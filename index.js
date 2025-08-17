// index.js - SpencerDeals Quote API (starter)
// Plain Express, no extra deps

const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

// --- Basic CORS so your Canvas/Shopify/Railway frontends can call this
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS, GET");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// --- Health
app.get("/", (req, res) => res.send("SpencerDeals Quote API: OK"));

// ------------------------------
// Config: starter rates (adjust anytime)
// ------------------------------
const RATES = {
  taxPct: 0.0,             // US sales tax %
  dutyPct: 0.25,           // 25% duty
  servicePct: 0.10,        // 10% service fee
  specialOrderExtraPct: 0.05, // +5% if special order
  handlingPerOrder: 15,    // $15 NJ handling
  oceanPct: 0.12,          // 12% of item subtotal
  airPct: 0.25,            // 25% of item subtotal (Fast Forward)
  placeholderItemPrice: 100 // if no price given, use this
};

// ------------------------------
// Helpers
// ------------------------------
function round(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function cleanUrl(u) {
  return (u || "").replace(/[),.;!]+$/g, "");
}

function vendorFromUrl(url) {
  try {
    const { hostname } = new URL(url);
    const host = hostname.replace(/^www\./, "");
    const parts = host.split(".");
    const core = parts.length >= 2 ? parts[parts.length - 2] : parts[0];
    return core.charAt(0).toUpperCase() + core.slice(1);
  } catch {
    return "Vendor";
  }
}

function parseItemsFromText(raw) {
  const itemsMap = new Map(); // url -> qty
  const urlRe = /https?:\/\/[^\s<>\"]+[^\s<>\")\],.]/gi;
  const qtyNearRe = /^\s*(?:(?:x|\*)(\d{1,3})|\((\d{1,3})\))/i;
  const lines = (raw || "").split(/\r?\n/).map(s => s.trim()).filter(Boolean);

  for (const line of lines) {
    const matches = line.matchAll(urlRe);
    for (const m of matches) {
      const rawUrl = m[0];
      const url = cleanUrl(rawUrl);
      const after = line.slice(m.index + rawUrl.length);
      let qty = 1;
      const q = after.match(qtyNearRe) || line.match(qtyNearRe);
      if (q) {
        qty = parseInt(q[1] || q[2], 10);
        if (!Number.isFinite(qty) || qty < 1) qty = 1;
      }
      itemsMap.set(url, (itemsMap.get(url) || 0) + qty);
    }
  }
  if (itemsMap.size === 0) {
    const all = (raw.match(/https?:\/\/[^\s<>\"]+/gi) || []).map(cleanUrl);
    for (const u of all) itemsMap.set(u, (itemsMap.get(u) || 0) + 1);
  }

  return Array.from(itemsMap.entries()).map(([url, qty]) => ({
    url,
    qty,
    vendor: vendorFromUrl(url)
  }));
}

function computeCharges(items, vendorFeesTotal, mode, specialOrder) {
  const itemSubtotal = items.reduce(
    (sum, it) => sum + (Number(it.priceUSD) || 0) * (it.qty || 1),
    0
  );

  const tax = itemSubtotal * RATES.taxPct;
  const handling = RATES.handlingPerOrder;
  const freight = itemSubtotal * (mode === "air" ? RATES.airPct : RATES.oceanPct);
  const duty = itemSubtotal * RATES.dutyPct;
  const service = itemSubtotal * (RATES.servicePct + (specialOrder ? RATES.specialOrderExtraPct : 0));
  const chargesSubtotal = vendorFeesTotal + tax + handling + freight + duty + service;
  const grand = itemSubtotal + chargesSubtotal;

  return {
    itemSubtotal: round(itemSubtotal),
    taxUSD: round(tax),
    handlingUSD: round(handling),
    freightUSD: round(freight),
    dutyUSD: round(duty),
    serviceUSD: round(service),
    chargesSubtotal: round(chargesSubtotal),
    grandTotal: round(grand)
  };
}

// ------------------------------
// POST /quote
// Body options:
//  A) { text: "paste of links", mode?: "ocean"|"air", specialOrder?: bool, vendorFees?: {Vendor:number}, items?: [{url, qty, priceUSD}] }
//  B) { items: [...] } (skip parsing, use provided items)
// If priceUSD missing, we use placeholder.
// ------------------------------
app.post("/quote", (req, res) => {
  try {
    const mode = req.body.mode === "air" ? "air" : "ocean";
    const specialOrder = !!req.body.specialOrder;

    let items = [];
    if (Array.isArray(req.body.items) && req.body.items.length) {
      items = req.body.items.map((it) => ({
        url: String(it.url || "").trim(),
        qty: Number(it.qty) || 1,
        vendor: it.vendor || vendorFromUrl(it.url || ""),
        priceUSD: Number(it.priceUSD) || RATES.placeholderItemPrice,
        low: !!it.low
      })).filter(x => x.url);
    } else if (typeof req.body.text === "string" && req.body.text.trim()) {
      items = parseItemsFromText(req.body.text).map((it) => ({
        ...it,
        priceUSD: RATES.placeholderItemPrice,
        low: false
      }));
    } else {
      return res.status(400).json({ error: "Provide either {text} or {items} in the body." });
    }

    // Vendor fees (optional)
    const vendorFees = req.body.vendorFees || {};
    const vendorList = Array.from(new Set(items.map(i => i.vendor)));
    const vendorFeesTotal = vendorList.reduce((sum, v) => sum + (parseFloat(vendorFees[v]) || 0), 0);

    const totals = computeCharges(items, vendorFeesTotal, mode, specialOrder);

    return res.json({
      ok: true,
      mode,
      specialOrder,
      rates: RATES,
      vendorFeesTotal: round(vendorFeesTotal),
      items,
      totals
    });
  } catch (err) {
    console.error("Quote error:", err);
    res.status(500).json({ ok: false, error: "Server error" });
  }
});

// --- Serve static (optional): if you drop an index.html into /public
app.use(express.static(path.join(__dirname, "public")));

app.listen(PORT, () => {
  console.log(`Quote API running on port ${PORT}`);
});
