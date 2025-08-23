/**
 * SDL — Instant Quote | Backend App
 * Production-ready server file
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
const RATE_LIMIT_PER_MIN = Number(process.env.RATE_LIMIT_PER_MIN || 120);
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

// Root UI
app.get(['/', '/index.html'], (_req, res) => {
  res.type('html').send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${APP_NAME}</title>
</head>
<body>
  <h1>${APP_NAME}</h1>
  <p>Instant Quote backend is running (${APP_VERSION}).</p>
  <p>Use <code>/quote</code> to request quotes.</p>
</body>
</html>`);
});

// 404
app.use((req, res) => {
  if (req.accepts('json')) {
    return res.status(404).json({ ok: false, error: 'Not found', path: req.path });
  }
  res.status(404).send('Not found');
});

// Start
app.listen(PORT, () => {
  console.log(`${APP_NAME} (${APP_VERSION}) listening on ${PORT}`);
});
