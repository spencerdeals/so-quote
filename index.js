/* Instant Quote — Consolidated Backend (index.js)
 * Purpose: Merge OCR/scraper logic into a single backend service for Railway.
 * Version: 4.0-consolidated
 * Health tag: version=4.0-consolidated, calc=price-sum
 *
 * Endpoints:
 *   GET  /health                          -> simple JSON health check
 *   POST /scrape                          -> { urls: string[] } -> [{ url, title, source: 'html|scraperbee', ok, error? }]
 *   POST /ocr/upload                      -> multipart/form-data (file) -> { ok: true, filename }
 *
 * Notes:
 *  - Title extraction tries: <title>, <meta property="og:title">, <meta name="title">.
 *  - Optional ScraperBee proxy: set SCRAPERBEE_API_KEY to enable.
 *  - Start command on Railway: `node index.js`
 */

const express = require("express");
const cors = require("cors");
const morgan = require("morgan");
const axios = require("axios");
const multer = require("multer");

const PORT = process.env.PORT || 3000;
const SCRAPERBEE_API_KEY = process.env.SCRAPERBEE_API_KEY || ""; // optional

const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use(morgan("tiny"));

// ----- Utils
const pickTitle = (html) => {
  if (!html) return null;
  // Try <title>
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  if (titleMatch) return titleMatch[1].trim();

  // Try og:title
  const ogMatch = html.match(
    /<meta[^>]+property=["']og:title["'][^>]*content=["']([^"']+)["'][^>]*>/i
  );
  if (ogMatch) return ogMatch[1].trim();

  // Try name="title"
  const nameMatch = html.match(
    /<meta[^>]+name=["']title["'][^>]*content=["']([^"']+)["'][^>]*>/i
  );
  if (nameMatch) return nameMatch[1].trim();

  return null;
};

async function fetchViaScraperBee(url) {
  if (!SCRAPERBEE_API_KEY) return null;
  try {
    // ScraperBee example endpoint (adjust if your provider differs)
    const api = "https://api.scraperbee.com/scrape";
    const resp = await axios.post(
      api,
      { url },
      { headers: { Authorization: `Bearer ${SCRAPERBEE_API_KEY}` }, timeout: 30000 }
    );
    if (resp?.data?.html) {
      const title = pickTitle(resp.data.html);
      return { ok: true, title, source: "scraperbee" };
    }
    return { ok: false, error: "No HTML in ScraperBee response", source: "scraperbee" };
  } catch (err) {
    return { ok: false, error: `ScraperBee error: ${err.message}`, source: "scraperbee" };
  }
}

async function fetchDirect(url) {
  try {
    const resp = await axios.get(url, {
      timeout: 20000,
      // Many e‑commerce sites require a UA to return full HTML
      headers: { "User-Agent": "Mozilla/5.0 (compatible; SDLQuoteBot/1.0)" },
    });
    const title = pickTitle(resp.data);
    return { ok: true, title, source: "html" };
  } catch (err) {
    return { ok: false, error: `Direct fetch error: ${err.message}`, source: "html" };
  }
}

// ----- Routes
app.get(["/", "/health"], (_req, res) => {
  res.json({ ok: true, version: "4.0-consolidated", calc: "price-sum" });
});

app.post("/scrape", async (req, res) => {
  try {
    const urls = Array.isArray(req.body?.urls) ? req.body.urls : [];
    if (!urls.length) {
      return res.status(400).json({ ok: false, error: "Provide { urls: string[] }" });
    }

    const results = await Promise.all(
      urls.map(async (url) => {
        // 1) Try direct fetch first (fast)
        const direct = await fetchDirect(url);
        if (direct.ok && direct.title) return { url, ...direct };

        // 2) Fallback to ScraperBee if configured
        const bee = await fetchViaScraperBee(url);
        if (bee && bee.ok && bee.title) return { url, ...bee };

        // 3) If both failed, return best error
        const error = bee?.error || direct.error || "Unknown error";
        return { url, ok: false, title: null, source: bee?.source || direct.source, error };
      })
    );

    res.json({ ok: true, results });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Simple OCR upload placeholder — consolidates former update.js into one service.
// You can wire your OCR processor here later.
const upload = multer({ dest: "uploads/" });
app.post("/ocr/upload", upload.single("file"), (req, res) => {
  if (!req.file) return res.status(400).json({ ok: false, error: "No file uploaded" });
  res.json({ ok: true, filename: req.file.filename, original: req.file.originalname });
});

// ----- Start
app.listen(PORT, () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
});
