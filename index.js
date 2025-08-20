// index.js — SDL Quote API (ocean-only; container rate; links/text/items supported)
const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

// ---- SDL defaults ----
const DEFAULT_RATE = 6.00;     // USD / ft³ (20' container all-in)
const DEFAULT_VOLUME = 11.33;  // ft³ default carton per item when unknown
const DEFAULT_FEES = 148;      // per-shipment fixed fees (basic allocation placeholder)
const DEFAULT_DUTY = 0.25;     // 25% (upholstered default)
const WHARFAGE_PER_UNIT = 0;   // set >0 to add per-unit wharfage
const PLACEHOLDER_PRICE = 100; // fallback first cost when not supplied

// --- CORS ---
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS, GET");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health endpoint the frontend expects
app.get(["/", "/health"], (_req, res) => {
  res.json({ ok: true, version: "3.3-container", calc: "landed-v1" });
});

// Helpers
const round = n => Math.round((Number(n) || 0) * 100) / 100;
const cleanUrl = u => (u || "").replace(/[),.;!]+$/g, "");
function vendorFromUrl(url) {
  try {
    const { hostname } = new URL(url);
    const host = hostname.replace(/^www\./, "");
    const parts = host.split(".");
    const core = parts.length >= 2 ? parts[parts.length - 2] : parts[0];
    return core.charAt(0).toUpperCase() + core.slice(1);
  } catch { return "Vendor"; }
}
function urlsFromText(raw) {
  if (!raw) return [];
  const urlRe = /https?:\/\/[^\s<>\"]+[^\s<>\")\],.]/gi;
  return (raw.match(urlRe) || []).map(cleanUrl);
}

// Normalizes incoming request body (links | text | items) into [{url, qty, firstCost}]
function normalizeItems(body) {
  const out = [];

  // A) items array provided
  if (Array.isArray(body.items) && body.items.length) {
    body.items.forEach(it => {
      const url = String(it.url || "").trim();
      if (!url) return;
      const qty = Number(it.qty) || 1;
      const firstCost = Number(it.firstCost ?? it.unitPrice ?? it.priceUSD ?? it.price ?? PLACEHOLDER_PRICE);
      out.push({ url, qty, firstCost, vendor: vendorFromUrl(url) });
    });
    return out;
  }

  // B) links array provided
  if (Array.isArray(body.links) && body.links.length) {
    body.links.forEach(link => {
      const url = cleanUrl(String(link || "").trim());
      if (!url) return;
      out.push({ url, qty: 1, firstCost: PLACEHOLDER_PRICE, vendor: vendorFromUrl(url) });
    });
    return out;
  }

  // C) text blob provided
  if (typeof body.text === "string" && body.text.trim()) {
    urlsFromText(body.text).forEach(url => {
      out.push({ url, qty: 1, firstCost: PLACEHOLDER_PRICE, vendor: vendorFromUrl(url) });
    });
    return out;
  }

  return out; // empty
}

// POST /quote
// Accepts:
//  { links?: string[], text?: string, items?: [{ url, qty, firstCost? | unitPrice? | priceUSD? }], opts?: { defaultRate, defaultVolume } }
app.post("/quote", (req, res) => {
  try {
    const itemsIn = normalizeItems(req.body || {});
    if (!itemsIn.length) {
      return res.status(400).json({ error: "Provide links[], text, or items[] in the body." });
    }

    const rate = Number(req.body?.opts?.defaultRate ?? DEFAULT_RATE) || DEFAULT_RATE;
    const defaultVolume = Number(req.body?.opts?.defaultVolume ?? DEFAULT_VOLUME) || DEFAULT_VOLUME;

    // Simple per-item landed calc using SDL container model
    const items = itemsIn.map((src, i) => {
      const qty = Number(src.qty || 1);
      const first = Number(src.firstCost || 0);
      const ft3 = defaultVolume;
      const freight = ft3 * rate;
      const fees = DEFAULT_FEES;                 // simple per-item placeholder (can later allocate by batch)
      const duty = first * DEFAULT_DUTY;
      const dutyWharf = duty + WHARFAGE_PER_UNIT;
      const unitLanded = first + freight + fees + duty;
      const total = qty * unitLanded;

      return {
        title: src.vendor || `Item ${i + 1}`,
        url: src.url,
        qty,
        firstCost: round(first),
        ft3: round(ft3),
        freight: round(freight),
        fees: round(fees),
        duty: round(duty),
        dutyWharf: round(dutyWharf),
        unitLanded: round(unitLanded),
        total: round(total)
      };
    });

    const subtotal = round(items.reduce((s, x) => s + (x.total || 0), 0));

    return res.json({ items, subtotal });
  } catch (err) {
    console.error("Quote error:", err);
    res.status(500).json({ error: "Server error generating quote." });
  }
});

// Serve any static test assets if you keep a public folder
app.use(express.static(path.join(__dirname, "public")));

app.listen(PORT, () => console.log(`SDL Quote API running on :${PORT}`));
