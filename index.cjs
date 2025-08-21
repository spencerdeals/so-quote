// ENTRY: index.cjs (CommonJS)
const express = require("express");
const cors = require("cors");

// ---- Safe fetch fallback (for Node <18 compatibility) ----
let _fetch = global.fetch;
if (!_fetch) {
  _fetch = (...args) => import("node-fetch").then(({ default: f }) => f(...args));
}
const withTimeout = (ms) => {
  const ac = new AbortController();
  const id = setTimeout(() => ac.abort(), ms);
  return { signal: ac.signal, cancel: () => clearTimeout(id) };
};
// -----------------------------------------------------------------

const app = express();
const PORT = process.env.PORT || 3000;
const VERSION = process.env.APP_VERSION || "alpha-2025-08-21";

// Allowed web origins
const allowedOrigins = (process.env.ALLOWED_ORIGINS ||
  "http://localhost:3000,http://localhost:5173,https://sdl.bm,https://www.sdl.bm")
  .split(",").map(s => s.trim()).filter(Boolean);

app.use((req, res, next) => {
  const proto = req.headers["x-forwarded-proto"];
  if (proto && proto !== "https" && process.env.ENFORCE_HTTPS === "1") {
    return res.redirect(301, "https://" + req.headers.host + req.originalUrl);
  }
  next();
});

// CORS
app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);
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
}));

app.use(express.json({ limit: "2mb" }));

// Health
app.get(["/", "/health"], (_req, res) => {
  res.json({ ok: true, version: VERSION });
});

// Silence favicon
app.get("/favicon.ico", (_req, res) => res.status(204).end());

// ✅ ScrapingBee raw scrape
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
      block_resources: "true"
    });

    const { signal, cancel } = withTimeout(10000);
    const sbResp = await _fetch(`https://app.scrapingbee.com/api/v1/?${params.toString()}`, {
      method: "GET",
      headers,
      signal
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

// ✅ ScrapingBee structured extract
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
      signal
    }).finally(cancel);

    const html = await resp.text();

    // parse HTML with cheerio
    const cheerio = require("cheerio");
    const $ = cheerio.load(html);

    const textOr = (...vals) => vals.find(v => v && String(v).trim().length) || null;
    const meta = (sel) => $(`meta[${sel}]`).attr("content");

    const t1 = meta('property="og:title"');
    const t2 = meta('name="twitter:title"');
    const t3 = $("h1").first().text();
    const t4 = $("title").first().text();
    const title = textOr(t1, t2, t3, t4);

    const i1 = meta('property="og:image"');
    const i2 = meta('name="twitter:image"');
    const i3 = $("img").first().attr("src");
    const image = textOr(i1, i2, i3);

    const p1 = meta('property="product:price:amount"');
    const p2 = $('*[itemprop="price"]').attr("content") || $('*[itemprop="price"]').text();
    const p3 = $('[data-price]').attr("data-price") || $('[data-price]').text();
    const p4 = $('.price, .product-price, .price__regular, .price-item').first().text();

    let p5 = null;
    const moneyMatches = (html.match(/\$[\s]*\d{1,3}(?:,\d{3})*(?:\.\d{2})?/g) || []).map(s => s.replace(/\s+/g,""));
    if (moneyMatches.length) {
      const freq = {};
      moneyMatches.forEach(m => freq[m] = (freq[m] || 0) + 1);
      p5 = Object.entries(freq).sort((a,b) => b[1]-a[1])[0][0];
    }

    const priceRaw = textOr(p1, p2, p3, p4, p5);
    const price = priceRaw ? String(priceRaw).trim() : null;

    res.json({ ok: true, url, title, price, image });
  } catch (err) {
    console.error("POST /extract error:", err?.message || err);
    res.status(502).json({ ok: false, error: "Extract failed" });
  }
});

// Preflight + error handler
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
