// index.js — ESM (because package.json has "type": "module")

import "dotenv/config";
import express from "express";
import cors from "cors";
import morgan from "morgan";

const app = express();
app.disable("x-powered-by");
app.use(cors({ origin: "*" }));
app.use(morgan("tiny"));
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

const VERSION = "so-quote-backend alpha (esm + lazy-scraper)";

// Health + root
const ok = (res) =>
  res.json({
    ok: true,
    version: VERSION,
    env: process.env.NODE_ENV || "development",
    ts: new Date().toISOString(),
  });

app.get("/", (_req, res) => ok(res));
app.get("/health", (_req, res) => ok(res));

// --- Scrape route (lazy-load the scraper so it can't crash startup) ---
app.get("/scrape", async (req, res) => {
  try {
    const url = String(req.query.url || "").trim();
    if (!url) return res.status(400).json({ ok: false, error: "Missing url" });

    // ESM dynamic import
    const { scrapePrice } = await import("./scraper.js");

    const price = await scrapePrice(url);
    if (price == null) {
      return res.json({ ok: true, price: null, note: "No price detected" });
    }
    return res.json({ ok: true, price });
  } catch (err) {
    return res
      .status(500)
      .json({ ok: false, error: String(err?.message || err) });
  }
});

// 404
app.use((req, res) => {
  res.status(404).json({ ok: false, error: "Not Found", path: req.originalUrl });
});

// Error handler
app.use((err, _req, res, _next) => {
  console.error("ERR:", err);
  res.status(err.status || 500).json({ ok: false, error: err.message || "Server error" });
});

const PORT = Number(process.env.PORT || 3000);
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT} — ${VERSION}`);
});
