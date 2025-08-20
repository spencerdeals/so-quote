// index.js – SO-Quote backend using scraper (CommonJS)
const express = require("express");
const cors = require("cors");
const { scrapeProduct } = require("./scraper");   // <-- name MUST match

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
ƒapp.use(express.urlencoded({ extended: true }));

app.get("/health", (_req, res) => {
  res.json({ ok: true, version: "3.3-container", calc: "landed-v1" });
});

app.post("/quote", async (req, res) => {
  try {
    const links = Array.isArray(req.body?.links) ? req.body.links.filter(Boolean) : [];
    if (!links.length) return res.status(400).json({ error: "Provide links[] in request body" });

    const items = [];
    for (const url of links) {
      const { title, firstCost } = await scrapeProduct(url);  // <-- ensure this runs
      items.push({ title, url, qty: 1, firstCost });
    }

    const subtotal = Math.round(items.reduce((s, it) => s + (it.firstCost * (it.qty || 1)), 0) * 100) / 100;
    res.json({ items, subtotal });
  } catch (e) {
    console.error("quote error:", e?.message || e);
    res.status(500).json({ error: "Server error generating quote." });
  }
});
// Quick test route to verify scraper works independently of the frontend
app.get("/test-scrape", async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).json({ error: "Missing ?url=" });
  try {
    const data = await scrapeProduct(url);
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e?.message || String(e) });
  }
});

app.listen(PORT, () => {
  console.log(`[SO-QUOTE] Backend running on :${PORT}`);
});
