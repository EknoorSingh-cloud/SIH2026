require("dotenv").config({ quiet: true });

const assert = require("assert");
const crypto = require("crypto");
const db = require("../db");

// ---------------------------------------------------------------
// Integration checks against a RUNNING server and a real database.
//
//   npm run dev            (in another terminal)
//   npm run test:integration
//
// Separate from `npm test`, which is deliberately dependency-free.
// These cover the things that can only go wrong once the pieces are
// wired together - specifically, what actually comes back over the
// wire for a protected case.
//
// The search leak this guards against was real: snippets were gated on
// REDACTION_ENABLED, so turning redaction ON turned the protection OFF
// and served the victim's name in search results. Nothing DB-free
// could have caught it.
// ---------------------------------------------------------------

const BASE = `http://localhost:${process.env.PORT || 5000}/api/v1`;

function totp(secret) {
    const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    let bits = 0, value = 0;
    const out = [];
    for (const c of secret) {
        const i = A.indexOf(c);
        if (i < 0) continue;
        value = (value << 5) | i;
        bits += 5;
        if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
    }
    const buf = Buffer.alloc(8);
    buf.writeUInt32BE(Math.floor(Date.now() / 1000 / 30), 4);
    const h = crypto.createHmac("sha1", Buffer.from(out)).update(buf).digest();
    const o = h[19] & 15;
    const n = (((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]) >>> 0;
    return String(n % 1000000).padStart(6, "0");
}

async function signIn(serviceNumber, password) {
    const { rows } = await db.query(
        "SELECT mfa_secret FROM users WHERE service_number = $1",
        [serviceNumber]
    );
    if (!rows[0]) throw new Error(`no such user ${serviceNumber}`);

    const login = await fetch(`${BASE}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ service_number: serviceNumber, password }),
    }).then((r) => r.json());

    const session = await fetch(`${BASE}/auth/mfa/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mfa_token: login.mfa_token, code: totp(rows[0].mfa_secret) }),
    }).then((r) => r.json());

    if (!session.session_token) throw new Error("sign in failed for " + serviceNumber);
    return session.session_token;
}

const get = (token, path) =>
    fetch(BASE + path, { headers: { Authorization: `Bearer ${token}` } });

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

let token;

test("search never returns a snippet for a protected case", async () => {
    // The regression. Whatever REDACTION_ENABLED is set to, the text of
    // an S.72 document must not come back in a search result.
    const res = await get(token, "/documents/search?q=Nehru");
    assert.strictEqual(res.status, 200);

    const body = await res.json();
    const leaks = body.items.filter(
        (i) => i.sensitivity === "protected" && i.snippet
    );

    assert.strictEqual(
        leaks.length,
        0,
        `protected snippet leaked: ${JSON.stringify(leaks.map((l) => l.snippet))}`
    );
});

test("search still returns snippets for ordinary cases", async () => {
    // The protection must not have been bought by breaking search.
    const body = await get(token, "/documents/search?q=Nehru").then((r) => r.json());
    const ordinary = body.items.filter((i) => i.sensitivity !== "protected");

    if (ordinary.length === 0) {
        console.log("        (no non-protected match seeded, skipping)");
        return;
    }
    assert.ok(ordinary.some((i) => i.snippet), "no snippet on any ordinary case");
});

test("search results only ever name cases the caller is assigned to", async () => {
    const body = await get(token, "/documents/search?q=Sharma").then((r) => r.json());

    const { rows } = await db.query(
        `SELECT c.id FROM cases c
           JOIN case_assignments a ON a.case_id = c.id
           JOIN users u ON u.id = a.user_id
          WHERE u.service_number = 'DL-INS-1001'`
    );
    const allowed = new Set(rows.map((r) => r.id));

    for (const item of body.items) {
        assert.ok(
            allowed.has(item.case_id),
            `search returned case ${item.case_number} the caller is not assigned to`
        );
    }
});

test("an unassigned officer sees nothing, whatever their rank", async () => {
    // Step 8 of the demo, asserted. A valid login on a real account with
    // no assignment must come back empty rather than merely hidden.
    const constable = await signIn("DL-CON-3003", "Test@1234").catch(() => null);
    if (!constable) {
        console.log("        (DL-CON-3003 not seeded, skipping)");
        return;
    }

    const cases = await get(constable, "/cases").then((r) => r.json());
    const hits = await get(constable, "/documents/search?q=Sharma").then((r) => r.json());

    const { rows } = await db.query(
        `SELECT count(*)::int n FROM case_assignments a
           JOIN users u ON u.id = a.user_id
          WHERE u.service_number = 'DL-CON-3003'`
    );

    if (rows[0].n === 0) {
        assert.strictEqual(cases.total, 0, "unassigned officer was shown cases");
        assert.strictEqual(hits.total, 0, "unassigned officer got search hits");
    } else {
        console.log(`        (constable is assigned to ${rows[0].n} case(s), skipping)`);
    }
});

test("the text endpoint withholds identifying entities on a protected case", async () => {
    const body = await get(token, "/documents/search?q=Sharma").then((r) => r.json());
    const target = body.items.find((i) => i.sensitivity === "protected");

    if (!target) {
        console.log("        (no protected document seeded, skipping)");
        return;
    }

    const res = await get(token, `/documents/${target.document_id}/text`);

    if (res.status === 503) {
        // Redaction disabled - refusing outright is the correct answer.
        return;
    }

    const text = await res.json();
    assert.ok(text.redacted, "protected text was not flagged as redacted");

    for (const key of ["persons", "addresses", "phones"]) {
        assert.ok(
            !text.entities || text.entities[key] === undefined,
            `identifying entity list "${key}" was returned for a protected case`
        );
    }
});

(async () => {
    try {
        await fetch(BASE.replace("/api/v1", "/"));
    } catch {
        console.error(`No server on ${BASE}. Start it with: npm run dev`);
        process.exit(1);
    }

    token = await signIn("DL-INS-1001", "Test@1234");

    let failed = 0;
    for (const [name, fn] of tests) {
        try {
            await fn();
            console.log(`  ok    ${name}`);
        } catch (err) {
            failed++;
            console.error(`  FAIL  ${name}`);
            console.error(`        ${err.message}`);
        }
    }

    await db.pool.end();
    console.log(`\n${tests.length - failed}/${tests.length} passed`);
    process.exit(failed ? 1 : 0);
})();
