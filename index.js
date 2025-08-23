app.use(express.static('public'));
// index.js — so-quote backend (// add near top of your Express routes:
// index.js — FULL FILE (paste-and-replace)
// Node/Express server with strict, working CORS for Railway frontend.

const express = require('express');
const cors = require('cors');

const app = express();

// ----- Logging (optional) -----
console.log('NODE_ENV', process.env.NODE_ENV || 'development');

// ----- Body parsing -----
app.use(express.json({ limit: '1mb' }));

// ----- Allowed origins (edit the Railway URL if yours differs) -----
const ALLOW_ORIGINS = [
  /^https?:\/\/localhost(:\d+)?$/i,
  /^https?:\/\/127\.0\.0\.1(:\d+)?$/i,
  // Your Railway frontend app URL:
  /^https:\/\/sdl-quote-frontend-production\.up\.railway\.app$/i,
  // If you have another Railway domain for previews, allow all *.railway.app:
  /\.railway\.app$/i,
];

// ----- CORS middleware -----
const corsMiddleware = cors({
  origin: (origin, cb) => {
    // Allow same-origin/fetches without Origin (e.g., curl, health checks)
    if (!origin) return cb(null, true);
    const ok = ALLOW_ORIGINS.some((re) =>
      typeof re.test === 'function' ? re.test(origin) : origin === re
    );
    return ok ? cb(null, true) : cb(new Error(`CORS: Origin not allowed: ${origin}`));
  },
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: false,
  optionsSuccessStatus: 204,
});

// Handle preflight for all routes
app.options('*', corsMiddleware);
app.use(corsMiddleware);

// ----- Static (optional) -----
app.use(express.static('public'));

// ----- Favicon: return 204 (no content) to silence 403 noise -----
app.get('/favicon.ico', (_req, res) => res.status(204).end());

// ----- Health -----
app.get(['/', '/health'], (_req, res) => {
  res.json({ ok: true, version: 'alpha', env: process.env.NODE_ENV || 'development' });
});

// ----- Your main API endpoint (adjust handler to your logic) -----
// Example: /quote expects JSON payload and returns a computed quote
app.post('/quote', async (req, res) => {
  try {
    const payload = req.body || {};

    // TODO: replace with your real calculation
    // Minimal echo to confirm CORS and wiring are good:
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
