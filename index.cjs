// index.cjs — BACKEND (CommonJS) — FULL PASTE & REPLACE

const express = require("express");
const cors = require("cors");
const cheerio = require("cheerio"); // for /extract parsing

// ---------- Safe fetch fallback + timeout helpers ----------
let _fetch = global.fetch;
if (!_fetch) {
  _fetch = (...args) => import("node-fetch").then(({ default: f }) => f(...args));
}
const withTimeout = (ms) => {
  const ac = new AbortController();
  const id = setTimeout(() => ac.abort(), ms);
  return { signal: ac.signal, cancel: () => clearTimeout(id) };
};
// -----------------------------------------------------------

const app = express();
const PORT = process.env.PORT || 3000;
const VERSION = process.env.APP_VERSION || "alpha-2025-08-21";

// Allowed web origins (comma-separated env or sensible defaults)
const allowedOrigins = (process.env.ALLOWED_ORIGINS ||
  "http://localhost:3000,http://localhost:5173,https://sdl.bm,https://www.sdl.bm")
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);

// Optional: force HTTPS behind Railway proxy when ENFORCE_HTTPS=1
app.use((req, res, next) => {
  const proto = req.headers["x-forwarded-proto"];
  if (proto && proto !== "https" && process.env.ENFORCE_HTTPS === "1") {
    return res.redirect(301, "https://" + req.headers.host + req.originalUrl);
  }
  next();
});

// CORS (includes support for *.vercel.app previews)
app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true); // server-to-server / curl
      try {
        const host = new URL(origin).hostname;
        const isVercel = host.endsWith(".vercel.app");
        if (allowedOrigins.includes(origin) || isVercel) return cb(null, true);
      } catch (_) {}
      return cb(new Error(`CORS: origin not allowed -> ${origin}`));
    },
    credentials: true,
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
    maxAge: 600,
  })
);

// Body parser
app.use(express.json({ limit: "2mb" }));

// Health
app.get(["/", "/health"], (_req, res) => {
  res.json({ ok: true, version: VERSION });
});

// Silence browser favicon request
app.get("/favicon.ico", (_req, res) => res.status(204).end());

// ----------------- Optional: Events shim -------------------
app.get(["/events", "/shop/events"], async (_req, res) => {
  const backend = process.env.BACKEND_URL;
  try {
    if (backend) {
      const upstream = await _fetch(`${backend.replace(/\/$/, "")}/events`, {
        headers: { Accept: "application/json" },
      });
      const body = await upstream.text();
      res
        .status(upstream.status)
        .type(upstream.headers.get("content-type") || "application/json")
        .send(body);
    } else {
      res.json([]); // benign fallback
    }
  } catch (err) {
    console.error("GET /events error:", err);
    res.status(502).json({ ok: false, error: "Failed to fetch events from backend" });
  }
});
// -----------------------------------------------------------

// ---------------- Quote proxy (optional) -------------------
app.post(["/quote", "/api/quote"], async (req, res) => {
  const backend = process.env.BACKEND_URL;
  if (!backend) {
    return res.status(503).json({ ok: false, error: "BACKEND_URL not set" });
  }
  try {
    const { signal, cancel } = withTimeout(10000);
    const upstream = await _fetch(`${backend.replace(/\/$/, "")}/quote`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(req.body),
      signal,
    }).finally(cancel);
    const text = await upstream.text();
    res
      .status(upstream.status)
      .type(upstream.headers.get("content-type") || "application/json")
      .send(text);
  } catch (err) {
    console.error("POST /quote error:", err?.name || err);
    const msg = err?.name === "AbortError" ? "Upstream quote timeout" : "Upstream quote unreachable";
    res.status(502).json({ ok: false, error: msg });
  }
});
// -----------------------------------------------------------

// --------------- ScrapingBee: raw HTML ---------------------
app.post("/scrape", async (req, res) => {
  try {
    const apiKey = process.env.SCRAPINGBEE_KEY;
    if (!apiKey) return res.status(503).json({ ok: false, error: "SCRAPINGBEE_KEY not set" });

    const { url, render_js = true, country = "US", headers = {} } = req.body || {};
    if (!url) return res.status(400).json({ ok: false, error: "Missing 'url' in body" });

    const params = new URLSearchParams({
      api_key: apiKey,
      url,
      render_js: String(render_js),
      country_code: country,
      block_resources: "true" // speed + cost
    });

    const { signal, cancel } = withTimeout(10000);
    const sbResp = await _fetch(`https://app.scrapingbee.com/api/v1/?${params.toString()}`, {
      method: "GET",
      headers: headers && typeof headers === "object" ? headers : {},
      signal,
    }).finally(cancel);

    const contentType = sbResp.headers.get("content-type") || "text/html; charset=utf-8";
    const bodyText = await sbResp.text();
    res.status(sbResp.status).type(contentType).send(bodyText);
  } catch (err) {
    console.error("POST /scrape error:", err?.name || err);
    const msg = err?.name === "AbortError" ? "Scrape timeout" : "Scrape failed";
    res.status(502).json({ ok: false, error: msg });
  }
});
// -----------------------------------------------------------

// ------------- ScrapingBee: structured extract -------------
app.post("/extract", async (req, res) => {
  try {
    const apiKey = process.env.SCRAPINGBEE_KEY;
    if (!apiKey) return res.status(503).json({ ok: false, error: "SCRAPINGBEE_KEY not set" });

    const { url, render_js = true, country = "US" } = req.body || {};
    if (!url) return res.status(400).json({ ok: false, error: "Missing 'url' in body" });

    const params = new URLSearchParams({
      api_key: apiKey,
      url,
      render_js: String(render_js),
      country_code: country,
      block_resources: "true"
    });

    const { signal, cancel } = withTimeout(12000);
    const resp = await _fetch(`https://app.scrapingbee.com/api/v1/?${params.toString()}`, {
      method: "GET",
      signal,
    }).finally(cancel);

    const html = await resp.text();

    const $ = cheerio.load(html);
    const textOr = (...vals) => vals.find(v => v && String(v).trim()) || null;
    const meta = (sel) => $(`meta[${sel}]`).attr("content");

    // title
    const title = textOr(
      meta('property="og:title"'),
      meta('name="twitter:title"'),
      $("h1").first().text(),
      $("title").first().text()
    );

    // image
    const image = textOr(
      meta('property="og:image"'),
      meta('name="twitter:image"'),
      $("img").first().attr("src")
    );

    // price (several strategies)
    const p1 = meta('property="product:price:amount"');
    const p2 = $('*[itemprop="price"]').attr("content") || $('*[itemprop="price"]').first().text();
    const p3 = $('[data-price]').attr("data-price") || $('[data-price]').first().text();
    const p4 = $('.price, .product-price, .price__regular, .price-item').first().text();

    // fallback: most frequent $xx.xx on page
    let p5 = null;
    const moneyMatches = (html.match(/\$[\s]*\d{1,3}(?:,\d{3})*(?:\.\d{2})?/g) || []).map(s => s.replace(/\s+/g,""));
    if (moneyMatches.length) {
      const freq = {};
      moneyMatches.forEach(m => (freq[m] = (freq[m] || 0) + 1));
      p5 = Object.entries(freq).sort((a, b) => b[1] - a[1])[0][0];
    }

    const priceRaw = textOr(p1, p2, p3, p4, p5);
    const price = priceRaw ? String(priceRaw).trim() : null;

    res.json({ ok: true, url, title, price, image });
  } catch (err) {
    console.error("POST /extract error:", err?.message || err);
    res.status(502).json({ ok: false, error: "Extract failed" });
  }
});
// -----------------------------------------------------------

// Preflight & centralized error handler
app.options("*", (_req, res) => res.sendStatus(204));
app.use((err, _req, res, _next) => {
  console.error("Unhandled error:", err?.message || err);
  if (err?.message?.startsWith("CORS:")) {
    return res.status(403).json({ ok: false, error: err.message });
  }
  res.status(500).json({ ok: false, error: "Server error" });
});

app.listen(PORT, () => {
  console.log(`Server running on ${PORT} (v=${VERSION})`);
});
