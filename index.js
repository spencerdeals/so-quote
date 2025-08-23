
/**
 * SDL — Instant Quote | Backend App
 * Full paste-and-replace server file (production-ready).
 * Updated: 2025-08-23 17:09:18
 *
 * What you get:
 *  - GET /            → serves the full 3-step Instant Quote UI
 *  - GET /health      → JSON health/version
 *  - GET /debug-index → plain text version check
 *  - GET /robots.txt  → disallow indexing
 *  - POST /quote      → proxies to QUOTE_API (Fly.io) and also accepts single-link payloads
 *
 * Env you can set (optional):
 *  - PORT                 (default 3000; Railway sets this automatically)
 *  - APP_NAME             (default "SDL — Instant Quote")
 *  - APP_VERSION          (default "alpha-2025-08-23-ultimate")
 *  - QUOTE_API            (default "https://so-quote.fly.dev/quote")
 *  - CORS_ORIGIN          (default "*")
 *  - RATE_LIMIT_PER_MIN   (default 120; applies to /quote only)
 */

const express = require('express');
const cors = require('cors');
const compression = require('compression');
const helmet = require('helmet');
const morgan = require('morgan');

const APP_NAME = process.env.APP_NAME || 'SDL — Instant Quote';
const APP_VERSION = process.env.APP_VERSION || 'alpha-2025-08-23-ultimate';
const QUOTE_API = process.env.QUOTE_API || 'https://so-quote.fly.dev/quote';
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';
const RATE_LIMIT_PER_MIN = Number(process.env.RATE_LIMIT_PER_MIN || 120);
const PORT = process.env.PORT || 3000;

const app = express();

// --- Middleware (fast + safe defaults) ---
app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(compression());
app.use(cors({ origin: CORS_ORIGIN === '*' ? true : CORS_ORIGIN }));
app.use(express.json({ limit: '2mb' }));
app.use(morgan('tiny'));

// --- Robots ---
app.get('/robots.txt', (_req, res) => {
  res.type('text/plain').send('User-agent: *\nDisallow: /');
});

// --- Health/Debug ---
app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    name: APP_NAME,
    app: APP_VERSION,
    node: process.version,
    quote_api: QUOTE_API ? 'configured' : 'unset'
  });
});

app.get('/debug-index', (_req, res) => {
  res.type('text/plain').send(`index.js loaded: ${APP_VERSION}`);
});

// --- Simple rate limit for /quote ---
let rateLimit;
try { rateLimit = require('express-rate-limit'); } catch {}
const quoteLimiter = rateLimit ? rateLimit({
  windowMs: 60 * 1000,
  max: RATE_LIMIT_PER_MIN,
  standardHeaders: true,
  legacyHeaders: false
}) : (_req, _res, next) => next();

// --- Helper: robust fetch (Node 18+ has global fetch) ---
const fetchFn = global.fetch || (async (...args) => {
  const mod = await import('node-fetch');
  return mod.default(...args);
});

// --- Proxy /quote to QUOTE_API, accepting multiple shapes ---
app.post('/quote', quoteLimiter, async (req, res) => {
  try {
    const body = req.body || {};

    // Normalize incoming payload:
    // - If client sends { link, qty } → convert to { urls: [link] } (qty included if API supports)
    // - If client sends { urls: [...] } → pass through
    let outbound = body;
    if (!Array.isArray(body.urls)) {
      const link = body.link || body.url;
      const qty = Number(body.qty || body.quantity || 1);
      if (link) { outbound = { urls: [link], qty }; }
    }

    const upstream = await fetchFn(QUOTE_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(outbound)
    });

    const txt = await upstream.text();
    let data;
    try { data = JSON.parse(txt); } catch (e) { data = { ok:false, raw: txt }; }
    res.status(upstream.status).json(data);
  } catch (err) {
    console.error('Proxy /quote failed:', err);
    res.status(502).json({ ok:false, error:'Bad gateway to quote backend', detail: String(err) });
  }
});

// --- Root UI (3-step customer-friendly form) ---
app.get(['/', '/index.html'], (_req, res) => {
  res.type('html').send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${APP_NAME}</title>
  <style>
    :root { --sdl: #2e8b57; --sdl-dark: #1f5e3b; --ink: #0f172a; --muted: #64748b; --bg: #f8fafc; --card: #ffffff; }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial; color: var(--ink); background: var(--bg); }
    header { padding: 20px; background: linear-gradient(180deg, var(--sdl) 0%, var(--sdl-dark) 100%); color: white; }
    .wrap { max-width: 1040px; margin: 0 auto; padding: 20px; }
    .brand { display:flex; align-items:center; gap:12px; }
    .logo { width: 36px; height: 36px; border-radius: 8px; background: white; color: var(--sdl-dark); display:grid; place-items:center; font-weight:800; }
    .title { font-size: 22px; font-weight: 700; letter-spacing: .2px; }
    .steps { display:flex; gap:12px; margin-top:14px; flex-wrap:wrap; }
    .chip { padding:8px 12px; border-radius: 999px; background:#1b433226; color:#e6fff1; border:1px solid #ffffff44; font-size: 12px; }
    .chip.active { background:white; color: var(--sdl-dark); border-color: #dbeafe; }
    .card { background: var(--card); border:1px solid #e2e8f0; border-radius: 16px; padding: 18px; box-shadow: 0 2px 8px rgba(2,6,23,.04); }
    .grid { display:grid; gap:16px; }
    .grid.cols-2 { grid-template-columns: 1fr 1fr; }
    .field label { display:block; font-size: 12px; color: var(--muted); margin-bottom: 6px; }
    .field input, .field textarea { width:100%; padding:12px 14px; border-radius: 10px; border:1px solid #e2e8f0; background:white; outline:none; font-size:14px; }
    .field textarea { min-height: 96px; resize: vertical; }
    .btn { appearance: none; border: 0; padding: 12px 16px; border-radius: 12px; font-weight: 700; cursor: pointer; }
    .btn.primary { background: var(--sdl); color: white; }
    .btn.secondary { background: #eef2ff; color: #334155; }
    .btn.ghost { background: transparent; border:1px solid #e2e8f0; }
    .toolbar { display:flex; justify-content: space-between; align-items:center; gap:12px; flex-wrap:wrap; }
    .list { width:100%; border-collapse: collapse; }
    .list th, .list td { border-bottom:1px solid #e2e8f0; padding:12px 8px; font-size:14px; text-align:left; }
    .right { text-align:right; }
    .muted { color: var(--muted); }
    .total { font-weight:800; font-size: 18px; }
    .hint { font-size: 12px; color: var(--muted); }
    @media (max-width: 860px) { .grid.cols-2 { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
  <header>
    <div class="wrap">
      <div class="brand">
        <div class="logo">$</div>
        <div class="title">${APP_NAME}</div>
      </div>
      <div class="steps">
        <div class="chip active" id="stepChip1">1 — Upload Links</div>
        <div class="chip" id="stepChip2">2 — Quote Review</div>
        <div class="chip" id="stepChip3">3 — Approve & Pay</div>
      </div>
    </div>
  </header>

  <main class="wrap" id="app"></main>
  <div class="wrap" style="font-size:12px;color:#64748b;padding:12px 0">Customer-friendly totals only. Internal costs hidden.</div>

  <script>
    const el = (tag, attrs = {}) => Object.assign(document.createElement(tag), attrs);
    const $ = (sel, root = document) => root.querySelector(sel);

    const state = {
      step: 1,
      items: [], // { link, title, qty, unit, total, manualPrice? }
      fees: { delivery: 0, assembly: 0 },
      totals: { subtotal: 0, grand: 0 }
    };

    function setStep(n) {
      state.step = n;
      $('#stepChip1').classList.toggle('active', n === 1);
      $('#stepChip2').classList.toggle('active', n === 2);
      $('#stepChip3').classList.toggle('active', n === 3);
      render();
    }

    const fmt = (n) => new Intl.NumberFormat('en-BM', { style: 'currency', currency: 'BMD' }).format(n || 0);

    function calcTotals() {
      const subtotal = state.items.reduce((s, it) => s + (it.total || 0), 0);
      const grand = subtotal + (Number(state.fees.delivery)||0) + (Number(state.fees.assembly)||0);
      state.totals.subtotal = subtotal;
      state.totals.grand = grand;
    }

    function addRow() { state.items.push({ link:'', title:'', qty:1, unit:0, total:0, manualPrice:'' }); render(); }
    function removeRow(idx) { state.items.splice(idx, 1); render(); }

    async function fetchQuoteForIndex(idx) {
      const row = state.items[idx];
      if (!row || !row.link) return;

      const payload = { link: row.link, qty: Number(row.qty)||1 };

      try {
        const res = await fetch('/quote', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        if (!res.ok) throw new Error('Quote backend error');
        const data = await res.json();

        if (Array.isArray(data.items)) {
          const first = data.items[0] || {};
          row.title = first.title || first.name || row.title || 'Item';
          const unit = Number(first.unitPrice || first.unit || 0);
          const qty = Number(row.qty)||1;
          row.unit = unit;
          row.total = unit * qty;
        } else {
          row.title = data.title || row.title || 'Item';
          row.unit = Number(data.unit) || 0;
          row.total = Number(data.total) || (row.unit * (Number(row.qty)||1));
        }

        if (!row.unit) { row.manualPrice = ''; }
      } catch (e) {
        console.error(e);
        row.title = row.title || 'Item';
        row.unit = 0;
        row.total = 0;
      } finally {
        calcTotals(); render();
      }
    }

    function handleManualPrice(idx, value) {
      const n = Number(value);
      const row = state.items[idx];
      row.manualPrice = value;
      if (Number.isFinite(n) && n > 0) { row.unit = n; row.total = n * (Number(row.qty)||1); }
      calcTotals(); render();
    }

    function handleQty(idx, value) {
      const q = Math.max(1, Number(value)||1);
      const row = state.items[idx];
      row.qty = q;
      row.total = (Number(row.unit)||0) * q;
      calcTotals(); render();
    }

    function renderStep1() {
      const root = el('div');
      root.appendChild(el('div', { className: 'card toolbar', innerHTML: `
        <div>
          <div style="font-weight:700">Upload product links</div>
          <div class="hint">Paste one link per line, or add rows below. We’ll fetch details.</div>
        </div>
        <div>
          <button class="btn secondary" id="addRowBtn">Add Row</button>
          <button class="btn primary" id="continueBtn">Continue</button>
        </div>
      `}));

      const rowsCard = el('div', { className:'card' });
      const table = el('table', { className:'list' });
      table.innerHTML = `
        <thead>
          <tr>
            <th style="width:40%">Link</th>
            <th>Title</th>
            <th class="right">Qty</th>
            <th class="right">Unit</th>
            <th class="right">Total</th>
            <th></th>
          </tr>
        </thead>
        <tbody id="rowsBody"></tbody>
      `;
      rowsCard.appendChild(table);
      root.appendChild(rowsCard);

      const body = table.querySelector('#rowsBody');
      state.items.forEach((row, idx) => {
        const tr = el('tr');
        const needManual = Number(row.unit) === 0;
        tr.innerHTML = `
          <td><input placeholder="https://vendor.com/product" value="${row.link||''}" data-idx="${idx}" data-key="link"/></td>
          <td><input placeholder="(auto)" value="${row.title||''}" data-idx="${idx}" data-key="title"/></td>
          <td class="right"><input style="text-align:right" type="number" min="1" value="${row.qty||1}" data-idx="${idx}" data-key="qty"/></td>
          <td class="right">${needManual ? '<input style="text-align:right" placeholder="enter price" value="'+(row.manualPrice||'')+'" data-idx="'+idx+'" data-key="manual"/>' : fmt(row.unit)}</td>
          <td class="right">${fmt(row.total)}</td>
          <td class="right"><button class="btn ghost" data-action="remove" data-idx="${idx}">Remove</button></td>
        `;
        body.appendChild(tr);
      });

      body.addEventListener('change', (e) => {
        const t = e.target;
        const idx = Number(t.getAttribute('data-idx'));
        const key = t.getAttribute('data-key');
        if (key === 'link') { state.items[idx].link = t.value.trim(); fetchQuoteForIndex(idx); }
        else if (key === 'title') { state.items[idx].title = t.value; }
        else if (key === 'qty') { handleQty(idx, t.value); }
        else if (key === 'manual') { handleManualPrice(idx, t.value); }
      });

      body.addEventListener('click', (e) => {
        const btn = e.target.closest('button');
        if (!btn) return;
        const idx = Number(btn.getAttribute('data-idx'));
        const action = btn.getAttribute('data-action');
        if (action === 'remove') removeRow(idx);
      });

      root.querySelector('#addRowBtn').addEventListener('click', () => addRow());
      root.querySelector('#continueBtn').addEventListener('click', () => setStep(2));
      return root;
    }

    function renderStep2() {
      calcTotals();
      const root = el('div', { className: 'grid cols-2' });

      const left = el('div', { className:'card' });
      left.innerHTML = `
        <div class="toolbar">
          <div>
            <div style="font-weight:700">Quote review</div>
            <div class="hint">Confirm items and quantities. Internal costs are hidden.</div>
          </div>
          <div>
            <button class="btn secondary" id="backBtn">Back</button>
            <button class="btn primary" id="nextBtn">Approve & Pay</button>
          </div>
        </div>
        <table class="list" style="margin-top:12px">
          <thead><tr><th>Item</th><th class="right">Qty</th><th class="right">Unit</th><th class="right">Total</th></tr></thead>
          <tbody id="reviewBody"></tbody>
          <tfoot><tr><td class="right" colspan="3"><strong>Subtotal</strong></td><td class="right">${fmt(state.totals.subtotal)}</td></tr></tfoot>
        </table>
      `;

      const body = left.querySelector('#reviewBody');
      state.items.forEach((it) => {
        const tr = el('tr');
        tr.innerHTML = `
          <td>${it.title || '(Item)'}<div class="hint">${it.link ? new URL(it.link).hostname : ''}</div></td>
          <td class="right">${it.qty}</td>
          <td class="right">${fmt(it.unit)}</td>
          <td class="right">${fmt(it.total)}</td>
        `;
        body.appendChild(tr);
      });

      const right = el('div', { className:'card' });
      right.innerHTML = `
        <div class="field">
          <label>Delivery fee (optional)</label>
          <input id="feeDelivery" type="number" min="0" step="1" placeholder="0" value="${state.fees.delivery||0}" />
        </div>
        <div class="field">
          <label>Assembly fee (optional)</label>
          <input id="feeAssembly" type="number" min="0" step="1" placeholder="0" value="${state.fees.assembly||0}" />
        </div>
        <div style="display:grid;grid-template-columns:1fr auto;gap:8px;margin-top:8px">
          <div class="muted">Subtotal</div><div class="right">${fmt(state.totals.subtotal)}</div>
          <div class="muted">Delivery</div><div class="right">${fmt(state.fees.delivery||0)}</div>
          <div class="muted">Assembly</div><div class="right">${fmt(state.fees.assembly||0)}</div>
          <div class="total">Grand total</div><div class="total right" id="grandOut">${fmt(state.totals.grand)}</div>
        </div>
      `;

      right.querySelector('#feeDelivery').addEventListener('input', (e)=>{ state.fees.delivery = Number(e.target.value)||0; calcTotals(); $('#grandOut').textContent = fmt(state.totals.grand); });
      right.querySelector('#feeAssembly').addEventListener('input', (e)=>{ state.fees.assembly = Number(e.target.value)||0; calcTotals(); $('#grandOut').textContent = fmt(state.totals.grand); });

      left.querySelector('#backBtn').addEventListener('click', ()=> setStep(1));
      left.querySelector('#nextBtn').addEventListener('click', ()=> setStep(3));

      root.appendChild(left);
      root.appendChild(right);
      return root;
    }

    function renderStep3() {
      const root = el('div', { className:'grid cols-2' });
      const left = el('div', { className:'card' });
      left.innerHTML = `
        <div style="font-weight:700">Approve & Pay</div>
        <p class="muted">You're almost done. Review your grand total and add any notes. When you approve, we'll send a secure payment link.</p>
        <table class="list" style="margin-top:8px">
          <thead><tr><th>Item</th><th class="right">Qty</th><th class="right">Unit</th><th class="right">Total</th></tr></thead>
          <tbody id="finalBody"></tbody>
          <tfoot><tr><td class="right" colspan="3"><strong>Grand total</strong></td><td class="right" id="grandFinal"></td></tr></tfoot>
        </table>
      `;

      const body = left.querySelector('#finalBody');
      state.items.forEach((it)=>{
        const tr = el('tr');
        tr.innerHTML = `<td>${it.title||'(Item)'}<div class="hint">${it.link ? new URL(it.link).hostname : ''}</div></td>
                        <td class="right">${it.qty}</td>
                        <td class="right">${fmt(it.unit)}</td>
                        <td class="right">${fmt(it.total)}</td>`;
        body.appendChild(tr);
      });

      $('#grandFinal').textContent = fmt(state.totals.grand);

      const right = el('div', { className:'card' });
      right.innerHTML = `
        <div class="field"><label>Your name</label><input id="custName" placeholder="Full name" /></div>
        <div class="field"><label>Email</label><input id="custEmail" placeholder="you@example.com" /></div>
        <div class="field"><label>Phone (optional)</label><input id="custPhone" placeholder="(441) 555-1234" /></div>
        <div class="field"><label>Notes (optional)</label><textarea id="custNotes" placeholder="Any special delivery or timing requests?"></textarea></div>
        <div class="toolbar"><button class="btn secondary" id="prevBtn">Back</button><button class="btn primary" id="approveBtn">Approve quote</button></div>
        <div class="hint">We’ll email a payment link after approval.</div>
      `;

      right.querySelector('#prevBtn').addEventListener('click', ()=> setStep(2));
      right.querySelector('#approveBtn').addEventListener('click', ()=> { alert('Thanks! Your quote has been approved. We will contact you with payment details shortly.'); });

      root.appendChild(left);
      root.appendChild(right);
      return root;
    }

    function render() {
      const app = $('#app'); app.innerHTML = '';
      if (state.step === 1) app.appendChild(renderStep1());
      if (state.step === 2) app.appendChild(renderStep2());
      if (state.step === 3) app.appendChild(renderStep3());
    }

    if (state.items.length === 0) addRow(); else render();
  </script>
</body>
</html>`);
});

// --- 404 JSON fallback for API routes ---
app.use((req, res, next) => {
  if (req.accepts('json') && req.path.startsWith('/')) {
    return res.status(404).json({ ok:false, error:'Not found', path: req.path });
  }
  next();
});

// --- Start ---
app.listen(PORT, () => {
  console.log(`${APP_NAME} (${APP_VERSION}) listening on ${PORT}`);
});
