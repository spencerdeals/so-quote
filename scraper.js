// scraper.js
import fetch from "node-fetch";
import * as cheerio from "cheerio";

export async function scrapeProduct(url) {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });
    if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
    const html = await res.text();
    const $ = cheerio.load(html);

    // title
    let title = $("h1").first().text().trim();

    // ashley price selector
    let priceText =
      $('[data-testid="price-sale"]').first().text().trim() ||
      $('[data-testid="price-regular"]').first().text().trim() ||
      $('[class*="price"]').first().text().trim();

    // parse number
    let price = 0;
    if (priceText) {
      let match = priceText.replace(/[^0-9.]/g, "");
      price = parseFloat(match);
    }

    return {
      title: title || "Unknown Product",
      firstCost: price || 0,
      url,
    };
  } catch (err) {
    console.error("Scrape error:", err);
    return { title: "Error fetching", firstCost: 0, url };
  }
}
