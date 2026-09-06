const express = require("express");
const crypto = require("crypto");

const db = require("../db");
const audit = require("../services/audit");
const { requireAuth } = require("../middleware/auth");
const {
    verifyPassword,
    generateToken,
    hashToken,
    verifyTotp,
} = require("../services/crypto");

const router = express.Router();

const SESSION_HOURS = 8;
const MFA_WINDOW_MS = 5 * 60 * 1000;

// Pending MFA challenges live in memory. They last five minutes and
// losing them on restart is fine - the user just logs in again.
// If you ever run more than one server process, move this to the
// database or Redis.
const pendingMfa = new Map();

setInterval(() => {
    const now = Date.now();
    for (const [key, value] of pendingMfa) {
        if (value.expiresAt < now) pendingMfa.delete(key);
    }
}, 60 * 1000).unref();

// ---------------------------------------------------------------
// POST /auth/login
// Step 1. Never returns a session, only an MFA challenge.
// ---------------------------------------------------------------
router.post("/login", async (req, res, next) => {
    const { service_number, password } = req.body || {};

    if (!service_number || !password) {
        return res.status(400).json({
            error: "bad_request",
            message: "service_number and password are required.",
        });
    }

    try {
        const { rows } = await db.query(
            `SELECT id, password_hash, mfa_secret, mfa_enabled, is_active
         FROM users WHERE service_number = $1`,
            [service_number]
        );

        const user = rows[0];

        // Same response whether the user does not exist or the password is
        // wrong. Otherwise you have handed an attacker a way to enumerate
        // valid service numbers.
        const ok =
            user && user.is_active && (await verifyPassword(password, user.password_hash));

        if (!ok) {
            await audit
                .append({
                    userId: user ? user.id : null,
                    action: "access_denied",
                    detail: { attempted: "login", service_number },
                    ip: req.ip,
                })
                .catch(() => {});

            return res.status(401).json({
                error: "unauthorized",
                message: "Invalid credentials.",
            });
        }

        const mfaToken = generateToken();
        pendingMfa.set(mfaToken, {
            userId: user.id,
            expiresAt: Date.now() + MFA_WINDOW_MS,
        });

        return res.json({
            mfa_token: mfaToken,
            expires_in: MFA_WINDOW_MS / 1000,
        });
    } catch (err) {
        next(err);
    }
});

// ---------------------------------------------------------------
// POST /auth/mfa/verify
// Step 2. Exchanges a TOTP code for a real session.
// ---------------------------------------------------------------
router.post("/mfa/verify", async (req, res, next) => {
    const { mfa_token, code } = req.body || {};

    if (!mfa_token || !code) {
        return res.status(400).json({
            error: "bad_request",
            message: "mfa_token and code are required.",
        });
    }

    const pending = pendingMfa.get(mfa_token);

    if (!pending || pending.expiresAt < Date.now()) {
        pendingMfa.delete(mfa_token);
        return res.status(401).json({
            error: "unauthorized",
            message: "Challenge expired. Log in again.",
        });
    }

    try {
        const { rows } = await db.query(
            `SELECT id, service_number, name, rank, station, mfa_secret, mfa_enabled
         FROM users WHERE id = $1`,
            [pending.userId]
        );
        const user = rows[0];

        if (user.mfa_enabled && !verifyTotp(user.mfa_secret, code)) {
            return res
                .status(401)
                .json({ error: "unauthorized", message: "Invalid code." });
        }

        // One code, one use.
        pendingMfa.delete(mfa_token);

        const token = generateToken();
        const expiresAt = new Date(Date.now() + SESSION_HOURS * 3600 * 1000);

        await db.query(
            `INSERT INTO sessions (user_id, token_hash, expires_at, ip, user_agent)
       VALUES ($1, $2, $3, $4, $5)`,
            [
                user.id,
                hashToken(token),
                expiresAt,
                req.ip,
                req.get("user-agent") || null,
            ]
        );

        return res.json({
            session_token: token,
            expires_at: expiresAt.toISOString(),
            user: {
                id: user.id,
                name: user.name,
                service_number: user.service_number,
                rank: user.rank,
                station: user.station,
            },
        });
    } catch (err) {
        next(err);
    }
});

// ---------------------------------------------------------------
// POST /auth/logout
// Deleting the row revokes the session instantly. This is the whole
// reason for opaque tokens over JWT.
// ---------------------------------------------------------------
router.post("/logout", requireAuth, async (req, res, next) => {
    try {
        await db.query("DELETE FROM sessions WHERE id = $1", [req.sessionId]);
        return res.status(204).end();
    } catch (err) {
        next(err);
    }
});

module.exports = router;