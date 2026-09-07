const express = require("express");

const db = require("../db");
const { requireAuth } = require("../middleware/auth");
const { requirePermission } = require("../middleware/policy");

const router = express.Router();

// ---------------------------------------------------------------
// GET /cases
//
// There is deliberately no "list all cases" endpoint. The join to
// case_assignments is the restriction, so it cannot be forgotten the
// way an optional WHERE clause can.
// ---------------------------------------------------------------
router.get("/", requireAuth, async (req, res, next) => {
    try {
        const page = Math.max(1, parseInt(req.query.page, 10) || 1);
        const perPage = Math.min(100, parseInt(req.query.per_page, 10) || 25);

        const { rows } = await db.query(
            `SELECT c.id, c.case_number, c.title, c.sensitivity, c.status, c.created_at
         FROM cases c
         JOIN case_assignments a ON a.case_id = c.id
        WHERE a.user_id = $1
        ORDER BY c.created_at DESC
        LIMIT $2 OFFSET $3`,
            [req.user.id, perPage, (page - 1) * perPage]
        );

        const total = await db.query(
            "SELECT count(*)::int AS n FROM case_assignments WHERE user_id = $1",
            [req.user.id]
        );

        return res.json({ items: rows, total: total.rows[0].n });
    } catch (err) {
        next(err);
    }
});

// ---------------------------------------------------------------
// GET /cases/:case_id
// ---------------------------------------------------------------
router.get(
    "/:case_id",
    requireAuth,
    requirePermission("case.view", (req) => req.params.case_id),
    async (req, res, next) => {
        try {
            const { rows } = await db.query(
                `SELECT id, case_number, title, sensitivity, status, station, created_at
           FROM cases WHERE id = $1`,
                [req.params.case_id]
            );
            if (!rows[0]) {
                return res.status(404).json({ error: "not_found", message: "Not found." });
            }
            return res.json(rows[0]);
        } catch (err) {
            next(err);
        }
    }
);

// ---------------------------------------------------------------
// GET /cases/:case_id/documents
// ---------------------------------------------------------------
router.get(
    "/:case_id/documents",
    requireAuth,
    requirePermission("document.view", (req) => req.params.case_id),
    async (req, res, next) => {
        try {
            const docType = req.query.doc_type || null;

            const { rows } = await db.query(
                `SELECT d.id, d.case_id, d.title, d.doc_type,
                d.current_version, d.created_at
           FROM documents d
          WHERE d.case_id = $1
            AND ($2::text IS NULL OR d.doc_type::text = $2)
          ORDER BY d.created_at DESC`,
                [req.params.case_id, docType]
            );

            return res.json(rows);
        } catch (err) {
            next(err);
        }
    }
);

module.exports = router;