// index.js — so-quote backend (Express)
// Paste-and-replace this entire file in your Railway backend repo.
// Requires: "type": "module" in package.json, and ./scraper/bee.js from earlier.

import express from "express";
import { scrapeNameAndPrice } from "./scraper/bee.js";

const app = express();

// -------- Middleware --------
app.use(express.json({ limit: "1mb" }));

// Basic request logging (optional; safe to keep)
app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// -------- Health --------
app.get(["/", "/health"], (_req, res) => {
  res.json({ ok: true, service: "so-quote-backend", version: "scrape-1" });
});

// -------- Scraping endpoint --------
// Body: { url: "https://..." }
app.post("/quote/scrape", async (req, res) => {
  try {
    const { url } = req.body || {};
    if (!url || typeof url !== "string") {
      return res.status(400).json({ ok: false, error: "Missing or invalid 'url'." });
    }
    const data = await scrapeNameAndPrice(url);
    return res.json({ ok: true, ...data });
  } catch (e) {
    console.error("Scrape error:", e?.message || e);
    return res.status(502).json({ ok: false, error: e?.message || "Scrape failed" });
  }
});

// -------- 404 fallback --------
app.use((req, res) => {
  res.status(404).json({ ok: false, error: "Not found" });
});

// -------- Start server --------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
});
