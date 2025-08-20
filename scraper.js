// scraper.js (CommonJS) — resilient price extractor with anti-bot fallback
const cheerio = require("cheerio");

// Rendered-text fallback (public read-only proxy). We only fetch and parse text.
const TEXT_FALLBACK_PREFIX = "https://r.jina.ai/http://"; // e.g., https://r.jina.ai/http://www.site.com/p/...

async function fetchHtml(url) {
  // Node 20 global fetch (undici)
  const res = await fetch(url, {
    redirect: "follow",
    headers: {
      // A realistic desktop browser profile + language headers helps on many retail sites
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      "accept":
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      "accept-language": "en-US,en;q=0.9",
      "cache-control": "no-cache",
      "pragma": "no-cache",
      "upgrade-insecure-requests": "1",
      "sec-fetch-dest": "document",
      "sec-fetch-mode": "navigate",
      "sec-fetch-site": "none",
      "sec-fetch-user": "?1",
      // Some CDNs like having a referrer
      "referer": new URL(url).origin + "/",
    },
  });

  const html = await res.text();
  return { status: res.status, html };
}

function toNum(txt) {
  const n = parseFloat(String(txt).replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function extractFromDom(html) {
  const $ = cheerio.load(html);

  // Title
  const title =
    $("h1").first().text().trim() ||
    $('meta[property="og:title"]').attr("content") ||
    $("title").first().text().trim() ||
    "Item";

  // 1) Prefer Sale/Now text (Ashley / C&B often show "Sale $1,954.00")
  const saleNode = $('*:contains("Sale"), *:contains("Now"), *:contains("Today")')
    .filter((_, el) => /\$\s*\d[\d,\.]*/.test($(el).text()))
    .first();
  if (saleNode.length) {
    const m = saleNode.text().match(/\$\s*\d[\d,\.]*/);
    if (m) return { title, firstCost: toNum(m[0]) };
  }

  // 2) Meta prices (many sites expose it)
  const metaPrice =
    Number($('meta[itemprop="price"]').attr("content")) ||
    Number($('meta[property="product:price:amount"]').attr("content")) ||
    0;
  if (metaPrice) return { title, firstCost: metaPrice };

  // 3) Common price containers
  const containers = [
    '[data-testid*="price"]',
    '[data-test*="price"]',
    '[class*="price"]',
    '[class*="Price"]',
    ".price",
    ".sale",
    ".salesprice",
    ".product-price",
    ".final-price",
  ].join(",");
  const contText = $(containers).text();
  const m2 = contText.match(/\$\s*\d[\d,\.]*/);
  if (m2) return { title, firstCost: toNum(m2[0]) };

  // 4) JSON-LD offers
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

  // 5) Last resort: first currency on page
  const any = $("body").text().match(/\$\s*\d[\d,\.]*/);
  if (any) return { title, firstCost: toNum(any[0]) };

  return { title, firstCost: 0 };
}

async function scrapeProduct(url) {
  try {
    // 1) Primary HTML fetch
    const { status, html } = await fetchHtml(url);

    // Blocked pages often render this phrase or return 403
    const blocked =
      status >= 400 ||
      /Access to this page has been denied|verify you are human|blocked/i.test(html);

    if (!blocked) {
      const { title, firstCost } = extractFromDom(html);
      if (firstCost) return { title, firstCost, url };
    }

    // 2) Fallback: rendered text proxy (read-only)
    // NOTE: This returns text; we regex the first $1234.56 we find.
    const fbUrl =
      TEXT_FALLBACK_PREFIX +
      url.replace(/^https?:\/\//i, ""); // ensure http:// after prefix
    const fbRes = await fetch(fbUrl, { headers: { "accept-language": "en-US,en;q=0.9" } });
    const text = await fbRes.text();

    // Try a few price patterns, prefer "Sale $X" if present
    let mSale = text.match(/Sale\s*\$[\s\d,\.]+/i);
    if (mSale) {
      const m = mSale[0].match(/\$\s*\d[\d,\.]*/);
      if (m) return { title: extractTitleFromText(text), firstCost: toNum(m[0]), url };
    }
    const mAny = text.match(/\$\s*\d[\d,\.]*/);
    if (mAny) {
      return { title: extractTitleFromText(text), firstCost: toNum(mAny[0]), url };
    }

    // Nothing found
    return { title: "Access blocked", firstCost: 0, url };
  } catch (e) {
    console.error("scrapeProduct error:", e?.message || e);
    return { title: "Item", firstCost: 0, url };
  }
}

function extractTitleFromText(text) {
  // crude: first non-empty line that looks like a product title
  const lines = text.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  return lines.find((s) => s.length > 10 && s.length < 140) || "Item";
}

module.exports = { scrapeProduct };
