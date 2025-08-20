const cheerio = require("cheerio");

async function scrapeProduct(url) {
  try {
    const res = await fetch(url, {
      headers: {
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
        "accept":
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
      }
    });
    const html = await res.text();
    const $ = cheerio.load(html);

    // Prefer “Sale $X”
    const saleNode = $('*:contains("Sale")')
      .filter((_, el) => /\$\s*\d[\d,\.]*/.test($(el).text()))
      .first();
    if (saleNode.length) {
      const m = saleNode.text().match(/\$\s*\d[\d,\.]*/);
      if (m) {
        const p = parseFloat(m[0].replace(/[^0-9.]/g, ""));
        if (p) return { title: extractTitle($), firstCost: p, url };
      }
    }

    // Common price containers
    const candidates = [
      '[data-testid*="price"]',
      '[class*="price"]',
      '[class*="Price"]',
      '.price', '.sale', '.product-price'
    ].join(",");
    const text = $(candidates).text();
    const m2 = text.match(/\$\s*\d[\d,\.]*/);
    let price = m2 ? parseFloat(m2[0].replace(/[^0-9.]/g, "")) : 0;

    // JSON-LD fallback
    if (!price) {
      $('script[type="application/ld+json"]').each((_, s) => {
        try {
          const data = JSON.parse($(s).html() || "{}");
          const arr = Array.isArray(data) ? data : [data];
          for (const d of arr) {
            if (d?.offers) {
              const candidate = Array.isArray(d.offers) ? d.offers[0]?.price : d.offers.price;
              if (candidate) {
                price = parseFloat(String(candidate).replace(/[^0-9.]/g, ""));
                if (price) return false;
              }
            }
          }
        } catch {}
      });
    }

    return { title: extractTitle($), firstCost: price || 0, url };
  } catch (e) {
    console.error("scrapeProduct error:", e?.message || e);
    return { title: "Item", firstCost: 0, url };
  }
}

function extractTitle($) {
  return $("h1").first().text().trim() || $("title").first().text().trim() || "Item";
}

module.exports = { scrapeProduct };
