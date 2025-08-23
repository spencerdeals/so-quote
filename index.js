// index.js — FULL FILE (alpha) — paste-and-replace
// Node/Express server with strict CORS for Railway frontend + Fly.io backend.
// Includes: health route, favicon 204, robust CORS preflight handling.

const express = require('express');
const cors = require('cors');

const app = express();

// ----- Logging -----
console.log('NODE_ENV', process.env.NODE_ENV || 'development');

// ----- Body parsing -----
app.use(express.json({ limit: '1mb' }));

// ----- Allowed origins -----
// Adjust these to your exact frontend hosts as needed.
const ALLOW_ORIGINS = [
  /^https?:\/\/localhost(:\d+)?$/i,
  /^https?:\/\/127\.0\.0\.1(:\d+)?$/i,
  // Railway frontend (production app)
  /^https:\/\/sdl-quote-frontend-production\.up\.railway\.app$/i,
  // Any other Railway preview hosts you spin up (optional; keep if you use previews)
  /^https:\/\/[a-z0-9-]+\.up\.railway\.app$/i,
];

// ----- CORS middleware -----
const corsMiddleware = cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true); // allow same-origin/no-origin (health checks, curl)
    const ok = ALLOW_ORIGINS.some((re) => re.test(origin));
    return ok ? cb(null, true) : cb(new Error(`CORS: Origin not allowed: ${origin}`));
  },
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: false,
  optionsSuccessStatus: 204,
});

// Preflight for all routes
app.options('*', corsMiddleware);
app.use(corsMiddleware);

// ----- Static (optional) -----
app.use(express.static('public'));

// ----- Favicon: silence 403s by returning 204 -----
app.get('/favicon.ico', (_req, res) => res.status(204).end());

// ----- Health -----
app.get(['/', '/health'], (_req, res) => {
  res.json({ ok: true, version: 'alpha', env: process.env.NODE_ENV || 'development' });
});

// ----- Main API endpoint -----
// NOTE: Ensure your frontend calls the full backend URL, e.g. https://so-quote.fly.dev/quote
app.post('/quote', async (req, res) => {
  try {
    const payload = req.body || {};

    // TODO: replace with your real calculator logic.
    const result = {
      received: payload,
      total: 123.45,
      note: 'Sample response — replace with real calculator.',
    };

    res.json(result);
  } catch (err) {
    console.error('Error in /quote:', err);
    res.status(500).json({ error: 'Internal error' });
  }
});

// ----- Start server -----
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on :${PORT}`);
});
