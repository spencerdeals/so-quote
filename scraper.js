// scraper.js – fetch product data with browser-like headers
const fetch = require("node-fetch");
const cheerio = require("cheerio");

async function scrapeProduct(url) {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Cache-Control": "no-cache",
      },
    });

    if (!res.ok) {
      return { title: `Fetch failed (${res.status})`, firstCost: 0, url };
    }

    const html = await res.text();
    const $ = cheerio.load(html);

    // Try to find product title
    let title =
      $("h1").first().text().trim() ||
      $("meta[property='og:title']").attr("content") ||
      "Unknown product";

    // Try to find price (common patterns)
    let priceText =
      $('[data-test="price"]').first().text().trim() ||
      $('[class*="price"]').first().text().trim() ||
      $("meta[property='og:price:amount']").attr("content") ||
      "";

    let firstCost = 0;
    if (priceText) {
      const match = priceText.replace(/[^0-9.]/g, "");
      firstCost = parseFloat(match) || 0;
    }

    return { title, firstCost, url };
  } catch (err) {
    return { title: "Scraper error", firstCost: 0, url, error: err.message };
  }
}

module.exports = { scrapeProduct };
