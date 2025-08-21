// index.js (ESM)
import express from "express";
import cors from "cors";

const app = express();
const PORT = process.env.PORT || 3000;
const VERSION = process.env.APP_VERSION || "alpha-2025-08-21";

// ✅ Allowed web origins (comma-separated env or sensible defaults)
const allowedOrigins = (process.env.ALLOWED_ORIGINS ||
  "http://localhost:3000,http://localhost:5173,https://sdl.bm,https://www.sdl.bm")
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);

// (Optional) force HTTPS behind Railway proxy when ENFORCE_HTTPS=1
app.use((req, res, next) => {
  const proto = req.headers["x-forwarded-proto"];
  if (proto && proto !== "https" && process.env.ENFORCE_HTTPS === "1") {
    return res.redirect(301, "https://" + req.headers.host + req.originalUrl);
  }
  next();
});

// ✅ CORS: precise, safe, and preflight-friendly
app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true); // server-to-server / curl
      if (allowedOrigins.includes(origin)) return cb(null, true);
      return cb(new Error(`CORS: origin not allowed -> ${origin}`));
    },
    credentials: true,
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
    maxAge: 600,
  })
);

// Body parser
app.use(express.json({ limit: "2mb" }));

// Health check
app.get(["/", "/health"], (_req, res) => {
  res.json({ ok: true, version: VERSION });
});

// 🔧 Events shim/proxy to stop "failed to fetch shop events"
app.get(["/events", "/shop/events"], async (req, res) => {
  const backend = process.env.BACKEND_URL;
  try {
    if (backend) {
      const upstream = await fetch(`${backend.replace(/\/$/, "")}/events`, {
        headers: { Accept: "application/json" },
      });
      const body = await upstream.text();
      res
        .status(upstream.status)
        .type(upstream.headers.get("content-type") || "application/json")
        .send(body);
    } else {
      res.json([]); // benign payload if no upstream
    }
  } catch (err) {
    console.error("GET /events error:", err);
    res.status(502).json({ ok: false, error: "Failed to fetch events from backend" });
  }
});

// 🔁 Quote proxy — forwards to your real calculator service
app.post(["/quote", "/api/quote"], async (req, res) => {
  const backend = process.env.BACKEND_URL;
  if (!backend) {
    return res.status(503).json({ ok: false, error: "BACKEND_URL not set" });
