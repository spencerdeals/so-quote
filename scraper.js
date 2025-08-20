// scraper.js (CommonJS) — robust retail price extractor (Ashley, C&B, etc.)
const cheerio = require("cheerio");

// Node 18+ has global fetch
async function scrapeProduct(url) {
  try {
    const res = await fetch(url, {
      headers: {
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
        "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
      }
    });
    const html = await res.text();
    const $ = cheerio.load(html);

    const title =
      $("h1").first().text().trim() ||
      $('meta[property="og:title"]').attr("content") ||
      $("title").first().text().trim() ||
      "Item";

    // 1) Prefer SALE / NOW price (Ashley & Crate often show "Sale $1,954.00")
    const saleNode = $('*:contains("Sale"), *:contains("Now"), *:contains("Today")')
      .filter((_, el) => /\$\s*\d[\d,\.]*/.test($(el).text()))
      .first();
    if (saleNode.length) {
      const m = saleNode.text().match(/\$\s*\d[\d,\.]*/);
      if (m) {
        const p = toNum(m[0]);
        if (p) return { title, firstCost: p, url };
      }
    }

    // 2) Common price containers
    const containers = [
      '[data-testid*="price"]',
      '[data-test*="price"]',
      '[class*="price"]',
      '[class*="Price"]',
      ".price", ".sale", ".salesprice", ".product-price", ".final-price",
      'meta[itemprop="price"]', 'meta[property="product:price:amount"]'
    ].join(",");
    // direct meta content price
    const metaPrice =
      Number($('meta[itemprop="price"]').attr("content")) ||
      Number($('meta[property="product:price:amount"]').attr("content")) || 0;
    if (metaPrice) return { title, firstCost: metaPrice, url };

    const contText = $(containers).text();
    const m2 = contText.match(/\$\s*\d[\d,\.]*/);
    if (m2) {
      const p = toNum(m2[0]);
      if (p) return { title, firstCost: p, url };
    }

    // 3) JSON-LD offers
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
    if (ldPrice) return { title, firstCost: ldPrice, url };

    // 4) Last resort: first currency on the whole page
    const any = $("body").text().match(/\$\s*\d[\d,\.]*/);
    if (any) {
      const p = toNum(any[0]);
      if (p) return { title, firstCost: p, url };
    }

    return { title, firstCost: 0, url };
  } catch (e) {
    console.error("scrapeProduct error:", e?.message || e);
    return { title: "Item", firstCost: 0, url };
  }
}

function toNum(txt) {
  const n = parseFloat(String(txt).replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

module.exports = { scrapeProduct };
