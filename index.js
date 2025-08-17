// index.js — so-quote
// Minimal Express server for Instant Import demo wiring

const path = require('path');
const express = require('express');
const app = express();

// Parse JSON bodies (for /quote)
app.use(express.json());

// Serve the static front-end in /public
app.use(express.static(path.join(__dirname, 'public')));

// ---------- Health check ----------
app.get('/health', (req, res) => {
  res.json({ ok: true, ts: new Date().toISOString() });
});

// ---------- Quote endpoint (temporary stub) ----------
// Accepts: { name, email, items: [{ url, qty }] }
// Returns: { ok, demo:true, rows:[...], total }
app.post('/quote', (req, res) => {
  try {
    const { name = '', email = '', items = [] } = req.body || {};

    // Normalize items -> [{url, qty}]
    const list = Array.isArray(items) ? items : [];
    const norm = list
      .map(it => ({
        url: String(it?.url || '').trim(),
        qty: Number(it?.qty || 1) || 1
      }))
      .filter(x => x.url);

    if (!norm.length) {
      return res.status(400).json({ ok: false, error: 'No items provided' });
    }

    // ---------- TEMP demo math ----------
    // These are placeholders so the UI shows a working breakdown NOW.
    // We’ll swap in real scraping + your full rules next pass.
    const demoFirstCost = 100;   // USD per unit
    const demoCft       = 3.2;   // ft³ per unit
    const CFT_RATE      = 6.46;  // your bulk rate $/ft³
    const FIXED_FFF     = 10;    // allocated fixed fees per item
    const DUTY_RATE     = 0.25;  // 25% duty
    const WHARF_RATE    = 0.02;  // 2% wharfage
    const CARD_RATE     = 0.0375;// 3.75% card fee

    const rows = norm.map(it => {
      const firstCost = demoFirstCost * it.qty;
      const cftTotal  = demoCft * it.qty;
      const freight   = cftTotal * CFT_RATE + (FIXED_FFF * it.qty);
      const duty      = firstCost * DUTY_RATE;
      const wharf     = firstCost * WHARF_RATE;
      const preCard   = firstCost + freight + duty + wharf;
      const cardFee   = preCard * CARD_RATE;
      const landed    = preCard + cardFee;

      return {
        url: it.url,
        qty: it.qty,
        firstCost,
        cft: cftTotal,
        freight,
        duty,
        wharf,
        cardFee,
        landed
      };
    });

    const total = rows.reduce((sum, r) => sum + r.landed, 0);

    res.json({
      ok: true,
      demo: true,   // flag so we both know this is the temporary math
      name,
      email,
      rows,
      total
    });
  } catch (err) {
    console.error('[POST /quote] error:', err);
    res.status(500).json({ ok: false, error: 'Server error' });
  }
});

// (Optional) send index.html for unknown routes to keep the SPA happy
app.get('*', (req, res, next) => {
  // If requesting an API route, let it 404 naturally
  if (req.path.startsWith('/quote') || req.path.startsWith('/health')) return next();
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ---------- Start server ----------
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
