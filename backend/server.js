require("dotenv").config();

const express = require("express");
const cors = require("cors");

const db = require("./db");

const authRoutes = require("./routes/auth");
const caseRoutes = require("./routes/cases");
const documentRoutes = require("./routes/documents");
const icjsRoutes = require("./routes/icjs");

const ledger = require("./services/ledger");

const { requireAuth } = require("./middleware/auth");

const app = express();

// ----------------------------------------------------
// CORS
// ----------------------------------------------------

app.use(
    cors({
        origin: process.env.CORS_ORIGIN || "http://localhost:5173",
        credentials: true,
    })
);

// ----------------------------------------------------
// BODY PARSERS
// ----------------------------------------------------

app.use(express.json({ limit: "100kb" }));

// ----------------------------------------------------
// TRUST PROXY
// ----------------------------------------------------

app.set("trust proxy", true);

// ----------------------------------------------------
// HEALTH CHECK
// ----------------------------------------------------

app.get("/", (req, res) => {
    res.json({
        message: "Secure Document Management System API is running!",
    });
});

// ----------------------------------------------------
// DATABASE TEST
// ----------------------------------------------------

app.get("/api/v1/test-db", async (req, res) => {
    try {
        const result = await db.query(
            "SELECT NOW() AS current_time"
        );

        res.json({
            success: true,
            message: "Database connected successfully!",
            time: result.rows[0].current_time,
        });
    } catch (error) {
        console.error(
            "Database connection failed:",
            error
        );

        res.status(500).json({
            success: false,
            message: "Database connection failed",
            error: error.message,
        });
    }
});

// ----------------------------------------------------
// ROUTES
// ----------------------------------------------------

app.use("/api/v1/auth", authRoutes);

app.use("/api/v1/cases", caseRoutes);

app.use("/api/v1/documents", documentRoutes);

app.use("/api/v1/icjs", icjsRoutes);

// ----------------------------------------------------
// AUTHENTICATED USER TEST
// ----------------------------------------------------

app.get("/api/v1/me", requireAuth, (req, res) => {
    res.json({
        user: req.user,
    });
});

// ----------------------------------------------------
// 404 HANDLER
// ----------------------------------------------------

app.use((req, res) => {
    res.status(404).json({
        error: "not_found",
        message: "Not found.",
    });
});

// ----------------------------------------------------
// ERROR HANDLER
// ----------------------------------------------------

app.use((err, req, res, next) => {
    // File too large
    if (err && err.code === "LIMIT_FILE_SIZE") {
        return res.status(413).json({
            error: "file_too_large",
            message: "Maximum upload size is 25 MB.",
        });
    }

    // Other Multer errors
    if (err instanceof require("multer").MulterError) {
        return res.status(400).json({
            error: "upload_error",
            message: err.message,
        });
    }

    console.error(err);

    res.status(500).json({
        error: "internal_error",
        message: err.message || "Something went wrong.",
    });
});

// ----------------------------------------------------
// START SERVER
// ----------------------------------------------------

const PORT = process.env.PORT || 5000;

app.listen(PORT, async () => {
    console.log(
        `Server running on http://localhost:${PORT}`
    );

    // Initialize / restore ledger data
    try {
        const n = await ledger.rehydrate();

        console.log(
            `Ledger backend: ${ledger.backend}`
        );

        if (ledger.backend === "stub") {
            console.log(
                "Ledger running with in-memory stub."
            );
        }

        if (n) {
            console.log(
                `Rehydrated ${n} anchors`
            );
        }

    } catch (error) {
        console.error(
            "Ledger initialization failed:",
            error.message
        );
    }

    if (process.env.REDACTION_ENABLED !== "true") {
        console.log(
            "Redaction: DISABLED"
        );
    }
});