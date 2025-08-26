// SDL Instant Import — Minimal Stable Extractor (Hardened)
// Endpoints: /health, /extractProduct
// Env: SCRAPINGBEE_API_KEY

const express = require("express");
const cors = require("cors");
const { JSDOM } = require("jsdom");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.options("*", cors());
app.use(express.json({ limit: "1mb" }));

// ---------- Utils ----------
function safeHost(u) { try { return new URL(u).hostname; } catch { return ""; } }
function parsePrice(s) { const n = parseFloat(String(s).replace(/[^\d.]/g, "")); return isFinite(n) ? n : 0; }
function pick(...vals) { for (const v of vals) if (v != null && String(v).trim() !== "") return v; return null; }

// ---------- ScrapingBee fetch ----------
async function fetchWithBee(url) {
  const key = process.env.SCRAPINGBEE_API_KEY;
  if (!key) throw new Error("Missing SCRAPINGBEE_API_KEY");
  const host = safeHost(url);

  // For tough sites (Wayfair/Amazon) – force JS render & longer wait
  const needsJS = /(^|\.)amazon\./i.test(host) || /(^|\.)wayfair\./i.test(host);
  const wait = needsJS ? 4000 : 2500;

  const qs = new URLSearchParams();
  qs.set("api_key", key);
  qs.set("url", url);
  qs.set("country_code", "us");
  qs.set("render_js", "true");           // ← force JS render during debug
  qs.set("wait", String(wait));
  // If your plan supports it, leaving this on drastically improves success:
  qs.set("premium_proxy", "true");       // ← remove this line if your plan errors

  qs.set("custom_headers", JSON.stringify({
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept-Language": "en-US,en;q=0.9"
  }));

  const api = `https://app.scrapingbee.com/api/v1?${qs.toString()}`;
  const resp = await fetch(api);
  const html = await resp.text();
  return { html, host, wait, status: resp.status };
}

// ---------- Extraction helpers ----------
function extractFromHTML(html, url) {
  const dom = new JSDOM(html);
  const { document } = dom.window;

  let title = null, image = null, price = null, currency = null, source = "none";

  // 1) JSON-LD Product
  const ldScripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));
  for (const s of ldScripts) {
    try {
      const json = JSON.parse(s.textContent || "{}");
      const arr = Array.isArray(json) ? json : [json];
      for (const node of arr) {
        if (!node || typeof node !== "object") continue;
        const isProduct = String(node["@type"] || "").toLowerCase().includes("product") || node.offers;
        if (isProduct) {
          title = node.name || title;
          if (!image) {
            if (Array.isArray(node.image)) image = node.image[0] || null;
            else if (typeof node.image === "string") image = node.image || null;
          }
          if (!price && node.offers) {
            const offers = Array.isArray(node.offers) ? node.offers[0] : node.offers;
            let p = offers?.price ?? offers?.lowPrice ?? offers?.highPrice ?? null;
            if (typeof p === "string") p = parsePrice(p);
            if (isFinite(p)) price = Number(p);
            currency = offers?.priceCurrency || currency;
            source = "jsonld";
          }
        }
      }
      if (title || image || price) break;
    } catch {}
  }

  // 2) Wayfair/Amazon: embedded JSON state
  if (!price || !title || !image) {
    // common: __NEXT_DATA__, __WF_STATE__, or application/json scripts
    const jsonBlocks = [];
    const nextData = document.querySelector("#__NEXT_DATA__");
    if (nextData?.textContent) jsonBlocks.push(nextData.textContent);

    // any <script type="application/json"> blocks
    const appJson = Array.from(document.querySelectorAll('script[type="application/json"]'));
    for (const s of appJson) if (s.textContent) jsonBlocks.push(s.textContent);

    // generic scan of HTML if still nothing
    if (!jsonBlocks.length) {
      const matches = html.match(/<script[^>]*type=["']application\/json["'][^>]*>[\s\S]*?<\/script>/gi) || [];
      for (const blk of matches) {
        const body = blk.replace(/^.*?>/s, "").replace(/<\/script>$/i, "");
        jsonBlocks.push(body);
      }
    }

    for (const body of jsonBlocks) {
      try {
        const obj = JSON.parse(body);
        // Walk shallowly to find reasonable price fields
        const stack = [obj];
        while (stack.length) {
          const cur = stack.pop();
          if (!cur || typeof cur !== "object") continue;

          // pick up title/name
          if (!title) title = cur.title || cur.name || title;
          // pick up image
          if (!image) image = cur.image || cur.imageUrl || cur.primaryImage || image;

          // look for common price keys
          const keys = ["price", "priceAmount", "price_value", "currentPrice", "amount", "value"];
          for (const k of keys) {
            if (k in cur) {
              const p = parsePrice(cur[k]);
              if (p > 0) { price = p; source = source === "none" ? `json:${k}` : source; }
            }
          }
          // arrays/objects
          if (Array.isArray(cur)) for (const v of cur) stack.push(v);
          else for (const v of Object.values(cur)) stack.push(v);
        }
        if (price && (title || image)) break;
      } catch {}
    }
  }

  // 3) DOM selectors (Amazon, Wayfair, generic)
  if (!price) {
    const sels = [
      // Amazon
      "#corePriceDisplay_desktop_feature_div .a-offscreen",
      "#corePrice_feature_div .a-offscreen",
      "#price_inside_buybox",
      "#priceblock_ourprice",
      "#priceblock_dealprice",
      "[itemprop=price]", 'meta[itemprop="price"]', 'meta[property="product:price:amount"]',
      // Wayfair
      "[data-hbkit-price]",
      // Generic
      ".price", ".sale-price", ".our-price", "[data-test*='price']", ".c-price"
    ];
    for (const sel of sels) {
      const el = document.querySelector(sel);
      if (!el) continue;
      const txt = el.getAttribute("content") || el.textContent || "";
      const p = parsePrice(txt);
      if (p > 0) { price = p; source = source === "none" ? `selector:${sel}` : source; break; }
    }
  }

  // 4) Title/Image fallbacks
  if (!title) {
    const og = document.querySelector('meta[property="og:title"]')?.getAttribute("content");
    const h1 = document.querySelector("h1")?.textContent;
    const amz = document.querySelector("#productTitle")?.textContent;
    const ttag = document.querySelector("title")?.textContent;
    title = (pick(amz, og, h1, ttag) || "").trim();
  }
  if (!image) {
    const ogi = document.querySelector('meta[property="og:image"]')?.getAttribute("content");
    const linki = document.querySelector('link[rel="image_src"]')?.getAttribute("href");
    const amzi = document.querySelector("#landingImage")?.getAttribute("data-old-hires")
              || document.querySelector("#imgTagWrapperId img")?.getAttribute("src");
    image = pick(ogi, linki, amzi);
  }

  // 5) Last-resort price sweep on full HTML
  if (!price) {
    const rx = /(USD\s*)?\$?\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})|[0-9]+(?:\.[0-9]{2}))/gi;
    let best = null, m;
    while ((m = rx.exec(html)) !== null) {
      const n = parsePrice(m[0]);
      if (n >= 5 && (!best || n < best)) best = n;
    }
    if (best) { price = best; source = source === "none" ? "regex" : source; }
  }

  let vendor = null;
  try { vendor = new URL(url).hostname.replace(/^www\./, ""); } catch {}

  return {
    title: title || null,
    image: image || null,
    price: isFinite(price) ? Number(price) : 0,
    currency: currency || null,
    vendor,
    debug: { source }
  };
}

// ---------- Routes ----------
app.get(["/", "/health"], (_req, res) => {
  res.json({ ok: true, version: "alpha-3-minimal-hardened" });
});

app.post("/extractProduct", async (req, res) => {
  try {
    const { url } = req.body || {};
    if (!url) return res.status(400).json({ ok:false, error:"Missing url" });
    const fetched = await fetchWithBee(url);
    const product = extractFromHTML(fetched.html, url);
    res.json({ ok:true, url, ...product, used: { host: fetched.host, wait: fetched.wait, status: fetched.status } });
  } catch (e) {
    res.status(500).json({ ok:false, error:String(e.message || e) });
  }
});

app.listen(PORT, () => {
  console.log(`Backend running on :${PORT}`);
});
