require("dotenv").config();

const db = require("../db");
const storage = require("../services/storage");
const ocr = require("../services/ocr");
const entities = require("../services/entities");

// ---------------------------------------------------------------
// OCR worker (F3) and the rules half of entity extraction (F4).
//
//   npm run worker
//
// A separate process, not inline in the upload request. OCR takes
// seconds; an officer uploading an FIR should not wait for it. Upload
// returns immediately with ocr_status='pending' and this picks it up.
//
// THE RULE THAT MATTERS: the plaintext never touches disk. The blob is
// read through storage.retrieve(), which decrypts in memory, and the
// decrypted bytes are passed straight to the recogniser. Writing a
// temp file "just for tesseract" would put an unencrypted victim
// statement in the filesystem and undo the entire storage design.
//
// The database is the only interface between this and the backend. It
// writes extracted_text, ocr_status and entities; it calls no endpoint,
// and no endpoint calls it.
// ---------------------------------------------------------------

const BATCH = Number(process.env.OCR_BATCH || 5);
const IDLE_MS = Number(process.env.OCR_POLL_MS || 5000);

let stopping = false;

async function claimBatch() {
    // One statement claims and reads. SELECT-then-UPDATE would let two
    // workers polling at the same moment pick up the same document -
    // the SELECT's row locks are released as soon as it returns unless
    // it is inside a transaction, so the "skip locked" would protect
    // nothing. Moving the rows to 'processing' in the same UPDATE that
    // returns them is what makes running two workers safe.
    //
    // ponytail: a worker killed mid-document leaves its rows in
    // 'processing' forever. Add a reaper (reset 'processing' older than
    // N minutes back to 'pending') if that starts happening.
    const { rows } = await db.query(
        `UPDATE document_versions
            SET ocr_status = 'processing'
          WHERE id IN (
                SELECT id
                  FROM document_versions
                 WHERE ocr_status = 'pending'
                 ORDER BY uploaded_at ASC
                 LIMIT $1
                   FOR UPDATE SKIP LOCKED
          )
      RETURNING id, storage_path, wrapped_key, iv, auth_tag, mime_type, document_id`,
        [BATCH]
    );
    return rows;
}

async function markFailed(id, reason) {
    await db
        .query("UPDATE document_versions SET ocr_status = 'failed' WHERE id = $1", [id])
        .catch(() => {});
    console.error(`  version ${id}: failed (${reason})`);
}

async function processOne(row) {
    // Not an image - there is nothing for this pipeline to read. Mark it
    // done rather than failed: a PDF or a text file is not an error, it
    // just is not OCR work.
    if (!ocr.canRead(row.mime_type)) {
        if (String(row.mime_type || "").startsWith("text/")) {
            // A text upload already is its own extracted text, so index
            // it and run the entity rules over it.
            const plaintext = await storage.retrieve(row);
            const text = plaintext.toString("utf8");

            await db.query(
                `UPDATE document_versions
                    SET extracted_text = $1, entities = $2, ocr_status = 'done'
                  WHERE id = $3`,
                [text, entities.extract(text), row.id]
            );
            console.log(`  version ${row.id}: indexed as text (${text.length} chars)`);
            return;
        }

        await db.query(
            "UPDATE document_versions SET ocr_status = 'done' WHERE id = $1",
            [row.id]
        );
        console.log(`  version ${row.id}: skipped (${row.mime_type || "unknown type"})`);
        return;
    }

    // Decrypt in memory. Nothing below writes it anywhere.
    const plaintext = await storage.retrieve(row);

    const result = await ocr.recognise(plaintext);
    const found = entities.extract(result.text);

    await db.query(
        `UPDATE document_versions
            SET extracted_text = $1,
                entities       = $2,
                ocr_status     = 'done'
          WHERE id = $3`,
        [result.text, { ...found, confidence: result.confidence, skew: result.skew }, row.id]
    );

    console.log(
        `  version ${row.id}: ${result.text.length} chars, ` +
        `confidence ${Math.round(result.confidence ?? 0)}, skew ${result.skew}, ` +
        `${found.persons.length} persons`
    );
}

async function tick() {
    const rows = await claimBatch();
    if (rows.length === 0) return 0;

    console.log(`Processing ${rows.length} pending version(s)...`);

    for (const row of rows) {
        if (stopping) break;
        try {
            await processOne(row);
        } catch (err) {
            // One bad scan must not take down the worker. Mark it and
            // keep going - a stuck queue is worse than a failed page.
            await markFailed(row.id, err.message);
        }
    }
    return rows.length;
}

async function main() {
    console.log(`OCR worker starting (languages: ${ocr.LANGS})`);
    console.log("Plaintext is decrypted in memory only and never written to disk.");

    while (!stopping) {
        let handled = 0;
        try {
            handled = await tick();
        } catch (err) {
            console.error("poll failed:", err.message);
        }

        if (!stopping && handled === 0) {
            await new Promise((r) => setTimeout(r, IDLE_MS));
        }
    }

    await ocr.shutdown();
    await db.pool.end().catch(() => {});
    console.log("OCR worker stopped.");
}

for (const sig of ["SIGINT", "SIGTERM"]) {
    process.on(sig, () => {
        if (stopping) process.exit(1);
        console.log(`\n${sig} - finishing current document...`);
        stopping = true;
    });
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
