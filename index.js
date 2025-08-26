// #alpha build — v3 (Hardened Wayfair/Amazon extraction + Debug)
// Endpoints: /health, /extractProduct, /extractPrice, /quote, /shopify/draft, /diag/extract
// Requires env: SCRAPINGBEE_API_KEY, SHOPIFY_SHOP, SHOPIFY_ACCESS_TOKEN

const express = require("express");
const cors = require("cors");
const { JSDOM } = require("jsdom");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.options("*", cors());
app.use(express.json({ limit: "2mb" }));

// ---------- Business rules ----------
const DEFAULT_US_SALES_TAX = 0.06625;
const DEFAULT_FREIGHT_PER_FT3 = 6.00; // container assumption
const CARD_FEE_RATE = 0.0325;
const DEFAULT_DUTY_UPHOLSTERED = 0.25;
const DEFAULT_VOLUME_FT3 = 11.33;
const FIXED_FEES_PER_SHIPMENT = 0;

function marginByVolume(totalFt3) {
  if (totalFt3 < 10) return 0.40;
  if (totalFt3 < 20) return 0.30;
  if (totalFt3 < 50) return 0.25;
  return 0.20;
}
function capByLanded(landed) {
  if (landed > 5000) return 0.15;
  if (landed > 3000) return 0.20;
  if (landed > 1000) return 0.25;
  return 1.0;
}
function roundTo95(n) {
  const rounded = Math.round(n / 0.05) * 0.05;
  const dollars = Math.floor(rounded);
  return Number((dollars + 0.95).toFixed(2));
}

// ---------- ScrapingBee fetch ----------
async function fetchWithScrapingBee(url, opts = {}) {
  const apiKey = process.env.SCRAPINGBEE_API_KEY;
  if (!apiKey) throw new Error("Missing SCRAPINGBEE_API_KEY");

  const host = safeHost(url);
  const isAmazon  = /(^|\.)amazon\./i.test(host);
  const isWayfair = /(^|\.)wayfair\./i.test(host);

  // Force JS rendering and a longer wait for hard sites
  const render_js = opts.render_js ?? (isAmazon || isWayfair);
  const wait = opts.wait ?? (isAmazon || isWayfair ? 2500 : 1200);

  const headers = {
    "User-Agent":
      opts.userAgent ||
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept-Language": opts.acceptLanguage || "en-US,en;q=0.9",
  };

  const sp = new URLSearchParams();
  sp.set("api_key", apiKey);
  sp.set("url", url);
  sp.set("country_code", "us");
  if (render_js) sp.set("render_js", "true");
  sp.set("wait", String(wait));
  sp.set("custom_headers", JSON.stringify(headers));
  // Premium/stealth proxies help on these sites. If your ScrapingBee plan supports it, uncomment:
  // sp.set("premium_proxy", "true");

  const apiUrl = `https://app.scrapingbee.com/api/v1?${sp.toString()}`;
  const res = await fetch(apiUrl);
  const html = await res.text();
  return { status: res.status, html, used: { render_js, wait, host } };
}

function safeHost(u) {
  try { return new URL(u).hostname; } catch { return ""; }
}

// ---------- Extraction helpers ----------
function parsePriceFromString(s) {
  const cleaned = String(s).replace(/[^\d.]/g, "");
  const n = parseFloat(cleaned);
  return isFinite(n) ? n : 0;
}

function pickFirstNonEmpty(...v) {
  for (const x of v) if (x !== undefined && x !== null && String(x).trim() !== "") return x;
  return null;
}

function extractJSONLDProduct(document) {
  const scripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));
  for (const s of scripts) {
    try {
      const json = JSON.parse(s.textContent || "{}");
      const arr = Array.isArray(json) ? json : [json];
      for (const node of arr) {
        if (!node || typeof node !== "object") continue;
        if ((node["@type"] && String(node["@type"]).toLowerCase().includes("product")) || node.offers) {
          // Normalize
          const title = node.name || null;
          const images = [];
          if (node.image) {
            if (Array.isArray(node.image)) images.push(...node.image);
            else if (typeof node.image === "string") images.push(node.image);
          }
          let price = null, currency = null;
          const offers = Array.isArray(node.offers) ? node.offers[0] : node.offers;
          if (offers) {
            price = offers.price || offers.lowPrice || offers.highPrice || null;
            if (typeof price === "string") price = parsePriceFromString(price);
            currency = offers.priceCurrency || null;
          }
          return { title, image: images[0] || null, price: isFinite(price) ? Number(price) : null, currency, source: "jsonld" };
        }
      }
    } catch {}
  }
  return null;
}

function extractTitleGeneric(document) {
  const og = document.querySelector("meta[property='og:title']")?.getAttribute("content");
  const h1 = document.querySelector("h1")?.textContent;
  const amz = document.querySelector("#productTitle")?.textContent;
  const titleTag = document.querySelector("title")?.textContent;
  return (pickFirstNonEmpty(amz, og, h1, titleTag) || "").trim();
}
function extractImageGeneric(document) {
  const og = document.querySelector("meta[property='og:image']")?.getAttribute("content");
  const linkImg = document.querySelector("link[rel='image_src']")?.getAttribute("href");
  const amz =
    document.querySelector("#landingImage")?.getAttribute("data-old-hires") ||
    document.querySelector("#imgTagWrapperId img")?.getAttribute("src");
  return pickFirstNonEmpty(og, linkImg, amz);
}
function extractPriceSelectors(document) {
  const sels = [
    // Amazon
    "#corePriceDisplay_desktop_feature_div .a-offscreen",
    "#corePrice_feature_div .a-offscreen",
    "#price_inside_buybox",
    "#priceblock_ourprice",
    "#priceblock_dealprice",
    "[itemprop=price]",
    "meta[itemprop=price]",
    "meta[property='product:price:amount']",
    // Wayfair
    "[data-hbkit-price]",
    // Generics
    ".price", ".sale-price", ".our-price", ".c-price", "[data-test*='price']"
  ];
  for (const sel of sels) {
    const el = document.querySelector(sel);
    if (!el) continue;
    const txt = el.getAttribute("content") || el.textContent || "";
    const p = parsePriceFromString(txt);
    if (isFinite(p) && p > 0) return { price: p, source: `selector:${sel}`, raw: txt };
  }
  return null;
}

// Deep JSON scan: find "price": 123 or "price": "123.45"
function scanJSONForPrice(html) {
  const results = [];
  const jsonScripts = html.match(/<script[^>]*type=["']application\/json["'][^>]*>[\s\S]*?<\/script>/gi) || [];
  for (const block of jsonScripts) {
    const body = block.replace(/^.*?>/s, "").replace(/<\/script>$/i, "");
    const hits = [...body.matchAll(/"price"\s*:\s*"?(\d{1,3}(?:,\d{3})*|\d+)(?:\.(\d{2}))?"?/gi)];
    for (const m of hits) {
      const n = parsePriceFromString(m[0]);
      if (n > 0) results.push(n);
    }
  }
  // Fallback regex on whole HTML (expensive but robust)
  if (!results.length) {
    const hits = [...html.matchAll(/(?:USD\s*)?\$?\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})|[0-9]+(?:\.[0-9]{2}))\s*(?:USD)?/gi)];
    for (const m of hits) {
      const n = parsePriceFromString(m[0]);
      if (n >= 5) results.push(n);
    }
  }
  if (!results.length) return null;
  // Heuristic: choose the smallest plausible price (> $5) to avoid bundles
  results.sort((a,b)=>a-b);
  return { price: results[0], source: "json-scan" };
}

function extractVariants(document) {
  const variants = [];
  const selects = Array.from(document.querySelectorAll("select"));
  for (const sel of selects) {
    const labelEl = sel.closest("label") || sel.previousElementSibling;
    const nameGuess = (labelEl?.textContent || sel.name || sel.id || "Option").trim();
    const options = Array.from(sel.querySelectorAll("option")).map(o => (o.textContent || "").trim()).filter(Boolean);
    if (options.length >= 2 && options.length <= 50) variants.push({ name: nameGuess, options });
  }
  const twister = document.querySelector("#twister, #variation_color_name, #variation_size_name");
  if (twister) {
    const labels = Array.from(twister.querySelectorAll("label, span.a-size-base"));
    const textOpts = labels.map(x => (x.textContent || "").trim()).filter(Boolean);
    if (textOpts.length > 1) variants.push({ name: "Variant", options: textOpts });
  }
  return variants;
}

function extractProductFromHTML(html, url) {
  const dom = new JSDOM(html);
  const { document } = dom.window;

  const debug = {};
  let title = null, image = null, price = null, currency = null, source = null;

  const ld = extractJSONLDProduct(document);
  if (ld) {
    ({ title } = ld);
    image = ld.image || null;
    price = ld.price ?? null;
    currency = ld.currency || null;
    source = ld.source;
  }

  if (!title)  title  = extractTitleGeneric(document);
  if (!image)  image  = extractImageGeneric(document);
  if (!price) {
    const sel = extractPriceSelectors(document);
    if (sel) { price = sel.price; source = sel.source; debug.selectorRaw = sel.raw
