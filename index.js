// index.js — hardened /meta + /health
import express from "express";
import cors from "cors";
import { request } from "undici";
import * as cheerio from "cheerio";

const app = express();
app.use(cors({ origin: true }));

// ---------- helpers ----------
const clean = (s) =>
  (s || "")
    .replace(/\s+/g, " ")
    .replace(/\s*[-–—·•]\s*(Amazon|Wayfair|Target|Crate & Barrel|Walmart).*/i, "")
    .trim();

function first($, sels) {
  for (const sel of sels) {
    const t = $(sel).first().text().trim();
    if (t) return t;
  }
  return "";
}

function fromJSONLD($) {
  let found = "";
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const raw = $(el).contents().text();
      if (!raw) return;
      const json = JSON.parse(raw);
      const stack = Array.isArray(json) ? json : [json];
      while (stack.length) {
        const node = stack.shift();
        if (!node || typeof node !== "object") continue;
        const type = String(node["@type"] || node.type || "").toLowerCase();
        if (type.includes("product") && (node.name || node.title)) {
          found = node.name || node.title;
          return false;
        }
        for (const v of Object.values(node)) {
          if (v && typeof v === "object") stack.push(v);
        }
      }
    } catch {}
  });
  return found;
}

function fromNextData($) {
  const el = $("#__NEXT_DATA__").first();
  if (!el.length) return "";
  try {
    const json = JSON.parse(el.text());
    const cand = [
      json?.props?.pageProps?.product?.name,
      json?.props?.pageProps?.initialData?.product?.name,
      json?.props?.pageProps?.apolloState?.ROOT_QUERY?.product?.name,
    ].find(Boolean);
    return cand || "";
  } catch {}
  return "";
}

// ---------- routes ----------
app.get("/meta", async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).json({ name: null, error: "Missing url" });

  try {
    const { body, statusCode } = await request(url, {
      maxRedirections: 5,
      headers: {
        // Heavier UA + language increases chance of full page
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept":
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Upgrade-Insecure-Requests": "1",
      },
    });

    if (statusCode >= 300 && statusCode < 400) {
      // undici follows redirects by default (maxRedirections). If we still land here, bail gracefully.
    }

    const html = await body.text();
    const $ = cheerio.load(html);

    let name =
      // 1) JSON-LD Product blocks (most reliable)
      fromJSONLD($) ||
      // 2) Next.js embedded data (Wayfair & others)
      fromNextData($) ||
      // 3) OG/Twitter meta
      $('meta[property="og:title"]').attr("content") ||
      $('meta[name="og:title"]').attr("content") ||
      $('meta[name="twitter:title"]').attr("content") ||
      // 4) Amazon & general fallbacks
      first($, [
        "#productTitle",            // Amazon
        "h1#title span",            // Amazon alt
        "h1[itemprop='name']",
        "meta[itemprop='name']",
        ".product-title",
        ".product-name",
        "[data-automation='product-title']",
        "h1",
        "title",
      ]);

    name = clean(name);
    return res.json({ name: name || null });
  } catch (err) {
    console.error("meta error:", err?.message || err);
    return res.json({ name: null });
  }
});

app.get(["/", "/health"], (_req, res) => {
  res.json({ ok: true, service: "Instant Import V5" });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Backend running on ${PORT}`));
