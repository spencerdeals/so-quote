// SDL Instant Import — Wayfair/Amazon Hardened Extractor (with diagnostics)
// Endpoints: /health, /extractProduct, /quote, /shopify/draft
// Env required: SCRAPINGBEE_API_KEY
// Optional: SCRAPINGBEE_PREMIUM=true (enable premium_proxy)
// Optional: SHOPIFY_SHOP=yourstore.myshopify.com, SHOPIFY_ACCESS_TOKEN=shpat_xxx

const express = require("express");
const cors = require("cors");
const { JSDOM } = require("jsdom");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.options("*", cors());
app.use(express.json({ limit: "2mb" }));

// ---------------- Utilities ----------------
const U = {
  safeHost(u) { try { return new URL(u).hostname; } catch { return ""; } },
  parsePrice(s) { const n = parseFloat(String(s).replace(/[^\d.]/g, "")); return isFinite(n) ? n : 0; },
  pick(...vals) { for (const v of vals) if (v != null && String(v).trim() !== "") return v; return null; },
};

function looksLikeBotWall(html) {
  const h = html.slice(0, 20000).toLowerCase();
  return (
    h.includes("are you a robot") ||
    h.includes("access denied") ||
    h.includes("attention required") ||
    h.includes("/captcha") ||
    h.includes("bot detection")
  );
}

// ---------------- ScrapingBee fetch ----------------
async function fetchWithBee(url) {
  const key = process.env.SCRAPINGBEE_API_KEY;
  if (!key) throw new Error("Missing SCRAPINGBEE_API_KEY");

  const host = U.safeHost(url).toLowerCase();
  const isWayfair = /(^|\.)wayfair\./.test(host);
  const isAmazon  = /(^|\.)amazon\./.test(host);

  // Heavier render path for Wayfair/Amazon
  const wait = (isWayfair || isAmazon) ? 6000 : 2500;

  const qs = new URLSearchParams();
  qs.set("api_key", key);
  qs.set("url", url);
  qs.set("country_code", "us");
  qs.set("render_js", "true");
  qs.set("wait", String(wait));
  // use premium proxy when available
  if (String(process.env.SCRAPINGBEE_PREMIUM || "").toLowerCase() === "true") {
    qs.set("premium_proxy", "true");
  }
  // realistic headers
  qs.set("custom_headers", JSON.stringify({
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept-Language": "en-US,en;q=0.9"
  }));

  const api = `https://app.scrapingbee.com/api/v1?${qs.toString()}`;
  const resp = await fetch(api);
  const html = await resp.text();
  return { html, host, wait, status: resp.status };
}

// ---------------- Variant extractor ----------------
function extractVariants(document) {
  const out = [];
  const selects = Array.from(document.querySelectorAll("select"));
  for (const sel of selects) {
    const labelEl = sel.closest("label") || sel.previousElementSibling;
    const nameGuess = (labelEl?.textContent || sel.name || sel.id || "Option").trim();
    const options = Array.from(sel.querySelectorAll("option"))
      .map(o => (o.textContent || "").trim())
      .filter(Boolean);
    if (options.length >= 2 && options.length <= 50) out.push({ name: nameGuess, options });
  }
  // Amazon "twister" (harmless for Wayfair)
  const twister = document.querySelector("#twister, #variation_color_name, #variation_size_name");
  if (twister) {
    const labels = Array.from(twister.querySelectorAll("label, span.a-size-base"));
    const textOpts = labels.map(x => (x.textContent || "").trim()).filter(Boolean);
    if (textOpts.length > 1) out.push({ name: "Variant", options: textOpts });
  }
  return out;
}

// ---------------- Price/title/image extraction ----------------
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
            if (typeof p === "string") p = U.parsePrice(p);
            if (isFinite(p)) price = Number(p);
            currency = offers?.priceCurrency || currency;
            source = "jsonld";
          }
        }
      }
      if (title || image || price) break;
    } catch {}
  }

  // 2) Wayfair direct selector
  if (!price) {
    const wf = document.querySelector("[data-hbkit-price]");
    if (wf) {
      const p = U.parsePrice(wf.getAttribute("data-hbkit-price"));
      if (p > 0) { price = p; source = "selector:[data-hbkit-price]"; }
    }
  }

  // 3) Embedded JSON (NEXT_DATA / application/json)
  if (!price || !title || !image) {
    const blocks = [];
    const nextData = document.querySelector("#__NEXT_DATA__");
    if (nextData?.textContent) blocks.push(nextData.textContent);
    const appJson = Array.from(document.querySelectorAll('script[type="application/json"]'));
    for (const s of appJson) if (s.textContent) blocks.push(s.textContent);
    if (!blocks.length) {
      const matches = html.match(/<script[^>]*type=["']application\/json["'][^>]*>[\s\S]*?<\/script>/gi) || [];
      for (const blk of matches) {
        const body = blk.replace(/^.*?>/s, "").replace(/<\/script>$/i, "");
        blocks.push(body);
      }
    }

    for (const body of blocks) {
      try {
        const obj = JSON.parse(body);
        const stack = [obj];
        while (stack.length) {
          const cur = stack.pop();
          if (!cur || typeof cur !== "object") continue;

          if (!title) title = cur.title || cur.name || title;
          if (!image) image = cur.image || cur.imageUrl || cur.primaryImage || image;

          const keys = ["price", "priceAmount", "price_value", "currentPrice", "amount", "value"];
          for (const k of keys) {
            if (k in cur) {
              const p = U.parsePrice(cur[k]);
              if (p > 0) { price = p; if (source === "none") source = `json:${k}`; }
            }
          }

          if (Array.isArray(cur)) for (const v of cur) stack.push(v);
          else for (const v of Object.values(cur)) stack.push(v);
        }
        if (price && (title || image)) break;
      } catch {}
    }
  }

  // 4) Generic DOM selectors for price
  if (!price) {
    const sels = [
      // Amazon
      "#corePriceDisplay_desktop_feature_div .a-offscreen",
      "#corePrice_feature_div .a-offscreen",
      "#price_inside_buybox",
      "#priceblock_ourprice",
      "#priceblock_dealprice",
      // Generic
      "[itemprop=price]", 'meta[itemprop="price"]', 'meta[property="product:price:amount"]',
      ".price", ".sale-price", ".our-price", "[data-test*='price']", ".c-price"
    ];
    for (const sel of sels) {
      const el = document.querySelector(sel);
      if (!el) continue;
      const txt = el.getAttribute("content") || el.textContent || "";
      const p = U.parsePrice(txt);
      if (p > 0) { price = p; if (source === "none") source = `selector:${sel}`; break; }
    }
  }

  // 5) Title/Image fallbacks
  if (!title) {
    const og  = document.querySelector('meta[property="og:title"]')?.getAttribute("content");
    const h1  = document.querySelector("h1")?.textContent;
    const amz = document.querySelector("#productTitle")?.textContent;
    const t   = document.querySelector("title")?.textContent;
    title = (U.pick(amz, og, h1, t) || "").trim();
  }
  if (!image) {
    const ogi = document.querySelector('meta[property="og:image"]')?.getAttribute("content");
    const linki = document.querySelector('link[rel="image_src"]')?.getAttribute("href");
    const amzi = document.querySelector("#landingImage")?.getAttribute("data-old-hires")
               || document.querySelector("#imgTagWrapperId img")?.getAttribute("src");
    image = U.pick(ogi, linki, amzi);
  }

  // 6) Last-resort price sweep
  if (!price) {
    const rx = /(USD\s*)?\$?\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})|[0-9]+(?:\.[0-9]{2}))/gi;
    let best = null, m;
    while ((m = rx.exec(html)) !== null) {
      const n = U.parsePrice(m[0]);
      if (n >= 5 && (!best || n < best)) best = n;
    }
    if (best) { price = best; if (source === "none") source = "regex"; }
  }

  let vendor = null;
  try { vendor = new URL(url).hostname.replace(/^www\./, ""); } catch {}

  return {
    title: title || null,
    image: image || null,
    price: isFinite(price) ? Number(price) : 0,
    currency: currency || null,
    vendor,
    variants: extractVariants(document),
    debug: { source }
  };
}

// ---------------- Quote rules ----------------
const DEFAULT_US_SALES_TAX = 0.06625;
const DEFAULT_FREIGHT_PER_FT3 = 6.00;
const CARD_FEE_RATE = 0.0325;
const DEFAULT_DUTY_UPHOLSTERED = 0.25;
const DEFAULT_VOLUME_FT3 = 11.33;
const FIXED_FEES_PER_SHIPMENT = 0;

function marginByVolume(totalFt3) {
  if (totalFt3 < 10) return 0.40;
  if (totalFt3 < 20) return 0.30;
  if (totalFt3 < 50) return 0.25;
  return 0.20;
}
function capByLanded(landed) {
  if (landed > 5000) return 0.15;
  if (landed > 3000) return 0.20;
  if (landed > 1000) return 0.25;
  return 1.0;
}
function roundTo95(n) {
  const rounded = Math.round(n / 0.05) * 0.05;
  const dollars = Math.floor(rounded);
  return Number((dollars + 0.95).toFixed(2));
}

// ---------------- Routes ----------------
app.get(["/", "/health"], (_req, res) => {
  res.json({ ok: true, version: "alpha-3-wayfair-hardened" });
});

// Extract product (diagnostic-friendly)
app.post("/extractProduct", async (req, res) => {
  try {
    const { url } = req.body || {};
    if (!url) return res.status(400).json({ ok:false, error:"Missing url" });

    const fetched = await fetchWithBee(url);
    const botWall = looksLikeBotWall(fetched.html);
    const product = extractFromHTML(fetched.html, url);

    res.json({
      ok: true,
      url,
      ...product,
      used: { host: fetched.host, wait: fetched.wait, status: fetched.status },
      botWall: botWall ? true : false,
      reason: botWall ? "Bot-wall detected by content fingerprint." : undefined
    });
  } catch (e) {
    res.status(500).json({ ok:false, error:String(e.message || e) });
  }
});

// Quote calc (auto-scrape if firstCost missing)
app.post("/quote", async (req, res) => {
  try {
    const body = req.body || {};
    const items = Array.isArray(body.items) ? body.items : [];
    if (!items.length) return res.status(400).json({ ok:false, error:"No items provided." });

    const resolved = await Promise.all(items.map(async (it) => {
      const out = { ...it };
      const fc = Number(out.firstCost);
      const need = !(isFinite(fc) && fc > 0) && typeof out.link === "string" && out.link.length > 4;
      if (need) {
        try {
          const fetched = await fetchWithBee(out.link);
          const prod = extractFromHTML(fetched.html, out.link);
          if (isFinite(prod.price) && prod.price > 0) {
            out.firstCost = Number(prod.price);
            out._product = prod;
            out._scrapeOk = true;
          } else {
            out._product = prod;
            out._scrapeOk = false;
          }
        } catch (e) {
          out._scrapeOk = false;
          out._scrapeError = String(e.message || e);
        }
      }
      return out;
    }));

    const totalFt3 = resolved.reduce((sum, it) => {
      const qty = Number(it.qty) || 1;
      const v = isFinite(it.volumeFt3) ? Number(it.volumeFt3) : DEFAULT_VOLUME_FT3;
      return sum + v * qty;
    }, 0);

    const volTierMargin = marginByVolume(totalFt3);
    const totalQty = resolved.reduce((s, it) => s + (Number(it.qty) || 1), 0);
    const perUnitFixedFee = totalQty > 0 ? (FIXED_FEES_PER_SHIPMENT / totalQty) : 0;

    const lines = resolved.map((it) => {
      const name = it.name || (it._product?.title || "Item");
      const qty = Number(it.qty) || 1;
      const firstCost = Math.max(0, Number(it.firstCost) || 0);
      const volumeFt3 = isFinite(it.volumeFt3) ? Number(it.volumeFt3) : DEFAULT_VOLUME_FT3;
      const category = (it.category || "").toLowerCase();
      const dutyRate = isFinite(it.dutyRate) ? Number(it.dutyRate) :
        (category.includes("upholster") ? DEFAULT_DUTY_UPHOLSTERED : 0.0);
      const taxExempt = Boolean(it.taxExempt);

      const usTax = taxExempt ? 0 : firstCost * DEFAULT_US_SALES_TAX;
      const freight = volumeFt3 * DEFAULT_FREIGHT_PER_FT3;
      const fixedFee = perUnitFixedFee;
      const duty = firstCost * dutyRate;

      const landedPerUnit = firstCost + usTax + freight + fixedFee + duty;
      const cap = capByLanded(landedPerUnit);
      const marginRate = Math.min(volTierMargin, cap);
      const retailPreCard = landedPerUnit * (1 + marginRate);
      const retailWithCard = retailPreCard * (1 + CARD_FEE_RATE);
      const retail = roundTo95(retailWithCard);
      const total = retail * qty;

      return {
        name,
        link: it.link || null,
        qty,
        firstCost,
        volumeFt3,
        image: it._product?.image || null,
        vendor: it._product?.vendor || (it.link ? U.safeHost(it.link).replace(/^www\./,"") : null),
        variants: it._product?.variants || [],
        retailUnit: Number(retail.toFixed(2)),
        retailTotal: Number(total.toFixed(2)),
        scraped: Boolean(it._product),
        scrapeOk: Boolean(it._scrapeOk),
        scrapeError: it._scrapeError || null,
        debug: it._product?.debug || null
      };
    });

    const grandTotal = lines.reduce((s, r) => s + r.retailTotal, 0);

    res.json({
      ok: true,
      version: "alpha-3-wayfair-hardened",
      totals: { totalFt3: Number(totalFt3.toFixed(2)), grandTotal: Number(grandTotal.toFixed(2)) },
      lines
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok:false, error:"Server error." });
  }
});

// Shopify draft order
app.post("/shopify/draft", async (req, res) => {
  try {
    const shop = process.env.SHOPIFY_SHOP;
    const token = process.env.SHOPIFY_ACCESS_TOKEN;
    if (!shop || !token) return res.status(500).json({ ok:false, error:"Shopify env vars missing" });

    const { items, customerEmail, note } = req.body || {};
    if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ ok:false, error:"No items" });

    const line_items = items.map(it => ({
      title: it.name || "Special Order — Customer Provided Link",
      quantity: Number(it.qty) || 1,
      price: Number(it.unitPrice) || undefined,
      properties: [
        it.link ? { name: "Source Link", value: it.link } : null,
        it.image ? { name: "Image", value: it.image } : null,
        it.vendor ? { name: "Vendor", value: it.vendor } : null,
        ...(Array.isArray(it.variantSelections) ? it.variantSelections.map(v => ({ name: v.name, value: v.value })) : [])
      ].filter(Boolean)
    }));

    const payload = {
      draft_order: {
        line_items,
        email: customerEmail || undefined,
        tags: "Special Order,Instant Import",
        note: note || "Instant Import draft order created automatically.",
        use_customer_default_address: true
      }
    };

    const url = `https://${shop}/admin/api/2024-07/draft_orders.json`;
    const resp = await fetch(url, {
      method: "POST",
      headers: { "X-Shopify-Access-Token": token, "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = await resp.json();
    if (!resp.ok) return res.status(500).json({ ok:false, error:"Shopify error", detail:data });
    res.json({ ok:true, draft_order: data.draft_order });
  } catch (e) {
    res.status(500).json({ ok:false, error:String(e.message || e) });
  }
});

app.listen(PORT, () => console.log(`Backend running on :${PORT}`));
