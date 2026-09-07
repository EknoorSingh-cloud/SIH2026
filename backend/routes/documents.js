const express = require("express");
const multer = require("multer");
const crypto = require("crypto");

const db = require("../db");
const storage = require("../services/storage");
const ledger = require("../services/ledger");
const audit = require("../services/audit");
const { requireAuth } = require("../middleware/auth");
const { requirePermission } = require("../middleware/policy");

const router = express.Router();

// Files are held in memory so we can hash before writing anything.
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 25 * 1024 * 1024 },
});

// Look up which case a document belongs to. The policy engine needs
// this to run its assignment check.
async function caseIdForDocument(req) {
    const { rows } = await db.query(
        "SELECT case_id FROM documents WHERE id = $1",
        [req.params.document_id]
    );
    return rows[0] ? rows[0].case_id : null;
}

async function sensitivityForDocument(documentId) {
    const { rows } = await db.query(
        `SELECT c.sensitivity
       FROM documents d JOIN cases c ON c.id = d.case_id
      WHERE d.id = $1`,
        [documentId]
    );
    return rows[0] ? rows[0].sensitivity : null;
}

// ---------------------------------------------------------------
// POST /documents        upload, creates version 1
// ---------------------------------------------------------------
router.post(
    "/",
    requireAuth,
    upload.single("file"),
    requirePermission("document.upload", (req) => req.body.case_id),
    async (req, res, next) => {
        const { case_id, title, doc_type } = req.body || {};

        if (!req.file) {
            return res
                .status(400)
                .json({ error: "bad_request", message: "file is required." });
        }
        if (!case_id || !title) {
            return res
                .status(400)
                .json({ error: "bad_request", message: "case_id and title are required." });
        }

        const client = await db.pool.connect();
        try {
            const blob = await storage.store(req.file.buffer);

            await client.query("BEGIN");

            const doc = await client.query(
                `INSERT INTO documents (case_id, title, doc_type, current_version, created_by)
         VALUES ($1, $2, $3, 1, $4) RETURNING id`,
                [case_id, title, doc_type || "other", req.user.id]
            );
            const documentId = doc.rows[0].id;

            const ver = await client.query(
                `INSERT INTO document_versions
           (document_id, version, sha256, storage_path, size_bytes, mime_type,
            wrapped_key, iv, auth_tag, uploaded_by)
         VALUES ($1, 1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING id, version, sha256, size_bytes, uploaded_at,
                   anchor_status, ocr_status`,
                [
                    documentId,
                    blob.sha256,
                    blob.storage_path,
                    blob.size_bytes,
                    req.file.mimetype,
                    blob.wrapped_key,
                    blob.iv,
                    blob.auth_tag,
                    req.user.id,
                ]
            );

            await client.query("COMMIT");

            await audit.append({
                userId: req.user.id,
                action: "upload",
                documentId,
                caseId: case_id,
                version: 1,
                detail: { sha256: blob.sha256, title },
                ip: req.ip,
            });

            // Anchoring is asynchronous on purpose. A slow or unreachable
            // ledger must not fail a user's upload.
            ledger
                .anchor({
                    versionId: ver.rows[0].id,
                    documentId,
                    sha256: blob.sha256,
                    signedBy: req.user.id,
                })
                .catch((e) => console.error("anchor failed", e));

            return res.status(201).json({
                document_id: documentId,
                ...ver.rows[0],
                uploaded_by: req.user,
            });
        } catch (err) {
            await client.query("ROLLBACK").catch(() => {});
            next(err);
        } finally {
            client.release();
        }
    }
);

// ---------------------------------------------------------------
// GET /documents/:document_id        metadata only
// ---------------------------------------------------------------
router.get(
    "/:document_id",
    requireAuth,
    requirePermission("document.view", caseIdForDocument),
    async (req, res, next) => {
        try {
            const { rows } = await db.query(
                `SELECT id, case_id, title, doc_type, current_version, created_at
           FROM documents WHERE id = $1`,
                [req.params.document_id]
            );
            if (!rows[0]) {
                return res.status(404).json({ error: "not_found", message: "Not found." });
            }

            await audit.append({
                userId: req.user.id,
                action: "view",
                documentId: req.params.document_id,
                caseId: rows[0].case_id,
                ip: req.ip,
            });

            return res.json(rows[0]);
        } catch (err) {
            next(err);
        }
    }
);

// ---------------------------------------------------------------
// GET /documents/:document_id/content        the actual file
// ---------------------------------------------------------------
router.get(
    "/:document_id/content",
    requireAuth,
    requirePermission("document.download", caseIdForDocument),
    async (req, res, next) => {
        try {
            const version = req.query.version ? parseInt(req.query.version, 10) : null;

            const { rows } = await db.query(
                `SELECT v.*, d.case_id, d.title
           FROM document_versions v
           JOIN documents d ON d.id = v.document_id
          WHERE v.document_id = $1
            AND v.version = COALESCE($2, d.current_version)`,
                [req.params.document_id, version]
            );

            const row = rows[0];
            if (!row) {
                return res.status(404).json({ error: "not_found", message: "Not found." });
            }

            const sensitivity = await sensitivityForDocument(req.params.document_id);

            // On a protected case, redaction is not optional and the client
            // does not get to decide. Until the redaction service is wired
            // up, refuse rather than serve an unredacted copy - handing out
            // an identifying document is the exact failure this system
            // exists to prevent.
            if (sensitivity === "protected" && process.env.REDACTION_ENABLED !== "true") {
                await audit.append({
                    userId: req.user.id,
                    action: "access_denied",
                    documentId: req.params.document_id,
                    caseId: row.case_id,
                    detail: { reason: "redaction_unavailable" },
                    ip: req.ip,
                });
                return res.status(503).json({
                    error: "redaction_unavailable",
                    message:
                        "This case requires redaction before release and the redaction service is not available.",
                });
            }

            let plaintext;
            try {
                plaintext = await storage.retrieve(row);
            } catch (e) {
                // GCM refused to authenticate. The blob on disk is not what
                // was stored.
                return res.status(409).json({
                    error: "integrity_failure",
                    message: "Stored file failed its integrity check. Run verify.",
                });
            }

            await audit.append({
                userId: req.user.id,
                action: sensitivity === "protected" ? "export_redacted" : "download",
                documentId: req.params.document_id,
                caseId: row.case_id,
                version: row.version,
                ip: req.ip,
            });

            res.setHeader("Content-Type", row.mime_type || "application/octet-stream");
            res.setHeader(
                "Content-Disposition",
                `attachment; filename="${row.title.replace(/[^\w.-]/g, "_")}"`
            );
            // Watermarks the copy with who pulled it. A leak stays traceable.
            res.setHeader("X-Released-To", req.user.service_number);

            return res.send(plaintext);
        } catch (err) {
            next(err);
        }
    }
);

// ---------------------------------------------------------------
// GET /documents/:document_id/versions
// ---------------------------------------------------------------
router.get(
    "/:document_id/versions",
    requireAuth,
    requirePermission("document.view", caseIdForDocument),
    async (req, res, next) => {
        try {
            const { rows } = await db.query(
                `SELECT v.id, v.version, v.sha256, v.size_bytes, v.uploaded_at,
                v.change_note, v.anchor_status, v.ledger_tx_id, v.ocr_status,
                u.name, u.service_number, u.rank
           FROM document_versions v
           JOIN users u ON u.id = v.uploaded_by
          WHERE v.document_id = $1
          ORDER BY v.version ASC`,
                [req.params.document_id]
            );
            return res.json(rows);
        } catch (err) {
            next(err);
        }
    }
);

// ---------------------------------------------------------------
// POST /documents/:document_id/versions        new version
// Nothing is overwritten. The old version stays retrievable forever.
// ---------------------------------------------------------------
router.post(
    "/:document_id/versions",
    requireAuth,
    upload.single("file"),
    requirePermission("document.new_version", caseIdForDocument),
    async (req, res, next) => {
        if (!req.file) {
            return res
                .status(400)
                .json({ error: "bad_request", message: "file is required." });
        }

        const client = await db.pool.connect();
        try {
            const blob = await storage.store(req.file.buffer);

            await client.query("BEGIN");

            const cur = await client.query(
                "SELECT case_id, current_version FROM documents WHERE id = $1 FOR UPDATE",
                [req.params.document_id]
            );
            if (!cur.rows[0]) {
                await client.query("ROLLBACK");
                return res.status(404).json({ error: "not_found", message: "Not found." });
            }

            const next_version = cur.rows[0].current_version + 1;

            const ver = await client.query(
                `INSERT INTO document_versions
           (document_id, version, sha256, storage_path, size_bytes, mime_type,
            wrapped_key, iv, auth_tag, uploaded_by, change_note)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         RETURNING id, version, sha256, size_bytes, uploaded_at, anchor_status`,
                [
                    req.params.document_id,
                    next_version,
                    blob.sha256,
                    blob.storage_path,
                    blob.size_bytes,
                    req.file.mimetype,
                    blob.wrapped_key,
                    blob.iv,
                    blob.auth_tag,
                    req.user.id,
                    req.body.change_note || null,
                ]
            );

            await client.query(
                "UPDATE documents SET current_version = $1 WHERE id = $2",
                [next_version, req.params.document_id]
            );

            await client.query("COMMIT");

            await audit.append({
                userId: req.user.id,
                action: "new_version",
                documentId: req.params.document_id,
                caseId: cur.rows[0].case_id,
                version: next_version,
                detail: { sha256: blob.sha256 },
                ip: req.ip,
            });

            ledger
                .anchor({
                    versionId: ver.rows[0].id,
                    documentId: req.params.document_id,
                    sha256: blob.sha256,
                    signedBy: req.user.id,
                })
                .catch((e) => console.error("anchor failed", e));

            return res.status(201).json(ver.rows[0]);
        } catch (err) {
            await client.query("ROLLBACK").catch(() => {});
            next(err);
        } finally {
            client.release();
        }
    }
);

// ---------------------------------------------------------------
// POST /documents/:document_id/verify
//
// The demo. Recompute the hash of what is actually on disk and
// compare it to what the ledger recorded at upload time.
//
// Returns 200 even when verification fails. A mismatch is a valid
// answer to the question, not a server error.
// ---------------------------------------------------------------
router.post(
    "/:document_id/verify",
    requireAuth,
    requirePermission("document.verify", caseIdForDocument),
    async (req, res, next) => {
        try {
            const version = req.body && req.body.version ? req.body.version : null;

            const { rows } = await db.query(
                `SELECT v.*, d.case_id
           FROM document_versions v
           JOIN documents d ON d.id = v.document_id
          WHERE v.document_id = $1
            AND v.version = COALESCE($2, d.current_version)`,
                [req.params.document_id, version]
            );

            const row = rows[0];
            if (!row) {
                return res.status(404).json({ error: "not_found", message: "Not found." });
            }

            const chainRecord = await ledger.lookup(row.id);

            let storedHash = null;
            let failure = null;

            try {
                const plaintext = await storage.retrieve(row);
                storedHash = crypto.createHash("sha256").update(plaintext).digest("hex");
            } catch (e) {
                // Decryption failed its authentication tag, which means the
                // ciphertext on disk was modified.
                failure = "ciphertext_modified";
            }

            const verified =
                !failure &&
                !!chainRecord &&
                storedHash === row.sha256 &&
                storedHash === chainRecord.sha256;

            await audit.append({
                userId: req.user.id,
                action: "verify",
                documentId: req.params.document_id,
                caseId: row.case_id,
                version: row.version,
                detail: { verified, failure },
                ip: req.ip,
            });

            const { rows: signer } = await db.query(
                "SELECT id, name, service_number, rank FROM users WHERE id = $1",
                [row.uploaded_by]
            );

            return res.json({
                verified,
                failure,
                version: row.version,
                stored_hash: storedHash,
                recorded_hash: row.sha256,
                ledger_hash: chainRecord ? chainRecord.sha256 : null,
                ledger_tx_id: row.ledger_tx_id,
                anchored_at: row.anchored_at,
                signed_by: signer[0] || null,
            });
        } catch (err) {
            next(err);
        }
    }
);

// ---------------------------------------------------------------
// GET /documents/:document_id/audit
// ---------------------------------------------------------------
router.get(
    "/:document_id/audit",
    requireAuth,
    requirePermission("document.view", caseIdForDocument),
    async (req, res, next) => {
        try {
            const { rows } = await db.query(
                `SELECT a.id, a.action, a.version, a.detail, a.occurred_at,
                a.prev_hash, a.entry_hash,
                u.name, u.service_number, u.rank
           FROM audit_log a
           LEFT JOIN users u ON u.id = a.user_id
          WHERE a.document_id = $1
          ORDER BY a.id ASC`,
                [req.params.document_id]
            );

            const chain = await audit.verifyChain(req.params.document_id);

            return res.json({
                chain_intact: chain.intact,
                broken_at: chain.brokenAt,
                entries: rows,
            });
        } catch (err) {
            next(err);
        }
    }
);

module.exports = router;