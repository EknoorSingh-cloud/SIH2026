const db = require("../db");
const { hashToken } = require("../services/crypto");

// ===============================================================
// AUTHENTICATION MIDDLEWARE
// ===============================================================
//
// This middleware checks:
//
// 1. Authorization header exists
// 2. Bearer token is valid
// 3. Session exists in database
// 4. Session has not expired
// 5. User account is active
//
// If everything is valid:
// req.user contains user information
// req.sessionId contains the session ID
//
// ===============================================================

async function requireAuth(req, res, next) {
    try {

        // -------------------------------------------------------
        // GET AUTHORIZATION HEADER
        // -------------------------------------------------------

        const authorizationHeader =
            req.get("Authorization") || "";


        // -------------------------------------------------------
        // CHECK BEARER TOKEN FORMAT
        //
        // Expected:
        //
        // Authorization: Bearer abc123...
        // -------------------------------------------------------

        if (!authorizationHeader.startsWith("Bearer ")) {

            return res.status(401).json({
                error: "unauthorized",
                message: "No session token provided.",
            });

        }


        // -------------------------------------------------------
        // EXTRACT TOKEN
        // -------------------------------------------------------

        const token =
            authorizationHeader.slice(7).trim();


        if (!token) {

            return res.status(401).json({
                error: "unauthorized",
                message: "Invalid session token.",
            });

        }


        // -------------------------------------------------------
        // HASH TOKEN
        //
        // We never store raw session tokens in the database.
        // -------------------------------------------------------

        const tokenHash = hashToken(token);


        // -------------------------------------------------------
        // FIND SESSION + USER
        // -------------------------------------------------------

        const result = await db.query(

            `
            SELECT

                s.id AS session_id,
                s.expires_at,

                u.id AS user_id,
                u.service_number,
                u.name,
                u.rank,
                u.station,
                u.is_active

            FROM sessions s

            JOIN users u
                ON u.id = s.user_id

            WHERE s.token_hash = $1
            `,

            [tokenHash]

        );


        const row = result.rows[0];


        // -------------------------------------------------------
        // SESSION NOT FOUND
        // -------------------------------------------------------

        if (!row) {

            return res.status(401).json({
                error: "unauthorized",
                message: "Invalid session.",
            });

        }


        // -------------------------------------------------------
        // CHECK SESSION EXPIRATION
        // -------------------------------------------------------

        const expiresAt = new Date(row.expires_at);
        const now = new Date();


        if (expiresAt < now) {

            // Delete expired session
            await db.query(

                `
                DELETE FROM sessions
                WHERE id = $1
                `,

                [row.session_id]

            );


            return res.status(401).json({
                error: "unauthorized",
                message: "Session expired. Please sign in again.",
            });

        }


        // -------------------------------------------------------
        // CHECK USER ACCOUNT
        // -------------------------------------------------------

        if (!row.is_active) {

            return res.status(401).json({
                error: "unauthorized",
                message: "Account is disabled.",
            });

        }


        // -------------------------------------------------------
        // ATTACH USER TO REQUEST
        // -------------------------------------------------------

        req.user = {

            id: row.user_id,

            service_number:
                row.service_number,

            name:
                row.name,

            rank:
                row.rank,

            station:
                row.station,

        };


        // -------------------------------------------------------
        // ATTACH SESSION ID
        // -------------------------------------------------------

        req.sessionId =
            row.session_id;


        // -------------------------------------------------------
        // CONTINUE TO NEXT ROUTE
        // -------------------------------------------------------

        next();


    } catch (error) {

        console.error(
            "Authentication middleware error:",
            error
        );

        next(error);

    }
}


module.exports = {
    requireAuth,
};