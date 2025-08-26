// Instant Quote Backend — alpha-landed-4-cjs (quote + extractProduct)
// CommonJS build (no "type":"module" needed)

const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch"); // add to package.json dependencies if missing

const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));

// ---------- Config ----------
const DEFAULT_FREIGHT_RATE_PER_FT3 = 6.0;   // hidden freight
const DEFAULT_VOLUME_FT3 = 11.33;
const DEFAULT_US_SALES_TAX_RATE = 0.06625;  // 6.625%
const FLAT_DUTY_RATE = 0.25;                // 25% duty for all items
const CARD_FEE_PCT = 0.0325;

// ---------- Helpers ----------
function roundRetail95(n) {
  const rounded = Math.round(n * 100) / 100;
  const floor = Math.floor(rounded);
  const cents = rounded - floor;
  if (cents <= 0.95) return floor + 0.95;
  return floor + 1 + 0.95;
}

function computeLanded({
  firstCost,
  qty = 1,
  volumeFt3,
  freightRatePerFt3 = DEFAULT_FREIGHT_RATE_PER_FT3,
  applyUsSalesTax = true,
  usSalesTaxRate = DEFAULT_US_SALES_TAX_RATE,
}) {
  const v = typeof volumeFt3 === "number" && volumeFt3 > 0 ? volumeFt3 : DEFAULT_VOLUME_FT3;
  const unitTax = applyUsSalesTax ? firstCost * usSalesTaxRate : 0;
  const unitFreight = freightRatePerFt3 * v;
  const unitDuty = firstCost * FLAT_DUTY_RATE;
  const landedUnit = firstCost + unitTax + unitFreight + unitDuty;
  const landedTotal = landedUnit * qty;

  // SDL import margin tiers (volume-based)
  const totalFt3 = v * qty;
  let marginPct = 0.4;
  if (totalFt3 >= 50) marginPct = 0.2;
  else if (totalFt3 >= 20) marginPct = 0.25;
  else if (totalFt3 >= 10) marginPct = 0.30;

  // Value caps by landed unit
  if (landedUnit > 5000) marginPct = Math.min(marginPct, 0.15);
  else if (landedUnit > 3000) marginPct = Math.min(marginPct, 0.20);
  else if (landedUnit > 1000) marginPct = Math.min(marginPct, 0.25);

  const retailUnitRaw = landedUnit * (1 + marginPct);
  const retailUnitWithFee = retailUnitRaw * (1 + CARD_FEE_PCT);
  const retailUnit = roundRetail95(retailUnitWithFee);
  const retailTotal = retailUnit * qty;

  return {
    inputs: { firstCost, qty, volumeFt3: v, freightRatePerFt3, applyUsSalesTax, usSalesTaxRate, dutyRate: FLAT_DUTY_RATE },
    breakdown: {
      unit: { firstCost, usSalesTax: unitTax, freight: unitFreight, duty: unitDuty, landed: landedUnit },
      total: { landed: landedTotal },
    },
    customer: { unit: retailUnit, total: retailTotal },
  };
}

// ---------- Health ----------
app.get(["/", "/health"], (_req, res) => {
  res.json({ ok: true, version: "alpha-landed-4-cjs", calc: "landed+retail-flat25+extract" });
});

// ---------- Quote ----------
app.post("/quote", (req, res) => {
  try {
    const body = req.body || {};
    const items = Array.isArray(body.items) ? body.items : (body.item ? [body.item] : []);
    if (!items.length) return res.status(400).json({ ok: false, error: "No items provided. Expect body.items[]." });

    const results = items.map((it, idx) => {
      const firstCost = Number(it.firstCost);
      const qty = Number.isFinite(Number(it.qty)) ? Number(it.qty) : 1;
      if (!Number.isFinite(firstCost) || firstCost <= 0) {
        return { index: idx, error: "Invalid firstCost" };
      }
      return { index: idx, ...computeLanded({ ...it, firstCost, qty }) };
    });

    const orderRetailTotal = results.reduce((sum, r) => sum + (r.customer?.total || 0), 0);
    const orderLandedTotal = results.reduce((sum, r) => sum + (r.breakdown?.total?.landed || 0), 0);

    res.json({
      ok: true,
      version: "alpha-landed-4-cjs",
      defaults: {
        freightRatePerFt3: DEFAULT_FREIGHT_RATE_PER_FT3,
        defaultVolumeFt3: DEFAULT_VOLUME_FT3,
        usSalesTaxRate: DEFAULT_US_SALES_TAX_RATE,
        dutyRate: FLAT_DUTY_RATE,
      },
      results,
      totals: { landed: orderLandedTotal, customer: orderRetailTotal },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: "Server error" });
  }
});

// GET convenience: /quote?firstCost=500&qty=2&volumeFt3=11.33
app.get("/quote", (req, res) => {
  const q = req.query;
  const firstCost = Number(q.firstCost);
  const qty = Number.isFinite(Number(q.qty)) ? Number(q.qty) : 1;
  if (!Number.isFinite(firstCost) || firstCost <= 0) {
    return res.status(400).json({ ok: false, error: "Provide firstCost as a number." });
  }
  const volumeFt3 = q.volumeFt3 !== undefined ? Number(q.volumeFt3) : undefined;
  const freightRatePerFt3 = q.freightRatePerFt3 !== undefined ? Number(q.freightRatePerFt3) : undefined;
  const applyUsSalesTax = q.applyUsSalesTax !== undefined ? q.applyUsSalesTax === "true" || q.applyUsSalesTax === true : true;

  const result = computeLanded({ firstCost, qty, volumeFt3, freightRatePerFt3, applyUsSalesTax });
  res.json({
    ok: true,
    version: "alpha-landed-4-cjs",
    results: [{ index: 0, ...result }],
    totals: { landed: result.breakdown.total.landed, customer: result.customer.total },
  });
});

// ---------- Scraper: POST /extractProduct ----------
// Uses ScrapingBee. Set env SCRAPINGBEE_API_KEY in Railway.
// Returns: { ok, url, title, price, image }
app.post("/extractProduct", async (req, res) => {
  try {
    const { url } = req.body || {};
    if (!url || typeof url !== "string") {
      return res.status(400).json({ ok: false, error: "Provide { url }" });
    }

    const apiKey = process.env.SCRAPINGBEE_API_KEY || process.env.SCRAPINGBEE_KEY;
    if (!apiKey) {
      return res.status(500).json({ ok: false, error: "Missing SCRAPINGBEE_API_KEY" });
    }

    const apiUrl = new URL("https://app.scrapingbee.com/api/v1");
    apiUrl.searchParams.set("api_key", apiKey);
    apiUrl.searchParams.set("url", url);
    apiUrl.searchParams.set("render_js", "true");
    apiUrl.searchParams.set("wait_for", "networkidle2"); // a little more stable

    const r = await fetch(apiUrl.toString(), { method: "GET" });
    if (!r.ok) throw new Error(`ScrapingBee HTTP ${r.status}`);
    const html = await r.text();

    // --- naive extractors ---
    const price = extractPrice(html);
    const title = extractTitle(html);
    const image = extractImage(html);

    res.json({
      ok: true,
      used: { provider: "scrapingbee", render_js: true },
      url,
      title,
      price,
      image,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: String(err.message || err) });
  }
});

// --- Simple HTML extractors (JSON-LD, metas, then regex fallbacks) ---
function extractTitle(html) {
  // <meta property="og:title" content="...">
  const m1 = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i);
  if (m1) return sanitize(m1[1]);

  // <title>...</title>
  const m2 = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  if (m2) return sanitize(m2[1]);

  return "Product";
}

function extractImage(html) {
  const m1 = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i);
  if (m1) return m1[1];
  const m2 = html.match(/<img[^>]+src=["']([^"']+)["'][^>]*class=["'][^"']*(main|hero|primary)[^"']*["']/i);
  if (m2) return m2[1];
  return "";
}

function extractPrice(html) {
  // 1) JSON-LD schema.org "price"
  const ldMatches = html.match(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi) || [];
  for (const block of ldMatches) {
    try {
      const json = JSON.parse(block.replace(/<script[^>]*>|<\/script>/gi, "").trim());
      const candidate = deepFindPrice(json);
      if (isFinite(candidate) && candidate > 0) return Number(candidate);
    } catch (_) { /* ignore */ }
  }

  // 2) Meta tags like product:price:amount
  const mMeta = html.match(/<meta[^>]+product:price:amount[^>]+content=["']([\d\.,]+)["']/i);
  if (mMeta) {
    const p = toNumber(mMeta[1]);
    if (p) return p;
  }

  // 3) Visible price patterns like "$1,299.99"
  const mDollar = html.match(/\$[\s]*([\d{1,3}(?:,\d{3})*(?:\.\d{2})?]+)/);
  if (mDollar) {
    const p = toNumber(mDollar[0]);
    if (p) return p;
  }

  // 4) Generic "price": 1299.99
  const mJson = html.match(/"price"\s*:\s*("?)(\d+(?:\.\d{2})?)\1/i);
  if (mJson) {
    const p = toNumber(mJson[2]);
    if (p) return p;
  }

  return 0;
}

function deepFindPrice(obj) {
  if (!obj || typeof obj !== "object") return 0;
  if (obj.price) {
    const p = toNumber(obj.price);
    if (p) return p;
  }
  if (obj.offers && typeof obj.offers === "object") {
    const offers = Array.isArray(obj.offers) ? obj.offers : [obj.offers];
    for (const o of offers) {
      const p = toNumber(o.price || o.priceSpecification?.price);
      if (p) return p;
    }
  }
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    const p = typeof v === "object" ? deepFindPrice(v) : 0;
    if (p) return p;
  }
  return 0;
}

function toNumber(s) {
  if (typeof s === "number") return s;
  if (!s) return 0;
  const cleaned = String(s).replace(/[^0-9.]/g, "");
  const n = parseFloat(cleaned);
  return isFinite(n) ? n : 0;
}

function sanitize(s) {
  return String(s).replace(/\s+/g, " ").trim();
}

// ---------- Start ----------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
});
