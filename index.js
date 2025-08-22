// index.js — CORS-safe quote API with Scraper B + Amazon fallback
import express from "express";
import cors from "cors";

// ---------- CONFIG ----------
const SETTINGS = {
  CARD_FEE_RATE: 0.05,
  DEFAULT_FT3: 11.33,
  FREIGHT_PER_FT3: 6.00,
  FIXED_FEES_TOTAL: 148.00,
  US_SALES_TAX_RATE: 0.06625,
  DUTY_RATE: 0.25,
  COMPETITIVE: true, // SDL import competitive margin (temporary)
};
const SCRAPER_B_URL = process.env.SCRAPER_B_URL || ""; // e.g. https://scraper-b.yourdomain/scrape

// ---------- SERVER ----------
const app = express();
app.use(express.json({ limit: "1mb" }));

// CORS: allow Canva + everywhere (we can tighten later)
app.use(
  cors({
    origin: (origin, cb) => cb(null, true),
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type"],
    credentials: false,
    maxAge: 86400,
  })
);
app.options("*", cors());

// Health
app.get(["/", "/health"], (_req, res) =>
  res.json({ ok: true, version: "alpha-sdl-canva", cors: "enabled" })
);

// ---------- Helpers ----------
function marginRateByVolume(totalFt3) {
  const standard = (v) => (v < 10 ? 0.40 : v < 20 ? 0.30 : v < 50 ? 0.25 : 0.20);
  const competitive = (v) => Math.max(0, standard(v) - 0.05); // 35/25/20/15
  return SETTINGS.COMPETITIVE ? competitive(totalFt3) : standard(totalFt3);
}
function to95(n) { const w = Math.floor(n); return w + 0.95; }

function priceOrder(items) {
  const totalFt3 = items.reduce((s, i) => s + (i.ft3 || SETTINGS.DEFAULT_FT3) * (i.qty || 1), 0);
  const margin = marginRateByVolume(totalFt3);
  const perVol = (ft3) => (totalFt3 > 0 ? ft3 / totalFt3 : 0);

  return items.map((it) => {
    const qty = it.qty || 1;
    const ft3 = it.ft3 || SETTINGS.DEFAULT_FT3;
    const first = Number(it.firstCost);

    const usTax = first * SETTINGS.US_SALES_TAX_RATE;
    const dutyBase = first + usTax; // IMPORTANT: duty on (first + US tax)
    const duty = dutyBase * SETTINGS.DUTY_RATE;
    const freight = ft3 * SETTINGS.FREIGHT_PER_FT3;
    const fixed = SETTINGS.FIXED_FEES_TOTAL * perVol(ft3 * qty) / Math.max(1, qty);

    const landed = first + usTax + duty + freight + fixed;
    const preCard = landed * (1 + margin);
    const cardFee = preCard * SETTINGS.CARD_FEE_RATE;
    const unit = to95(preCard + cardFee);
    const total = unit * qty;

    return { ...it, qty, ft3, unit, total, breakdown: { first, usTax, duty, freight, fixed, margin, cardFee } };
  });
}

// Minimal Amazon fallback scraper (best-effort; Scraper B preferred)
async function scrapeAmazonDirect(url) {
  const resp = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
      "Accept-Language": "en-US,en;q=0.9",
    },
  });
  if (!resp.ok) throw new Error(`Amazon fetch failed: ${resp.status}`);
  const html = await resp.text();

  // Title
  let title = null;
  const t1 = html.match(/<span[^>]*id=["']productTitle["'][^>]*>([^<]+)<\/span>/i);
  if (t1) title = t1[1].trim();

  // Price
  let price = null;
  const p1 = html.match(/"priceToPay"[^}]*"amount"\s*:\s*([0-9.]+)/i);
  if (p1) price = parseFloat(p1[1]);
  if (!price) {
    const p2 = html.match(/<span[^>]*class=["']a-offscreen["'][^>]*>\$([0-9.,]+)<\/span>/i);
    if (p2) price = parseFloat(p2[1].replace(/,/g, ""));
  }

  // Image
  let image = null;
  const i1 = html.match(/"hiRes":"(https:[^"]+)"/i);
  if (i1) image = i1[1].replace(/\\u0026/g, "&");
  if (!image) {
    const i2 = html.match(/"large":"(https:[^"]+)"/i);
    if (i2) image = i2[1].replace(/\\u0026/g, "&");
  }

  // Variants
  let variants = [];
  const dv = html.match(/"dimensionValuesDisplayData"\s*:\s*(\{[^}]+\})/i);
  if (dv) {
    try {
      const obj = JSON.parse(dv[1].replace(/\\u0022/g, '"'));
      for (const k of Object.keys(obj)) variants.push(`${k}: ${obj[k]}`);
    } catch {}
  } else {
    const color = html.match(/"color_name"\s*:\s*"([^"]+)"/i);
    const style = html.match(/"style_name"\s*:\s*"([^"]+)"/i);
    if (color) variants.push(`Color: ${color[1]}`);
    if (style) variants.push(`Configuration: ${style[1]}`);
  }

  return { name: title || null, price: price ?? null, image, variants };
}

// Try Scraper B first
async function scrapeViaScraperB(url) {
  if (!SCRAPER_B_URL) return null;
  const resp = await fetch(SCRAPER_B_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });
  if (!resp.ok) throw new Error(`Scraper B ${resp.status}`);
  const j = await resp.json();
  // Expecting: { name, price, image, variants }
  return {
    name: j.name ?? null,
    price: typeof j.price === "number" ? j.price : (j.price ? Number(j.price) : null),
    image: j.image ?? null,
    variants: Array.isArray(j.variants) ? j.variants : [],
  };
}

// Debug route: raw scrape only (no pricing)
app.post("/quote/raw", async (req, res) => {
  const { url } = req.body || {};
  if (!url) return res.status(400).json({ error: "url required" });
  try {
    const sB = await scrapeViaScraperB(url);
    if (sB && sB.price != null) return res.json({ source: "scraperB", ...sB });
    const az = await scrapeAmazonDirect(url);
    return res.json({ source: "amazon-fallback", ...az });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
});

// Main quote: scrape -> price -> return
app.post("/quote", async (req, res) => {
  try {
    const { links } = req.body || {};
    if (!Array.isArray(links) || links.length === 0) return res.json({ items: [] });

    const scraped = [];
    for (const link of links) {
      let s = null;
      try {
        s = (await scrapeViaScraperB(link)) || (await scrapeAmazonDirect(link));
      } catch (e) {
        s = { error: String(e.message || e) };
      }
      scraped.push({ link, ...s, qty: 1, ft3: SETTINGS.DEFAULT_FT3 });
    }

    // Only price successful entries with a price
    const toPrice = scraped
      .filter(x => typeof x.price === "number" && isFinite(x.price))
      .map(x => ({ link: x.link, name: x.name, image: x.image, firstCost: x.price, qty: x.qty, ft3: x.ft3 }));

    const priced = priceOrder(toPrice);

    // Merge priced totals back
    const items = scraped.map(x => {
      const p = priced.find(y => y.link === x.link);
      return {
        link: x.link,
        name: x.name || null,
        image: x.image || null,
        variants: Array.isArray(x.variants) ? x.variants : [],
        qty: x.qty || 1,
        unit: p ? p.unit : null,
        total: p ? p.total : null,
        error: x.error || (p ? null : (typeof x.price !== "number" ? "No price" : null))
      };
    });

    res.json({ items });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Server running on", PORT));
