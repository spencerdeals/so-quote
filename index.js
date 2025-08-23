/**
 * SDL — Instant Quote | Backend App
 * Full 3-step UI + /quote proxy with ScrapingBee fallback
 * Updated: 2025-08-23
 */

const express = require('express');
const cors = require('cors');
const compression = require('compression');
const helmet = require('helmet');
const morgan = require('morgan');

const APP_NAME = process.env.APP_NAME || 'SDL — Instant Quote';
const APP_VERSION = process.env.APP_VERSION || 'alpha-2025-08-23-fallback-sbee';
const QUOTE_API = process.env.QUOTE_API || '';                 // optional; if unreachable we fall back to ScrapingBee
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';
const PORT = process.env.PORT || 3000;
const SCRAPINGBEE_API_KEY = process.env.SCRAPINGBEE_API_KEY || '';

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
    quote_api: QUOTE_API ? 'set' : 'not set',
    sbee: SCRAPINGBEE_API_KEY ? 'set' : 'not set'
  });
});

app.get('/debug-index', (_req, res) => {
  res.type('text/plain').send(`index.js loaded: ${APP_VERSION}`);
});

// Fetch with timeout
async function fetchWithTimeout(url, opts = {}, timeoutMs = 12000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, { ...opts, signal: controller.signal });
    clearTimeout(id);
    return resp;
  } catch (e) {
    clearTimeout(id);
    throw e;
  }
}

// --- Minimal HTML extraction helpers (ScrapingBee fallback) ---
function pickMeta(html, name, prop) {
  const re = prop
    ? new RegExp(`<meta[^>]+property=["']${prop}["'][^>]*content=["']([^"']+)["']`, 'i')
    : new RegExp(`<meta[^>]+name=["']${name}["'][^>]*content=["']([^"']+)["']`, 'i');
  const m = html.match(re);
  return m ? m[1] : '';
}
function extractJsonLd(html) {
  const out = [];
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    try { out.push(JSON.parse(m[1].trim())); } catch {}
  }
  return out;
}
function findProductFromJsonLd(ld) {
  const arr = Array.isArray(ld) ? ld : [ld];
  for (const node of arr) {
    if (!node) continue;
    if (Array.isArray(node)) {
      const f = findProductFromJsonLd(node); if (f) return f;
    } else if (typeof node === 'object') {
      const t = node['@type'];
      if (t === 'Product') return node;
      if (Array.isArray(node['@graph'])) {
        const f = findProductFromJsonLd(node['@graph']); if (f) return f;
      }
    }
  }
  return null;
}
function toNumber(x) {
  if (typeof x === 'number') return x;
  if (!x) return 0;
  const m = String(x).replace(/[, \t$]/g,'').match(/-?\d+(?:\.\d+)?/);
  return m ? parseFloat(m[0]) : 0;
}

async function scrapeWithScrapingBee(url) {
  if (!SCRAPINGBEE_API_KEY) throw new Error('SCRAPINGBEE_API_KEY not set');
  const api = `https://app.scrapingbee.com/api/v1?api_key=${encodeURIComponent(SCRAPINGBEE_API_KEY)}&url=${encodeURIComponent(url)}&render_js=true`;
  const resp = await fetchWithTimeout(api, { method: 'GET' }, 20000);
  if (!resp.ok) throw new Error('ScrapingBee error ' + resp.status);
  const html = await resp.text();

  let title = pickMeta(html, '', 'og:title') || pickMeta(html, 'title', '');
  let image = pickMeta(html, '', 'og:image');
  let price = 0;
  let variant = '';

  try {
    const blocks = extractJsonLd(html);
    for (const ld of blocks) {
      const prod = findProductFromJsonLd(ld);
      if (prod) {
        if (!title) title = prod.name || title;
        if (!image) image = (typeof prod.image === 'string' ? prod.image : (Array.isArray(prod.image) ? prod.image[0] : '')) || image;
        if (prod.sku) variant = String(prod.sku);
        const offers = prod.offers;
        if (offers) {
          if (Array.isArray(offers)) {
            for (const o of offers) { const p = toNumber(o.price || o.priceSpecification?.price); if (p) { price = p; break; } }
          } else if (typeof offers === 'object') {
            price = toNumber(offers.price || offers.priceSpecification?.price);
          }
        }
        break;
      }
    }
  } catch {}

  if (!price) {
    const metaPrice = pickMeta(html, '', 'product:price:amount') || pickMeta(html, 'price', '');
    price = toNumber(metaPrice);
  }
  if (!price) {
    const m = html.match(/\$\s*\d{1,3}(?:,\d{3})*(?:\.\d{2})?/);
    if (m) price = toNumber(m[0]);
  }
  if (!title) {
    const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    if (m) title = m[1].replace(/\s+/g,' ').trim();
  }

  return {
    title: title || 'Item',
    variant: variant || '',
    thumbnail: image || '',
    unitPrice: price || 0
  };
}

// --- /quote handler: try QUOTE_API, else ScrapingBee ---
app.post('/quote', async (req, res) => {
  try {
    const body = req.body || {};
    const urls = Array.isArray(body.urls) ? body.urls : (body.link ? [body.link] : []);
    const qty = Number(body.qty || body.quantity || 1) || 1;

    // 1) Try QUOTE_API first (if provided)
    if (QUOTE_API) {
      try {
        const r = await fetchWithTimeout(QUOTE_API, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ urls, qty })
        }, 15000);
        if (r.ok) {
          const data = await r.json();
          return res.status(200).json(data);
        }
      } catch (e) { /* fall back */ }
    }

    // 2) Fallback: ScrapingBee (cloud-only)
    if (!urls.length) return res.status(400).json({ ok:false, error:'No URLs provided' });
    if (!SCRAPINGBEE_API_KEY) return res.status(502).json({ ok:false, error:'SCRAPINGBEE_API_KEY not set' });

    const items = [];
    for (const u of urls) {
      try {
        const info = await scrapeWithScrapingBee(u);
        items.push({
          link: u,
          title: info.title,
          variant: info.variant,
          thumbnail: info.thumbnail,
          unitPrice: info.unitPrice,
          qty,
          total: (info.unitPrice || 0) * qty
        });
      } catch (e) {
        items.push({ link: u, title: 'Item', variant:'', thumbnail:'', unitPrice: 0, qty, total: 0, error: String(e) });
      }
    }
    const first = items[0] || {};
    return res.status(200).json({
      ok: true,
      items,
      title: first.title || 'Item',
      unit: first.unitPrice || 0,
      total: (first.unitPrice || 0) * qty,
      thumbnail: first.thumbnail || '',
      variant: first.variant || ''
    });
  } catch (err) {
    console.error('Quote handler failed:', err);
    res.status(500).json({ ok:false, error:'Internal error', detail: String(err) });
  }
});

// Root UI (current 3-step form with thumbnail/variant support)
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
    img.thumb { width:48px; height:48px; object-fit:cover; border-radius:6px; }
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
    function addRow(){state.items.push({link:'',title:'',variant:'',thumbnail:'',qty:1,unit:0,total:0});render();}
    function updateQty(i,q){state.items[i].qty=+q||1;state.items[i].total=state.items[i].unit*state.items[i].qty;calc();render();}
    async function fetchQuote(i){
      const row=state.items[i]; if(!row.link) return;
      try{
        const r=await fetch('/quote',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({link:row.link,qty:row.qty})});
        const d=await r.json();
        if(Array.isArray(d.items)&&d.items[0]){
          const x=d.items[0];
          row.title=x.title||row.title;
          row.variant=x.variant||'';
          row.thumbnail=x.thumbnail||'';
          row.unit=+x.unitPrice||0;
          row.total=row.unit*row.qty;
        }else{
          row.title=d.title||row.title;
          row.unit=+d.unit||0;
          row.total=row.unit*row.qty;
        }
      }catch(e){ console.error(e); }
      calc(); render();
    }
    function render(){
      const app=document.getElementById('app'); app.innerHTML='';
      if(state.step===1){
        const c=document.createElement('div'); c.className='card';
        c.innerHTML='<h2>Paste product links</h2><button class="btn secondary" id="add">Add Row</button><button class="btn primary" id="cont">Continue</button><table class="list"><thead><tr><th>Thumb</th><th>Title / Variant</th><th>Link</th><th class="right">Qty</th><th class="right">Unit</th><th class="right">Total</th></tr></thead><tbody id="rows"></tbody></table>';
        app.appendChild(c);
        document.getElementById('add').onclick=()=>addRow();
        document.getElementById('cont').onclick=()=>setStep(2);
        const body=c.querySelector('#rows');
        state.items.forEach((row,i)=>{
          const tr=document.createElement('tr');
          tr.innerHTML=\`<td>\${row.thumbnail?'<img class="thumb" src="'+row.thumbnail+'"/>':''}</td>
            <td><div><b>\${row.title||''}</b></div><div style="color:#64748b;font-size:12px">\${row.variant||''}</div></td>
            <td><input value="\${row.link}" data-i="\${i}" data-k="link" placeholder="https://vendor.com/product"></td>
            <td class="right"><input type="number" value="\${row.qty}" data-i="\${i}" data-k="qty" style="width:60px"></td>
            <td class="right">\${fmt(row.unit)}</td><td class="right">\${fmt(row.total)}</td>\`;
          body.appendChild(tr);
        });
        body.onchange=e=>{const i=+e.target.dataset.i;const k=e.target.dataset.k;if(k==='link'){state.items[i].link=e.target.value;fetchQuote(i);}if(k==='qty'){updateQty(i,e.target.value);}};
      }
      if(state.step===2){
        calc();
        const c=document.createElement('div'); c.className='card';
        c.innerHTML='<h2>Review Quote</h2><button class="btn secondary" id="back">Back</button><button class="btn primary" id="next">Approve</button><table class="list"><thead><tr><th>Thumb</th><th>Item</th><th class="right">Qty</th><th class="right">Unit</th><th class="right">Total</th></tr></thead><tbody id="review"></tbody><tfoot><tr><td colspan="4" class="right"><b>Subtotal</b></td><td class="right">'+fmt(state.totals.sub)+'</td></tr><tr><td colspan="4" class="right"><b>Grand</b></td><td class="right">'+fmt(state.totals.grand)+'</td></tr></tfoot></table>';
        app.appendChild(c);
        document.getElementById('back').onclick=()=>setStep(1);
        document.getElementById('next').onclick=()=>setStep(3);
        const body=c.querySelector('#review');
        state.items.forEach(it=>{
          const tr=document.createElement('tr');
          tr.innerHTML=\`<td>\${it.thumbnail?'<img class="thumb" src="'+it.thumbnail+'"/>':''}</td>
            <td><div><b>\${it.title||''}</b></div><div style="color:#64748b;font-size:12px">\${it.variant||''}</div></td>
            <td class="right">\${it.qty}</td><td class="right">\${fmt(it.unit)}</td><td class="right">\${fmt(it.total)}</td>\`;
          body.appendChild(tr);
        });
      }
      if(state.step===3){
        const c=document.createElement('div'); c.className='card';
        c.innerHTML='<h2>Approve & Pay</h2><p>Grand Total: '+fmt(state.totals.grand)+'</p><button class="btn secondary" id="prev">Back</button><button class="btn primary" id="approve">Approve Quote</button>';
        app.appendChild(c);
        document.getElementById('prev').onclick=()=>setStep(2);
        document.getElementById('approve').onclick=()=>alert('Quote approved! We will send payment link.');
      }
    }
    if(state.items.length===0)addRow(); else render();
  </script>
</body>
</html>`);
});

// 404 fallback
app.use((req,res)=>res.status(404).json({ok:false,error:'Not found',path:req.path}));

// Start
app.listen(PORT,()=>console.log(`${APP_NAME} (${APP_VERSION}) listening on ${PORT}`));
