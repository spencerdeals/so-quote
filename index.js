// index.js — SDL Quote API with CORS + real price scraper
const express = require("express");
const cheerio = require("cheerio");
const app = express();
const PORT = process.env.PORT || 3000;

/* ---------- CORS FIRST ---------- */
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");  // lock to your frontend later if you wish
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

/* ---------- Parsers ---------- */
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/* ---------- Health ---------- */
app.get("/health", (_req, res) => {
  res.json({ ok: true, version: "3.3-container", calc: "landed-v1" });
});

/* ---------- Helpers ---------- */
const round = n => Math.round((Number(n) || 0) * 100) / 100;

/**
 * Robust price extraction:
 * 1) Prefer "Sale" price text on page
 * 2) Otherwise find first $"1234.56" text in common price containers
 * 3) Fallback to JSON-LD offers.price
 */
function extractPrice($) {
  // 1) Try an explicit "Sale" context (Crate & Barrel shows "Sale $1,954.00")
  const saleText = $('*:contains("Sale")').filter((_, el) => $(el).text().trim().match(/\$\d[\d,\.]*/)).first().text();
  if (saleText) {
    const m = saleText.match(/\$\d[\d,\.]*/);
    if (m) return parseFloat(m[0].replace(/[^0-9.]/g, ""));
  }

  // 2) Look in common price containers
  const candidates = [
    '[data-testid*="price"]',
    '[class*="price"]',
    '[class*="Price"]',
    '.price', '.sale', '.product-price'
  ].join(",");

  const containerText = $(candidates).text();
  const m2 = containerText.match(/\$\s*\d[\d,\.]*/);
  if (m2) return parseFloat(m2[0].replace(/[^0-9.]/g, ""));

  // 3) JSON-LD
  const ld = $('script[type="application/ld+json"]').map((_, s) => $(s).html()).get();
  for (const block of ld) {
    try {
      const data = JSON.parse(block);
      // handle both single object and array of objects
      const candidates = Array.isArray(data) ? data : [data];
      for (const d of candidates) {
        if (d && d.offers && (d.offers.price || (Array.isArray(d.offers) && d.offers[0]?.price))) {
          const p = d.offers.price || d.offers[0].price;
          const priceNum = parseFloat(String(p).replace(/[^0-9.]/g, ""));
          if (!Number.isNaN(priceNum) && priceNum > 0) return priceNum;
        }
      }
    } catch {}
  }

  return null;
}

function extractTitle($) {
  const t = $('h1').first().text().trim() || $('title').first().text().trim();
  return t || "Item";
}

/**
 * Fetch a single product page and extract its first cost
 */
async function fetchItem(url) {
  try {
    const res = await fetch(url, {
      headers: {
        // Be polite + avoid some bot blocks
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
        "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
      }
    });
    const html = await res.text();
    const $ = cheerio.load(html);

    const firstCost = extractPrice($) ?? 0;
    const title = extractTitle($);
    return { title, firstCost };
  } catch (e) {
    console.error("fetchItem error:", e?.message || e);
    return { title: "Item", firstCost: 0 };
  }
}

/* ---------- /quote ---------- */
/**
 * Expected body:
 * { links: ["https://site/product1", "..."], opts: { defaultRate, defaultVolume } }
 * We return items with firstCost; your frontend normalizer will add freight/fees/duty.
 */
app.post("/quote", async (req, res) => {
  try {
    const links = Array.isArray(req.body?.links) ? req.body.links.filter(Boolean) : [];
    if (!links.length) return res.status(400).json({ error: "Provide links[] in request body" });

    const items = [];
    for (let i = 0; i < links.length; i++) {
      const url = String(links[i]).trim();
      const { title, firstCost } = await fetchItem(url);
      items.push({
        title: title || `Item ${i + 1}`,
        url,
        qty: 1,
        firstCost: round(firstCost)
      });
    }

    // Subtotal here is just the base cost sum; your frontend will layer freight/fees/duty.
    const subtotal = round(items.reduce((s, it) => s + (it.firstCost * (it.qty || 1)), 0));
    res.json({ items, subtotal });
  } catch (e) {
    console.error("quote error:", e?.message || e);
    res.status(500).json({ error: "Server error generating quote." });
  }
});

/* ---------- Start ---------- */
app.listen(PORT, () => {
  console.log(`[SO-QUOTE] Backend running on :${PORT}`);
});
