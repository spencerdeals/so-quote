// scraper.js
import fetch from "node-fetch";
import * as cheerio from "cheerio";

export async function scrapeProduct(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
    const html = await res.text();
    const $ = cheerio.load(html);

    // Generic fallback
    let title = $("h1").first().text().trim();
    let priceText = $('[class*="price"], .price, [data-test="product-price"]').first().text().trim();

    // Extract number from price string
    let price = 0;
    if (priceText) {
      let match = priceText.replace(/[^0-9.]/g, "");
      price = parseFloat(match);
    }

    return {
      title: title || "Unknown Product",
      price: price || 0,
      url
    };
  } catch (err) {
    console.error("Scrape error:", err);
    return { title: "Error fetching", price: 0, url };
  }
}
