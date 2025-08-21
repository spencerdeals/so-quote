// index.js — #alpha lightweight scraper API (titles, variants, best-effort first cost)
//
// App: Railway (Backend API)
// Replace your entire index.js with this file.

import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import cheerio from "cheerio";
import { extractProductInfo } from "./scrapers.js";

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json({ limit: "1mb" }));

// Health check (keep this exact shape for your sanity checks)
app.get(["/", "/health"], (_req, res) => {
  res.json({ ok: true, version: "3.3-titles-variants", mode: "light-scrape" });
});

// POST /scrape  { urls: string[] }
app.post("/scrape", async (req, res) => {
  try {
    const urls = Array.isArray(req.body?.urls) ? req.body.urls : [];
    if (!urls.length) {
      return res.status(400).json({ ok: false, error: "No urls provided." });
    }

    const results = await Promise.all(
      urls.map(async (url) => {
        try {
          const resp = await fetch(url, {
            headers: {
              "User-Agent":
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
              "Accept-Language": "en-US,en;q=0.9",
              "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
              "Cache-Control": "no-cache",
              "Pragma": "no-cache",
            },
            redirect: "follow",
          });
          const html = await resp.text();
          const info = extractProductInfo(html, url);
          return { url, ...info };
        } catch (e) {
          return { url, error: String(e) };
        }
      })
    );

    res.json({ ok: true, results });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on :${PORT}`);
});
