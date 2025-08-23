// index.js — Instant Quote backend (alpha-cloud, ScrapingBee edition)
const express = require("express");
const cors = require("cors");
const fs = require("fs");

const app = express();
const PORT = process.env.PORT || 8080;

app.use(cors());
app.use(express.json({ limit: "2mb" }));

// Load scraper from /scraper/scraper.js
let scraper = null;
try {
  if (fs.existsSync("./scraper/scraper.js")) {
    scraper = require("./scraper/scraper");
  }
} catch (e) {
  console.error("Failed to load ./scraper/scraper.js:", e);
}

app.get(["/","/health"], (_req, res) => {
  res.json({
    ok: true,
    app: "instant-quote-backend",
    version: "alpha-cloud-scrapingbee",
    hasScraper: !!scraper && typeof scraper.scrape === "function",
    hasBeeKey: !!process.env.SCRAPINGBEE_API_KEY
  });
});

app.get("/debug-modules", (_req, res) => {
  const files = ["./index.js", "./package.json", "./scraper/scraper.js"];
  const exists = Object.fromEntries(files.map(f => [f, fs.existsSync(f)]));
  let pkg = null;
  try { pkg = JSON.parse(fs.readFileSync("./package.json", "utf-8")); } catch {}
  res.json({ exists, pkg, env: { hasBeeKey: !!process.env.SCRAPINGBEE_API_KEY } });
});

app.get("/debug-scraper", async (req, res) => {
  try {
    if (!scraper || !scraper.scrape) return res.status(500).json({ ok:false, error:"Scraper module not loaded" });
    const url = req.query.url;
    if (!url) return res.status(400).json({ ok:false, error:"Missing ?url" });
    const data = await scraper.scrape(url);
    res.json({ ok:true, data });
  } catch (err) {
    res.status(500).json({ ok:false, error:String(err) });
  }
});

app.post("/quote", async (req, res) => {
  try {
    const { url } = req.body || {};
    if (!url) return res.status(400).json({ ok:false, error:"Missing url in body" });
    if (!scraper || !scraper.scrape) return res.status(500).json({ ok:false, error:"Scraper module not loaded" });

    const item = await scraper.scrape(url);
    const response = {
      title: item.title || item.name || null,
      price: item.price ?? null,
      variant: item.variant || null,
      image: item.image || item.thumbnail || null,
      raw: item
    };
    res.json({ ok:true, item: response });
  } catch (err) {
    res.status(500).json({ ok:false, error:String(err) });
  }
});

app.listen(PORT, () => console.log(`Server running on ${PORT}`));
