/**
 * SDL — Instant Quote | Backend App
 * Full 3-step Instant Quote UI + /quote proxy
 * Updated: 2025-08-23
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
const PORT = process.env.PORT || 3000;

const app = express();

// Middleware
app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(compression());
app.use(cors({ origin: CORS_ORIGIN === '*' ? true : CORS_ORIGIN }));
app.use(express.json({ limit: '2mb' }));
app.use(morgan('tiny'));

// Robots
app.get('/robots.txt', (_req, res) => {
  res.type('text/plain').send('User-agent: *\nDisallow: /');
});

// Health
app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    app: APP_VERSION,
    name: APP_NAME,
    node: process.version,
    quote_api: QUOTE_API
  });
});

app.get('/debug-index', (_req, res) => {
  res.type('text/plain').send(`index.js loaded: ${APP_VERSION}`);
});

// Fetch helper
const fetchFn = global.fetch || (async (...args) => {
  const mod = await import('node-fetch');
  return mod.default(...args);
});

// Quote proxy
app.post('/quote', async (req, res) => {
  try {
    const body = req.body || {};
    let outbound = body;

    if (!Array.isArray(body.urls)) {
      const link = body.link || body.url;
      const qty = Number(body.qty || body.quantity || 1);
      if (link) outbound = { urls: [link], qty };
    }

    const upstream = await fetchFn(QUOTE_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(outbound)
    });

    const txt = await upstream.text();
    let data;
    try { data = JSON.parse(txt); } catch { data = { ok: false, raw: txt }; }

    res.status(upstream.status).json(data);
  } catch (err) {
    console.error('Proxy /quote failed:', err);
    res.status(502).json({ ok: false, error: 'Bad gateway', detail: String(err) });
  }
});

// Root UI: full 3-step form
app.get(['/', '/index.html'], (_req, res) => {
  res.type('html').send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${APP_NAME}</title>
  <style>
    body { font-family: ui-sans-serif, system-ui, sans-serif; margin:0; background:#f8fafc; color:#0f172a; }
    header { padding:20px; background:#2c7a3f; color:#fff; }
    .wrap { max-width:960px; margin:0 auto; padding:20px; }
    .steps { display:flex; gap:10px; margin-top:10px; }
    .chip { padding:6px 12px; border-radius:999px; background:#1f5e3b; color:#fff; font-size:13px; }
    .chip.active { background:#fff; color:#2c7a3f; }
    .card { background:#fff; padding:16px; border-radius:12px; box-shadow:0 2px 6px rgba(0,0,0,.08); margin-top:20px; }
    .list { width:100%; border-collapse: collapse; margin-top:12px; }
    .list th, .list td { border-bottom:1px solid #e2e8f0; padding:8px; font-size:14px; }
    .right { text-align:right; }
    .btn { padding:10px 14px; border:none; border-radius:8px; font-weight:600; cursor:pointer; }
    .btn.primary { background:#2c7a3f; color:#fff; }
    .btn.secondary { background:#e2e8f0; color:#111; }
    input { padding:6px 8px; border:1px solid #ccc; border-radius:6px; width:100%; }
  </style>
</head>
<body>
  <header>
    <div class="wrap">
      <h1>${APP_NAME}</h1>
      <div class="steps">
        <div class="chip active" id="step1chip">1 — Upload Links</div>
        <div class="chip" id="step2chip">2 — Review</div>
        <div class="chip" id="step3chip">3 — Approve & Pay</div>
      </div>
    </div>
  </header>
  <main class="wrap" id="app"></main>

  <script>
    const state = { step:1, items:[], totals:{sub:0,grand:0}, fees:{delivery:0,assembly:0} };
    const fmt = n => new Intl.NumberFormat('en-BM',{style:'currency',currency:'BMD'}).format(n||0);
    function calc(){state.totals.sub=state.items.reduce((s,i)=>s+(i.total||0),0);state.totals.grand=state.totals.sub+(+state.fees.delivery||0)+(+state.fees.assembly||0);}
    function setStep(n){state.step=n;document.querySelectorAll('.chip').forEach((c,i)=>c.classList.toggle('active',i+1===n));render();}

    function addRow(){state.items.push({link:'',title:'',qty:1,unit:0,total:0});render();}
    function updateQty(i,q){state.items[i].qty=+q||1;state.items[i].total=state.items[i].unit*state.items[i].qty;calc();render();}
    async function fetchQuote(i){const row=state.items[i];if(!row.link)return;try{const r=await fetch('/quote',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({link:row.link,qty:row.qty})});const d=await r.json();row.title=d.title||row.title||'Item';row.unit=d.unit||0;row.total=row.unit*row.qty;}catch(e){console.error(e);}calc();render();}

    function render(){
      const app=document.getElementById('app');app.innerHTML='';
      if(state.step===1){
        const c=document.createElement('div');c.className='card';
        c.innerHTML='<h2>Paste product links</h2><button class="btn secondary" id="add">Add Row</button><button class="btn primary" id="cont">Continue</button><table class="list"><thead><tr><th>Link</th><th>Title</th><th class="right">Qty</th><th class="right">Unit</th><th class="right">Total</th></tr></thead><tbody id="rows"></tbody></table>';
        app.appendChild(c);
        document.getElementById('add').onclick=()=>addRow();
        document.getElementById('cont').onclick=()=>setStep(2);
        const body=c.querySelector('#rows');
        state.items.forEach((row,i)=>{const tr=document.createElement('tr');tr.innerHTML=\`<td><input value="\${row.link}" data-i="\${i}" data-k="link"></td><td>\${row.title}</td><td class="right"><input type="number" value="\${row.qty}" data-i="\${i}" data-k="qty" style="width:60px"></td><td class="right">\${fmt(row.unit)}</td><td class="right">\${fmt(row.total)}</td>\`;body.appendChild(tr);});
        body.onchange=e=>{const i=+e.target.dataset.i;const k=e.target.dataset.k;if(k==='link'){state.items[i].link=e.target.value;fetchQuote(i);}if(k==='qty'){updateQty(i,e.target.value);}};
      }
      if(state.step===2){
        calc();
        const c=document.createElement('div');c.className='card';
        c.innerHTML='<h2>Review Quote</h2><button class="btn secondary" id="back">Back</button><button class="btn primary" id="next">Approve</button><table class="list"><thead><tr><th>Item</th><th class="right">Qty</th><th class="right">Unit</th><th class="right">Total</th></tr></thead><tbody id="review"></tbody><tfoot><tr><td colspan="3" class="right"><b>Subtotal</b></td><td class="right">'+fmt(state.totals.sub)+'</td></tr><tr><td colspan="3" class="right"><b>Grand</b></td><td class="right">'+fmt(state.totals.grand)+'</td></tr></tfoot></table>';
        app.appendChild(c);
        document.getElementById('back').onclick=()=>setStep(1);
        document.getElementById('next').onclick=()=>setStep(3);
        const body=c.querySelector('#review');state.items.forEach(it=>{const tr=document.createElement('tr');tr.innerHTML=\`<td>\${it.title}</td><td class="right">\${it.qty}</td><td class="right">\${fmt(it.unit)}</td><td class="right">\${fmt(it.total)}</td>\`;body.appendChild(tr);});
      }
      if(state.step===3){
        const c=document.createElement('div');c.className='card';
        c.innerHTML='<h2>Approve & Pay</h2><p>Grand Total: '+fmt(state.totals.grand)+'</p><button class="btn secondary" id="prev">Back</button><button class="btn primary" id="approve">Approve Quote</button>';
        app.appendChild(c);
        document.getElementById('prev').onclick=()=>setStep(2);
        document.getElementById('approve').onclick=()=>alert('Quote approved! We will send payment link.');
      }
    }

    if(state.items.length===0)addRow();else render();
  </script>
</body>
</html>`);
});

// 404 fallback
app.use((req,res)=>res.status(404).json({ok:false,error:'Not found',path:req.path}));

// Start
app.listen(PORT,()=>console.log(`${APP_NAME} (${APP_VERSION}) listening on ${PORT}`));
