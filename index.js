// index.js — Instant Import V5 backend (/meta scraper)
import express from "express";
import cors from "cors";
import { request } from "undici";
import * as cheerio from "cheerio";

const app = express();
app.use(cors({ origin: true }));

const clean = (s) =>
  (s || "").replace(/\s+/g, " ")
           .replace(/\s*[-–—·•]\s*(Amazon|Wayfair|Target|Crate & Barrel).*/i, "")
           .trim();

function firstText($, sels) {
  for (const sel of sels) {
    const t = $(sel).first().text().trim();
    if (t) return t;
  }
  return "";
}

function parseJSONLD($) {
  let found = "";
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const raw = $(el).contents().text();
      const json = JSON.parse(raw);
      const stack = Array.isArray(json) ? json : [json];
      while (stack.length) {
        const node = stack.shift();
        if (!node || typeof node !== "object") continue;
        const type = (node["@type"] || node.type || "").toString().toLowerCase();
        if (type.includes("product") && (node.name || node.title)) {
          found = node.name || node.title; return false;
        }
        for (const v of Object.values(node)) if (v && typeof v === "object") stack.push(v);
      }
    } catch {}
  });
  return found;
}

function parseNextData($) {
  const el = $("#__NEXT_DATA__").first();
  if (!el.length) return "";
  try {
    const json = JSON.parse(el.text());
    const candidates = [
      json?.props?.pageProps?.product?.name,
      json?.props?.pageProps?.initialData?.product?.name,
      json?.props?.pageProps?.apolloState?.ROOT_QUERY?.product?.name,
    ].filter(Boolean);
    return candidates[0] || "";
  } catch {}
  return "";
}

app.get("/meta", async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).json({ name: null, error: "Missing url" });
  try {
    const { body } = await request(url, {
      headers: {
        "User-Agent":"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        "Accept":"text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language":"en-US,en;q=0.9"
      },
      maxRedirections: 5,
    });
    const html = await body.text();
    const $ = cheerio.load(html);
    let name =
      parseJSONLD($) ||
      parseNextData($) ||
      $('meta[property="og:title"]').attr("content") ||
      $('meta[name="og:title"]').attr("content") ||
      $('meta[name="twitter:title"]').attr("content") ||
      firstText($, ["h1", "#productTitle", "[data-automation='product-title']", ".product-name", "title"]);
    return res.json({ name: clean(name) || null });
  } catch (err) {
    console.error("meta error:", err?.message || err);
    return res.json({ name: null });
  }
});

app.get(["/", "/health"], (_req, res) => {
  res.json({ ok: true, service: "Instant Import V5" });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Instant Import V5 server running on port ${PORT}`));
