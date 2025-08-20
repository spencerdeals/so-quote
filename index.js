import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import * as cheerio from "cheerio";

const app = express();
app.use(cors());
app.use(express.json({ limit: "4mb" }));

const VERSION = "InstantImport3-alpha-titles";

app.get(["/", "/health"], (_req, res) => {
  res.json({ ok: true, version: VERSION, calc: "price-sum", time: new Date().toISOString() });
});

/* ---------- Helpers ---------- */
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36";
const ACCEPT_LANG = "en-US,en;q=0.9";

function parseMoney(str) {
  if (!str) return undefined;
  const cleaned = String(str).replace(/[^0-9.,]/g, "");
  const normalized = cleaned.replace(/,(?=\d{3}(\D|$))/g, "");
  const n = parseFloat(normalized.replace(/,/g, "."));
  return Number.isFinite(n) ? n : undefined;
}
function first(...vals) {
  for (const v of vals) if (v !== undefined && v !== null && v !== "") return v;
  return undefined;
}
function cleanTitle(t) {
  if (!t) return undefined;
  let s = String(t).replace(/\s+/g, " ").trim();
  // Common retailer noise
  s = s.replace(/^Amazon\.com:\s*/i, "").replace(/\s*[-–]\s*Amazon\.com$/i, "");
  s = s.replace(/\s*\|\s*Wayfair\s*$/i, "");
  return s || undefined;
}
async function fetchHtml(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 10000);
  try {
    const r = await fetch(url, {
      headers: { "user-agent": UA, "accept-language": ACCEPT_LANG, referer: "https://www.google.com/" },
      signal: ctrl.signal,
    });
    if (!r.ok) return null;
    return await r.text();
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

/* ---------- Title extraction ---------- */
function extractTitleFromLd($) {
  const scripts = $('script[type="application/ld+json"]');
  for (let i = 0; i < scripts.length; i++) {
    try {
      const raw = $(scripts[i]).contents().text();
      const data = JSON.parse(raw);
      const nodes = Array.isArray(data) ? data : [data];
      for (const node of nodes) {
        if (!node) continue;
        const types = Array.isArray(node["@type"]) ? node["@type"] : [node["@type"]];
        if (types && types.includes("Product")) {
          const t = cleanTitle(node.name);
          if (t) return t;
        }
      }
    } catch {}
  }
  return undefined;
}
function extractMetaTitle($) {
  const candidates = [
    'meta[property="og:title"]',
    'meta[name="og:title"]',
    'meta[name="twitter:title"]',
    'meta[property="twitter:title"]',
  ];
  for (const sel of candidates) {
    const v = $(sel).attr("content");
    const t = cleanTitle(v);
    if (t) return t;
  }
  return undefined;
}
function extractDomTitle($, url) {
  const host = (() => {
    try { return new URL(url).hostname.toLowerCase(); } catch { return ""; }
  })();

  // Amazon specific
  if (host.includes("amazon.")) {
    const t1 = cleanTitle($("#productTitle").text());
    if (t1) return t1;
    const t2 = cleanTitle($("#titleSection").text());
    if (t2) return t2;
  }
  // Generic fallbacks
  const h1 = cleanTitle($("h1").first().text());
  if (h1) return h1;
  const docTitle = cleanTitle($("title").first().text());
  if (docTitle) return docTitle;
  return undefined;
}
function guessFromUrl(url) {
  try {
    const p = new URL(url).pathname.split("/").filter(Boolean);
    const last = p[p.length - 1] || url;
    return decodeURIComponent(last.replace(/[-_]/g, " ")).slice(0, 120);
  } catch {
    return url;
  }
}
function extractTitle($, html, url) {
  return (
    extractTitleFromLd($) ||
    extractMetaTitle($) ||
    extractDomTitle($, url) ||
    guessFromUrl(url)
  );
}

/* ---------- Price extraction (kept from earlier) ---------- */
function extractPriceFromLd($) {
  const scripts = $('script[type="application/ld+json"]');
  for (let i = 0; i < scripts.length; i++) {
    try {
      const raw = $(scripts[i]).contents().text();
      const data = JSON.parse(raw);
      const nodes = Array.isArray(data) ? data : [data];
      for (const node of nodes) {
        const types = Array.isArray(node["@type"]) ? node["@type"] : [node["@type"]];
        if (types && types.includes("Product")) {
          const offer = Array.isArray(node.offers) ? node.offers[0] : node.offers;
          const p = first(offer?.price, node?.price, offer?.lowPrice, offer?.highPrice);
          const parsed = parseMoney(p);
          if (parsed) return parsed;
        }
      }
    } catch {}
  }
  return undefined;
}
function extractPriceFromMeta($) {
  const tryMeta = (...sels) => {
    for (const s of sels) {
      const v = $(s).attr("content");
      const n = parseMoney(v);
      if (n) return n;
    }
    return undefined;
  };
  return tryMeta(
    'meta[itemprop="price"]',
    'meta[property="product:price:amount"]',
    'meta[name="twitter:data1"]'
  );
}
function extractPriceBySelectors($) {
  const candidates = [
    "#corePrice_feature_div .a-offscreen", // Amazon
    ".a-price .a-offscreen",              // Amazon alt
    ".price", ".product-price", ".sale-price", ".current-price", ".our-price",
    "[data-price]", "[data-product-price]"
  ];
  for (const sel of candidates) {
    const t = $(sel).first().text();
    const n = parseMoney(t);
    if (n) return n;
  }
  return undefined;
}
function extractPriceByRegex(html) {
  const rx = /(?:\bprice\b|"price"\s*[:=]|\$)\D*([0-9][0-9,]*\.?[0-9]{0,2})/i;
  const m = html.match(rx);
  if (m) return parseMoney(m[1]);
  return undefined;
}

async function scrape(url) {
  const html = await fetchHtml(url);
  if (!html) return { title: guessFromUrl(url), unitPrice: undefined };
  const $ = cheerio.load(html);
  const title = extractTitle($, html, url);
  const unitPrice =
    extractPriceFromLd($) ||
    extractPriceFromMeta($) ||
    extractPriceBySelectors($) ||
    extractPriceByRegex(html);
  return { title, unitPrice };
}

/* ---------- API ---------- */
app.post("/enrich", async (req, res) => {
  const items = Array.isArray(req.body?.items) ? req.body.items : [];
  const urls = items.map(x => String(x.url || "")).filter(Boolean);
  const out = await Promise.all(urls.map(async (u) => {
    try { return { url: u, ...(await scrape(u)) }; }
    catch { return { url: u, title: guessFromUrl(u), unitPrice: undefined }; }
  }));
  res.json({ ok: true, items: out, source: "enrich" });
});

app.post("/quote", async (req, res) => {
  const raw = Array.isArray(req.body?.items) ? req.body.items : [];
  if (String(req.query.enrichOnly || "") === "1") {
    const urls = raw.map(x => String(x.url || ""));
    const out = await Promise.all(urls.map(async (u) => {
      try { return { url: u, ...(await scrape(u)) }; }
      catch { return { url: u, title: guessFromUrl(u), unitPrice: undefined }; }
    }));
    return res.json({ ok: true, items: out, source: "quote-enrichOnly" });
  }

  const filled = await Promise.all(raw.map(async (it) => {
    const qty = Math.max(1, parseInt(it.qty || 1, 10));
    let unitPrice = Number.isFinite(it.unitPrice) ? Number(it.unitPrice) : undefined;
    let title = it.title;
    if (!unitPrice || !title) {
      const s = await scrape(String(it.url || ""));
      unitPrice = unitPrice || s.unitPrice;
      title = title || s.title;
    }
    return {
      url: String(it.url || ""),
      title: title || guessFromUrl(it.url),
      qty,
      unitPrice: Number.isFinite(unitPrice) ? unitPrice : 0,
      notes: String(it.notes || ""),
    };
  }));

  const itemsTotal = filled.reduce((s, it) => s + (it.unitPrice * it.qty), 0);
  const shipping = 0, fees = 0;
  const grand = itemsTotal + shipping + fees;

  res.json({
    ok: true,
    items: filled,
    summary: { totals: { items: itemsTotal, shipping, fees, grand } },
    payment: { link: null }
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on :${PORT} v=${VERSION}`));
