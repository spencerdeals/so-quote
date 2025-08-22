// index.js — so-quote backend (Express, robust paste-and-replace)

import express from "express";
// If you already added this file earlier, keep it. Otherwise comment the import and the route that uses it.
import { scrapeNameAndPrice } from "./scraper/bee.js";

const app = express();

// ------- Core middleware -------
app.set("trust proxy", 1); // safe for Railway
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: false }));

// Optional CORS (no extra deps). Allow everything by default; tighten later if needed.
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

// ------- Health -------
app.get(["/", "/health"], (_req, res) => {
  res.json({ ok: true, service: "so-quote-backend", version: "scrape-1" });
});

// ------- ScrapingBee endpoint -------
// Body: { url: "https://..." }
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

// ------- (Optional) Your existing quote route placeholder -------
app.post("/quote", (_req, res) => {
  res.json({ ok: true, message: "Quote endpoint placeholder" });
});

// ------- 404 & Error handlers -------
app.use((_req, res) => {
  res.status(404).json({ ok: false, error: "Not found" });
});

app.use((err, _req, res, _next) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ ok: false, error: "Server error" });
});

// ------- Start server -------
const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
});

// ---- Test (run this in your Mac Terminal) ----
// curl -X POST https://so-quote-production.up.railway.app/quote/scrape \
//   -H "Content-Type: application/json" \
//   -d '{"url":"https://www.amazon.com/dp/B0CXXXXXXX"}'
