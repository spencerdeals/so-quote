// index.js — SO-Quote backend: CORS + JSON /health + real price scraper
const express = require("express");
const cheerio = require("cheerio");

const app = express();
const PORT = process.env.PORT || 3000;

/* ---------------- CORS (must be first) ---------------- */
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*"); // lock to your frontend later if you wish
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

/* ---------------- Parsers ---------------- */
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/* ---------------- Health ---------------- */
app.get("/health", (_req, res) => {
  res.json({ ok: true, version: "3.3-container", calc: "landed-v1" });
});

/* ---------------- Helpers ---------------- */
const round = n => Math.round((Number(n) || 0) * 100) / 100;

/**
 * Extract price from HTML using common Crate&Barrel/retail patterns:
 * 1) Prefer "Sale $X" text
 * 2) Look in common price containers
 * 3) Fallback to JSON-LD offers.price
 */
function extractPrice($) {
  // 1) "Sale $1,954.00" style text
  const saleNode = $('*:contains("Sale")')
    .filter((_, el) => /\$\s*\d[\d,\.]*/.test($(el).text()))
    .first();
  if (saleNode.length) {
    const m = saleNode.text().match(/\$\s*\d[\d,\.]*/);
    if (m) return parseFloat(m[0].replace(/[^0-9.]/g, ""));
  }

  // 2) Common price containers
  const priceContainers = [
    '[data-testid*="price"]',
    '[class*="price"]',
    '[class*="Price"]',
    '.price', '.sale', '.product-price'
  ].join(",");
  const containerText = $(priceContainers).text();
  const m2 = containerText.match(/\$\s*\d[\d,\.]*/);
  if (m2) return parseFloat(m2[0].replace(/[^0-9.]/g, ""));

  // 3) JSON-LD offers
  const ldBlocks = $('script[type="application/ld+json"]').map((_, s) => $(s).html()).get();
  for (const block of ldBlocks) {
    try {
      const data = JSON.parse(block);
      const arr = Array.isArray(data) ? data : [data];
      for (const d of arr) {
        if (d?.offers) {
          if (Array.isArray(d.offers) && d.offers[0]?.price) {
            const p = parseFloat(String(d.offers[0].price).replace(/[^0-9.]/g, ""));
            if (!Number.isNaN(p) && p > 0) return p;
          }
          if (d.offers.price) {
            const p = parseFloat(String(d.offers.price).replace(/[^0-9.]/g, ""));
            if (!Number.isNaN(p) && p > 0) return p;
          }
        }
      }
    } catch { /* ignore JSON parse errors */ }
  }

  return null;
}

function extractTitle($) {
  return $('h1').first().text().trim() || $('title').first().text().trim() || "Item";
}

/** Fetch a product page and extract first cost + title */
async function fetchItem(url) {
  try {
    const res = await fetch(url, {
      headers: {
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

/* ---------------- /quote ----------------
   Body: { links: ["https://..."], opts?: { defaultRate, defaultVolume } }
   We return items with firstCost; your frontend adds freight/fees/duty.
------------------------------------------------ */
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

    // Subtotal of base costs (frontend layers freight/fees/duty)
    const subtotal = round(items.reduce((s, it) => s + (it.firstCost * (it.qty || 1)), 0));
    res.json({ items, subtotal });
  } catch (e) {
    console.error("quote error:", e?.message || e);
    res.status(500).json({ error: "Server error generating quote." });
  }
});

/* ---------------- Start ---------------- */
app.listen(PORT, () => {
  console.log(`[SO-QUOTE] Backend running on :${PORT}`);
});
