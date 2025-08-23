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
    const qty = Number(body.qty ||
