// index.js - SpencerDeals Quote API (ocean-only)
const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

// CORS
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS, GET");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get("/", (_req, res) => res.send("SpencerDeals Quote API (ocean-only): OK"));

// Config (ocean only)
const DEFAULT_RATES = {
  taxPct: 0.0,              // US sales tax %
  dutyPct: 0.25,            // duty %
  servicePct: 0.10,         // service %
  specialOrderExtraPct: 0.05, // +5% if special order
  handlingPerOrder: 15,     // $ per order
  oceanPct: 0.12,           // sea freight as % of item subtotal
  placeholderItemPrice: 100,
  njToBdaDays: 14,
  standardEtaWeeks: [3, 5], // fallback when no product ETA
};

const round = n => Math.round((Number(n) || 0) * 100) / 100;
const cleanUrl = u => (u || "").replace(/[),.;!]+$/g, "");
const nowUTC = () => new Date();
const addDays = (d, days) => { const x = new Date(d); x.setUTCDate(x.getUTCDate() + Number(days||0)); return x; };
const toISO = d => new Date(d).toISOString();

function vendorFromUrl(url) {
  try {
    const { hostname } = new URL(url);
    const host = hostname.replace(/^www\./, "");
    const parts = host.split(".");
    const core = parts.length >= 2 ? parts[parts.length - 2] : parts[0];
    return core.charAt(0).toUpperCase() + core.slice(1);
  } catch { return "Vendor"; }
}

function parseItemsFromText(raw) {
  const itemsMap = new Map();
  const urlRe = /https?:\/\/[^\s<>\"]+[^\s<>\")\],.]/gi;
  const qtyNearRe = /^\s*(?:(?:x|\u00D7|\*)(\d{1,3})|\((\d{1,3})\))/i;
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
  return Array.from(itemsMap.entries()).map(([url, qty]) => ({ url, qty, vendor: vendorFromUrl(url) }));
}

function computeCharges(items, vendorFeesTotal, specialOrder, rates) {
  const r = { ...DEFAULT_RATES, ...(rates || {}) };
  const itemSubtotal = items.reduce((sum, it) => sum + (Number(it.priceUSD) || 0) * (it.qty || 1), 0);
  const tax = itemSubtotal * r.taxPct;
  const handling = r.handlingPerOrder;
  const freight = itemSubtotal * r.oceanPct; // OCEAN ONLY
  const duty = itemSubtotal * r.dutyPct;
  const service = itemSubtotal * (r.servicePct + (specialOrder ? r.specialOrderExtraPct : 0));
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
    grandTotal: round(grand),
    appliedRates: r,
  };
}

function computeETA(items, rates) {
  const r = { ...DEFAULT_RATES, ...(rates || {}) };
  const today = nowUTC();
  let usMinDays = null, usMaxDays = null;

  for (const it of items) {
    if (Number.isFinite(it.usEtaDaysMin) || Number.isFinite(it.usEtaDaysMax)) {
      const min = Number(it.usEtaDaysMin ?? it.usEtaDaysMax ?? 0);
      const max = Number(it.usEtaDaysMax ?? it.usEtaDaysMin ?? 0);
      usMinDays = Math.max(usMinDays ?? 0, min);
      usMaxDays = Math.max(usMaxDays ?? 0, max);
    } else if (it.usArrivalISO) {
      const d = new Date(it.usArrivalISO);
      const diff = Math.ceil((d - today) / (1000*60*60*24));
      usMinDays = Math.max(usMinDays ?? 0, diff);
      usMaxDays = Math.max(usMaxDays ?? 0, diff);
    }
  }

  if (usMaxDays == null) {
    const [wMin, wMax] = r.standardEtaWeeks;
    return { type: "standard", standardWeeks: [wMin, wMax], displayText: `${wMin}-${wMax} weeks` };
  }

  const finalMin = (usMinDays) + (r.njToBdaDays || 0);
  const finalMax = (usMaxDays) + (r.njToBdaDays || 0);
  const minDateISO = toISO(addDays(today, finalMin));
  const maxDateISO = toISO(addDays(today, finalMax));
  return {
    type: "calculated",
    rule: "latest US ETA + NJ→BDA days",
    njToBdaDays: r.njToBdaDays,
    usArrivalDays: { min: usMinDays, max: usMaxDays, chosen: usMaxDays },
    finalDays: { min: finalMin, max: finalMax },
    finalDates: { minDateISO, maxDateISO },
    displayText: `${new Date(minDateISO).toDateString()} — ${new Date(maxDateISO).toDateString()}`,
  };
}

// POST /quote  (ocean only)
// Body:
//  { text?: string, items?: [{url, qty, priceUSD?, vendor?, low?, usEtaDaysMin?, usEtaDaysMax?, usArrivalISO?}], specialOrder?: bool, vendorFees?: {Vendor:number}, rates?: {} }
app.post("/quote", (req, res) => {
  try {
    const specialOrder = !!req.body.specialOrder;
    const rates = req.body.rates || {};

    let items = [];
    if (Array.isArray(req.body.items) && req.body.items.length) {
      items = req.body.items.map(it => ({
        url: String(it.url || "").trim(),
        qty: Number(it.qty) || 1,
        vendor: it.vendor || vendorFromUrl(it.url || ""),
        priceUSD: Number(it.priceUSD) || DEFAULT_RATES.placeholderItemPrice,
        low: !!it.low,
        usEtaDaysMin: Number.isFinite(it.usEtaDaysMin) ? Number(it.usEtaDaysMin) : undefined,
        usEtaDaysMax: Number.isFinite(it.usEtaDaysMax) ? Number(it.usEtaDaysMax) : undefined,
        usArrivalISO: it.usArrivalISO || undefined,
      })).filter(x => x.url);
    } else if (typeof req.body.text === "string" && req.body.text.trim()) {
      items = parseItemsFromText(req.body.text).map(it => ({
        ...it,
        priceUSD: DEFAULT_RATES.placeholderItemPrice,
        low: false,
      }));
    } else {
      return res.status(400).json({ error: "Provide either {text} or {items} in the body." });
    }

    const vendorFees = req.body.vendorFees || {};
    const vendorList = Array.from(new Set(items.map(i => i.vendor)));
    const vendorFeesTotal = vendorList.reduce((sum, v) => sum + (parseFloat(vendorFees[v]) || 0), 0);

    const totals = computeCharges(items, vendorFeesTotal, specialOrder, rates);
    const eta = computeETA(items, rates);

    const alerts = [];
    const lowCount = items.filter(i => i.low).length;
    if (lowCount > 0) {
      alerts.push({ type: "stock", level: "warning", text: `${lowCount} item${lowCount>1?'s':''} are LOW IN STOCK — we recommend ordering today.` });
    }
    if (!req.body.noteVariantConfirmed) {
      alerts.push({ type: "variant", level: "info", text: "Please ensure the correct size/colour/finish is selected on each product page before sending the link." });
    }

    return res.json({
      ok: true,
      mode: "ocean",
      specialOrder,
      vendorFeesTotal: round(vendorFeesTotal),
      items,
      totals,
      eta,
      alerts,
    });
  } catch (err) {
    console.error("Quote error:", err);
    res.status(500).json({ ok: false, error: "Server error" });
  }
});

app.use(express.static(path.join(__dirname, "public")));

app.listen(PORT, () => console.log(`Quote API (ocean-only) on ${PORT}`));
