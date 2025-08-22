// index.js — CORS-safe backend for Canva
import express from "express";
import cors from "cors";

// ---------- CORS: allow Canva + anywhere (for testing) ----------
const app = express();
app.use(express.json());

// Be permissive first; we can tighten later.
app.use(
  cors({
    origin: (origin, cb) => cb(null, true), // allow all origins, incl. Canva sandbox
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type"],
    credentials: false,
    maxAge: 86400,
  })
);

// Make sure preflight OPTIONS succeeds quickly
app.options("*", cors());

// ---------- Health ----------
app.get(["/", "/health"], (_req, res) => {
  res.json({ ok: true, version: "alpha-cors-ok", msg: "CORS enabled" });
});

// ---------- Quote (backend-driven only) ----------
app.post("/quote", async (req, res) => {
  try {
    const { links } = req.body || {};
    if (!Array.isArray(links) || links.length === 0) {
      return res.json({ items: [] });
    }

    // TEMP: minimal backend echo so Canva can render something from server.
    // (Replace this block with your real scraper logic when ready.)
    const items = links.map((link) => ({
      link,
      name: humanizeName(link),
      image: faviconFor(link),      // lightweight thumbnail
      qty: 1,
      // Leave unit/total null if you only want real scraper prices to show.
      // For now, we’ll return null so frontend NEVER fakes it.
      unit: null,
      total: null,
      variants: [],                 // fill from scraper when available
    }));

    res.json({ items });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// ---------- helpers ----------
function humanizeName(url) {
  try {
    const u = new URL(url);
    const segments = u.pathname.split("/").filter(Boolean);
    const last = decodeURIComponent(segments.pop() || u.hostname);
    return last
      .replace(/\.(html?|php|aspx?)$/i, "")
      .replace(/[-_]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/\b\w/g, (c) => c.toUpperCase());
  } catch {
    return url;
  }
}

function faviconFor(url) {
  try {
    const host = new URL(url).hostname;
    return `https://www.google.com/s2/favicons?domain=${host}&sz=128`;
  } catch {
    return null;
  }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Server running on", PORT));
