const assert = require("assert");
const { PDFDocument } = require("pdf-lib");

const dsc = require("../services/dsc");
const watermark = require("../services/watermark");
const certificate = require("../services/certificate");
const icjs = require("../services/icjs");

// ---------------------------------------------------------------
// Self-check for the backend services that have real logic in them.
// No database and no server - everything here is pure or in-memory.
//
//   node test/services.test.js
//
// Routes and SQL are not covered; those need a live Postgres and the
// demo script exercises them.
// ---------------------------------------------------------------

const HASH = "a".repeat(64);
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

// ---- F11: DSC / eSign ----

test("dsc: a signature it just made verifies", () => {
    const s = dsc.sign(HASH, "user-1");
    assert.strictEqual(dsc.verify(HASH, s.signature, s.certificate), true);
});

test("dsc: signature does not verify against a different hash", () => {
    const s = dsc.sign(HASH, "user-1");
    assert.strictEqual(dsc.verify("b".repeat(64), s.signature, s.certificate), false);
});

test("dsc: a garbage signature is false, not a thrown error", () => {
    const s = dsc.sign(HASH, "user-1");
    assert.strictEqual(dsc.verify(HASH, "not-base64-at-all", s.certificate), false);
    assert.strictEqual(dsc.verify(HASH, s.signature, "not-a-pem"), false);
});

test("dsc: reports the algorithm and carries its certificate", () => {
    const s = dsc.sign(HASH, "user-1");
    assert.strictEqual(s.algorithm, "ecdsa-p256-sha256");
    assert.ok(s.certificate.includes("BEGIN PUBLIC KEY"));
});

// ---- F8: watermarking ----

test("watermark: Devanagari is stripped, not thrown on", () => {
    // Helvetica cannot encode these. An officer named in Hindi must not
    // break the download path.
    assert.strictEqual(watermark.toWinAnsi("राजेश Kumar"), "Kumar");
    assert.ok(watermark.buildLabel({ name: "राजेश", serviceNumber: "MH-1" }).length > 0);
});

test("watermark: label carries every identifying field", () => {
    const label = watermark.buildLabel({
        serviceNumber: "MH-INS-4471",
        name: "A Deshmukh",
        caseNumber: "FIR/0142/2026",
        timestamp: "2026-09-07T10:00:00Z",
    });
    for (const part of ["MH-INS-4471", "A Deshmukh", "FIR/0142/2026"]) {
        assert.ok(label.includes(part), `label missing ${part}`);
    }
});

test("watermark: never empty, even with no metadata at all", () => {
    assert.strictEqual(watermark.buildLabel({}), "RELEASED COPY");
});

test("watermark: non-PDF passes through byte-identical", async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x01, 0x02]);
    const out = await watermark.apply(png, "image/png", { name: "X" });
    assert.ok(out.equals(png));
});

test("watermark: PDF is stamped and stays a valid PDF", async () => {
    const doc = await PDFDocument.create();
    doc.addPage([300, 300]);
    doc.addPage([300, 300]);
    const original = Buffer.from(await doc.save());

    const out = await watermark.apply(original, "application/pdf", {
        serviceNumber: "MH-INS-4471",
        name: "A Deshmukh",
        caseNumber: "FIR/0142/2026",
        timestamp: new Date().toISOString(),
    });

    assert.ok(!out.equals(original), "pdf was not modified");
    assert.strictEqual(out.subarray(0, 4).toString(), "%PDF");

    // Still parseable, and no pages were lost.
    const reloaded = await PDFDocument.load(out);
    assert.strictEqual(reloaded.getPageCount(), 2);
});

test("watermark: unparseable PDF still returns bytes rather than failing", async () => {
    const junk = Buffer.from("%PDF-1.7 this is not really a pdf");
    const out = await watermark.apply(junk, "application/pdf", { name: "X" });
    assert.ok(out.equals(junk));
});

// ---- F2: BSA s.63 certificate ----

const CERT_FIXTURE = {
    document: { id: "doc-1", title: "First Information Report", doc_type: "fir" },
    caseRecord: {
        case_number: "FIR/0142/2026",
        title: "State v. Unknown",
        sensitivity: "normal",
    },
    version: {
        version: 2,
        sha256: HASH,
        size_bytes: 48210,
        mime_type: "application/pdf",
        uploaded_at: "2026-02-11T09:24:00.000Z",
        ledger_tx_id: "stub-deadbeef",
        anchored_at: "2026-02-11T09:24:03.000Z",
        anchor_status: "anchored",
    },
    producedBy: {
        id: "user-1",
        name: "A Deshmukh",
        rank: "inspector",
        service_number: "MH-INS-4471",
        station: "Sadar Bazar",
    },
    verification: { verified: true, verified_at: "2026-09-07T10:00:00.000Z" },
};

test("certificate: produces a loadable multi-page PDF", async () => {
    const pdf = await certificate.build(CERT_FIXTURE);

    assert.strictEqual(pdf.subarray(0, 4).toString(), "%PDF");

    const reloaded = await PDFDocument.load(pdf);
    // Part A plus the blank Part B does not fit on one page.
    assert.ok(reloaded.getPageCount() >= 2, "certificate should run past one page");
});

test("certificate: survives a name it cannot encode", async () => {
    const pdf = await certificate.build({
        ...CERT_FIXTURE,
        producedBy: { ...CERT_FIXTURE.producedBy, name: "राजेश कुमार" },
    });
    assert.strictEqual(pdf.subarray(0, 4).toString(), "%PDF");
});

test("certificate: tolerates a document that was never anchored", async () => {
    const pdf = await certificate.build({
        ...CERT_FIXTURE,
        version: {
            ...CERT_FIXTURE.version,
            ledger_tx_id: null,
            anchored_at: null,
            anchor_status: "pending",
        },
    });
    assert.strictEqual(pdf.subarray(0, 4).toString(), "%PDF");
});

test("certificate: states the statutory operating condition", () => {
    assert.ok(certificate.OPERATION_STATEMENT.includes("operating properly"));
});

// ---- F10: ICJS mock adapter ----

test("icjs: known FIR returns a record flagged as mock", async () => {
    const fir = await icjs.fetchFir("FIR/0142/2026");
    assert.strictEqual(fir.cctns_id, "MH01-2026-0000142");
    assert.strictEqual(fir.mock, true);
});

test("icjs: unknown FIR is null, not an invented record", async () => {
    assert.strictEqual(await icjs.fetchFir("FIR/9999/2026"), null);
});

test("icjs: linkage fails cleanly for an unknown FIR", async () => {
    const r = await icjs.linkCase({ caseNumber: "C-1", firNumber: "FIR/9999/2026" });
    assert.strictEqual(r.linked, false);
    assert.strictEqual(r.reason, "fir_not_found");
});

test("icjs: linkage returns a correlation id for a known FIR", async () => {
    const r = await icjs.linkCase({ caseNumber: "C-1", firNumber: "FIR/0142/2026" });
    assert.strictEqual(r.linked, true);
    assert.ok(r.correlation_id.includes("MH01-2026-0000142"));
});

test("icjs: metadata payload carries the hash and never the content", () => {
    const payload = icjs.documentMetadataPayload({
        document: { id: "doc-1", title: "FIR", doc_type: "fir" },
        caseRecord: { case_number: "FIR/0142/2026", sensitivity: "protected" },
        version: {
            version: 1,
            sha256: HASH,
            ledger_tx_id: "stub-1",
            anchored_at: "2026-02-11T09:24:03.000Z",
        },
    });

    assert.strictEqual(payload.integrity.hash, HASH);

    // ICJS gets a pointer and a hash. If the document text, entities, or
    // any victim data ever appear in this payload, that is a leak across
    // an organisational boundary.
    const wire = JSON.stringify(payload);
    for (const forbidden of ["extracted_text", "entities", "wrapped_key", "storage_path"]) {
        assert.ok(!wire.includes(forbidden), `payload leaked ${forbidden}`);
    }
});

// ---- F9: route ordering ----

test("routes: /search is registered before /:document_id", () => {
    // Express matches in order. If these ever swap, every search becomes
    // a lookup for a document whose id is the word "search" and the
    // failure is a confusing 404, not an error anyone can trace.
    const router = require("../routes/documents");
    const paths = router.stack.filter((l) => l.route).map((l) => l.route.path);

    const search = paths.indexOf("/search");
    const byId = paths.indexOf("/:document_id");

    assert.ok(search !== -1, "/search route is missing");
    assert.ok(byId !== -1, "/:document_id route is missing");
    assert.ok(search < byId, "/search must be registered before /:document_id");
});

// ---------------------------------------------------------------

(async () => {
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

    console.log(`\n${tests.length - failed}/${tests.length} passed`);
    process.exit(failed ? 1 : 0);
})();
