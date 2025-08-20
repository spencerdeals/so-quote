// index.js — SDL Quote API (minimal) with CORS + JSON health
const express = require("express");
const app = express();
const PORT = process.env.PORT || 3000;

/* ---------- CORS FIRST ---------- */
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");  // you can lock to your frontend domain later
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(200); // preflight OK
  next();
});

/* ---------- Parsers ---------- */
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/* ---------- Routes ---------- */
app.get("/", (_req, res) => {
  res.send("so-quote backend running");
});

// IMPORTANT: return JSON here (frontend expects json(), not text)
app.get("/health", (_req, res) => {
  res.json({ ok: true, version: "3.3-container", calc: "landed-v1" });
});

// Simple /quote placeholder so we can test end-to-end
const round = n => Math.round((Number(n) || 0) * 100) / 100;
const DEFAULTS = { dutyPct: 0.25, servicePct: 0.10, handling: 15, oceanPct: 0.12, placeholder: 100 };

app.post("/quote", (req, res) => {
  const links = Array.isArray(req.body?.links) ? req.body.links : [];
  const items = links.map((url, i) => {
    const first = DEFAULTS.placeholder;
    const freight = first * DEFAULTS.oceanPct;
    const duty = first * DEFAULTS.dutyPct;
    const service = first * DEFAULTS.servicePct;
    const fees = DEFAULTS.handling;
    const unitLanded = first + freight + duty + service + fees;
    return {
      title: `Item ${i + 1}`,
      url: String(url || ""),
      qty: 1,
      firstCost: round(first),
      freight: round(freight),
      fees: round(fees),
      duty: round(duty),
      unitLanded: round(unitLanded),
      total: round(unitLanded)
    };
  });
  const subtotal = round(items.reduce((s, x) => s + x.total, 0));
  res.json({ items, subtotal });
});

/* ---------- Start ---------- */
app.listen(PORT, () => {
  console.log(`[SO-QUOTE] Backend running on :${PORT}`);
});
