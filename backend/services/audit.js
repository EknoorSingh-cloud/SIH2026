const db = require("../db");
const { sha256 } = require("./crypto");

const GENESIS = "0".repeat(64);

// Every entry stores the hash of the entry before it. Alter or remove
// any row and every hash after it stops matching, so tampering with
// the log itself becomes detectable.
//
// The advisory lock means two concurrent requests cannot both read the
// same "last hash" and produce a forked chain.
async function append({
                          userId = null,
                          action,
                          documentId = null,
                          caseId = null,
                          version = null,
                          detail = null,
                          ip = null,
                      }) {
    const client = await db.pool.connect();
    try {
        await client.query("BEGIN");
        await client.query("SELECT pg_advisory_xact_lock(4815162342)");

        const prev = await client.query(
            "SELECT entry_hash FROM audit_log ORDER BY id DESC LIMIT 1"
        );
        const prevHash = prev.rows[0] ? prev.rows[0].entry_hash : GENESIS;

        const occurredAt = new Date().toISOString();
        const payload = [
            prevHash,
            userId,
            action,
            documentId,
            caseId,
            version,
            occurredAt,
            detail ? JSON.stringify(detail) : "",
        ].join("|");

        const entryHash = sha256(payload);

        await client.query(
            `INSERT INTO audit_log
         (user_id, action, document_id, case_id, version,
          detail, ip, occurred_at, prev_hash, entry_hash)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
            [
                userId,
                action,
                documentId,
                caseId,
                version,
                detail,
                ip,
                occurredAt,
                prevHash,
                entryHash,
            ]
        );

        await client.query("COMMIT");
        return entryHash;
    } catch (err) {
        await client.query("ROLLBACK");
        // An audit write failing must never silently succeed, but it also
        // must not take down the request that triggered it.
        console.error("AUDIT WRITE FAILED", err);
        throw err;
    } finally {
        client.release();
    }
}

// Walk the chain and confirm every link still matches.
// This is what backs the chain_intact flag in the API.
async function verifyChain(documentId = null) {
    const { rows } = documentId
        ? await db.query(
            "SELECT * FROM audit_log WHERE document_id = $1 ORDER BY id ASC",
            [documentId]
        )
        : await db.query("SELECT * FROM audit_log ORDER BY id ASC");

    let prevHash = GENESIS;
    for (const row of rows) {
        if (row.prev_hash !== prevHash) {
            return { intact: false, brokenAt: row.id };
        }
        const payload = [
            row.prev_hash,
            row.user_id,
            row.action,
            row.document_id,
            row.case_id,
            row.version,
            new Date(row.occurred_at).toISOString(),
            row.detail ? JSON.stringify(row.detail) : "",
        ].join("|");

        if (sha256(payload) !== row.entry_hash) {
            return { intact: false, brokenAt: row.id };
        }
        prevHash = row.entry_hash;
    }
    return { intact: true, brokenAt: null };
}

module.exports = { append, verifyChain, GENESIS };