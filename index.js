// index.js — #alpha build with Amazon + Wayfair scraping
import express from "express";
import bodyParser from "body-parser";
import fetch from "node-fetch";
import dotenv from "dotenv";

dotenv.config();
const app = express();
app.use(bodyParser.json());

const PORT = process.env.PORT || 3000;
const SCRAPINGBEE_API_KEY = process.env.SCRAPINGBEE_API_KEY;

// Helper: fetch page HTML via ScrapingBee
async function scrapePage(url) {
  const apiUrl = `https://app.scrapingbee.com/api/v1?api_key=${SCRAPINGBEE_API_KEY}&url=${encodeURIComponent(
    url
  )}`;
  const res = await fetch(apiUrl);
  if (!res.ok) {
    throw new Error(`ScrapingBee error ${res.status}`);
  }
  return await res.text();
}

// Extract product details depending on domain
async function extractProduct(url) {
  const html = await scrapePage(url);

  if (url.includes("wayfair.com")) {
    // Wayfair: simple regex extraction
    const titleMatch = html.match(/"name":"([^"]+)"/);
    const priceMatch = html.match(/"price":\s*"([\d.]+)"/);
    return {
      vendor: "Wayfair",
      title: titleMatch ? titleMatch[1] : "Unknown Wayfair Item",
      firstCost: priceMatch ? parseFloat(priceMatch[1]) : 0,
    };
  }

  if (url.includes("amazon.")) {
    // Amazon: look for price and title in HTML
    const titleMatch = html.match(/<span id="productTitle"[^>]*>(.*?)<\/span>/s);
    const priceMatch =
      html.match(/"priceAmount"\s*:\s*"([\d.]+)"/) ||
      html.match(/id="priceblock_ourprice"[^>]*>\s*\$([\d.,]+)/) ||
      html.match(/id="priceblock_dealprice"[^>]*>\s*\$([\d.,]+)/);

    let title = titleMatch ? titleMatch[1].trim() : "Unknown Amazon Item";
    title = title.replace(/\s+/g, " ");

    let price = 0;
    if (priceMatch) {
      price = parseFloat(priceMatch[1].replace(/,/g, ""));
    }

    return {
      vendor: "Amazon",
      title,
      firstCost: price,
    };
  }

  return {
    vendor: "Unknown",
    title: "Unsupported Vendor",
    firstCost: 0,
  };
}

// API: GET health check
app.get(["/", "/health"], (_req, res) => {
  res.json({ ok: true, version: "alpha", calc: "amazon+wayfair" });
});

// API: POST /quote
app.post("/quote", async (req, res) => {
  try {
    const { links } = req.body;
    if (!Array.isArray(links)) {
      return res.status(400).json({ error: "links must be an array" });
    }

    const results = [];
    for (const link of links) {
      try {
        const product = await extractProduct(link);
        results.push({ url: link, ...product });
      } catch (err) {
        results.push({ url: link, error: err.message });
      }
    }

    res.json({ items: results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
