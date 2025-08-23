app.use(express.static('public'));
// index.js — so-quote backend (// add near top of your Express routes:
app.get('/favicon.ico', (_req, res) => res.status(204).end());
ScrapingBee primary, optional fallback)
const express = require("express");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 3000;

// CORS
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN;
app.use(cors(FRONTEND_ORIGIN ? { origin: FRONTEND_ORIGIN } : { origin: "*" }));

app.use(express.json({ limit: "2mb" }));

app.get(["/", "/health"], (_req, res) => {
  res.json({
    ok: true,
    version: "alpha-fresh-scrapingbee",
    hasBeeKey: !!process.env.SCRAPINGBEE_API_KEY,
    hasFallback: !!process.env.SCRAPER_B_URL
  });
});

const beeKey = () => process.env.SCRAPINGBEE_API_KEY?.trim();
const fallbackUrl = () => process.env.SCRAPER_B_URL?.replace(/\/$/, "");

async function safeFetch(url, opts = {}) {
  const res = await fetch(url, opts);
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  return { res, text, json };
}

function normalizeOne(obj = {}, fallback = "") {
  const title = obj.title || obj.name || "Unnamed Item";
  const image = obj.image || obj.thumbnail || "";
  const price = typeof obj.price === "number" ? obj.price : Number(obj.price) || 0;
  const variant = obj.variant || (Array.isArray(obj.variants) && obj.variants[0]?.label) || "";
  return { title, image, price, variant, url: obj.url || fallback };
}

// minimal OG parse to get title/image if site blocks details
function tryParseHtml(html = "", url = "") {
  const out = { url };
  const t = html.match(/property=["']og:title["']\s+content=["']([^"']+)["']/i);
  const i = html.match(/property=["']og:image["']\s+content=["']([^"']+)["']/i);
  if (t) out.title = t[1];
  if (i) out.image = i[1];
  return out;
}

async function scrapeWithBee(targetUrl) {
  if (!beeKey()) return null;
  const endpoint =
    `https://app.scrapingbee.com/api/v1/?api_key=${beeKey()}&url=${encodeURIComponent(targetUrl)}&render_js=true&block_resources=true&premium_proxy=true`;
  const { res, text } = await safeFetch(endpoint);
  if (!res.ok) return null;
  const product = tryParseHtml(text, targetUrl);
  return normalizeOne(product, targetUrl);
}

async function scrapeWithFallback(targetUrl) {
  const fb = fallbackUrl();
  if (!fb) return null;
  const { res, json } = await safeFetch(`${fb}/quote`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: targetUrl })
  });
  if (!res.ok || !json) return null;
  if (Array.isArray(json.items)) return normalizeOne(json.items[0], targetUrl);
  if (json.item) return normalizeOne(json.item, targetUrl);
  if (json.title || json.name) return normalizeOne(json, targetUrl);
  return null;
}

app.post("/quote", async (req, res) => {
  try {
    const target = req.body?.url;
    if (!target) return res.status(400).json({ error: "Missing url" });
    let product = null;
    try { product = await scrapeWithBee(target); } catch {}
    if (!product) { try { product = await scrapeWithFallback(target); } catch {} }
    if (!product) product = normalizeOne({ title: "Product from link", url: target }, target);
    return res.json({ item: product });
  } catch (err) {
    return res.status(500).json({ error: String(err) });
  }
});

app.listen(PORT, () => console.log("Backend running on port", PORT));
