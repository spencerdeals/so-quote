// scraper/bee.js — returns clean name, price, and variant
import axios from "axios";

const BEE_BASE = "https://app.scrapingbee.com/api/v1";
const BEE_KEY = process.env.SCRAPINGBEE_API_KEY;

const stripHtml = (raw) => raw.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();

function extractName(html) {
  const name =
    html.match(/<meta\s+property="og:title"\s+content="([^"]+)"/i)?.[1] ||
    html.match(/<h1[^>]*>(.*?)<\/h1>/i)?.[1] || "";
  return stripHtml(name);
}

function extractPrice(html) {
  const price =
    html.match(/"price"\s*:\s*"(\d[\d.,]*)"/i)?.[1] ||              // JSON-LD
    html.match(/itemprop="price"[^>]*content="(\d[\d.,]*)"/i)?.[1] ||
    html.match(/class="a-offscreen">\$?(\d[\d.,]*)</i)?.[1] ||      // Amazon
    html.match(/data-price="(\d[\d.,]*)"/i)?.[1] ||
    html.match(/\$ ?(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/)?.[1] || "";
  return price ? Number(price.replace(/[,$]/g, "")) : null;
}

function extractVariant(html) {
  // Amazon common selected variant nodes:
  //   #variation_color_name .selection
  //   #variation_size_name .selection
  //   #variation_style_name .selection
  //   .twister .a-button-selected .a-button-text
  const picks = [];

  // #variation_* .selection → "Dark Gray" / "Queen" / "Right Sitting Chaise"
  const selMatches = html.match(/id="variation_[^"]+"\s*[^>]*>[\s\S]*?class="selection"[^>]*>([\s\S]*?)<\/[^>]+>/gi);
  if (selMatches) {
    for (const m of selMatches) {
      const val = stripHtml(m.replace(/^[\s\S]*class="selection"[^>]*>/i, "").replace(/<\/[^>]+>[\s\S]*$/i, ""));
      if (val) picks.push(val);
    }
  }

  // Twister selected pill text
  const twister = html.match(/class="a-button-selected"[\s\S]*?class="a-button-text"[^>]*>([\s\S]*?)<\/span>/i)?.[1];
  if (twister) {
    const t = stripHtml(twister);
    if (t) picks.push(t);
  }

  // JSON-LD hints (color/size) if present
  const color = html.match(/"color"\s*:\s*"([^"]+)"/i)?.[1];
  const size  = html.match(/"size"\s*:\s*"([^"]+)"/i)?.[1];
  if (color) picks.push(color);
  if (size)  picks.push(size);

  // Deduplicate and join
  const uniq = [...new Set(picks.filter(Boolean))];
  const variant = uniq.join(" • ");
  return variant || ""; // empty string if none found
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function fetchWithBee(targetUrl, { waitMs = 2500, retries = 2 } = {}) {
  if (!BEE_KEY) throw new Error("Missing SCRAPINGBEE_API_KEY");

  const params = [
    `api_key=${BEE_KEY}`,
    `url=${encodeURIComponent(targetUrl)}`,
    "premium_proxy=true",
    "country_code=us",
    "render_js=true",
    `wait=${waitMs}`,
    "block_resources=false",
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

      const beeErr =
        res.headers["scrapingbee-error"] ||
        res.headers["x-scrapingbee-error"] ||
        (typeof res.data === "string" ? res.data.slice(0, 500) : JSON.stringify(res.data || {}));
      const msg = `Bee error ${beeStatus}${beeErr ? `: ${beeErr}` : ""}`;

      if ((beeStatus >= 500 && beeStatus < 600) || beeStatus === 429) {
        if (attempt >= retries) throw new Error(msg);
        attempt++; await sleep(400 * (2 ** attempt)); continue;
      }
      throw new Error(msg);
    } catch (err) {
      if (attempt >= retries) throw err;
      attempt++; await sleep(400 * (2 ** attempt));
    }
  }
}

export async function scrapeNameAndPrice(targetUrl) {
  const html = await fetchWithBee(targetUrl);
  const name = extractName(html);
  const price = extractPrice(html);
  const variant = extractVariant(html);

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

  return {
    name: fallbackName.trim(),
    price,
    variant,                          // <-- returned to frontend
    htmlSnippet: html.slice(0, 1000)
  };
}
