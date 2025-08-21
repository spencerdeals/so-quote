// index.js — backend with /meta route
import express from "express";
import cors from "cors";
import { request } from "undici";
import * as cheerio from "cheerio";

const app = express();
app.use(cors({ origin: true }));

// Tiny helpers
const clean = s => (s || "").replace(/\s+/g, " ").trim();

function findJSONLD($) {
  let name = "";
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const raw = $(el).contents().text();
      const json = JSON.parse(raw);
      const stack = Array.isArray(json) ? json : [json];
      while (stack.length) {
        const node = stack.shift();
        if (!node || typeof node !== "object") continue;
        const t = (node["@type"] || node.type || "").toString().toLowerCase();
        if (t.includes("product") && (node.name || node.title)) {
          name = node.name || node.title; return false;
        }
        for (const v of Object.values(node)) if (v && typeof v === "object") stack.push(v);
      }
    } catch {}
  });
  return name;
}

function firstText($, sels) {
  for (const sel of sels) {
    const txt = $(sel).first().text().trim();
    if (txt) return txt;
  }
  return "";
}

// /meta?url=<product URL>
app.get("/meta", async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).json({ name: null, error: "Missing url" });
  try {
    const { body } = await request(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9"
      },
      maxRedirections: 5
    });
    const html = await body.text();
    const $ = cheerio.load(html);

    let name =
      findJSONLD($) ||
      $('meta[property="og:title"]').attr("content") ||
      $('meta[name="twitter:title"]').attr("content") ||
      firstText($, ["#productTitle", "h1", ".product-name", "[data-automation='product-title']", "title"]);

    return res.json({ name: clean(name) || null });
  } catch (e) {
    return res.json({ name: null });
  }
});

// health
app.get(["/", "/health"], (_req, res) => {
  res.json({ ok: true, service: "Instant Import V5" });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Backend running on ${PORT}`));
