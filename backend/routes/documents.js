const express = require("express");
const multer = require("multer");
const crypto = require("crypto");

const db = require("../db");
const storage = require("../services/storage");
const ledger = require("../services/ledger");
const audit = require("../services/audit");
const certificate = require("../services/certificate");
const watermark = require("../services/watermark");
const redaction = require("../services/redaction");
const { requireAuth } = require("../middleware/auth");
const { requirePermission, caseIdForDocument } = require("../middleware/policy");

const router = express.Router();

// Files are held in memory so we can hash before writing anything.
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 25 * 1024 * 1024 },
});

async function sensitivityForDocument(documentId) {
    const { rows } = await db.query(
        `SELECT c.sensitivity
       FROM documents d JOIN cases c ON c.id = d.case_id
      WHERE d.id = $1`,
        [documentId]
    );
    return rows[0] ? rows[0].sensitivity : null;
}

// Recompute the hash of what is actually on disk and compare it to
// both the stored value and the ledger.
//
// One function, two callers: /verify reports the result, and the
// certificate refuses to issue without it. A certificate must never
// attest to a hash that nobody just checked, so both paths have to
// reach the same answer the same way.
async function checkIntegrity(row) {
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

    return { verified, failure, storedHash, chainRecord };
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
                    station: req.user.station,
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
// GET /documents/search?q=
//
// MUST stay above /:document_id. Express matches routes in order, so
// with these two swapped every search would be read as a request for
// a document whose id is the word "search".
//
// There is deliberately no permission middleware here. Like GET /cases,
// the JOIN to case_assignments IS the restriction - it cannot be
// forgotten the way an optional WHERE clause can. A search must never
// reveal that a document exists in a case you are not assigned to.
// ---------------------------------------------------------------
router.get("/search", requireAuth, async (req, res, next) => {
    try {
        const q = (req.query.q || "").trim();
        if (!q) {
            return res
                .status(400)
                .json({ error: "bad_request", message: "q is required." });
        }

        const page = Math.max(1, parseInt(req.query.page, 10) || 1);
        const perPage = Math.min(100, parseInt(req.query.per_page, 10) || 25);

        // Snippets are withheld on protected cases until redaction is
        // live. The extracted text of an S.72 document contains exactly
        // the victim identity that redaction exists to strip, and a
        // search result is an export path like any other. The hit still
        // shows - the reader is assigned to the case - but the text does
        // not. Same reasoning as the 503 on /content.
        const snippetsAllowed = process.env.REDACTION_ENABLED === "true";

        // to_tsvector(...) here matches the expression on the GIN index
        // in schema.sql exactly. Change one and you must change both or
        // the index stops being used.
        const { rows } = await db.query(
            `SELECT d.id AS document_id, d.title, d.doc_type,
                    c.id AS case_id, c.case_number, c.sensitivity,
                    v.version, v.uploaded_at,
                    CASE
                      WHEN c.sensitivity = 'protected' AND NOT $3 THEN NULL
                      ELSE ts_headline('simple', v.extracted_text,
                                       plainto_tsquery('simple', $2),
                                       'MaxFragments=2,MaxWords=18,MinWords=5')
                    END AS snippet,
                    count(*) OVER() AS total_count
               FROM document_versions v
               JOIN documents d ON d.id = v.document_id
               JOIN cases c ON c.id = d.case_id
               JOIN case_assignments a
                 ON a.case_id = c.id AND a.user_id = $1
              WHERE to_tsvector('simple', coalesce(v.extracted_text, ''))
                    @@ plainto_tsquery('simple', $2)
              ORDER BY v.uploaded_at DESC
              LIMIT $4 OFFSET $5`,
            [req.user.id, q, snippetsAllowed, perPage, (page - 1) * perPage]
        );

        const total = rows[0] ? Number(rows[0].total_count) : 0;
        const items = rows.map(({ total_count, ...rest }) => rest);

        // Searching reveals what exists. It is logged like any read.
        await audit.append({
            userId: req.user.id,
            action: "search",
            detail: { q, results: total },
            ip: req.ip,
        });

        return res.json({ items, total, page, per_page: perPage });
    } catch (err) {
        next(err);
    }
});

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
                `SELECT v.*, d.case_id, d.title, c.case_number
           FROM document_versions v
           JOIN documents d ON d.id = v.document_id
           JOIN cases c ON c.id = d.case_id
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

            // Redaction runs on this in-memory copy and nothing else. The
            // stored blob is never rewritten, which is why the original
            // still verifies as AUTHENTIC after a redacted export.
            let redactedCount = null;

            if (sensitivity === "protected") {
                const { rows: identities } = await db.query(
                    "SELECT value FROM case_protected_identities WHERE case_id = $1",
                    [row.case_id]
                );

                try {
                    const result = redaction.redact(
                        plaintext,
                        row.mime_type,
                        redaction.targetsFrom({
                            identities,
                            extracted: row.entities,
                        })
                    );
                    plaintext = result.buffer;
                    redactedCount = result.removed;
                } catch (err) {
                    if (!(err instanceof redaction.UnsupportedFormatError)) throw err;

                    // We cannot remove the identity from this file type
                    // completely, so we do not send it at all. Falling back
                    // to the original here would be the exact leak this
                    // system exists to prevent.
                    await audit.append({
                        userId: req.user.id,
                        action: "access_denied",
                        documentId: req.params.document_id,
                        caseId: row.case_id,
                        version: row.version,
                        detail: {
                            reason: "redaction_unsupported_format",
                            mime_type: row.mime_type,
                        },
                        ip: req.ip,
                    });

                    return res.status(503).json({
                        error: "redaction_unavailable",
                        message:
                            "This case requires redaction before release and this file type cannot be redacted safely.",
                    });
                }
            }

            // Stamp the copy with who pulled it. This runs on the export
            // path only - the stored original is never rewritten, so the
            // hash still verifies after a watermarked download.
            //
            // Redaction (when it lands) belongs immediately above this
            // line, so the mark is applied on top of the redacted output
            // rather than being stripped along with it.
            const released = await watermark.apply(plaintext, row.mime_type, {
                serviceNumber: req.user.service_number,
                name: req.user.name,
                caseNumber: row.case_number,
                timestamp: new Date().toISOString(),
            });

            await audit.append({
                userId: req.user.id,
                action: sensitivity === "protected" ? "export_redacted" : "download",
                documentId: req.params.document_id,
                caseId: row.case_id,
                version: row.version,
                // How many identities were removed. Zero on a protected
                // case is a signal worth seeing, not a success.
                detail:
                    redactedCount === null ? null : { entities_removed: redactedCount },
                ip: req.ip,
            });

            // Custody events append to the same ledger asset as the
            // anchor, so the version's history is the full chain of
            // custody. Fire and forget for the same reason anchoring is:
            // a slow ledger must not hold up a release.
            ledger
                .recordCustody({
                    versionId: row.id,
                    action: "export",
                    actor: req.user.id,
                    station: req.user.station,
                })
                .catch((e) => console.error("custody record failed", e.message));

            res.setHeader("Content-Type", row.mime_type || "application/octet-stream");
            res.setHeader(
                "Content-Disposition",
                `attachment; filename="${row.title.replace(/[^\w.-]/g, "_")}"`
            );
            // The same identity that is stamped on the page itself.
            res.setHeader("X-Released-To", req.user.service_number);

            return res.send(released);
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
                    station: req.user.station,
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

            const { verified, failure, storedHash, chainRecord } =
                await checkIntegrity(row);

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
// GET /documents/:document_id/certificate
//
// The Section 63(4) BSA certificate. Courts reject electronic evidence
// over a missing certificate and every Part A field is already in the
// database, so this is the cheapest admissibility win available.
//
// Gated on document.verify rather than document.download: this is an
// integrity attestation, and it is exactly the court-side roles
// (prosecutor, judge) who need it. A constable cannot issue one.
// ---------------------------------------------------------------
router.get(
    "/:document_id/certificate",
    requireAuth,
    requirePermission("document.verify", caseIdForDocument),
    async (req, res, next) => {
        try {
            const version = req.query.version
                ? parseInt(req.query.version, 10)
                : null;

            const { rows } = await db.query(
                `SELECT v.*, d.id AS doc_id, d.title AS document_title, d.doc_type,
                        d.case_id, c.case_number, c.title AS case_title,
                        c.sensitivity
                   FROM document_versions v
                   JOIN documents d ON d.id = v.document_id
                   JOIN cases c ON c.id = d.case_id
                  WHERE v.document_id = $1
                    AND v.version = COALESCE($2, d.current_version)`,
                [req.params.document_id, version]
            );

            const row = rows[0];
            if (!row) {
                return res
                    .status(404)
                    .json({ error: "not_found", message: "Not found." });
            }

            // Verify at issue time. Signing a certificate for a document
            // that does not currently verify would be attesting to
            // something untrue, which is the one thing this document
            // exists to avoid.
            const { verified, failure } = await checkIntegrity(row);

            if (!verified) {
                await audit.append({
                    userId: req.user.id,
                    action: "access_denied",
                    documentId: req.params.document_id,
                    caseId: row.case_id,
                    version: row.version,
                    detail: { attempted: "certificate", failure },
                    ip: req.ip,
                });

                return res.status(409).json({
                    error: "not_verified",
                    message:
                        "This document does not currently verify, so no certificate can be issued. " +
                        `Run POST /api/v1/documents/${req.params.document_id}/verify for the details.`,
                });
            }

            const verifiedAt = new Date().toISOString();

            const pdf = await certificate.build({
                document: {
                    id: row.doc_id,
                    title: row.document_title,
                    doc_type: row.doc_type,
                },
                caseRecord: {
                    case_number: row.case_number,
                    title: row.case_title,
                    sensitivity: row.sensitivity,
                },
                version: {
                    version: row.version,
                    sha256: row.sha256,
                    size_bytes: row.size_bytes,
                    mime_type: row.mime_type,
                    uploaded_at: row.uploaded_at,
                    ledger_tx_id: row.ledger_tx_id,
                    anchored_at: row.anchored_at,
                    anchor_status: row.anchor_status,
                },
                // The officer producing the output now is the person in a
                // responsible position in relation to its production.
                producedBy: req.user,
                verification: { verified, verified_at: verifiedAt },
            });

            await audit.append({
                userId: req.user.id,
                action: "verify",
                documentId: req.params.document_id,
                caseId: row.case_id,
                version: row.version,
                detail: { certificate_issued: true, sha256: row.sha256 },
                ip: req.ip,
            });

            res.setHeader("Content-Type", "application/pdf");
            res.setHeader(
                "Content-Disposition",
                `attachment; filename="bsa63-${row.case_number.replace(
                    /[^\w.-]/g,
                    "_"
                )}-v${row.version}.pdf"`
            );

            return res.send(pdf);
        } catch (err) {
            next(err);
        }
    }
);

// ---------------------------------------------------------------
// GET /documents/:document_id/custody
//
// The chain of custody straight off the ledger - every write to this
// version's key, oldest first. On the Fabric backend this is
// GetHistoryForKey and no single organisation can edit it.
//
// Returns an empty history on the stub backend, which has none. The
// backend is named in the response so nobody mistakes one for the
// other.
// ---------------------------------------------------------------
router.get(
    "/:document_id/custody",
    requireAuth,
    requirePermission("document.verify", caseIdForDocument),
    async (req, res, next) => {
        try {
            const version = req.query.version
                ? parseInt(req.query.version, 10)
                : null;

            const { rows } = await db.query(
                `SELECT v.id, v.version
                   FROM document_versions v
                   JOIN documents d ON d.id = v.document_id
                  WHERE v.document_id = $1
                    AND v.version = COALESCE($2, d.current_version)`,
                [req.params.document_id, version]
            );

            const row = rows[0];
            if (!row) {
                return res
                    .status(404)
                    .json({ error: "not_found", message: "Not found." });
            }

            const entries = await ledger.history(row.id);

            return res.json({
                ledger_backend: ledger.backend,
                version: row.version,
                entries,
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