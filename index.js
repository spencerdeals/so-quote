// index.js — FULL FILE (alpha CORS toggle) — paste-and-replace
// - CORS_MODE=open  → allow any Origin (reflects request origin).
// - CORS_MODE=strict (default) → allowlist via regex + FRONTEND_ORIGINS env list.
// - Includes: health, favicon 204, /debug/cors to echo headers for troubleshooting.

const express = require('express');
const cors = require('cors');

const app = express();

// ----- Config -----
const NODE_ENV = process.env.NODE_ENV || 'development';
const CORS_MODE = (process.env.CORS_MODE || 'strict').toLowerCase(); // 'open' | 'strict'
// Optionally provide comma-separated extra allowed origins in env:
const FRONTEND_ORIGINS = (process.env.FRONTEND_ORIGINS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

console.log('NODE_ENV', NODE_ENV);
console.log('CORS_MODE', CORS_MODE);
if (FRONTEND_ORIGINS.length) {
  console.log('FRONTEND_ORIGINS', FRONTEND_ORIGINS);
}

// ----- Body parsing -----
app.use(express.json({ limit: '1mb' }));

// ----- Allowed origins (strict mode) -----
const STRICT_ALLOW = [
  /^https?:\/\/localhost(:\d+)?$/i,
  /^https?:\/\/127\.0\.0\.1(:\d+)?$/i,

  // Railway frontend (production app)
  /^https:\/\/sdl-quote-frontend-production\.up\.railway\.app$/i,

  // Any other Railway preview hosts you spin up (keep if you use previews)
  /^https:\/\/[a-z0-9-]+\.up\.railway\.app$/i,

  // Future custom domains (optional examples; add/remove as needed)
  /^https?:\/\/(?:www\.)?sdl\.bm$/i,
  /^https?:\/\/(?:www\.)?spencerdeals\.bm$/i,
  // Shopify custom domain preview or embeds (uncomment if needed)
  // /^https?:\/\/.*\.myshopify\.com$/i,
];

// Merge FRONTEND_ORIGINS (exact strings) into allow check.
function isAllowedOrigin(origin) {
  if (!origin) return true; // allow same-origin/no-origin for health checks & curl
  if (FRONTEND_ORIGINS.includes(origin)) return true;
  return STRICT_ALLOW.some(re => re.test(origin));
}

// ----- CORS setup -----
let corsOptions;
if (CORS_MODE === 'open') {
  console.warn('[CORS] OPEN mode enabled — allowing all origins (for debugging).');
  corsOptions = {
    origin: true, // reflect request origin
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: false,
    optionsSuccessStatus: 204,
  };
} else {
  corsOptions = {
    origin: (origin, cb) => {
      const ok = isAllowedOrigin(origin);
      if (!ok) console.error(`[CORS] Blocked Origin: ${origin}`);
      return ok ? cb(null, true) : cb(new Error(`CORS: Origin not allowed: ${origin}`));
    },
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: false,
    optionsSuccessStatus: 204,
  };
}

// Preflight for all routes
app.options('*', cors(corsOptions));
app.use((req, _res, next) => {
  // Lightweight request log for CORS debugging
  const o = req.headers.origin || '';
  const m = req.method;
  const p = req.path;
  if (m === 'OPTIONS' || p === '/quote' || p === '/debug/cors') {
    console.log(`[REQ] ${m} ${p} Origin=${o}`);
  }
  next();
});
app.use(cors(corsOptions));

// ----- Static (optional) -----
app.use(express.static('public'));

// ----- Favicon: silence 403s by returning 204 -----
app.get('/favicon.ico', (_req, res) => res.status(204).end());

// ----- Health -----
app.get(['/', '/health'], (_req, res) => {
  res.json({ ok: true, version: 'alpha', env: NODE_ENV, cors: CORS_MODE });
});

// ----- Debug endpoint: echoes CORS-related headers -----
app.get('/debug/cors', (req, res) => {
  res.json({
    ok: true,
    method: req.method,
    path: req.path,
    origin: req.headers.origin || null,
    referer: req.headers.referer || null,
    'access-control-request-method': req.headers['access-control-request-method'] || null,
    'access-control-request-headers': req.headers['access-control-request-headers'] || null,
  });
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
