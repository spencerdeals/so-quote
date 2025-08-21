require('dotenv').config();
const express = require('express');
const axios = require('axios').default;
const cheerio = require('cheerio');
const bodyParser = require('body-parser');
const cors = require('cors');

const app = express();

// ---- STRICT CORS (frontends allowed) ----
const ALLOWED_ORIGINS = [
  'https://sdl-quote-frontend-production.up.railway.app',
  'https://sdl.bm', // if you ever serve from store
];
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && (ALLOWED_ORIGINS.includes(origin) || /\.railway\.app$/.test(new URL(origin).host))) {
    res.header('Access-Control-Allow-Origin', origin);
    res.header('Vary', 'Origin');
  }
  res.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});
// ----------------------------------------

app.use(bodyParser.json({ limit: '1mb' }));

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36';

async function fetchHTMLDirect(url) {
  const res = await axios.get(url, {
    headers: {
      'User-Agent': UA,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache',
      'Upgrade-Insecure-Requests': '1',
    },
    timeout: 15000,
    maxRedirects: 5,
    validateStatus: status => status >= 200 && status < 400,
  });
  return { html: res.data, status: res.status, via: 'direct' };
}

async function fetchHTMLWithScrapingBee(url, opts = {}) {
  const apiKey = process.env.SCRAPINGBEE_API_KEY;
  if (!apiKey) throw new Error('Missing SCRAPINGBEE_API_KEY');
  const params = {
    api_key: apiKey,
    url,
    render_js: 'true',
    wait: '2000',
    // premium_proxy: 'true', // uncomment if still blocked
  };
  const res = await axios.get('https://app.scrapingbee.com/api/v1', {
    params,
    timeout: 20000,
    responseType: 'text',
    validateStatus: status => status >= 200 && status < 600,
  });
  if (res.status >= 400) {
    const err = new Error(`ScrapingBee HTTP ${res.status}`);
    err.status = res.status;
    err.data = res.data;
    throw err;
  }
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
    const text = $(el).contents().text();
    try {
      const data = JSON.parse(text);
      const items = Array.isArray(data) ? data : [data];
      for (const obj of items) {
        const type = obj['@type'];
        const isProduct = type === 'Product' || (Array.isArray(type) && type.includes('Product'));
        if (isProduct || obj.name) {
          const offers = Array.isArray(obj.offers) ? obj.offers[0] : obj.offers;
          results.push({
            name: obj.name,
            sku: obj.sku || (obj.productID || ''),
            price: offers?.price || offers?.priceSpecification?.price || '',
            currency: offers?.priceCurrency || offers?.priceSpecification?.priceCurrency || '',
            images: (Array.isArray(obj.image) ? obj.image : (obj.image ? [obj.image] : [])),
          });
        }
      }
    } catch (_e) {}
  });
  return results;
}

function extractPriceGeneric($) {
  const metas = [
    $('meta[property="product:price:amount"]').attr('content'),
    $('meta[property="og:price:amount"]').attr('content'),
    $('meta[name="twitter:data1"]').attr('content'),
    $('meta[itemprop="price"]').attr('content'),
    $('[itemprop="price"]').attr('content'),
    $('[itemprop="price"]').text(),
  ].filter(Boolean);
  let text = firstNonEmpty(...metas,
    $('.price:contains("$")').first().text(),
    $('.product-price').first().text(),
    $('.Price, .c-price, .current-price, .sale-price, .regular-price').first().text(),
    $('*[class*="price"]').first().text()
  );
  if (!text) return '';
  const match = String(text).replace(/,/g, '').match(/(\d{1,3}(?:[.,]\d{3})*|\d+)(?:\.(\d{1,2}))?/);
  if (!match) return '';
  const number = match[0].replace(/,/g, '');
  return number;
}

function extractTitle($) {
  return firstNonEmpty(
    $('meta[property="og:title"]').attr('content'),
    $('meta[name="twitter:title"]').attr('content'),
    $('meta[name="title"]').attr('content'),
    $('h1').first().text(),
    $('title').first().text()
  );
}

function extractImages($) {
  const set = new Set();
  const candidates = [
    $('meta[property="og:image:secure_url"]').attr('content'),
    $('meta[property="og:image"]').attr('content'),
    $('link[rel="image_src"]').attr('href')
  ].filter(Boolean);
  candidates.forEach(u => set.add(u));
  $('img').slice(0, 20).each((_i, el) => {
    const src = $(el).attr('src') || $(el).attr('data-src') || $(el).attr('srcset');
    if (src) set.add(src.split(' ')[0]);
  });
  return Array.from(set);
}

function normalizePrice(price) {
  if (!price) return '';
  const s = String(price).replace(/[^\d.]/g, '').replace(/\.{2,}/g, '.');
  return s;
}

async function getProductData(url) {
  let html, via = '';
  let lastError = null;
  // Strategy 1: direct
  try {
    const res = await fetchHTMLDirect(url);
    html = res.html; via = res.via;
  } catch (e1) {
    lastError = `direct:${e1.message}`;
  }
  // Strategy 2: ScrapingBee if direct failed or looks blocked
  const looksBlocked = (html && /captcha|access denied|verify you are human|cf-browser-verification/i.test(html));
  if (!html || looksBlocked) {
    try {
      const res2 = await fetchHTMLWithScrapingBee(url);
      html = res2.html; via = res2.via;
    } catch (e2) {
      lastError = (lastError ? lastError + '; ' : '') + `scrapingbee:${e2.message}`;
    }
  }
  if (!html) {
    return { url, ok: false, error: lastError || 'no html', title: '', price: '', images: [], via };
  }

  const $ = cheerio.load(html);
  const title = extractTitle($);
  const ld = extractFromJSONLD($);
  let price = firstNonEmpty(ld[0]?.price, extractPriceGeneric($));
  price = normalizePrice(price);
  const images = ld[0]?.images?.length ? ld[0].images : extractImages($);

  // Currency (best-effort)
  let currency = firstNonEmpty(
    $('meta[property="product:price:currency"]').attr('content'),
    $('meta[property="og:price:currency"]').attr('content'),
    ld[0]?.currency
  ) || '';

  return {
    url,
    ok: Boolean(title),
    title: title || '',
    price: price || '',
    currency,
    images,
    via,
    debug: {
      used_ldjson: Boolean(ld.length),
      attempted: lastError ? ['direct', 'scrapingbee'] : ['direct'],
      last_error: lastError || null
    }
  };
}

async function handleScrape(req, res) {
  try {
    const { url, urls } = req.method === 'GET' ? { url: req.query.url } : req.body;
    if (!url && (!urls || !Array.isArray(urls) || urls.length === 0)) {
      return res.status(400).json({ ok: false, error: 'Provide ?url=... or JSON {url} or {urls:[...]}' });
    }
    if (url) {
      const result = await getProductData(url);
      return res.json(result);
    } else {
      const promises = urls.map(u => getProductData(u));
      const results = await Promise.all(promises);
      return res.json({ ok: true, results });
    }
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
}

// Health
app.get(['/', '/health'], (_req, res) => {
  res.json({ ok: true, version: 'alpha-cors-meta-fix-2025-08-21', service: 'scraper' });
});

// Unified routes
app.get(['/scrape', '/api/scrape', '/extract', '/meta'], handleScrape);
app.post(['/scrape', '/api/scrape', '/extract', '/meta', '/quote'], handleScrape);

const port = process.env.PORT || 8080;
app.listen(port, () => {
  console.log(`Server listening on ${port}`);
});
