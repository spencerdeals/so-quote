// index.js – SO-Quote backend (CommonJS) with route inspector
const express = require("express");
const cors = require("cors");
const { scrapeProduct } = require("./scraper");

const app = express();
const PORT = process.env.PORT || 8080;
const VERSION = "so-quote@v23"; // <— bump this if needed to confirm redeploy

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// --- Health ---
app.get("/health", (_req, res) => {
  res.json({ ok: true, version: "3.3-container", calc: "landed-v1", api: VERSION });
});

// --- Quick homepage (shows version) ---
app.get("/", (_req, res) => {
  res.send(`SO-Quote API running (${VERSION})`);
});

// --- Test scraper directly ---
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

// --- Frontend endpoint ---
app.post("/quote", async (req, res) => {
  try {
    const links = Array.isArray(req.body?.links) ? req.body.links.filter(Boolean) : [];
    if (!links.length) return res.status(400).json({ error: "Provide links[] in request body" });

    const items = [];
    for (const url of links) {
      const { title, firstCost } = await scrapeProduct(url);
      items.push({ title, url, qty: 1, firstCost });
    }

    const subtotal = Math.round(items.reduce((s, it) => s + (it.firstCost * (it.qty || 1)), 0) * 100) / 100;
    res.json({ items, subtotal });
  } catch (e) {
    console.error("quote error:", e?.message || e);
    res.status(500).json({ error: "Server error generating quote." });
  }
});

// --- Route inspector so we can SEE what’s running ---
app.get("/__routes", (_req, res) => {
  const routes = [];
  app._router.stack.forEach(layer => {
    if (layer.route && layer.route.path) {
      const methods = Object.keys(layer.route.methods).join(",").toUpperCase();
      routes.push({ methods, path: layer.route.path });
    }
  });
  res.json({ version: VERSION, routes });
});

app.listen(PORT, () => {
  console.log(`[SO-QUOTE] Backend running on :${PORT} (${VERSION})`);
});
