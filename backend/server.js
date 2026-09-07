require("dotenv").config();

const express = require("express");
const cors = require("cors");

const authRoutes = require("./routes/auth");
const caseRoutes = require("./routes/cases");
const documentRoutes = require("./routes/documents");
const icjsRoutes = require("./routes/icjs");
const ledger = require("./services/ledger");
const { requireAuth } = require("./middleware/auth");

const app = express();

// Locked to the Vite dev server. Before the demo, set CORS_ORIGIN to
// wherever the frontend actually runs. Never leave it wide open.
app.use(
    cors({
        origin: process.env.CORS_ORIGIN || "http://localhost:5173",
        credentials: true,
    })
);

app.use(express.json({ limit: "100kb" }));

app.set("trust proxy", true);

app.get("/", (req, res) => {
    res.json({ message: "Secure Document Management System API is running!" });
});

app.use("/api/v1/auth", authRoutes);
app.use("/api/v1/cases", caseRoutes);
app.use("/api/v1/documents", documentRoutes);
app.use("/api/v1/icjs", icjsRoutes);

app.get("/api/v1/me", requireAuth, (req, res) => {
    res.json({ user: req.user });
});

app.use((req, res) => {
    res.status(404).json({ error: "not_found", message: "Not found." });
});

// Multer's own errors are worth surfacing properly - a silent 500 on
// an oversized upload is a confusing bug to chase.
app.use((err, req, res, next) => {
    if (err && err.code === "LIMIT_FILE_SIZE") {
        return res
            .status(413)
            .json({ error: "file_too_large", message: "Maximum upload size is 25 MB." });
    }

    // Logged in full, never sent. Stack traces tell an attacker about
    // your file layout and dependency versions.
    console.error(err);
    res
        .status(500)
        .json({ error: "internal_error", message: "Something went wrong." });
});

const PORT = process.env.PORT || 5000;

app.listen(PORT, async () => {
    const n = await ledger.rehydrate().catch(() => 0);
    console.log(`Server running on port ${PORT}`);
    if (n) console.log(`Ledger stub rehydrated ${n} anchors`);
});