// ENTRY: index.cjs (CommonJS)
const express = require("express");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 3000;
const VERSION = process.env.APP_VERSION || "alpha-2025-08-21";

// Allowed web origins (comma-separated)
const allowedOrigins = (process.env.ALLOWED_ORIGINS ||
  "http://localhost:3000,http://localhost:5173,https://sdl.bm,https://www.sdl.bm")
  .split(",").map(s => s.trim()).filter(Boolean);

// Optional: force HTTPS behind Railway proxy
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
    if (!origin) return cb(null, true); // server-to-server
    try {
      const host = new URL(origin).hostname;
      const isVercel = host.endsWith(".vercel.app"); // allow Vercel previews
      if (allowedOrigins.includes(origin) || isVercel) return cb(null, true);
    } catch (_) {}
    return cb(new Error(`CORS: origin not allowed -> ${origin}`));
  },
  credentials: true,
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
  maxAge: 600,
}));

// JSON body
app.use(express.json({ limit: "2mb" }));

// Health
app.get(["/", "/health"], (_req, res) => {
  res.json({ ok: true, version: VERSION });
});

// Silence browser favicon request
app.get("/favicon.ico", (_req, res) => res.status(204).end());

// Events proxy/shim (optional; safe fallback)
app.get(["/events", "/shop/events"], async (_req, res) => {
  const backend = process.env.BACKEND_URL;
  try {
    if (backend) {
      const upstream = await fetch(`${backend.replace(/\/$/, "")}/events`, {
        headers: { Accept: "application/json" },
      });
      const body = await upstream.text();
      res.status(upstream.status)
         .type(upstream.headers.get("content-type") || "application/json")
         .send(body);
    } else {
      res.json([]); // safe fallback
    }
  } catch (err) {
    console.error("GET /events error:", err);
    res.status(502).json({ ok: false, error: "Failed to fetch events from backend" });
  }
});

// Quote proxy — forwards to your calculator service
app.post(["/quote", "/api/quote"], async (req, res) => {
  const backend = process.env.BACKEND_URL;
  if (!backend) {
    return res.status(503).json({ ok: false, error: "BACKEND_URL not set" });
  }
  try {
    const upstream = await fetch(`${backend.replace(/\/$/, "")}/quote`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(req.body),
    });
    const text = await upstream.text();
    res.status(upstream.status)
       .type(upstream.headers.get("content-type") || "application/json")
       .send(text);
  } catch (err) {
    console.error("POST /quote error:", err);
    res.status(502).json({ ok: false, error: "Upstream quote service unreachable" });
  }
});

// ✅ ScrapingBee endpoint
// POST /scrape  { url: string, render_js?: boolean, country?: string, headers?: object }
app.post("/scrape", async (req, res) => {
  try {
    const apiKey = process.env.SCRAPINGBEE_KEY;
    if (!apiKey) {
      return res.status(503).json({ ok: false, error: "SCRAPINGBEE_KEY not set" });
    }

    const { url, render_js = true, country = "US", headers = {} } = req.body || {};
    if (!url) {
      return res.status(400).json({ ok: false, error: "Missing 'url' in body" });
    }

    const params = new URLSearchParams({
      api_key: apiKey,
      url,
      render_js: String(render_js),
      country_code: country,
      block_resources: "true" // speeds up + reduces costs
    });

    const sbResp = await fetch(`https://app.scrapingbee.com/api/v1/?${params.toString()}`, {
      // Forward optional headers (e.g., a specific User-Agent) via ScrapingBee
      method: "GET",
      headers: headers && typeof headers === "object" ? headers : {}
    });

    // ScrapingBee returns HTML (text) by default
    const contentType = sbResp.headers.get("content-type") || "text/html; charset=utf-8";
    const bodyText = await sbResp.text();

    // Pass through status + content-type so callers can parse HTML
    res.status(sbResp.status).type(contentType).send(bodyText);
  } catch (err) {
    console.error("POST /scrape error:", err);
    res.status(500).json({ ok: false, error: "Scrape failed" });
  }
});

// Preflight
app.options("*", (_req, res) => res.sendStatus(204));

// Error handler
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
