/**
 * so-quote BACKEND — Paste-and-Replace index.js
 * ------------------------------------------------
 * What this gives you:
 * - /health : JSON ok + version
 * - /quote  : ALWAYS returns JSON. Accepts { links: [...] } OR { url }
 * - Uses ScrapingBee if SCRAPINGBEE_API_KEY is set
 * - Optionally calls your fallback scraper if SCRAPER_B_URL is set
 * - CORS is enabled (configure FRONTEND_ORIGIN for stricter policy)
 *
 * How to run locally:
 *   npm install
 *   npm start
 *
 * Environment variables (Railway → Variables):
 *   SCRAPINGBEE_API_KEY   = your ScrapingBee key (required for real scraping)
 *   SCRAPER_B_URL         = https://your-fallback-scraper.example.com (optional)
 *   FRONTEND_ORIGIN       = https://your-frontend-domain (optional, for strict CORS)
 *   NIXPACKS_NODE_VERSION = 20   (recommended on Railway)
 */
const express = require("express");
const cors = require("cors");

const app = express();

// ---------- CORS ----------
// Default: allow all (easy for testing). For production, set FRONTEND_ORIGIN.
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN;
app.use(
  cors(
    FRONTEND_ORIGIN
      ? { origin: FRONTEND_ORIGIN, credentials: false }
      : { origin: "*", credentials: false }
  )
);

// ---------- Middleware ----------
app.use(express.json({ limit: "1mb" }));

// ---------- Health ----------
app.get(["/", "/health"], (_req, res) => {
  res.setHeader("Content-Type", "application/json");
  res.json({ ok: true, version: "alpha-backend-json-1" });
});

// ---------- Helpers ----------
const hasBee = () => !!process.env.SCRAPINGBEE_API_KEY;
const beeKey = () => process.env.SCRAPINGBEE_API_KEY?.trim();
const scraperB = () => process.env.SCRAPER_B_URL?.replace(/\/$/, "");

// fetch wrapper using global fetch (Node 18+)
async function safeFetch(url, opts = {}) {
  const res = await fetch(url, opts);
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // not JSON, that's fine; caller decides
  }
  return { res, text, json };
}

function normalizeOne(obj = {}, fallbackUrl = "") {
  return {
    id: obj.id || "product-1",
    url: obj.url || fallbackUrl || "",
    name: obj.name || obj.title || "Unnamed Item",
    image: obj.image || obj.thumbnail || "",
    price: typeof obj.price === "number" ? obj.price : Number(obj.price) || 0,
    currency: obj.currency || "USD",
    variants: Array.isArray(obj.variants) ? obj.variants : Array.isArray(obj.options) ? obj.options : [],
  };
}

function normalizeArray(arr = [], urls = []) {
  return arr.map((item, i) => normalizeOne(item, urls[i] || urls[0] || ""));
}

// Very light HTML parsing as last resort (tries to extract og:title & og:image)
function tryParseHtml(html = "", url = "") {
  const out = { url };
  const ogTitle = html.match(/property=["']og:title["']\s+content=["']([^"']+)["']/i);
  const ogImage = html.match(/property=["']og:image["']\s+content=["']([^"']+)["']/i);
  if (ogTitle) out.name = ogTitle[1];
  if (ogImage) out.image = ogImage[1];
  return out;
}

// ---------- Scrape chain ----------
async function scrapeWithBee(targetUrl) {
  if (!hasBee()) return null;
  const endpoint = `https://app.scrapingbee.com/api/v1/?api_key=${encodeURIComponent(
    beeKey()
  )}&url=${encodeURIComponent(targetUrl)}&render_js=false`;
  const { res, text } = await safeFetch(endpoint);
  if (!res.ok) return null;
  // We got HTML; attempt minimal parse
  const product = tryParseHtml(text, targetUrl);
  // price extraction is site-specific; if needed, you can add heuristics here
  return normalizeOne(product, targetUrl);
}

async function scrapeWithScraperB(targetUrl) {
  const base = scraperB();
  if (!base) return null;
  const { res, json } = await safeFetch(`${base}/quote`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: targetUrl }),
  });
  if (!res.ok || !json) return null;

  // Accept either { items: [...] } or a single product object
  let items = [];
  if (Array.isArray(json)) items = json;
  else if (Array.isArray(json.items)) items = json.items;
  else if (json.name || json.price || json.image) items = [json];

  if (!items.length) return null;
  return normalizeOne(items[0], targetUrl);
}

// Fallback stub so frontend always gets valid JSON
function stubProduct(url) {
  const hostname = (() => {
    try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; }
  })();
  return normalizeOne({
    url,
    name: `Product from ${hostname || "link"}`,
    image: "https://via.placeholder.com/300x300?text=No+Image",
    price: 0,
    currency: "USD",
    variants: [{ id: "default", label: "Default", price: 0, currency: "USD" }],
  }, url);
}

// ---------- /quote ----------
app.post("/quote", async (req, res) => {
  res.setHeader("Content-Type", "application/json");
  try {
    const links = Array.isArray(req.body?.links) ? req.body.links.filter(Boolean) : [];
    const single = req.body?.url;

    const targets = links.length ? links : single ? [single] : [];
    if (!targets.length) {
      return res.status(400).json({ error: "Provide { links: [url,...] } or { url }" });
    }

    const results = [];
    for (const url of targets) {
      let product = null;

      // 1) ScrapingBee (primary)
      try { product = await scrapeWithBee(url); } catch {}

      // 2) Scraper-B (fallback service)
      if (!product) {
        try { product = await scrapeWithScraperB(url); } catch {}
      }

      // 3) Stub fallback so frontend always gets JSON
      if (!product) product = stubProduct(url);

      results.push(product);
    }

    return res.status(200).json({ items: results });
  } catch (err) {
    return res.status(500).json({ error: String(err) });
  }
});

// ---------- Start ----------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("so-quote backend running on port", PORT);
});
