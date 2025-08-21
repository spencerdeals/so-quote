// index.js — CommonJS server with lazy-loaded scraper route

const express = require("express");
const cors = require("cors");
const morgan = require("morgan");
require("dotenv").config();

const app = express();
app.disable("x-powered-by");
app.use(cors({ origin: "*" }));
app.use(morgan("tiny"));
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

const VERSION = "so-quote-backend alpha (lazy-scraper)";

// Health + root
function ok(res) {
  res.json({
    ok: true,
    version: VERSION,
    env: process.env.NODE_ENV || "development",
    ts: new Date().toISOString(),
  });
}
app.get("/", (_req, res) => ok(res));
app.get("/health", (_req, res) => ok(res));

// --- Scrape route (lazy-load to avoid startup crashes) ---
app.get("/scrape", async (req, res) => {
  try {
    const url = String(req.query.url || "").trim();
    if (!url) return res.status(400).json({ ok: false, error: "Missing url" });

    // 👇 lazy-load so a bad scraper file can't crash the whole app at boot
    const { scrapePrice } = require("./scraper.js");

    const price = await scrapePrice(url);
    if (price == null) {
      return res.json({ ok: true, price: null, note: "No price detected" });
    }
    return res.json({ ok: true, price });
  } catch (err) {
    return res
      .status(500)
      .json({ ok: false, error: String(err && err.message ? err.message : err) });
  }
});

// 404
app.use((req, res) => {
  res.status(404).json({ ok: false, error: "Not Found", path: req.originalUrl });
});

// Error handler
app.use((err, _req, res, _next) => {
  console.error("ERR:", err);
  res
    .status(err.status || 500)
    .json({ ok: false, error: err.message || "Server error" });
});

// Start
const PORT = Number(process.env.PORT || 3000);
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT} — ${VERSION}`);
});
