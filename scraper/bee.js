// scraper/bee.js — accurate price (prefers core price), clean name, variant, image
import axios from "axios";

const BEE_BASE = "https://app.scrapingbee.com/api/v1";
const BEE_KEY = process.env.SCRAPINGBEE_API_KEY;

const stripHtml = (raw) => raw.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
const toNumber = (s) => Number(String(s || "").replace(/[^\d.]/g, "") || NaN);

function extractBetween(html, startId) {
  const idx = html.indexOf(startId);
  if (idx < 0) return "";
  return html.slice(idx, idx + 5000); // read a window near the price block
}

function extractName(html) {
  const name =
    html.match(/<meta\s+(?:property|name)=["']og:title["']\s+content=["']([^"']+)["']/i)?.[1] ||
    html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || "";
  return stripHtml(name);
}

function extractPrice(html) {
  // 1) Prefer the core price block (avoid strikethrough a-text-price)
  const core = extractBetween(html, 'id="corePriceDisplay_desktop_feature_div"') ||
               extractBetween(html, 'id="corePrice_feature_div"');
  let m =
    core.match(/class="a-price[^"]*">\s*<span[^>]*class="a-offscreen"[^>]*>\s*\$?\s*([\d,]+(?:\.\d{2})?)\s*<\/span>/i) ||
    html.match(/id="priceblock_(?:dealprice|ourprice|saleprice)"[^>]*>\s*\$?\s*([\d,]+(?:\.\d{2})?)/i);
  if (m) return toNumber(m[1]);

  // 2) JSON-LD offers.price (skip if it's clearly a strikethrough block)
  const jsonPrice =
    html.match(/"offers"\s*:\s*\{[\s\S]*?"price"\s*:\s*"(\d[\d.,]*)"/i)?.[1] ||
    html.match(/"price"\s*:\s*"(\d[\d.,]*)"\s*,\s*"priceCurrency"\s*:\s*"USD"/i)?.[1];
  if (jsonPrice) return toNumber(jsonPrice);

  // 3) Generic fallback near the core area (avoid a-text-price: strikethrough)
  const generic =
    core.replace(/a-text-price/gi, "") // drop strikethrough sections
        .match(/\$ ?(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/);
  if (generic) return toNumber(generic[1]);

  // 4) Last resort: first currency-like number on page (can be wrong)
  const last = html.match(/\$ ?(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/);
  return last ? toNumber(last[1]) : null;
}

function extractVariant(html) {
  const picks = [];
  const selMatches = html.match(/id="variation_[^"]+"\s*[^>]*>[\s\S]*?class="selection"[^>]*>([\s\S]*?)<\/[^>]+>/gi);
  if (selMatches) {
    for (const m of selMatches) {
      const val = stripHtml(m.replace(/^[\s\S]*class="selection"[^>]*>/i, "").replace(/<\/[^>]+>[\s\S]*$/i, ""));
      if (val) picks.push(val);
    }
  }
  const twister = html.match(/class="a-button-selected"[\s\S]*?class="a-button-text"[^>]*>([\s\S]*?)<\/span>/i)?.[1];
  if (twister) picks.push(stripHtml(twister));
  const color = html.match(/"color"\s*:\s*"([^"]+)"/i)?.[1];
  const size  = html.match(/"size"\s*:\s*"([^"]+)"/i)?.[1];
  if (color) picks.push(color);
  if (size)  picks.push(size);
  return [...new Set(picks.filter(Boolean))].join(" • ");
}

function extractImage(html) {
  const og = html.match(/<meta\s+(?:property|name)=["']og:image["']\s+content=["']([^"']+)["']/i)?.[1];
  if (og) return og;
  const link = html.match(/<link\s+rel=["']image_src["']\s+href=["']([^"']+)["']/i)?.[1];
  if (link) return link;
  const jsonStr = html.match(/"image"\s*:\s*"(https?:[^"]+)"/i)?.[1];
  if (jsonStr) return jsonStr;
  const jsonArr = html.match(/"image"\s*:\s*\[\s*"(https?:[^"]+)"/i)?.[1];
  if (jsonArr) return jsonArr;
  const cdn = html.match(/https?:\/\/images-(?:na|eu|fe)\.ssl-images-amazon\.com\/[^"' ]+\.(?:jpg|jpeg|png|webp)/i)?.[0];
  return cdn || "";
}

function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }

async function fetchWithBee(targetUrl, { waitMs = 3000, retries = 2 } = {}) {
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
      const res = await axios.get(`${BEE_BASE}?${params}`, { responseType: "text", validateStatus: () => true });
      const beeStatus = Number(res.headers["scrapingbee-status-code"]) || res.status;
      if (beeStatus >= 200 && beeStatus < 300) return res.data;

      const beeErr = res.headers["scrapingbee-error"] || res.headers["x-scrapingbee-error"] ||
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
  const image = extractImage(html);

  let fallbackName = name;
  try {
    const u = new URL(targetUrl);
    if (!fallbackName) {
      fallbackName = u.pathname.split("/").filter(Boolean).slice(0, -1).join(" ").replace(/[-_]/g, " ") ||
                     `${u.hostname.replace(/^www\./, "")} item (name not found)`;
    }
  } catch {
    if (!fallbackName) fallbackName = "Item (name not found)";
  }

  return { name: fallbackName.trim(), price, variant: variant || "", image, htmlSnippet: html.slice(0, 1000) };
}
