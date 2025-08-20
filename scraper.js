// scraper.js (CommonJS) — hardened price extractor with Ashley-first fallback
const cheerio = require("cheerio");

const FALLBACK_HTTP  = "https://r.jina.ai/http://";
const FALLBACK_HTTPS = "https://r.jina.ai/https://";

const CURRENCY_RE = /\$\s*\d[\d,\.]*/;
const ACCESS_RE   = /access to this page has been denied|verify you are human|blocked/i;

// Common JSON-in-HTML keys we often see
const JSON_PRICE_KEYS = [
  /"salePrice"\s*:\s*"?([\d.,]+)"?/i,
  /"price"\s*:\s*"?([\d.,]+)"?/i,
  /"currentPrice"\s*:\s*"?([\d.,]+)"?/i,
  /"offerPrice"\s*:\s*"?([\d.,]+)"?/i
];

function toNum(s) { const n = parseFloat(String(s).replace(/[^0-9.]/g, "")); return Number.isFinite(n) ? n : 0; }
function firstCurrency(text) { const m = text.match(CURRENCY_RE); return m ? toNum(m[0]) : 0; }
function fallbackUrl(url) { const bare = url.replace(/^https?:\/\//i, ""); return (url.startsWith("https://") ? FALLBACK_HTTPS : FALLBACK_HTTP) + bare; }
function titleFromText(text) { const lines = text.split(/\r?\n/).map(s=>s.trim()).filter(Boolean); return lines.find(s => s.length > 10 && s.length < 140) || "Item"; }

async function fetchHtml(url) {
  const res = await fetch(url, {
    redirect: "follow",
    headers: {
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      "accept-language": "en-US,en;q=0.9",
      "upgrade-insecure-requests": "1",
      "cache-control": "no-cache",
      "pragma": "no-cache",
      "referer": new URL(url).origin + "/"
    }
  });
  const html = await res.text();
  return { status: res.status, html };
}

function scanJsonForPrice(html) {
  for (const rx of JSON_PRICE_KEYS) {
    const m = html.match(rx);
    if (m && m[1]) {
      const v = toNum(m[1]);
      if (v) return v;
    }
  }
  return 0;
}

function extractFromDom(html) {
  const $ = cheerio.load(html);

  const title =
    $("h1").first().text().trim() ||
    $('meta[property="og:title"]').attr("content") ||
    $("title").first().text().trim() || "Item";

  // JSON-LD offers first (often reliable)
  let ldPrice = 0;
  $('script[type="application/ld+json"]').each((_, s) => {
    try {
      const data = JSON.parse($(s).html() || "{}");
      const arr = Array.isArray(data) ? data : [data];
      for (const d of arr) {
        if (d?.offers) {
          const cand = Array.isArray(d.offers) ? d.offers[0]?.price : d.offers.price;
          if (cand) { ldPrice = toNum(cand); if (ldPrice) return false; }
        }
      }
    } catch {}
  });
  if (ldPrice) return { title, price: ldPrice };

  // “Sale/Now/Today $…”
  const saleText = $('*:contains("Sale"), *:contains("Now"), *:contains("Today")')
    .filter((_, el) => CURRENCY_RE.test($(el).text()))
    .first().text();
  if (saleText) {
    const n = firstCurrency(saleText);
    if (n) return { title, price: n };
  }

  // Meta price
  const meta =
    Number($('meta[itemprop="price"]').attr("content")) ||
    Number($('meta[property="product:price:amount"]').attr("content")) || 0;
  if (meta) return { title, price: meta };

  // Common containers
  const containers = [
    '[data-testid*="price"]','[data-test*="price"]',
    '[class*="price"]','[class*="Price"]',
    '.price','.sale','.salesprice','.product-price','.final-price'
  ].join(",");
  const block = $(containers).text();
  const n = firstCurrency(block);
  if (n) return { title, price: n };

  // Anywhere in body
  const any = firstCurrency($("body").text());
  if (any) return { title, price: any };

  return { title, price: 0 };
}

async function scrapeProduct(url) {
  try {
    const host = new URL(url).hostname;

    // --- Ashley: go straight to text-render fallback first ---
    if (host.includes("ashleyfurniture.com")) {
      const fbRes = await fetch(fallbackUrl(url), { headers: { "accept-language": "en-US,en;q=0.9" } });
      const text = await fbRes.text();

      // Prefer explicit phrases
      const sale = text.match(/(?:Sale|Now|Today)\s*\$[\s\d,\.]+/i);
      if (sale) {
        const n = firstCurrency(sale[0]);
        if (n) return { title: titleFromText(text), firstCost: n, url };
      }

      // Embedded JSON price keys
      const jp = scanJsonForPrice(text);
      if (jp) return { title: titleFromText(text), firstCost: jp, url };

      // First currency anywhere
      const any = firstCurrency(text);
      return { title: titleFromText(text), firstCost: any || 0, url };
    }

    // --- Others: DOM attempt first, then fallback ---
    const { status, html } = await fetchHtml(url);
    const dom = extractFromDom(html);
    let price = dom.price || scanJsonForPrice(html);
    const blocked = status >= 400 || ACCESS_RE.test(dom.title || html) || !price;

    if (!blocked && price) {
      return { title: dom.title, firstCost: price, url };
    }

    // Forced fallback
    const fbRes = await fetch(fallbackUrl(url), { headers: { "accept-language": "en-US,en;q=0.9" } });
    const text = await fbRes.text();

    const sale = text.match(/(?:Sale|Now|Today)\s*\$[\s\d,\.]+/i);
    if (sale) {
      const n = firstCurrency(sale[0]);
      if (n) return { title: titleFromText(text), firstCost: n, url };
    }
    const jp = scanJsonForPrice(text);
    if (jp) return { title: titleFromText(text), firstCost: jp, url };

    const any = firstCurrency(text);
    return { title: titleFromText(text), firstCost: any || 0, url };

  } catch (e) {
    console.error("scrapeProduct error:", e?.message || e);
    return { title: "Item", firstCost: 0, url };
  }
}

module.exports = { scrapeProduct };
