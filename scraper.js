// scraper.js (CommonJS) — resilient price extractor for Ashley / retail sites
const cheerio = require("cheerio");

// Read-only text render fallback (no JS, good for anti-bot walls)
const TEXT_FALLBACK_PREFIX = "https://r.jina.ai/http://"; // e.g. https://r.jina.ai/http://www.site.com/...

/* ---------------- helpers ---------------- */
function toNum(txt) {
  const n = parseFloat(String(txt).replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function extractTitleFromText(text) {
  const lines = text.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  return lines.find(s => s.length > 10 && s.length < 140) || "Item";
}

/* ---------------- primary fetch ---------------- */
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

/* ---------------- DOM price extraction ---------------- */
function extractFromDom(url, html) {
  const $ = cheerio.load(html);

  const title =
    $("h1").first().text().trim() ||
    $('meta[property="og:title"]').attr("content") ||
    $("title").first().text().trim() ||
    "Item";

  // Ashley-specific selectors (common patterns)
  // Prefer visible "Sale" / "Now" price
  const ashleySale =
    $('[data-testid="price-sale"]').first().text().trim() ||
    $('[data-test*="price"]').filter((_, el) => /sale/i.test($(el).text())).first().text().trim() ||
    $('*:contains("Sale")').filter((_, el) => /\$\s*\d[\d,\.]*/.test($(el).text())).first().text().trim();

  if (ashleySale) {
    const m = ashleySale.match(/\$\s*\d[\d,\.]*/);
    if (m) return { title, firstCost: toNum(m[0]) };
  }

  // Regular / list price fallbacks
  const ashleyReg =
    $('[data-testid="price-regular"]').first().text().trim() ||
    $('[class*="price"]').first().text().trim() ||
    $('[data-testid*="price"]').first().text().trim();

  if (ashleyReg) {
    const m = ashleyReg.match(/\$\s*\d[\d,\.]*/);
    if (m) return { title, firstCost: toNum(m[0]) };
  }

  // Meta price (some sites expose it)
  const metaPrice =
    Number($('meta[itemprop="price"]').attr("content")) ||
    Number($('meta[property="product:price:amount"]').attr("content")) ||
    0;
  if (metaPrice) return { title, firstCost: metaPrice };

  // JSON-LD offers (generic)
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

  // Currency anywhere on page (last resort)
  const any = $("body").text().match(/\$\s*\d[\d,\.]*/);
  if (any) return { title, firstCost: toNum(any[0]) };

  // No price found
  return { title, firstCost: 0 };
}

/* ---------------- public API ---------------- */
async function scrapeProduct(url) {
  try {
    // 1) Primary fetch + DOM parse
    const { status, html } = await fetchHtml(url);
    const dom = extractFromDom(url, html);

    const looksBlocked =
      status >= 400 ||
      /access to this page has been denied|verify you are human|blocked/i.test(dom.title || html) ||
      dom.firstCost === 0;

    if (!looksBlocked && dom.firstCost) {
      return { title: dom.title, firstCost: dom.firstCost, url };
    }

    // 2) Forced fallback: text render proxy
    const fbUrl = TEXT_FALLBACK_PREFIX + url.replace(/^https?:\/\//i, "");
    const fbRes = await fetch(fbUrl, { headers: { "accept-language": "en-US,en;q=0.9" } });
    const text = await fbRes.text();

    // Prefer "Sale $..." or "Now $..."
    const saleHit = text.match(/(?:Sale|Now)\s*\$[\s\d,\.]+/i);
    if (saleHit) {
      const m = saleHit[0].match(/\$\s*\d[\d,\.]*/);
      if (m) return { title: extractTitleFromText(text), firstCost: toNum(m[0]), url };
    }

    // Otherwise first $number we see
    const anyHit = text.match(/\$\s*\d[\d,\.]*/);
    if (anyHit) {
      return { title: extractTitleFromText(text), firstCost: toNum(anyHit[0]), url };
    }

    return { title: dom.title || "Item", firstCost: 0, url };
  } catch (e) {
    console.error("scrapeProduct error:", e?.message || e);
    return { title: "Item", firstCost: 0, url };
  }
}

module.exports = { scrapeProduct };
