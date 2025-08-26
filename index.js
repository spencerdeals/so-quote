// SDL Instant Import — Minimal Stable Backend
// Endpoints: /health, /extractProduct
// Env required: SCRAPINGBEE_API_KEY

const express = require("express");
const cors = require("cors");
const { JSDOM } = require("jsdom");

const app = express();
const PORT = process.env.PORT || 3000;

// --- Middleware
app.use(cors());
app.options("*", cors());
app.use(express.json({ limit: "1mb" }));

// --- Helpers
function safeHost(u) { try { return new URL(u).hostname; } catch { return ""; } }
function parsePrice(s) {
  const n = parseFloat(String(s).replace(/[^\d.]/g, ""));
  return isFinite(n) ? n : 0;
}
function pick(...vals) {
  for (const v of vals) if (v != null && String(v).trim() !== "") return v;
  return null;
}

// ScrapingBee fetch (stable defaults; JS rendering for Wayfair/Amazon)
async function fetchWithBee(url) {
  const key = process.env.SCRAPINGBEE_API_KEY;
  if (!key) throw new Error("Missing SCRAPINGBEE_API_KEY");
  const host = safeHost(url);
  const needsJS = /(^|\.)amazon\./i.test(host) || /(^|\.)wayfair\./i.test(host);
  const wait = needsJS ? 2500 : 1200;

  const qs = new URLSearchParams();
  qs.set("api_key", key);
  qs.set("url", url);
  qs.set("country_code", "us");
  if (needsJS) qs.set("render_js", "true");
  qs.set("wait", String(wait));
  qs.set("custom_headers", JSON.stringify({
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept-Language": "en-US,en;q=0.9"
  }));

  const api = `https://app.scrapingbee.com/api/v1?${qs.toString()}`;
  const resp = await fetch(api);
  const html = await resp.text();
  return { html, host, needsJS, wait, status: resp.status };
}

// Extraction
function extractFromHTML(html, url) {
  const dom = new JSDOM(html);
  const { document } = dom.window;

  // JSON-LD Product
  let title = null, image = null, price = null, currency = null, source = "none";
  const ldScripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));
  for (const s of ldScripts) {
    try {
      const json = JSON.parse(s.textContent || "{}");
      const arr = Array.isArray(json) ? json : [json];
      for (const node of arr) {
        if (node && typeof node === "object" && (String(node["@type"]||"").toLowerCase().includes("product") || node.offers)) {
          title = node.name || title;
          if (!image) {
            if (Array.isArray(node.image)) image = node.image[0] || null;
            else if (typeof node.image === "string") image = node.image;
          }
          if (!price && node.offers) {
            const offers = Array.isArray(node.offers) ? node.offers[0] : node.offers;
            let p = offers?.price ?? offers?.lowPrice ?? offers?.highPrice ?? null;
            if (typeof p === "string") p = parsePrice(p);
            if (isFinite(p)) price = Number(p);
            currency = offers?.priceCurrency || currency;
            source = "jsonld";
          }
        }
      }
      if (title || image || price) break;
    } catch { /* ignore */ }
  }

  // Title/image fallbacks
  if (!title) {
    const og = document.querySelector('meta[property="og:title"]')?.getAttribute("content");
    const h1 = document.querySelector("h1")?.textContent;
    const amz = document.querySelector("#productTitle")?.textContent;
    const ttag = document.querySelector("title")?.textContent;
    title = (pick(amz, og, h1, ttag) || "").trim();
  }
  if (!image) {
    const ogi = document.querySelector('meta[property="og:image"]')?.getAttribute("content");
    const linki = document.querySelector('link[rel="image_src"]')?.getAttribute("href");
    const amzi = document.querySelector("#landingImage")?.getAttribute("data-old-hires")
              || document.querySelector("#imgTagWrapperId img")?.getAttribute("src");
    image = pick(ogi, linki, amzi);
  }

  // Price selectors (Amazon, Wayfair, generic)
  if (!price) {
    const sels = [
      "#corePriceDisplay_desktop_feature_div .a-offscreen",
      "#corePrice_feature_div .a-offscreen",
      "#price_inside_buybox",
      "#priceblock_ourprice",
      "#priceblock_dealprice",
      "[itemprop=price]", 'meta[itemprop="price"]', 'meta[property="product:price:amount"]',
      "[data-hbkit-price]", ".price", ".sale-price", ".our-price", "[data-test*='price']"
    ];
    for (const sel of sels) {
      const el = document.querySelector(sel);
      if (!el) continue;
      const txt = el.getAttribute("content") || el.textContent || "";
      const p = parsePrice(txt);
      if (p > 0) { price = p; source = `selector:${sel}`; break; }
    }
  }

  // JSON script scan + HTML regex as last resort
  if (!price) {
    const jsonBlocks = html.match(/<script[^>]*type=["']application\/json["'][^>]*>[\s\S]*?<\/script>/gi) || [];
    outer: for (const blk of jsonBlocks) {
      const body = blk.replace(/^.*?>/s, "").replace(/<\/script>$/i, "");
      const m = body.match(/"price"\s*:\s*"?(\d{1,3}(?:,\d{3})*|\d+)(?:\.(\d{2}))?"?/i);
      if (m) { price = parsePrice(m[0]); source = "json-scan"; break outer; }
    }
  }
  if (!price) {
    const rx = /(USD\s*)?\$?\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})|[0-9]+(?:\.[0-9]{2}))/gi;
    let best = null, m;
    while ((m = rx.exec(html)) !== null) {
      const n = parsePrice(m[0]);
      if (n >= 5 && (!best || n < best)) best = n; // choose smallest plausible
    }
    if (best) { price = best; source = "regex"; }
  }

  let vendor = null;
  try { vendor = new URL(url).hostname.replace(/^www\./, ""); } catch { /* noop */ }

  return {
    title: title || null,
    image: image || null,
    price: isFinite(price) ? Number(price) : null,
    currency: currency || null,
    vendor,
    debug: { source }
  };
}

// --- Routes
app.get(["/", "/health"], (_req, res) => {
  res.json({ ok: true, version: "alpha-3-minimal-stable" });
});

app.post("/extractProduct", async (req, res) => {
  try {
    const { url } = req.body || {};
    if (!url) return res.status(400).json({ ok: false, error: "Missing url" });
    const fetched = await fetchWithBee(url);
    const product = extractFromHTML(fetched.html, url);
    res.json({ ok: true, url, ...product, used: { host: fetched.host, needsJS: fetched.needsJS, wait: fetched.wait } });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

app.listen(PORT, () => {
  console.log(`Backend running on :${PORT}`);
});
