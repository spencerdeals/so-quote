// Instant Quote Backend — #alpha landed cost patch (flat 25% duty, CommonJS)
// Full paste-and-replace file for index.js (CommonJS to avoid ESM issues)
// Version: alpha-landed-3-cjs (2025-08-23)

const express = require("express");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));

// ---------- Config (hidden defaults for customer-facing UI) ----------
// Freight assumption: consolidated 20' container @ $6,000, ~75% full ⇒ ~$6.00/ft³ (hidden)
const DEFAULT_FREIGHT_RATE_PER_FT3 = 6.0;

// Default carton volume when unknown (ft³)
const DEFAULT_VOLUME_FT3 = 11.33;

// US sales tax when vendors ship to FFF NJ warehouse
const DEFAULT_US_SALES_TAX_RATE = 0.06625; // 6.625%

// Flat import duty (25% for all items)
const FLAT_DUTY_RATE = 0.25;

// Round retail to *.95 endings (helper)
function roundRetail95(n) {
  const rounded = Math.round(n * 100) / 100;
  const floor = Math.floor(rounded);
  const cents = rounded - floor;
  if (cents <= 0.95) return floor + 0.95;
  return floor + 1 + 0.95;
}

// Core landed cost calculator
function computeLanded({
  firstCost,
  qty = 1,
  volumeFt3,
  category = "other",
  freightRatePerFt3 = DEFAULT_FREIGHT_RATE_PER_FT3,
  applyUsSalesTax = true,
  usSalesTaxRate = DEFAULT_US_SALES_TAX_RATE,
}) {
  const v = typeof volumeFt3 === "number" && volumeFt3 > 0 ? volumeFt3 : DEFAULT_VOLUME_FT3;
  const unitTax = applyUsSalesTax ? firstCost * usSalesTaxRate : 0;
  const unitFreight = freightRatePerFt3 * v;
  const unitDuty = firstCost * FLAT_DUTY_RATE; // always 25%
  const landedUnit = firstCost + unitTax + unitFreight + unitDuty;
  const landedTotal = landedUnit * qty;

  // Customer-facing retail (import margin SDL)
  const totalFt3 = v * qty;
  let marginPct = 0.4;
  if (totalFt3 >= 50) marginPct = 0.2;
  else if (totalFt3 >= 20) marginPct = 0.25;
  else if (totalFt3 >= 10) marginPct = 0.30;

  if (landedUnit > 5000) marginPct = Math.min(marginPct, 0.15);
  else if (landedUnit > 3000) marginPct = Math.min(marginPct, 0.20);
  else if (landedUnit > 1000) marginPct = Math.min(marginPct, 0.25);

  const retailUnitRaw = landedUnit * (1 + marginPct);
  const cardFeePct = 0.0325;
  const retailUnitWithFee = retailUnitRaw * (1 + cardFeePct);
  const retailUnit = roundRetail95(retailUnitWithFee);
  const retailTotal = retailUnit * qty;

  return {
    inputs: { firstCost, qty, volumeFt3: v, category, freightRatePerFt3, applyUsSalesTax, usSalesTaxRate, dutyRate: FLAT_DUTY_RATE },
    breakdown: {
      unit: {
        firstCost,
        usSalesTax: unitTax,
        freight: unitFreight,
        duty: unitDuty,
        landed: landedUnit,
      },
      total: {
        landed: landedTotal,
      },
    },
    customer: {
      unit: retailUnit,
      total: retailTotal,
    },
  };
}

app.get(["/", "/health"], (_req, res) => {
  res.json({ ok: true, version: "alpha-landed-3-cjs", calc: "landed+retail-flat25" });
});

app.post("/quote", (req, res) => {
  try {
    const body = req.body || {};
    const items = Array.isArray(body.items) ? body.items : (body.item ? [body.item] : []);

    if (!items.length) {
      return res.status(400).json({ ok: false, error: "No items provided. Expect body.items[]." });
    }

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
      version: "alpha-landed-3-cjs",
      defaults: {
        freightRatePerFt3: DEFAULT_FREIGHT_RATE_PER_FT3,
        defaultVolumeFt3: DEFAULT_VOLUME_FT3,
        usSalesTaxRate: DEFAULT_US_SALES_TAX_RATE,
        dutyRate: FLAT_DUTY_RATE,
      },
      results,
      totals: {
        landed: orderLandedTotal,
        customer: orderRetailTotal,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: "Server error" });
  }
});

app.get("/quote", (req, res) => {
  const q = req.query;
  const firstCost = Number(q.firstCost);
  const qty = Number.isFinite(Number(q.qty)) ? Number(q.qty) : 1;
  if (!Number.isFinite(firstCost) || firstCost <= 0) {
    return res.status(400).json({ ok: false, error: "Provide firstCost as a number." });
  }
  const volumeFt3 = q.volumeFt3 !== undefined ? Number(q.volumeFt3) : undefined;
  const category = q.category || "other";
  const freightRatePerFt3 = q.freightRatePerFt3 !== undefined ? Number(q.freightRatePerFt3) : undefined;
  const applyUsSalesTax = q.applyUsSalesTax !== undefined ? q.applyUsSalesTax === "true" || q.applyUsSalesTax === true : true;
  const result = computeLanded({ firstCost, qty, volumeFt3, category, freightRatePerFt3, applyUsSalesTax });
  res.json({ ok: true, version: "alpha-landed-3-cjs", results: [ { index: 0, ...result } ], totals: { landed: result.breakdown.total.landed, customer: result.customer.total } });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
});
