// #alpha build — v3 FULL (Instant Import)
// Features:
// - /health, /debug-index
// - /scrape            → raw HTML via ScrapingBee
// - /extractPrice      → price only
// - /extractProduct    → title, price, images, variants (JSON-LD + heuristics; Amazon + Wayfair aware)
// - /quote             → calculator with SDL margins; auto-scrapes price if missing
//
// Paste as backend index.js (CommonJS). Railway start: `npm start`.
// Set env: SCRAPINGBEE_API_KEY

const express = require("express");
const cors = require("cors");
const { JSDOM } = require("jsdom");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: "1mb" }));

// ---------- Config & business rules ----------
const DEFAULT_US_SALES_TAX = 0.06625;
const DEFAULT_FREIGHT_PER_FT3 = 6.00; // consolidated container assumption
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

// ---------- ScrapingBee ----------
async function fetchWithScrapingBee(url, opts = {}) {
  const apiKey = process.env.SCRAPINGBEE_API_KEY;
  if (!apiKey) throw new Error("Missing SCRAPINGBEE_API_KEY");
  const params = new URLSearchParams();
  params.set("api_key", apiKey);
  params.set("url", url);
  params.set("country_code", opts.country || "us");
  if (opts.render_js) params.set("render_js", "true");
  if (opts.wait) params.set("wait", String(opts.wait));
  // Provide realistic headers for sites like Amazon
  const headers = {
    "User-Agent": opts.userAgent || "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Safari/537.36",
    "Accept-Language": opts.acceptLanguage || "en-US,en;q=0.9",
  };
  params.set("custom_headers", JSON.stringify(headers));

  const apiUrl = `https://app.scrapingbee.com/api/v1?${params.toString()}`;
  const res = await fetch(apiUrl);
  const html = await res.text();
  return { status: res.status, html };
}

// ---------- Parsing helpers ----------
function parsePriceFromString(s) {
  const cleaned = String(s).replace(/[^\d.]/g, "");
  const n = parseFloat(cleaned);
  return isFinite(n) ? n : 0;
}

function extractJSONLDProduct(document) {
  const scripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));
  let best = null;
  for (const s of scripts) {
    let txt = s.textContent || "";
    try {
      const json = JSON.parse(txt);
      const arr = Array.isArray(json) ? json : [json];
      for (const node of arr) {
        if (!node || typeof node !== "object") continue;
        // Product node
        if ((node["@type"] && String(node["@type"]).toLowerCase().includes("product")) || node.productID || node.offers) {
          // Choose first Product block
          best = node;
          break;
        }
        // Some sites wrap in "@graph"
        if (Array.isArray(node["@graph"])) {
          for (const g of node["@graph"]) {
            if ((g["@type"] && String(g["@type"]).toLowerCase().includes("product")) || g.offers) {
              best = g;
              break;
            }
          }
        }
      }
      if (best) break;
    } catch {}
  }
  if (!best) return null;
  // Normalize
  const title = best.name || null;
  const images = [];
  if (best.image) {
    if (Array.isArray(best.image)) images.push(...best.image);
    else if (typeof best.image === "string") images.push(best.image);
  }
  let price = null, currency = null;
  const offers = Array.isArray(best.offers) ? best.offers[0] : best.offers;
  if (offers) {
    price = offers.price || offers.lowPrice || offers.highPrice || null;
    if (typeof price === "string") price = parsePriceFromString(price);
    currency = offers.priceCurrency || null;
  }
  return { title, images, price: isFinite(price) ? Number(price) : null, currency };
}

function pickFirstNonEmpty(...vals) {
  for (const v of vals) {
    if (v !== undefined && v !== null && String(v).trim() !== "") return v;
  }
  return null;
}

function extractPriceGeneric(document) {
  // Generic price selectors
  const candidates = [
    "#priceblock_ourprice",
    "#priceblock_dealprice",
    "#price_inside_buybox",
    "#corePrice_feature_div .a-offscreen",
    "#corePriceDisplay_desktop_feature_div .a-offscreen",
    '[data-a-color="price"] .a-offscreen',
    "[itemprop=price]",
    "meta[itemprop=price]",
    "meta[property='product:price:amount']",
    "[data-test*='price']",
    "[data-hbkit-price]",
    ".price, .sale-price, .our-price"
  ];
  for (const sel of candidates) {
    const el = document.querySelector(sel);
    if (!el) continue;
    const txt = el.getAttribute("content") || el.textContent || "";
    const p = parsePriceFromString(txt);
    if (isFinite(p) && p > 0) return { price: p, raw: txt, selector: sel };
  }
  return null;
}

function extractTitleGeneric(document) {
  const og = document.querySelector("meta[property='og:title']")?.getAttribute("content");
  const h1 = document.querySelector("h1")?.textContent;
  const prod = document.querySelector("#productTitle")?.textContent; // Amazon
  return (pickFirstNonEmpty(prod, og, h1) || "").trim();
}

function extractImageGeneric(document) {
  const og = document.querySelector("meta[property='og:image']")?.getAttribute("content");
  const linkImg = document.querySelector("link[rel='image_src']")?.getAttribute("href");
  const amz = document.querySelector("#landingImage")?.getAttribute("data-old-hires") ||
              document.querySelector("#imgTagWrapperId img")?.getAttribute("src");
  return pickFirstNonEmpty(og, linkImg, amz);
}

function extractVariantsGeneric(document) {
  // Harvest <select> options that look like variant selectors
  const selects = Array.from(document.querySelectorAll("select"));
  const variants = [];
  for (const sel of selects) {
    const labelEl = sel.closest("label") || sel.previousElementSibling;
    const nameGuess = (labelEl?.textContent || sel.name || sel.id || "Option").trim();
    const options = Array.from(sel.querySelectorAll("option")).map(o => (o.textContent || "").trim()).filter(Boolean);
    if (options.length >= 2 && options.length <= 50) {
      variants.push({ name: nameGuess, options });
    }
  }
  // Amazon might use swatches without <select> — collect color/size labels
  const twister = document.querySelector("#twister, #variation_color_name, #variation_size_name");
  if (twister) {
    const labels = Array.from(twister.querySelectorAll("label, span.a-size-base"));
    const textOpts = labels.map(x => (x.textContent || "").trim()).filter(Boolean);
    if (textOpts.length > 1) variants.push({ name: "Variant", options: textOpts });
  }
  return variants;
}

function extractProductFromHTML(html, url) {
  const dom = new JSDOM(html);
  const { document } = dom.window;

  // 1) JSON-LD Product if available
  const ld = extractJSONLDProduct(document);

  // 2) Generic fallbacks + Amazon/Wayfair specific selectors in extractPriceGeneric()
  const title = pickFirstNonEmpty(ld?.title, extractTitleGeneric(document)) || null;
  const image = pickFirstNonEmpty(ld?.images?.[0], extractImageGeneric(document)) || null;

  let price = null, priceRaw = null, currency = ld?.currency || null;
  if (ld?.price) price = ld.price;
  if (!price) {
    const p = extractPriceGeneric(document);
    if (p) { price = p.price; priceRaw = p.raw; }
  }

  const variants = extractVariantsGeneric(document);

  return {
    title,
    image,
    price: isFinite(price) ? Number(price) : null,
    currency: currency || null,
    variants
  };
}

// ---------- Endpoints ----------
app.get(["/", "/health"], (_req, res) => {
  res.json({ ok: true, version: "alpha-3-full-ii", calc: "SDL+ScrapingBee+ProductExtract" });
});

app.get("/debug-index", (_req, res) => {
  res.type("text/plain").send("debug-index ok :: alpha-3-full-ii");
});

app.post("/scrape", async (req, res) => {
  try {
    const { url, render_js = false, wait = 1200 } = req.body || {};
    if (!url) return res.status(400).json({ ok:false, error:"Missing url" });
    // Amazon often needs JS + short wait
    const isAmazon = /(^|\.)amazon\./i.test(url);
    const opts = { render_js: render_js || isAmazon, wait, country: "us" };
    const { status, html } = await fetchWithScrapingBee(url, opts);
    const out = html.length > 300000 ? html.slice(0, 300000) + "\n<!-- trimmed -->" : html;
    res.json({ ok:true, status, bytes: html.length, html: out });
  } catch (e) {
    res.status(500).json({ ok:false, error: String(e.message || e) });
  }
});

app.post("/extractPrice", async (req, res) => {
  try {
    const { url, render_js = false } = req.body || {};
    if (!url) return res.status(400).json({ ok:false, error:"Missing url" });
    const isAmazon = /(^|\.)amazon\./i.test(url);
    const { html } = await fetchWithScrapingBee(url, { render_js: render_js || isAmazon, wait: 1200 });
    const product = extractProductFromHTML(html, url);
    res.json({ ok:true, url, price: product.price || 0, title: product.title, image: product.image });
  } catch (e) {
    res.status(500).json({ ok:false, error: String(e.message || e) });
  }
});

app.post("/extractProduct", async (req, res) => {
  try {
    const { url, render_js = false } = req.body || {};
    if (!url) return res.status(400).json({ ok:false, error:"Missing url" });
    const isAmazon = /(^|\.)amazon\./i.test(url);
    const { html } = await fetchWithScrapingBee(url, { render_js: render_js || isAmazon, wait: 1200 });
    const product = extractProductFromHTML(html, url);
    res.json({ ok:true, url, ...product });
  } catch (e) {
    res.status(500).json({ ok:false, error: String(e.message || e) });
  }
});

app.post("/quote", async (req, res) => {
  try {
    const body = req.body || {};
    const items = Array.isArray(body.items) ? body.items : [];
    if (!items.length) return res.status(400).json({ ok:false, error:"No items provided." });

    const freightPerFt3 = isFinite(body.freightPerFt3) ? Number(body.freightPerFt3) : DEFAULT_FREIGHT_PER_FT3;
    const fixedFeesPerShipment = isFinite(body.fixedFeesPerShipment) ? Number(body.fixedFeesPerShipment) : FIXED_FEES_PER_SHIPMENT;

    // Auto-resolve firstCost via ScrapingBee (with render_js for Amazon) when missing/zero and link present
    const resolved = await Promise.all(items.map(async (it) => {
      const out = { ...it };
      const fc = Number(out.firstCost);
      const need = !(isFinite(fc) && fc > 0) && typeof out.link === "string" && out.link.length > 4;
      if (need) {
        try {
          const isAmazon = /(^|\.)amazon\./i.test(out.link);
          const { html } = await fetchWithScrapingBee(out.link, { render_js: isAmazon, wait: 1200 });
          const product = extractProductFromHTML(html, out.link);
          if (isFinite(product.price) && product.price > 0) {
            out.firstCost = Number(product.price);
            out._product = product;
            out._scrapeOk = true;
          } else {
            out._product = product;
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
    const perUnitFixedFee = totalQty > 0 ? (fixedFeesPerShipment / totalQty) : 0;

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
      const freight = volumeFt3 * freightPerFt3;
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
        category,
        dutyRate,
        taxExempt,
        breakdown: {
          usTax: Number(usTax.toFixed(2)),
          freight: Number(freight.toFixed(2)),
          fixedFee: Number(fixedFee.toFixed(2)),
          duty: Number(duty.toFixed(2)),
          landedPerUnit: Number(landedPerUnit.toFixed(2)),
          marginRate,
          cardFeeRate: CARD_FEE_RATE,
        },
        retailUnit: Number(retail.toFixed(2)),
        retailTotal: Number(total.toFixed(2)),
        scraped: Boolean(it._product),
        scrapeOk: Boolean(it._scrapeOk),
        scrapeError: it._scrapeError || null,
      };
    });

    const grandTotal = lines.reduce((s, r) => s + r.retailTotal, 0);

    res.json({
      ok: true,
      version: "alpha-3-full-ii",
      calc: "SDL+ScrapingBee+ProductExtract",
      params: { freightPerFt3, fixedFeesPerShipment, usSalesTaxRate: DEFAULT_US_SALES_TAX },
      totals: { totalFt3: Number(totalFt3.toFixed(2)), grandTotal: Number(grandTotal.toFixed(2)) },
      lines
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok:false, error: "Server error." });
  }
});

app.listen(PORT, () => console.log("Server running on :", PORT));
