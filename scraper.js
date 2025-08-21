// scrapers.js — product title/variant/price extraction helpers
import cheerio from "cheerio";

const moneyRegex = /\$?\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})|\d+(?:\.\d{2})?)/;

export function extractProductInfo(html, url) {
  const $ = cheerio.load(html);

  // TITLE
  let title = null;
  let titleSource = null;
  const jsonld = parseJsonLdProduct($);

  
  if (jsonld?.name) {
    title = clean(jsonld.name);
    titleSource = "jsonld.product.name";
  }
  if (!title) {
    const og = $('meta[property="og:title"]').attr("content");
    if (og) { title = clean(og); titleSource = "meta.og:title"; }
  }
  if (!title) {
    const t = $("title").first().text();
    if (t) { title = clean(t); titleSource = "html.title"; }
  }
  if (!title) {
    const h1 = $("h1").first().text();
    if (h1) { title = clean(h1); titleSource = "html.h1"; }
  }

  // VARIANTS
  let variants = extractVariants($, jsonld);
  let variantSource = variants.length ? "jsonld/offers|selects" : null;

  // PRICE (best-effort)
  let price = null;
  let currency = null;
  let priceSource = null;

  if (jsonld?.offers) {
    const { price: jp, priceCurrency: jc } = pickFirstPriceFromOffers(jsonld.offers);
    if (jp) {
      price = toNumber(jp);
      currency = jc || readCurrencyMeta($) || "USD";
      priceSource = "jsonld.offers.price";
    }
  }

  if (!price) {
    const metas = [
      'meta[itemprop="price"]',
      'meta[property="product:price:amount"]',
      'meta[name="price"]',
      'span[itemprop="price"]',
      'div[itemprop="price"]'
    ];
    for (const sel of metas) {
      const node = $(sel).first();
      const val = node.attr("content") || node.text();
      const m = val && val.match(moneyRegex);
      if (m) {
        price = toNumber(m[1]);
        currency = readCurrencyMeta($) || "USD";
        priceSource = `selector:${sel}`;
        break;
      }
    }
  }

  if (!price) {
    const probable = $('[class*="price"], [id*="price"]').first().text();
    const m = probable && probable.match(moneyRegex);
    if (m) {
      price = toNumber(m[1]);
      currency = readCurrencyMeta($) || "USD";
      priceSource = "scan.near-price";
    }
  }

  const note = !price ? "Price not found — show manual price input on frontend." : null;

  return {
    title: title || "Item",
    titleSource,
    variants,
    variantSource,
    price: price ?? null,
    currency: currency ?? null,
    priceSource,
    note
  };
}

// Helpers
function clean(s) { return String(s || "").replace(/\s+/g, " ").trim(); }
function toNumber(s) { return Number(String(s || "").replace(/[^0-9.]/g, "")) || null; }

function parseJsonLdProduct($) {
  const scripts = $('script[type="application/ld+json"]');
  for (let i = 0; i < scripts.length; i++) {
    try {
      const txt = scripts.eq(i).contents().text();
      if (!txt) continue;
      const data = JSON.parse(txt.trim());
      const arr = Array.isArray(data) ? data : [data];
      for (const obj of arr) {
        if (!obj || typeof obj !== "object") continue;
        if (isType(obj["@type"], "Product")) return obj;
        if (Array.isArray(obj["@graph"])) {
          for (const g of obj["@graph"]) {
            if (isType(g?.["@type"], "Product")) return g;
          }
        }
      }
    } catch {}
  }
  return null;
}

function isType(t, val) { return Array.isArray(t) ? t.includes(val) : t === val; }

function pickFirstPriceFromOffers(offers) {
  const list = Array.isArray(offers) ? offers : [offers];
  for (const o of list) {
    if (!o) continue;
    if (o.price || (o.priceSpecification && o.priceSpecification.price)) {
      return {
        price: o.price ?? o.priceSpecification?.price,
        priceCurrency: o.priceCurrency ?? o.priceSpecification?.priceCurrency
      };
    }
  }
  return { price: null, priceCurrency: null };
}

function readCurrencyMeta($) {
  return $('meta[property="product:price:currency"]').attr("content")
      || $('meta[itemprop="priceCurrency"]').attr("content")
      || null;
}

function extractVariants($, jsonld) {
  const out = new Set();

  // JSON-LD offers names/attributes
  if (jsonld?.offers) {
    const list = Array.isArray(jsonld.offers) ? jsonld.offers : [jsonld.offers];
    for (const o of list) {
      const n = clean(o?.name || o?.sku || "");
      if (n && n.length < 140) out.add(n);
      const color = o?.color ? `Color: ${clean(o.color)}` : null;
      const size = o?.size ? `Size: ${clean(o.size)}` : null;
      const combo = [color, size].filter(Boolean).join(" — ");
      if (combo) out.add(combo);
    }
  }

  // Common selects for options
  const selects = $('select[name*="color" i], select[id*="color" i], select[name*="size" i], select[id*="size" i], select[name*="style" i], select[id*="style" i], select[name*="option" i], select[id*="option" i]');
  selects.each((_, sel) => {
    const $sel = $(sel);
    $sel.find("option").each((_, opt) => {
      const txt = clean($(opt).text());
      if (txt && !/select/i.test(txt) && txt.length < 140) out.add(txt);
    });
  });

  return Array.from(out);
}
