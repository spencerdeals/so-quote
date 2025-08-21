// index.js — SDL so-quote BACK END (Option A: hard-coded CORS + /meta)
// Date: 2025-08-21

require('dotenv').config();

const express = require('express');
const axios = require('axios');          // <- IMPORTANT: no .default
const cheerio = require('cheerio');
const bodyParser = require('body-parser');

const app = express();

/* ---------- CORS (Option A: hard-coded allow-list) ---------- */
const ALLOWED_ORIGINS = [
  'https://sdl-quote-frontend-production.up.railway.app',
  'https://sdl.bm' // optional; keep if your store will call backend
];

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});
/* ----------------------------------------------------------- */

app.use(bodyParser.json({ limit: '1mb' }));

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36';

/* ------------------ Fetch helpers ------------------ */
async function fetchHTMLDirect(url) {
  const res = await axios.get(url, {
    headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' },
    timeout: 15000,
    maxRedirects: 5,
    validateStatus: (s) => s >= 200 && s < 400
  });
  return { html: res.data, via: 'direct' };
}

async function fetchHTMLWithScrapingBee(url) {
  const key = process.env.SCRAPINGBEE_API_KEY;
  if (!key) throw new Error('Missing SCRAPINGBEE_API_KEY');
  const res = await axios.get('https://app.scrapingbee.com/api/v1', {
    params: { api_key: key, url, render_js: 'true', wait: '2000' },
    timeout: 20000,
    responseType: 'text',
    validateStatus: (s) => s >= 200 && s < 600
  });
  if (res.status >= 400) throw new Error(`ScrapingBee HTTP ${res.status}`);
  return { html: res.data, via: 'scrapingbee' };
}
/* ---------------------------------------------------- */

function firstNonEmpty(...vals) {
  for (const v of vals) {
    if (typeof v === 'string' && v.trim()) return v.trim();
    if (Array.isArray(v) && v.length) return v[0];
  }
  return '';
}

/* ------------------ Extractors ------------------ */
function extractFromJSONLD($) {
  const out = [];
  $('script[type="application/ld+json"]').each((_i, el) => {
    try {
      const data = JSON.parse($(el).contents().text());
      const arr = Array.isArray(data) ? data : [data];
      for (const obj of arr) {
        const t = obj['@type'];
        const isProduct = t === 'Product' || (Array.isArray(t) && t.includes('Product'));
        if (isProduct || obj.name) {
          const offers = Array.isArray(obj.offers) ? obj.offers[0] : obj.offers;
          out.push({
            name: obj.name || '',
            price: offers?.price || offers?.priceSpecification?.price || '',
            currency: offers?.priceCurrency || offers?.priceSpecification?.priceCurrency || '',
            images: Array.isArray(obj.image) ? obj.image : obj.image ? [obj.image] : []
          });
        }
      }
    } catch (_) {}
  });
  return out;
}

function extractTitle($) {
  return firstNonEmpty(
    $('meta[property="og:title"]').attr('content'),
    $('meta[name="twitter:title"]').attr('content'),
    $('h1').first().text(),
    $('title').first().text()
  );
}

function extractPriceGeneric($) {
  let text = firstNonEmpty(
    $('meta[property="product:price:amount"]').attr('content'),
    $('meta[property="og:price:amount"]').attr('content'),
    $('[itemprop="price"]').attr('content'),
    $('.price:contains("$")').first().text(),
    $('.product-price').first().text(),
    $('.Price, .c-price, .current-price, .sale-price, .regular-price').first().text()
  );
  if (!text) return '';
  const match = String(text).replace(/,/g, '').match(/(\d+(\.\d{1,2})?)/);
  return match ? match[0] : '';
}

function extractImages($) {
  const set = new Set();
  const og = $('meta[property="og:image"]').attr('content');
  if (og) set.add(og);
  $('img').slice(0, 20).each((_i, el) => {
    const src = $(el).attr('src') || $(el).attr('data-src') || $(el).attr('srcset');
    if (src) set.add(String(src).split(' ')[0]);
  });
  return Array.from(set);
}
/* ----------------------------------------------- */

async function getProductData(url) {
  let html = '', via = '', lastError = null;

  try {
    const r1 = await fetchHTMLDirect(url);
    html = r1.html; via = r1.via;
  } catch (e1) {
    lastError = `direct:${e1.message}`;
  }

  const looksBlocked = html && /captcha|access denied|verify you are human|cf-browser-verification/i.test(html);
  if (!html || looksBlocked) {
    try {
      const r2 = await fetchHTMLWithScrapingBee(url);
      html = r2.html; via = r2.via;
    } catch (e2) {
      lastError = (lastError ? lastError + '; ' : '') + `scrapingbee:${e2.message}`;
    }
  }

  if (!html) {
    return { url, ok: false, error: lastError || 'no html', title: '', price: '', images: [], via };
  }

  const $ = cheerio.load(html);
  const title = extractTitle($) || '';
  const ld = extractFromJSONLD($);
  const price = firstNonEmpty(ld[0]?.price, extractPriceGeneric($)) || '';
  const images = ld[0]?.images?.length ? ld[0].images : extractImages($);

  return {
    url, ok: Boolean(title), title, price, images, via,
    debug: { used_ldjson: Boolean(ld.length), last_error: lastError || null }
  };
}

/* ------------------ Routes ------------------ */
async function handleScrape(req, res) {
  try {
    const { url, urls } =
      req.method === 'GET' ? { url: req.query.url } : req.body;

    if (url) return res.json(await getProductData(url));

    if (Array.isArray(urls) && urls.length) {
      const results = await Promise.all(urls.map((u) => getProductData(u)));
      return res.json({ ok: true, results });
    }

    return res.status(400).json({ ok: false, error: 'Provide ?url=... or {url} or {urls:[...]}' });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message || 'server error' });
  }
}

app.get(['/', '/health'], (_req, res) => {
  res.json({ ok: true, version: 'alpha-cors-meta-fix-OptionA-2025-08-21', service: 'scraper' });
});

// All aliases point to the same handler
app.get(['/scrape', '/api/scrape', '/extract', '/meta'], handleScrape);
app.post(['/scrape', '/api/scrape', '/extract', '/meta', '/quote'], handleScrape);
/* ------------------------------------------- */

const port = process.env.PORT || 8080;
app.listen(port, () => {
  console.log(`Server listening on ${port}`);
});
