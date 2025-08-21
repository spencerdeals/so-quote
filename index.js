// Instant Quote Backend — CORS Fix (#alpha)
// Full paste-and-replace file for index.js
// Version: 2025-08-21 alpha-cors-allow

import express from "express";
import cors from "cors";

const app = express();
const PORT = process.env.PORT || 3000;

// ---------------------------
// CORS: allow only approved origins
// ---------------------------
const DEFAULT_ALLOWED_ORIGINS = [
  "https://sdl-quote-frontend-production.up.railway.app",
  "https://sdl.bm",
  "http://localhost:5173",
  "http://localhost:3000"
];

const ALLOWED_ORIGINS = (process.env.FRONTEND_ORIGINS || "")
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);

const allowList = ALLOWED_ORIGINS.length ? ALLOWED_ORIGINS : DEFAULT_ALLOWED_ORIGINS;

const corsOptionsDelegate = (req, callback) => {
  const origin = req.header("Origin");
  // Allow same-origin/no-origin (like curl or server-to-server)
  if (!origin) return callback(null, { origin: true, credentials: false });
  const isAllowed = allowList.includes(origin);
  callback(null, {
    origin: isAllowed,
    credentials: false,
    methods: ["GET", "HEAD", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Accept"],
    maxAge: 600
  });
};

app.use(cors(corsOptionsDelegate));
app.options("*", cors(corsOptionsDelegate));

app.use((req, _res, next) => {
  if (process.env.LOG_REQUESTS === "1") {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl} (Origin: ${req.headers.origin || "-"})`);
  }
  next();
});

app.get(["/", "/health"], (_req, res) => {
  res.json({ ok: true, version: "alpha-cors-allow", time: new Date().toISOString() });
});

// ---------------------------------------
// /meta — fetch a page server-side & return its <title>
// ---------------------------------------
function extractTitle(html) {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (m && m[1]) {
    return m[1].replace(/\s+/g, " ").trim();
  }
  const m2 = html.match(/<meta[^>]+property=["']og:title["'][^>]*content=["']([^"']+)["'][^>]*>/i);
  if (m2 && m2[1]) return m2[1].trim();
  const m3 = html.match(/<meta[^>]+name=["']twitter:title["'][^>]*content=["']([^"']+)["'][^>]*>/i);
  if (m3 && m3[1]) return m3[1].trim();
  return null;
}

app.get("/meta", async (req, res) => {
  try {
    const target = String(req.query.url || "").trim();
    if (!target) {
      return res.status(400).json({ ok: false, error: "Missing ?url parameter" });
    }
    let u;
    try {
      u = new URL(target);
    } catch {
      return res.status(400).json({ ok: false, error: "Invalid URL" });
    }
    if (!/^https?:$/.test(u.protocol)) {
      return res.status(400).json({ ok: false, error: "Only http(s) URLs are allowed" });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    const resp = await fetch(u.href, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9"
      }
    }).catch(err => {
      throw new Error(`Upstream fetch error: ${err.message}`);
    });
    clearTimeout(timeout);

    if (!resp.ok) {
      return res.status(resp.status).json({ ok: false, error: `Upstream responded ${resp.status}` });
    }

    const html = await resp.text();
    const title = extractTitle(html) || null;

    res.setHeader("Vary", "Origin");
    return res.json({ ok: true, url: u.href, title });
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    return res.status(502).json({ ok: false, error: msg });
  }
});

app.use((req, res) => {
  res.status(404).json({ ok: false, error: "Not found" });
});

app.listen(PORT, () => {
  console.log(`Server running on :${PORT}`);
});
