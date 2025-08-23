// index.js — #alpha build (CommonJS) with Amazon + Wayfair via ScrapingBee
// No ESM required; works with Node 18+ / 20 on Railway.
// Uses global fetch (available in Node 18+).

const express = require("express");
const dotenv = require("dotenv");

dotenv.config();

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const SCRAPINGBEE_API_KEY = process.env.SCRAPINGBEE_API_KEY;

// ---- Utilities ----

// Fetch page HTML via ScrapingBee
async function scrapePage(url) {
  if (!SCRAPINGBEE_API_KEY) {
    throw new Error("Missing SCRAPINGBEE_API_KEY env var");
  }
  const api = `https://app.scrapingbee.com/api/v1?api_key=${encodeURIComponent(
    SCRAPINGBEE_API_KEY
  )}&url=${encodeURIComponent(url)}&block_resources=false`;
  const res = await fetch(api, { method: "GET" });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`ScrapingBee ${res.status} ${res.statusText}: ${text.slice(0,200)}`);
  }
  return await res.text();
}

// Parse helpers
function pickFirst(...matches) {
  for (const m of matches) {
    if (m && m[1]) return m[1];
  }
  return null;
}

// Extract product info by domain
async function extractProduct(url) {
  const html = await scrapePage(url);

  if (url.includes("wayfair.com")) {
    const title = pickFirst(
      html.match(/"name":"([^"]+)"/),
      html.match(/<meta property="og:title" content="([^"]+)"/i)
    ) || "Unknown Wayfair Item";

    const priceStr = pickFirst(
      html.match(/"price":\s*"([\d.]+)"/),
      html.match(/"price":\s*([\d.]+)/)
    );

    const firstCost = priceStr ? parseFloat(priceStr) : 0;

    return { vendor: "Wayfair", title, firstCost };
  }

  if (url.includes("amazon.")) {
    // Title candidates
    let title = pickFirst(
      html.match(/<span id="productTitle"[^>]*>(.*?)<\/span>/is),
      html.match(/"name"\s*:\s*"([^"]+)"/),
      html.match(/<meta property="og:title" content="([^"]+)"/i)
    ) || "Unknown Amazon Item";
    title = title.replace(/\s+/g, " ").trim();

    // Price candidates
    const priceCandidate = pickFirst(
      html.match(/"priceAmount"\s*:\s*"([\d.,]+)"/),
      html.match(/"price"\s*:\s*"([\d.,]+)"/),
      html.match(/id="priceblock_ourprice"[^>]*>\s*\$([\d.,]+)/i),
      html.match(/id="priceblock_dealprice"[^>]*>\s*\$([\d.,]+)/i),
      html.match(/data-a-color="price"[^>]*>\s*<span[^>]*>\s*\$?\s*([\d.,]+)/i)
    );

    let firstCost = 0;
    if (priceCandidate) {
      firstCost = parseFloat(priceCandidate.replace(/,/g, "")) || 0;
    }

    return { vendor: "Amazon", title, firstCost };
  }

  return { vendor: "Unknown", title: "Unsupported Vendor", firstCost: 0 };
}

// ---- Routes ----

app.get(["/", "/health"], (_req, res) => {
  res.json({ ok: true, version: "alpha", calc: "amazon+wayfair", module: "cjs" });
});

app.post("/quote", async (req, res) => {
  try {
    const { links } = req.body || {};
    if (!Array.isArray(links)) {
      return res.status(400).json({ error: "links must be an array" });
    }

    const items = [];
    for (const url of links) {
      try {
        const product = await extractProduct(url);
        items.push({ url, ...product });
      } catch (err) {
        items.push({ url, error: String(err.message || err) });
      }
    }

    res.json({ items });
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
