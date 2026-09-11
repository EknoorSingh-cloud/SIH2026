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

const send = (token, method, path, body) =>
    fetch(BASE + path, {
        method,
        headers: {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...(body instanceof FormData ? {} : { "Content-Type": "application/json" }),
        },
        body: body instanceof FormData ? body : body && JSON.stringify(body),
    });

const userId = async (serviceNumber) =>
    (await db.query("SELECT id FROM users WHERE service_number = $1", [serviceNumber]))
        .rows[0].id;

// Run SQL that is expected to be refused, then roll back whatever
// happened - so a guarantee that has quietly stopped holding cannot
// leave a stray row in an append-only log on its way to failing.
async function rolledBack(fn) {
    const client = await db.pool.connect();
    try {
        await client.query("BEGIN");
        return await fn(client);
    } finally {
        await client.query("ROLLBACK");
        client.release();
    }
}

async function refused(client, sql, params) {
    await client.query("SAVEPOINT s");
    try {
        await client.query(sql, params);
    } catch (err) {
        await client.query("ROLLBACK TO SAVEPOINT s");
        return err;
    }
    throw new Error(`database accepted: ${sql}`);
}

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

test("audit chain stays intact when two documents are used interleaved", async () => {
    // The regression this guards: chain_intact used to be computed over
    // one document's rows only. Because the chain is global - an entry
    // links to whatever was written before it anywhere - a document
    // whose entries are not consecutive reported BROKEN during entirely
    // normal use. It showed up as a red banner on the audit screen with
    // nothing actually wrong.
    const cases = await get(token, "/cases").then((r) => r.json());
    assert.ok(cases.items.length >= 1, "no cases seeded");

    // Touch documents in two different cases, alternating, so this
    // document's audit rows are definitely not adjacent.
    const docsPerCase = [];
    for (const c of cases.items) {
        const docs = await get(token, `/cases/${c.id}/documents`).then((r) => r.json());
        if (docs[0]) docsPerCase.push(docs[0].id);
    }

    if (docsPerCase.length < 2) {
        console.log("        (need a document in two cases, skipping)");
        return;
    }

    for (let i = 0; i < 2; i++) {
        for (const id of docsPerCase) await get(token, `/documents/${id}`);
    }

    const audit = await get(token, `/documents/${docsPerCase[0]}/audit`).then((r) => r.json());

    assert.strictEqual(
        audit.chain_intact,
        true,
        `chain reported broken at entry ${audit.broken_at} with nothing actually wrong`
    );
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

// ---- mobile OTP sign-in ----
//
// The code the server sends is never readable - only its HMAC is
// stored. So these tests plant their own newest challenge with a known
// code, which also retires the one the request step just created.

const { hashOtp } = require("../services/crypto");
const OTP_OFFICER = "DL-SI-2002";
const OTP_MOBILE = "0000000002";

async function plantChallenge(code, { attempts = 0, expiresIn = "5 minutes" } = {}) {
    const id = crypto.randomUUID();
    await db.query(
        `INSERT INTO otp_challenges (id, user_id, otp_hash, expires_at, attempts, max_attempts)
         VALUES ($1, $2, $3, now() + $4::interval, $5, 5)`,
        [id, await userId(OTP_OFFICER), hashOtp(id, code), expiresIn, attempts]
    );
    return id;
}

const verifyOtp = (otp) =>
    send(null, "POST", "/auth/otp/verify", { mobile_number: OTP_MOBILE, otp });

// Four requests per run against a per-IP limit of ten per 15 minutes:
// restart the server if you run this more than twice in that window.
test("otp: a code is sent only when service number, password and mobile all match", async () => {
    const ask = (password, mobile_number) =>
        send(null, "POST", "/auth/otp/request", {
            service_number: OTP_OFFICER,
            password,
            mobile_number,
        });

    await db.query("DELETE FROM otp_challenges WHERE user_id = $1", [await userId(OTP_OFFICER)]);

    const wrongPassword = await ask("not-the-password", OTP_MOBILE);
    const wrongPhone = await ask("Test@1234", "0000000005"); // another officer's number
    assert.strictEqual(wrongPassword.status, 401);
    assert.strictEqual(wrongPhone.status, 401);
    // Same answer, so the endpoint cannot confirm whose phone is whose.
    assert.deepStrictEqual(await wrongPassword.json(), await wrongPhone.json());

    assert.strictEqual((await ask("Test@1234", OTP_MOBILE)).status, 202);
    assert.strictEqual(
        (await ask("Test@1234", OTP_MOBILE)).status, 429, "a second code within a minute was sent"
    );
});

test("otp: a wrong code is refused and costs an attempt", async () => {
    const id = await plantChallenge("314159");
    const res = await verifyOtp("271828");

    assert.strictEqual(res.status, 401);
    assert.strictEqual((await res.json()).error, "invalid_code");
    const { rows } = await db.query("SELECT attempts FROM otp_challenges WHERE id = $1", [id]);
    assert.strictEqual(rows[0].attempts, 1);
});

test("otp: the right code signs in once, and only once", async () => {
    const id = await plantChallenge("161803");

    const first = await verifyOtp("161803");
    assert.strictEqual(first.status, 200);
    const session = await first.json();
    assert.ok(session.session_token, "no session issued");
    assert.strictEqual(session.user.service_number, OTP_OFFICER);

    const me = await get(session.session_token, "/me").then((r) => r.json());
    assert.strictEqual(me.user.service_number, OTP_OFFICER);

    const { rows } = await db.query(
        "SELECT verified_at FROM otp_challenges WHERE id = $1", [id]
    );
    assert.ok(rows[0].verified_at, "challenge not marked used");

    const replay = await verifyOtp("161803");
    assert.strictEqual(replay.status, 401, "a used code signed in a second time");
});

test("otp: an exhausted challenge refuses even the right code", async () => {
    await plantChallenge("141421", { attempts: 5 });
    assert.strictEqual((await verifyOtp("141421")).status, 401);
});

test("otp: an expired challenge refuses the right code", async () => {
    await plantChallenge("173205", { expiresIn: "-1 second" });
    assert.strictEqual((await verifyOtp("173205")).status, 401);
});

// ---- case lifecycle: every change lands in that case's audit trail ----

test("case trail: create, assign, file, edit, delete attempt, unassign - all recorded, all attributed", async () => {
    const inspector = await userId("DL-INS-1001");
    const si = await userId("DL-SI-2002");

    // The body names someone else as creator. The server must ignore it.
    const created = await send(token, "POST", "/cases", {
        case_number: `TEST/${Date.now()}`,
        title: "Integration test case",
        created_by: si,
        station: "Nowhere",
    });
    assert.strictEqual(created.status, 201);
    const kase = await created.json();
    assert.strictEqual(kase.created_by, inspector, "creator taken from the request body");
    assert.notStrictEqual(kase.station, "Nowhere", "station taken from the request body");

    const detail = await get(token, `/cases/${kase.id}`).then((r) => r.json());
    assert.ok(detail.officers.some((o) => o.id === inspector), "creator not assigned");

    assert.strictEqual(
        (await send(token, "POST", `/cases/${kase.id}/assignments`, { user_id: si })).status, 201
    );
    assert.strictEqual(
        (await send(token, "POST", `/cases/${kase.id}/assignments`, { user_id: si })).status, 409
    );

    const upload = async (docType, extra = {}) => {
        const form = new FormData();
        form.append("case_id", kase.id);
        form.append("doc_type", docType);
        for (const [k, v] of Object.entries(extra)) form.append(k, v);
        form.append("file", new Blob([`evidence ${crypto.randomUUID()}`], { type: "text/plain" }), "e.txt");
        const res = await send(token, "POST", "/documents", form);
        assert.strictEqual(res.status, 201, `upload failed: ${res.status}`);
        return res.json();
    };

    // No title anywhere: the number is the identifier.
    const stm1 = await upload("statement", { enteredBy: si, created_by: si });
    const stm2 = await upload("statement", { title: "Witness statement - shopkeeper" });
    assert.strictEqual(stm1.evidence_number, "STM-001");
    assert.strictEqual(stm2.evidence_number, "STM-002");

    // Numbering under contention: parallel uploads never share a number.
    const parallel = await Promise.all([1, 2, 3, 4].map(() => upload("notice")));
    assert.deepStrictEqual(
        parallel.map((d) => d.evidence_number).sort(),
        ["NTC-001", "NTC-002", "NTC-003", "NTC-004"]
    );

    const { rows: filed } = await db.query(
        "SELECT created_by, title FROM documents WHERE id = $1", [stm1.document_id]
    );
    assert.strictEqual(filed[0].created_by, inspector, "uploader taken from the request body");
    assert.strictEqual(filed[0].title, "STM-001");

    assert.strictEqual(
        (await send(token, "PATCH", `/cases/${kase.id}`, { status: "under_investigation" })).status, 200
    );
    assert.strictEqual(
        (await send(token, "DELETE", `/documents/${stm1.document_id}`)).status, 405
    );
    assert.strictEqual(
        (await send(token, "DELETE", `/cases/${kase.id}/assignments/${si}`)).status, 204
    );

    const trail = await get(token, `/cases/${kase.id}/audit`).then((r) => r.json());
    assert.strictEqual(trail.chain_intact, true);
    assert.deepStrictEqual(
        trail.entries.map((e) => e.action),
        ["case_create", "assign", "upload", "upload", "upload", "upload", "upload", "upload",
         "case_update", "delete_attempt", "unassign"]
    );
    for (const e of trail.entries) {
        assert.strictEqual(e.user_id, inspector, `${e.action} attributed to ${e.user_id}`);
    }
    assert.ok(
        trail.entries.filter((e) => e.action === "upload").every((e) => e.evidence_number),
        "an upload entry does not name its evidence number"
    );
    assert.deepStrictEqual(
        trail.entries.find((e) => e.action === "case_update").detail.changes,
        { status: { from: "open", to: "under_investigation" } }
    );

    // Taken off the case, the sub-inspector can no longer see it.
    const siToken = await signIn("DL-SI-2002", "Test@1234");
    assert.strictEqual((await get(siToken, `/cases/${kase.id}`)).status, 404);
});

// ---- scheduled integrity check ----
//
// Runs the sweep in this process, against the same database and the
// same files the server uses. The damaged byte is always put back.

test("integrity sweep: damage alerts every officer on the case, once, and restoration is announced", async () => {
    const fs = require("fs");
    const path = require("path");
    const storage = require("../services/storage");
    const ledger = require("../services/ledger");
    const integrity = require("../services/integrity");

    if (storage.BACKEND !== "disk") {
        console.log("        (storage is not disk, skipping)");
        return;
    }

    const inspector = await userId("DL-INS-1001");
    const si = await userId("DL-SI-2002");

    const kase = await send(token, "POST", "/cases", {
        case_number: `TEST/INT/${Date.now()}`,
        title: "Integrity sweep test",
    }).then((r) => r.json());
    await send(token, "POST", `/cases/${kase.id}/assignments`, { user_id: si });

    const form = new FormData();
    form.append("case_id", kase.id);
    form.append("doc_type", "forensic_report");
    form.append("file", new Blob([`report ${crypto.randomUUID()}`], { type: "text/plain" }), "r.txt");
    const doc = await send(token, "POST", "/documents", form).then((r) => r.json());

    await send(token, "PATCH", `/cases/${kase.id}`, { status: "under_investigation" });

    // Anchoring runs after the upload returns; wait for it, then load
    // the anchors into this process's copy of the stub ledger.
    for (let i = 0; i < 50; i++) {
        const { rows } = await db.query(
            "SELECT anchor_status FROM document_versions WHERE id = $1", [doc.id]
        );
        if (rows[0].anchor_status === "anchored") break;
        await new Promise((r) => setTimeout(r, 100));
    }
    await ledger.rehydrate();

    const file = path.join(storage.BLOB_DIR,
        (await db.query("SELECT storage_path FROM document_versions WHERE id = $1", [doc.id]))
            .rows[0].storage_path);
    const flipFirstByte = () => {
        const bytes = fs.readFileSync(file);
        bytes[0] ^= 0xff;
        fs.writeFileSync(file, bytes);
    };
    const alerts = async () =>
        (await db.query(
            "SELECT user_id, kind FROM notifications WHERE document_id = $1 ORDER BY id",
            [doc.document_id]
        )).rows;

    // Capture texts instead of sending them. integrity.js calls
    // sms.send through the module, so replacing it here is what it uses.
    const sms = require("../services/sms");
    const realSend = sms.send;
    const texts = [];
    sms.send = async (to, body) => {
        texts.push({ to, body });
    };

    let whileTampered;
    let textsWhileTampered;
    try {
        await integrity.sweep();
        assert.deepStrictEqual(await alerts(), [], "an intact file raised an alert");

        flipFirstByte();
        try {
            await integrity.sweep();
            await integrity.sweep(); // still broken - must not alert a second time
            whileTampered = await alerts();
            textsWhileTampered = texts.filter((t) => t.body.includes(doc.evidence_number));
        } finally {
            flipFirstByte();
        }

        // Only this case's document was damaged; every other text in
        // `texts` would be a false alarm from somewhere else in the sweep.
        assert.deepStrictEqual(
            textsWhileTampered.map((t) => t.to).sort(),
            ["+910000000001", "+910000000002"],
            "expected exactly one SMS per officer on the case"
        );
        assert.strictEqual(texts.length, 2, `unexpected extra texts: ${JSON.stringify(texts)}`);
        assert.ok(textsWhileTampered[0].body.includes(kase.case_number));
    } finally {
        sms.send = realSend;
    }

    assert.deepStrictEqual(
        whileTampered.map((a) => a.kind),
        ["tamper", "tamper"],
        "expected exactly one tamper alert per officer"
    );
    assert.deepStrictEqual(
        new Set(whileTampered.map((a) => a.user_id)), new Set([inspector, si])
    );

    // The sub-inspector sees it in their own inbox, and nobody else can
    // mark it read for them.
    const siToken = await signIn("DL-SI-2002", "Test@1234");
    const inbox = await get(siToken, "/notifications").then((r) => r.json());
    const mine = inbox.items.find((n) => n.document_id === doc.document_id);
    assert.ok(mine && !mine.read_at, "alert missing from the officer's inbox");
    assert.strictEqual((await send(token, "POST", `/notifications/${mine.id}/read`)).status, 404);
    assert.strictEqual((await send(siToken, "POST", `/notifications/${mine.id}/read`)).status, 204);

    const docs = await get(token, `/cases/${kase.id}/documents`).then((r) => r.json());
    assert.strictEqual(docs[0].integrity_failed, true, "case list does not flag the document");

    const trail = await get(token, `/cases/${kase.id}/audit`).then((r) => r.json());
    const detected = trail.entries.find((e) => e.action === "verify" && e.detail.automated);
    assert.ok(detected, "no automated entry in the case audit trail");
    assert.strictEqual(detected.user_id, null);
    assert.strictEqual(detected.detail.failure, "ciphertext_modified");
    assert.strictEqual(trail.chain_intact, true);

    // File restored: the next pass says so in the app and by text, and
    // clears the flag.
    const textsBefore = texts.length;
    sms.send = async (to, body) => {
        texts.push({ to, body });
    };
    try {
        await integrity.sweep();
    } finally {
        sms.send = realSend;
    }
    const restoredTexts = texts.slice(textsBefore);
    assert.deepStrictEqual(
        restoredTexts.map((t) => t.to).sort(),
        ["+910000000001", "+910000000002"],
        "expected exactly one restoration SMS per officer"
    );
    assert.ok(restoredTexts.every((t) => t.body.includes("verifies again")));
    assert.deepStrictEqual(
        (await alerts()).map((a) => a.kind),
        ["tamper", "tamper", "integrity_restored", "integrity_restored"]
    );
    const { rows } = await db.query(
        "SELECT integrity_failed_at, integrity_checked_at FROM document_versions WHERE id = $1",
        [doc.id]
    );
    assert.strictEqual(rows[0].integrity_failed_at, null);
    assert.ok(rows[0].integrity_checked_at);
});

test("database: an exhibit's case, type and number cannot be changed", async () => {
    await rolledBack(async (client) => {
        const { rows } = await client.query(
            "SELECT id, case_id FROM documents ORDER BY created_at LIMIT 1"
        );
        const other = await client.query(
            "SELECT id FROM cases WHERE id <> $1 LIMIT 1", [rows[0].case_id]
        );

        await refused(client, "UPDATE documents SET evidence_number = 'FIR-999' WHERE id = $1", [rows[0].id]);
        await refused(client, "UPDATE documents SET doc_type = 'notice' WHERE id = $1", [rows[0].id]);
        await refused(client, "UPDATE documents SET case_id = $2 WHERE id = $1",
            [rows[0].id, other.rows[0].id]);
    });
});

test("database: a supplied evidence number is overwritten by the assigned one", async () => {
    await rolledBack(async (client) => {
        const { rows: c } = await client.query("SELECT id, created_by FROM cases LIMIT 1");
        const { rows } = await client.query(
            `INSERT INTO documents (case_id, title, doc_type, created_by, evidence_seq, evidence_number)
             VALUES ($1, '', 'charge_sheet', $2, 77, 'MINE-1') RETURNING evidence_number, title`,
            [c[0].id, c[0].created_by]
        );
        assert.match(rows[0].evidence_number, /^CHS-\d{3,}$/);
        assert.strictEqual(rows[0].title, rows[0].evidence_number);
    });
});

test("database: case events must name their case, and the right one", async () => {
    await rolledBack(async (client) => {
        const { rows: d } = await client.query("SELECT id, case_id FROM documents LIMIT 1");
        const { rows: other } = await client.query(
            "SELECT id FROM cases WHERE id <> $1 LIMIT 1", [d[0].case_id]
        );
        const insert = `INSERT INTO audit_log (action, document_id, case_id, prev_hash, entry_hash)
                        VALUES ($1, $2, $3, repeat('0', 64), repeat('0', 64))`;

        await refused(client, insert, ["upload", null, null]);          // no case at all
        await refused(client, insert, ["case_update", null, null]);
        await refused(client, insert, ["view", d[0].id, null]);        // document, no case
        await refused(client, insert, ["view", d[0].id, other[0].id]); // document, wrong case
    });
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
