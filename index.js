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
    $('h1
