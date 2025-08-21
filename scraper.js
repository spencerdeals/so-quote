// scraper.js — ESM safe helpers

async function fetchWithTimeout(url, ms = 10000) {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { signal: ctrl.signal, redirect: "follow" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(id);
  }
}

/** Try to find a price in the page. Returns number or null. */
export async function scrapePrice(url) {
  try {
    const html = await fetchWithTimeout(url);
    const m =
      html.match(/\$[\s]*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})?)/) ||
      html.match(/"price"\s*:\s*"([0-9]+(?:\.[0-9]{2})?)"/i) ||
      html.match(/"priceAmount"\s*:\s*"([0-9]+(?:\.[0-9]{2})?)"/i);
    if (!m) return null;
    const num = Number(m[1].replace(/,/g, ""));
    return Number.isFinite(num) ? num : null;
  } catch {
    return null;
  }
}

export async function scrapeLinks(_htmlOrUrl) {
  return [];
}

export default { scrapePrice, scrapeLinks };
