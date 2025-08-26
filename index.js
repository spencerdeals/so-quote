// #alpha build — version 3
// Express backend with /health and /quote using SDL rules

const express = require("express");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 3000;

// --- Middleware
app.use(cors());
app.use(express.json({ limit: "1mb" }));

// --- Constants
const DEFAULT_US_SALES_TAX = 0.06625;
const DEFAULT_FREIGHT_PER_FT3 = 6.00;
const CARD_FEE_RATE = 0.0325;
const DEFAULT_DUTY_UPHOLSTERED = 0.25;
const DEFAULT_VOLUME_FT3 = 11.33;
const FIXED_FEES_PER_SHIPMENT = 0;

// Margin tiers
function marginByVolume(totalFt3) {
  if (totalFt3 < 10) return 0.40;
  if (totalFt3 < 20) return 0.30;
  if (totalFt3 < 50) return 0.25;
  return 0.20;
}

// Value caps
function capByLanded(landed) {
  if (landed > 5000) return 0.15;
  if (landed > 3000) return 0.20;
  if (landed > 1000) return 0.25;
  return 1.0;
}

// Round retail to *.95 endings
function roundTo95(n) {
  const rounded = Math.round(n / 0.05) * 0.05;
  const dollars = Math.floor(rounded);
  return dollars + 0.95;
}

// Health check
app.get(["/", "/health"], (_req, res) => {
  res.json({ ok: true, version: "alpha-3", calc: "landed+retail-dynamic(SDL)" });
});

// Quote endpoint
app.post("/quote", (req, res) => {
  try {
    const body = req.body || {};
    const items = Array.isArray(body.items) ? body.items : [];
    if (!items.length) {
      return res.status(400).json({ ok: false, error: "No items provided." });
    }

    const freightPerFt3 = isFinite(body.freightPerFt3) ? Number(body.freightPerFt3) : DEFAULT_FREIGHT_PER_FT3;
    const fixedFeesPerShipment = isFinite(body.fixedFeesPerShipment) ? Number(body.fixedFeesPerShipment) : FIXED_FEES_PER_SHIPMENT;

    const totalFt3 = items.reduce((sum, it) => {
      const qty = Number(it.qty) || 1;
      const v = isFinite(it.volumeFt3) ? Number(it.volumeFt3) : DEFAULT_VOLUME_FT3;
      return sum + v * qty;
    }, 0);

    const volTierMargin = marginByVolume(totalFt3);
    const totalQty = items.reduce((s, it) => s + (Number(it.qty) || 1), 0);
    const perUnitFixedFee = totalQty > 0 ? (fixedFeesPerShipment / totalQty) : 0;

    const lineResults = items.map((it) => {
      const name = it.name || "Item";
      const qty = Number(it.qty) || 1;
      const firstCost = Math.max(0, Number(it.firstCost) || 0);
      const volumeFt3 = isFinite(it.volumeFt3) ? Number(it.volumeFt3) : DEFAULT_VOLUME_FT3;
      const category = (it.category || "").toLowerCase();
      const dutyRate = isFinite(it.dutyRate) ? Number(it.dutyRate) :
        (category.includes("upholster") ? DEFAULT_DUTY_UPHOLSTERED : 0.0);
      const taxExempt = Boolean(it.taxExempt);

      const usTax = taxExempt ? 0 : firstCost * DEFAULT_US_SALES_TAX;
      const freight = volumeFt3 * freightPerFt3;
      const fixedFee = perUnitFixedFee;
      const duty = firstCost * dutyRate;

      const landedPerUnit = firstCost + usTax + freight + fixedFee + duty;

      const cap = capByLanded(landedPerUnit);
      const marginRate = Math.min(volTierMargin, cap);

      const retailPreCard = landedPerUnit * (1 + marginRate);
      const retailWithCard = retailPreCard * (1 + CARD_FEE_RATE);
      const retail = roundTo95(retailWithCard);
      const total = retail * qty;

      return {
        name,
        qty,
        firstCost,
        volumeFt3,
        category,
        dutyRate,
        taxExempt,
        breakdown: {
          usTax: Number(usTax.toFixed(2)),
          freight: Number(freight.toFixed(2)),
          fixedFee: Number(fixedFee.toFixed(2)),
          duty: Number(duty.toFixed(2)),
          landedPerUnit: Number(landedPerUnit.toFixed(2)),
          marginRate,
          cardFeeRat
