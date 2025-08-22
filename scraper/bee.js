// scraper/bee.js — Canonicalize Amazon /dp URL, wait for real DOM,
// accurate buy price (avoid strikethrough/widgets), plus name, variant, image.

import axios from "axios";

const BEE_BASE = "https://app.scrapingbee.com/api/v1";
const BEE_KEY  = process.env.SCRAPINGBEE_API_KEY;

const stripHtml = (raw) => String(raw || "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
const toNumber  = (s)   => Number(String(s || "").replace(/[^\d.]/g, "") || NaN);

function extractBetween(html, marker, span = 6000) {
  const idx = html.indexOf(marker);
  if (idx < 0) return "";
  return html.slice(idx, idx + span);
}

// Force Amazon ad/sponsored URLs to canonical /dp/ASIN, preserve th=1
function canonicalizeAmazonUrl(u) {
  try {
    const url = new URL(u);
    if (!/amazon\./i.test(url.hostname)) return u;

    // Prefer existing /dp/ASIN in the path
    const dp = url.pathname.match(/\/dp\/([A-Z0-9]{10})/i);
    let asin = dp?.[1];

    // Else try params (e.g., pd_rd_i)
    if (!asin) {
      const cand = url.searchParams.get("pd_rd_i") || "";
      if (/^[A-Z0-9]{10}$/i.test(cand)) asin = cand;
    }
    if (!asin) return u;

    const th = url.searchParams.get("th") === "1" ? "?th=1" : "";
    return `https://www.amazon.com/dp/${asin}${th}`;
  } catch {
    return u;
  }
}

function extractName(html) {
  const name =
    html.match(/<meta\s+(?:property|name)=["']og:title["']\s+content=["']([^"']+)["']/i)?.[1] ||
    html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || "";
  return stripHtml(name);
}

function extractPrice(html) {
  const core =
    extractBetween(html, 'id="corePriceDisplay_desktop_feature_div"') ||
    extractBetween(html, 'id="corePrice_feature_div"');

  // Prefer core buy price; remove strikethroughs (a-text-price)
  let m =
    core.replace(/a-text-price/gi, "")
        .match(/class="a-price[^"]*">\s*<span[^>]*class="a-offscreen"[^>]*>\s*\$?\s*([\d,]+(?:\.\d{2})?)\s*<\/span>/i) ||
    html.match(/id="priceblock_(?:dealprice|ourprice|saleprice)"[^>]*>\s*\$?\s*([\d,]+(?:\.\d{2})?)/i);
  if (m) return toNumber(m[1]);

  // JSON-LD price (USD)
  const jsonPrice =
    html.match(/"offers"\s*:\s*\{[\s\S]*?"price"\s*:\s*"(\d[\d.,]*)"/i)?.[1] ||
    html.match(/"price"\s*:\s*"(\d[\d.,]*)"\s*,\s*"priceCurrency"\s*:\s*"USD"/i)?.[1];
  if (jsonPrice) return toNumber(jsonPrice);

  // Fallback inside core
  const gen = core.replace(/a-text-price/gi, "").match(/\$ ?(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/);
  if (gen) return toNumber(gen[1]);

  // Last resort
  const last = html.match(/\$ ?(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/);
  return last ? toNumber(last[1]) : null;
}

function extractVariant(html) {
  const picks = [];
  const sel = html.match(/id="variation_[^"]+"\s*[^>]*>[\s\S]*?class="selection"[^>]*>([\s\S]*?)<\/[^>]+>/gi);
  if (sel) for (const m of sel) {
    const v = stripHtml(m.replace(/^[\s\S]*class="selection"[^>]*>/i, "").replace(/<\/[^>]+>[\s\S]*$/i, ""));
    if (v) picks.push(v);
  }
  const twist = html.match(/class="a-button-selected"[\s\S]*?class="a-button-text"[^>]*>([\s\S]*?)<\/span>/i)?.[1];
  if (twist) picks.push(stripHtml(twist));
  const color = html.match(/"color"\s*:\s*"([^"]+)"/i)?.[1];
  const size  = html.match(/"size"\s*:\s*"([^"]+)"/i)?.[1];
  if (color) picks.push(color);
  if (size)  picks.push(size);
  return [...new Set(picks.filter(Boolean))].join(" • ");
}

function extractImage(html) {
  const og   = html.match(/<meta\s+(?:property|name)=["']og:image["']\s+content=["']([^"']+)["']/i)?.[1];
  if (og) return og;
  const link = html.match(/<link\s+rel=["']image_src["']\s+href=["']([^"']+)["']/i)?.[1];
  if (link) return link;
  const j1   = html.match(/"image"\s*:\s*"(https?:[^"]+)"/i)?.[1];
  if (j1) return j1;
  const j2   = html.match(/"image"\s*:\s*\[\s*"(https?:[^"]+)"/i)?.[1];
  if (j2) return j2;
  const cdn  = html.match(/https?:\/\/images-(?:na|eu|fe)\.ssl-images-amazon\.com\/[^"' ]+\.(?:jpg|jpeg|png|webp)/i)?.[0];
  return cdn || "";
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function fetchWithBee(targetUrl, { waitMs = 3200, retries = 2 } = {}) {
  if (!BEE_KEY) throw new Error("Missing SCRAPINGBEE_API_KEY");

  // Normalize Amazon links (drops ad/ref params; keeps ?th=1)
  const normalizedUrl = canonicalizeAmazonUrl(targetUrl);

  const params = [
    `api_key=${BEE_KEY}`,
    `url=${encodeURIComponent(normalizedUrl)}`,
    "premium_proxy=true",
    "country_code=us",
    "render_js=true",
    `wait=${waitMs}`,
    // wait for real product DOM
    `wait_for=${encodeURIComponent("#productTitle, #corePriceDisplay_desktop_feature_div, #corePrice_feature_div")}`,
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
  const html    = await fetchWithBee(targetUrl);
  const name    = extractName(html);
  const price   = extractPrice(html);
  const variant = extractVariant(html);
  const image   = extractImage(html);

  let fallbackName = name;
  try {
    const u = new URL(targetUrl);
    if (!fallbackName) {
      fallbackName =
        u.pathname.split("/").filter(Boolean).slice(0, -1).join(" ").replace(/[-_]/g, " ") ||
        `${u.hostname.replace(/^www\./, "")} item (name not found)`;
    }
  } catch { if (!fallbackName) fallbackName = "Item (name not found)"; }

  return {
    name: fallbackName.trim(),
    price,
    variant: variant || "",
    image,
    htmlSnippet: html.slice(0, 1000)
  };
}
