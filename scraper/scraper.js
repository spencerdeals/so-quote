// scraper/scraper.js — Scraper B powered by ScrapingBee
const axios = require("axios");
const cheerio = require("cheerio");

const BEE_ENDPOINT = "https://app.scrapingbee.com/api/v1/";
const BEE_KEY = process.env.SCRAPINGBEE_API_KEY;

function parsePrice(text) {
  if (!text) return null;
  const m = (text + "").replace(/[, ]+/g, "").match(/\$?(-?\d+(?:\.\d{2})?)/);
  return m ? parseFloat(m[1]) : null;
}

async function fetchHtmlWithBee(url) {
  if (!BEE_KEY) {
    throw new Error("Missing SCRAPINGBEE_API_KEY");
  }
  const { data } = await axios.get(BEE_ENDPOINT, {
    params: {
      api_key: BEE_KEY,
      url,
      render_js: "true",         // render client-side JS for dynamic sites
      block_resources: "true",   // faster, cheaper
      premium_proxy: "true"      // fewer blocks on retail sites
    },
    timeout: 30000,
    validateStatus: s => s >= 200 && s < 400,
  });
  return typeof data === "string" ? data : data.toString();
}

async function scrape(url) {
  const html = await fetchHtmlWithBee(url);
  const $ = cheerio.load(html);

  const title =
    $('meta[property="og:title"]').attr("content") ||
    $("h1").first().text().trim() ||
    $('meta[name="title"]').attr("content") ||
    $('meta[name="twitter:title"]').attr("content") ||
    null;

  const image =
    $('meta[property="og:image"]').attr("content") ||
    $('meta[name="twitter:image"]').attr("content") ||
    $("img").first().attr("src") ||
    null;

  const variant =
    $('select[name*="variant"], select[id*="variant"]').find("option:selected").text().trim() ||
    $('[data-variant], .product-variant, .variant').first().text().trim() ||
    null;

  const priceText =
    $('meta[property="product:price:amount"]').attr("content") ||
    $('[itemprop="price"]').attr("content") ||
    $('[data-price], .price, .product-price, .money').first().text().trim() ||
    null;
  const price = parsePrice(priceText);

  return { url, title, image, variant, price, priceText };
}

module.exports = { scrape };
