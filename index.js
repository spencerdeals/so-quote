// index.js — SDL Quote API (ocean-only) with CORS enabled
const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

/* -------------------- CORS (MUST be first) -------------------- */
app.use((req, res, next) => {
  // Allow your frontend to call this API from the browser
  res.setHeader("Access-Control-Allow-Origin", "*"); // or lock to: https://sdl-quote-frontend-production.up.railway.app
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(200); // preflight
  next();
});

/* -------------------- Body parsing -------------------- */
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/* -------------------- Health -------------------- */
app.get("/health", (_req, res) => {
  res.json({ ok: true, version: "3.3-container", calc: "landed-v1" });
});

/* -------------------- Simple ocean-only model -------------------- */
/* This version uses a % model: freight/service/duty from first cost.
   You can swap back to your ft³ model later if you prefer. */
const DEFAULTS = {
  dutyPct: 0.25,
  servicePct: 0.10,
  handlingPerOrder: 15,
  oceanPct: 0.12,
  placeholder: 100
};
const round = n => Math.round((Number(n) || 0) * 100) / 100;

function normalizeItems(body) {
  const out = [];
  if (Array.isArray(body.items)) {
    body.items.forEach(it => {
      const url = String(it.url || "").trim();
      if (!url) return;
      out.push({
        url,
        qty: Number(it.qty) || 1,
        firstCost: Number(it.firstCost ?? it.unitPrice ?? it.priceUSD ?? it.price ?? DEFAULTS.placeholder)
      });
    });
    return out;
  }
  if (Array.isArray(body.links)) {
    body.links.forEach(link => {
      const url = String(link || "").trim();
      if (!url) return;
      out.push({ url, qty: 1, firstCost: DEFAULTS.placeholder });
    });
    return out;
  }
  if (typeof body.text === "string" && body.text.trim()) {
    (body.text.match(/https?:\/\/[^\s<>\"]+[^\s<>\")\],.]/gi) || []).forEach(url => {
      out.push({ url, qty: 1, firstCost: DEFAULTS.placeholder });
    });
  }
  return out;
}

/* -------------------- /quote -------------------- */
app.post("/quote", (req, res) => {
  try {
    const itemsIn = normalizeItems(req.body || {});
    if (!itemsIn.length) {
      return res.status(400).json({ error: "Provide links[] or items[] in the body." });
    }

    const d = DEFAULTS;
    const items = itemsIn.map((it, i) => {
      const qty = it.qty;
      const first = it.firstCost;

      const freight = first * d.oceanPct;
      const fees = d.handlingPerOrder;
      const duty = first * d.dutyPct;
      const service = first * d.servicePct;

      const unitLanded = first + freight + fees + duty + service;
      const total = qty * unitLanded;

      return {
        title: `Item ${i + 1}`,
        url: it.url,
        qty,
        firstCost: round(first),
        freight: round(freight),
        fees: round(fees),
        duty: round(duty),
        unitLanded: round(unitLanded),
        total: round(total)
      };
    });

    const subtotal = round(items.reduce((s, x) => s + (x.total || 0), 0));
    res.json({ items, subtotal });
  } catch (e) {
    console.error("Quote error:", e);
    res.status(500).json({ error: "Server error generating quote." });
  }
});

/* -------------------- Optional static (if you keep /public) -------------------- */
app.use(express.static(path.join(__dirname, "public")));

app.listen(PORT, () => {
  console.log(`Quote API running on :${PORT}`);
});
