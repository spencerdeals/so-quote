// index.js — so-quote backend (Express) with CORS + /quote/scrape + /meta

import express from "express";
import { scrapeNameAndPrice } from "./scraper/bee.js";

const app = express();
app.set("trust proxy", 1);
app.use(express.json({ limit: "1mb" }));

// CORS: open for now; you can lock to your domain later
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

// Health
app.get(["/", "/health"], (_req, res) => {
  res.json({ ok: true, service: "so-quote-backend", version: "scrape-3-meta" });
});

// Existing POST endpoint (works with fetch from the front-end)
app.post("/quote/scrape", async (req, res) => {
  try {
    const { url } = req.body || {};
    if (!url || typeof url !== "string") {
      return res.status(400).json({ ok: false, error: "Missing or invalid 'url'." });
    }
    const data = await scrapeNameAndPrice(url);
    res.json({ ok: true, ...data });
  } catch (e) {
    console.error("Scrape error:", e?.message || e);
    res.status(502).json({ ok: false, error: e?.message || "Scrape failed" });
  }
});

// NEW: GET /meta?url=...  (so your current front-end GET call stops 404'ing)
app.get("/meta", async (req, res) => {
  try {
    const { url } = req.query || {};
    if (!url || typeof url !== "string") {
      return res.status(400).json({ ok: false, error: "Missing or invalid 'url'." });
    }
    const data = await scrapeNameAndPrice(url);
    res.json({ ok: true, ...data });
  } catch (e) {
    console.error("Meta error:", e?.message || e);
    res.status(502).json({ ok: false, error: e?.message || "Meta failed" });
  }
});

// 404
app.use((_req, res) => res.status(404).json({ ok: false, error: "Not found" }));

// Start
const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
});
