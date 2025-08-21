// SDL Instant Quote — #alpha ScrapingBee Patch
// - Adds GET /meta?url=... using ScrapingBee to fetch title/price/image reliably
// - Keeps / (frontend), /health, and POST /quote proxy intact

const express = require('express');
const path = require('path');
const cheerio = require('cheerio');

const app = express();
app.use(express.json({ limit: '2mb' }));

// ---- Config ----
const SCRAPINGBEE_KEY = process.env.SCRAPINGBEE_KEY; // REQUIRED
const TARGET_QUOTE = process.env.QUOTE_URL || 'https://so-quote.fly.dev/quote';

// ---- Frontend + health ----
app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'frontend.html'));
});

app.get('/health', (_req, res) => {
  res.json({ ok: true, version: '#alpha + scrapingbee', hasKey: !!SCRAPINGBEE_KEY, ts: new Date().toISOString() });
});

// ---- Quote proxy (unchanged) ----
app.post('/quote', async (req, res) => {
  try {
    const r = await fetch(TARGET_QUOTE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body || {}),
    });
    const text = await r.text();
    res.status(r.status).type(r.headers.get('content-type') || 'application/json').send(text);
  } catch (err) {
    res.status(500).json({ error: 'Proxy failed', detail: String(err && err.message || err) });
  }
});

// ---- NEW: /meta via ScrapingBee ----
/**
 * GET /meta?url=https://example.com/product/123
 * Returns: { url, title, price, image, source }
 */
app.get('/meta', async (req, res) => {
  try {
    const target = (req.query.url || '').toString();
    if (!target) return res.status(400).json({ error: 'Missing url' });
    if (!SCRAPINGBEE_KEY) return res.status(500).json({ error: 'Missing SCRAPINGBEE_KEY env' });

    const beeUrl = new URL('https://app.scrapingbee.com/api/v1/');
    beeUrl.searchParams.set('api_key', SCRAPINGBEE_KEY);
    beeUrl.searchParams.set('url', target);
    beeUrl.searchParams.set('render_js', 'true');            // let pages compute content
    beeUrl.searchParams.set('country_code', 'us');           // US region
    beeUrl.searchParams.set('premium_proxy', 'true');        // more reliable e-comm
    beeUrl.searchParams.set('return_page_source', 'true');   // return HTML

    const r = await fetch(beeUrl.toString(), {
      headers: {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123 Safari/537.36'
      }
    });
    const html = await r.text();
    const $ = cheerio.load(html);

    // Try JSON-LD first (Product schema)
    let title = null, price = null, image = null, source = 'unknown';
    $('script[type="application/ld+json"]').each((_, el) => {
      try {
        const data = JSON.parse($(el).text());
        const arr = Array.isArray(data) ? data : [data];
        for (const item of arr) {
          const t = (item && (item.name || item.title)) || null;
          const offers = item && item.offers;
          const p = offers && (offers.price || (offers.priceSpecification && offers.priceSpecification.price));
          const img = item && (item.image || (item.images && item.images[0]));
          if (!title && t) { title = String(t); source = 'ld+json'; }
          if (!price && p) { price = String(p); source = 'ld+json'; }
          if (!image && img) { image = Array.isArray(img) ? img[0] : img; }
          if (title && (price || image)) break;
        }
      } catch {}
    });

    // Fallback: Open Graph
    if (!title) {
      const ogt = $('meta[property="og:title"]').attr('content');
      if (ogt) { title = ogt; source = 'og'; }
    }
    if (!image) {
      const ogi = $('meta[property="og:image"]').attr('content');
      if (ogi) image = ogi;
    }

    // Fallback: <title>
    if (!title) {
      const t = $('title').first().text().trim();
      if (t) { title = t; source = 'title-tag'; }
    }

    // Heuristic: look for price-like strings if not in JSON-LD
    if (!price) {
      const metaPrice = $('meta[itemprop="price"], meta[property="product:price:amount"]').attr('content');
      if (metaPrice) { price = metaPrice; source = 'meta-price'; }
    }
    if (!price) {
      const priceText = $('*[class*="price"], *[id*="price"]').first().text();
      const m = priceText && priceText.match(/\$?\s?(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/);
      if (m) { price = m[1].replace(/,/g, ''); source = 'price-heuristic'; }
    }

    res.json({ url: target, title: title || null, price: price || null, image: image || null, source, status: r.status });
  } catch (err) {
    res.status(500).json({ error: 'meta-failed', detail: String(err && err.message || err) });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('SDL #alpha (ScrapingBee) on http://localhost:' + PORT));
