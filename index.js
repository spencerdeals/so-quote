require('dotenv').config();
const express = require('express');
const axios = require('axios').default;
const cheerio = require('cheerio');
const bodyParser = require('body-parser');

const app = express();

// ---- STRICT CORS (only allow your frontend) ----
const ALLOWED_ORIGINS = [
  'https://sdl-quote-frontend-production.up.railway.app',
  'https://sdl.bm' // optional, if your store frontend will call backend
];
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && (ALLOWED_ORIGINS.includes(origin))) {
    res.header('Access-Control-Allow-Origin', origin);
    res.header('Vary', 'Origin');
  }
  res.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});
// -----------------------------------------------

app.use(bodyParser.json({ limit: '1mb' }));

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36';

async function fetchHTMLDirect(url) {
  const res = await axios.get(url, {
    headers: { 'User-Agent': UA },
    timeout: 15000,
    maxRedirects: 5,
    validateStatus: status => status >= 200 && status < 400,
  });
  return { html: res.data, status: res.status, via: 'direct' };
}

async function fetchHTMLWithScrapingBee(url) {
  const apiKey = process.env.SCRAPINGBEE_API_KEY;
  if (!apiKey) throw new Error('Missing SCRAPINGBEE_API_KEY');
  const res = await axios.get('https://app.scrapingbee.com/api/v1', {
    params: { api_key: apiKey, url, render_js: 'true', wait: '2000' },
    timeout: 20000,
    responseType: 'text',
    validateStatus: status => status >= 200 && status < 600,
  });
  if (res.status >= 400) throw new Error(`ScrapingBee HTTP ${res.status}`);
  return { html: res.data, status: res.status, via: 'scrapingbee' };
}

function firstNonEmpty(...vals) {
  for (const v of vals) {
    if (typeof v === 'string' && v.trim()) return v.trim();
    if (Array.isArray(v) && v.length) return v[0];
  }
  return '';
}

function extractFromJSONLD($) {
  const results = [];
  $('script[type="application/ld+json"]').each((_i, el) => {
    try {
      const data = JSON.parse($(el).contents().text());
      const items = Array.isArray(data) ? data : [data];
      for (const obj of items) {
        if (obj['@type'] === 'Product' || obj.name) {
          const offers = Array.isArray(obj.offers) ? obj.offers[0] : obj.offers;
          results.push({
            name: obj.name,
            price: offers?.price || '',
            currency: offers?.priceCurrency || '',
            images: Array.isArray(obj.image) ? obj.image : (obj.image ? [obj.image] : []),
          });
        }
      }
    } catch {}
  });
  return results;
}

function extractPriceGeneric($) {
  let text = firstNonEmpty(
    $('meta[property="product:price:amount"]').attr('content'),
    $('meta[property="og:price:amount"]').attr('content'),
    $('[itemprop="price"]').attr('content'),
    $('.price:contains("$")').first().text(),
    $('.product-price').first().text()
  );
  if (!text) return '';
  const match = String(text).replace(/,/g, '').match(/(\d+(\.\d{1,2})?)/);
  return match ? match[0] : '';
}

function extractTitle($) {
  return firstNonEmpty(
    $('meta[property="og:title"]').attr('content'),
    $('h1').first().text(),
    $('title').first().text()
  );
}

function extractImages($) {
  const set = new Set();
  $('meta[property="og:image"]').each((_i, el) => set.add($(el).attr('content')));
  $('img').slice(0, 10).each((_i, el) => {
    const src = $(el).attr('src') || $(el).attr('data-src');
    if (src) set.add(src);
  });
  return Array.from(set);
}

async function getProductData(url) {
  let html, via = '', lastError = null;
  try { const res = await fetchHTMLDirect(url); html = res.html; via = res.via; } 
  catch (e1) { lastError = `direct:${e1.message}`; }
  if (!html) {
    try { const res2 = await fetchHTMLWithScrapingBee(url); html = res2.html; via = res2.via; } 
    catch (e2) { lastError = (lastError||'') + `; scrapingbee:${e2.message}`; }
  }
  if (!html) return { url, ok: false, error: lastError };

  const $ = cheerio.load(html);
  const title = extractTitle($);
  const ld = extractFromJSONLD($);
  let price = firstNonEmpty(ld[0]?.price, extractPriceGeneric($));
  const images = ld[0]?.images?.length ? ld[0].images : extractImages($);
  return { url, ok: !!title, title, price, images, via, debug: { lastError } };
}

async function handleScrape(req, res) {
  const { url, urls } = req.method === 'GET' ? { url: req.query.url } : req.body;
  if (url) return res.json(await getProductData(url));
  if (Array.isArray(urls)) {
    const results = await Promise.all(urls.map(u => getProductData(u)));
    return res.json({ ok: true, results });
  }
  res.status(400).json({ ok: false, error: 'No url(s) provided' });
}

app.get(['/', '/health'], (_req, res) => {
  res.json({ ok: true, version: 'alpha-cors-meta-fix-2025-08-21' });
});
app.get(['/scrape', '/api/scrape', '/extract', '/meta'], handleScrape);
app.post(['/scrape', '/api/scrape', '/extract', '/meta', '/quote'], handleScrape);

const port = process.env.PORT || 8080;
app.listen(port, () => console.log(`Server running on ${port}`));
