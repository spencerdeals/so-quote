// scraper/bee.js
import axios from "axios";

const BEE_BASE = "https://app.scrapingbee.com/api/v1";
const BEE_KEY = process.env.SCRAPINGBEE_API_KEY;

function extractNamePrice(html) {
  const nameMatch =
    html.match(/<meta\s+property="og:title"\s+content="([^"]+)"/i)?.[1] ||
    html.match(/<h1[^>]*>(.*?)<\/h1>/i)?.[1] ||
    "";

  const priceMatch =
    html.match(/"price"\s*:\s*"(\d[\d.,]*)"/i)?.[1] ||
    html.match(/data-price="(\d[\d.,]*)"/i)?.[1] ||
    html.match(/class="a-offscreen">\$?(\d[\d.,]*)</i)?.[1] ||
    html.match(/itemprop="price"[^>]*content="(\d[\d.,]*)"/i)?.[1] ||
    html.match(/\$ ?(\d{1,3}(?:[,]\d{3})*(?:\.\d{2})?)/)?.[1] ||
    "";

  const name = nameMatch.toString().replace(/\s+/g, " ").trim();
  const price = priceMatch ? Number(priceMatch.replace(/[,$]/g, "")) : null;
  return { name, price };
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function fetchWithBee(targetUrl, {
  waitMs = 1500,
  waitFor = ".a-price,.product-price,.price,.ProductPrice",
  retries = 3,
} = {}) {
  if (!BEE_KEY) throw new Error("Missing SCRAPINGBEE_API_KEY");

  const params = [
    `api_key=${BEE_KEY}`,
    `url=${encodeURIComponent(targetUrl)}`,
    "premium_proxy=true",
    "country_code=us",
    "render_js=true",
    `wait=${waitMs}`,
    `wait_for=${encodeURIComponent(waitFor)}`,
    "block_resources=false",
    `custom_headers[User-Agent]=${encodeURIComponent(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0 Safari/537.36"
    )}`,
    "timeout=30000"
  ].join("&");

  let attempt = 0;
  while (true) {
    try {
      const res = await axios.get(`${BEE_BASE}?${params}`, {
        responseType: "text",
        validateStatus: () => true
      });
      const beeStatus = Number(res.headers["scrapingbee-status-code"]) || res.status;

      if (beeStatus >= 200 && beeStatus < 300) return res.data;

      if ((beeStatus >= 500 && beeStatus < 600) || beeStatus === 429) {
        if (attempt >= retries) throw new Error(`Bee error ${beeStatus} after ${retries + 1} tries`);
        attempt++;
        await sleep(400 * Math.pow(2, attempt));
        continue;
      }
      throw new Error(`Bee non-retryable error: ${beeStatus}`);
    } catch (err) {
      if (attempt >= retries) throw err;
      attempt++;
      await sleep(400 * Math.pow(2, attempt));
    }
  }
}

export async function scrapeNameAndPrice(targetUrl) {
  const html = await fetchWithBee(targetUrl);
  const { name, price } = extractNamePrice(html);

  let fallbackName = name;
  try {
    const u = new URL(targetUrl);
    if (!fallbackName) {
      fallbackName =
        u.pathname.split("/").filter(Boolean).slice(0, -1).join(" ").replace(/[-_]/g, " ") ||
        `${u.hostname.replace(/^www\./, "")} item (name not found)`;
    }
  } catch {
    if (!fallbackName) fallbackName = "Item (name not found)";
  }

  return { name: fallbackName.trim(), price, htmlSnippet: html.slice(0, 4000) };
}
