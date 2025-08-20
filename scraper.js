// scraper.js (CommonJS) — resilient price extractor w/ forced fallback
const cheerio = require("cheerio");

const TEXT_FALLBACK_PREFIX = "https://r.jina.ai/http://"; // e.g. https://r.jina.ai/http://www.site.com/...

function toNum(txt) {
  const n = parseFloat(String(txt).replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function extractFromDom(html) {
  const $ = cheerio.load(html);

  const title =
    $("h1").first().text().trim() ||
    $('meta[property="og:title"]').attr("content") ||
    $("title").first().text().trim() ||
    "Item";

  // Prefer “Sale/Now” style text
  const saleNode = $('*:contains("Sale"), *:contains("Now"), *:contains("Today")')
    .filter((_, el) => /\$\s*\d[\d,\.]*/.test($(el).text()))
    .first();
  if (saleNode.length) {
    const m = saleNode.text().match(/\$\s*\d[\d,\.]*/);
    if (m) return { title, firstCost: toNum(m[0]) };
  }

  // Meta price
  const metaPrice =
    Number($('meta[itemprop="price"]').attr("content")) ||
    Number($('meta[property="product:price:amount"]').attr("content")) ||
    0;
  if (metaPrice) return { title, firstCost: metaPrice };

  // Common containers
  const containers = [
    '[data-testid*="price"]','[data-test*="price"]',
    '[class*="price"]','[class*="Price"]',
    '.price','.sale','.salesprice','.product-price','.final-price'
  ].join(",");
  const contText = $(containers).text();
  const m2 = contText.match(/\$\s*\d[\d,\.]*/);
  if (m2) return { title, firstCost: toNum(m2[0]) };

  // JSON-LD offers
  let ldPrice = 0;
  $('script[type="application/ld+json"]').each((_, s) => {
    try {
      const data = JSON.parse($(s).html() || "{}");
      const arr = Array.isArray(data) ? data : [data];
      for (const d of arr) {
        if (d?.offers) {
          const cand = Array.isArray(d.offers) ? d.offers[0]?.price : d.offers.price;
          if (cand) {
            ldPrice = toNum(String(cand));
            if (ldPrice) return false;
          }
        }
      }
    } catch {}
  });
  if (ldPrice) return { title, firstCost: ldPrice };

  // Nothing found
  return { title, firstCost: 0 };
}

function extractTitleFromText(text) {
  // crude guess: first non-empty mid-length line
  const lines = text.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  return lines.find(s => s.length > 10 && s.length < 140) || "Item";
}

async function fetchHtml(url) {
  const res = await fetch(url, {
    redirect: "follow",
    headers: {
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      "accept":
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      "accept-language": "en-US,en;q=0.9",
      "upgrade-insecure-requests": "1",
      "cache-control": "no-cache",
      "pragma": "no-cache",
      "referer": new URL(url).origin + "/",
      "sec-fetch-dest": "document",
      "sec-fetch-mode": "navigate",
      "sec-fetch-site": "none",
      "sec-fetch-user": "?1"
    }
  });
  const html = await res.text();
  return { status: res.status, html };
}

async function scrapeProduct(url) {
  try {
    // 1) Primary fetch
    const { status, html } = await fetchHtml(url);
    const dom = extractFromDom(html);

    const looksBlocked =
      status >= 400 ||
      /access to this page has been denied|verify you are human|blocked/i.test(dom.title || html) ||
      dom.firstCost === 0;

    // If we got a price and it doesn't look blocked, use it
    if (!looksBlocked && dom.firstCost) {
      return { title: dom.title, firstCost: dom.firstCost, url };
    }

    // 2) Forced fallback when no price or blocked signals
    const fbUrl = TEXT_FALLBACK_PREFIX + url.replace(/^https?:\/\//i, "");
    const fbRes = await fetch(fbUrl, { headers: { "accept-language": "en-US,en;q=0.9" } });
    const text = await fbRes.text();

    // Prefer "Sale $..." / "Now $..."
    const saleHit = text.match(/(?:Sale|Now)\s*\$[\s\d,\.]+/i);
    if (saleHit) {
      const m = saleHit[0].match(/\$\s*\d[\d,\.]*/);
      if (m) return { title: extractTitleFromText(text), firstCost: toNum(m[0]), url };
    }
    // Otherwise the first $number we see
    const anyHit = text.match(/\$\s*\d[\d,\.]*/);
    if (anyHit) {
      return { title: extractTitleFromText(text), firstCost: toNum(anyHit[0]), url };
    }

    // Still nothing
    return { title: dom.title || "Item", firstCost: 0, url };
  } catch (e) {
    console.error("scrapeProduct error:", e?.message || e);
    return { title: "Item", firstCost: 0, url };
  }
}

module.exports = { scrapeProduct };
