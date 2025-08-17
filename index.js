// index.js
const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

// Static site (serves /public/index.html)
app.use(express.static(path.join(__dirname, "public")));
app.use(express.json());

// --- BUSINESS RULES (from your spec) ---
const SALES_TAX_RATE = 0.06625;     // 6.625% if NOT Amazon/Wayfair
const DUTY_RATE = 0.25;             // 25%
const WHARFAGE_RATE = 0.02;         // 2%
const FREIGHT_PER_FT3 = 6.46;       // per cubic foot
const FIXED_FFF_PER_ITEM = 10;      // ≈ $10 per item
const CARD_FEE_RATE = 0.0375;       // 3.75%

function marginForCubicFeet(totalFt3) {
  if (totalFt3 < 20) return 0.30;
  if (totalFt3 <= 50) return 0.25;
  return 0.20;
}

function isTaxExemptVendor(vendor) {
  if (!vendor) return false;
  const v = String(vendor).trim().toLowerCase();
  return v.includes("amazon") || v.includes("wayfair");
}
function toNumber(n, fallback = 0) {
  const x = typeof n === "string" ? n.replace(/[^\d.]/g, "") : n;
  const num = Number(x);
  return Number.isFinite(num) ? num : fallback;
}

function calculateQuote(items = []) {
  const normalized = items.map((raw, idx) => {
    const vendor = String(raw.vendor || "").trim();
    const url = String(raw.url || "").trim();
    const qty = Math.max(1, Math.floor(toNumber(raw.qty, 1)));
    const firstCost = toNumber(raw.firstCost, 0);
    const ft3 = toNumber(raw.ft3, 0);

    const tax = isTaxExemptVendor(vendor) ? 0 : firstCost * SALES_TAX_RATE;
    const duty = firstCost * DUTY_RATE;
    const wharfage = firstCost * WHARFAGE_RATE;
    const freight = FREIGHT_PER_FT3 * ft3;
    const fixedFff = FIXED_FFF_PER_ITEM;

    const unitSubtotalBeforeCard =
      firstCost + tax + duty + wharfage + freight + fixedFff;
    const lineSubtotalBeforeCard = unitSubtotalBeforeCard * qty;

    return {
      i: idx + 1,
      vendor, url, qty, firstCost, ft3,
      tax, duty, wharfage, freight, fixedFff,
      unitSubtotalBeforeCard, lineSubtotalBeforeCard,
    };
  });

  const totalFt3 = normalized.reduce((s, it) => s + it.ft3 * it.qty, 0);
  const marginRate = marginForCubicFeet(totalFt3);
  const subtotalBeforeCard = normalized.reduce((s, it) => s + it.lineSubtotalBeforeCard, 0);
  const cardFee = subtotalBeforeCard * CARD_FEE_RATE;
  const totalLanded = subtotalBeforeCard + cardFee;
  const suggestedRetail = totalLanded / (1 - marginRate);

  const linesWithCard = normalized.map((it) => {
    const share = subtotalBeforeCard > 0
      ? (it.lineSubtotalBeforeCard / subtotalBeforeCard) * cardFee
      : 0;
    const lineLanded = it.lineSubtotalBeforeCard + share;
    return { ...it, cardShare: share, lineLanded };
  });

  return {
    destinationZip: "07201",
    inputs: normalized.map(({ url, vendor, qty, firstCost, ft3 }) => ({ url, vendor, qty, firstCost, ft3 })),
    totals: { totalFt3, marginRate, subtotalBeforeCard, cardFee, totalLanded, suggestedRetail },
    lines: linesWithCard,
    rules: {
      taxExemptVendors: ["Amazon", "Wayfair"],
      salesTaxRate: SALES_TAX_RATE, dutyRate: DUTY_RATE, wharfageRate: WHARFAGE_RATE,
      freightPerFt3: FREIGHT_PER_FT3, fixedFffPerItem: FIXED_FFF_PER_ITEM, cardFeeRate: CARD_FEE_RATE,
      marginBreaks: { "<20 ft³": 0.3, "20–50 ft³": 0.25, ">50 ft³": 0.2 },
    },
  };
}

app.post("/api/quote", (req, res) => {
  try {
    const { items } = req.body || {};
    const result = calculateQuote(Array.isArray(items) ? items : []);
    res.json(result);
  } catch (e) {
    console.error("Quote error", e);
    res.status(500).json({ error: "Failed to calculate quote." });
  }
});

app.get("/health", (_req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
