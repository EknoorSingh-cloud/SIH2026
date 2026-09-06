require("dotenv").config();

const express = require("express");
const cors = require("cors");

const authRoutes = require("./routes/auth");
const { requireAuth } = require("./middleware/auth");

const app = express();

// Locked to the Vite dev server. Before the demo, set this to wherever
// the frontend is actually served from. Never leave it wide open.
app.use(
    cors({
      origin: process.env.CORS_ORIGIN || "http://localhost:5173",
      credentials: true,
    })
);

app.use(express.json({ limit: "100kb" }));

// Express sits behind nothing right now, but this makes req.ip correct
// the moment you put it behind nginx or a load balancer.
app.set("trust proxy", true);

app.get("/", (req, res) => {
  res.json({ message: "Secure Document Management System API is running!" });
});

app.use("/api/v1/auth", authRoutes);

// Temporary: proves the session token works end to end.
app.get("/api/v1/me", requireAuth, (req, res) => {
  res.json({ user: req.user });
});

app.use((req, res) => {
  res.status(404).json({ error: "not_found", message: "Not found." });
});

// Errors are logged in full but never sent to the client. Stack traces
// tell an attacker about your file layout and dependency versions.
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "internal_error", message: "Something went wrong." });
});

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});