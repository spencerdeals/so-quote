// scrapers.js — generic title/variant/price extraction with graceful fallbacks
import cheerio from "cheerio";

const moneyRegex = /\$?\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})|\d+(?:\.\d{2})?)/;

export function extractProductInfo(html, url) {
  const $ = cheerio.load(html);

  // ---------- TITLE ----------
  let title = null;
  let titleSource = null;

  // 1) JSON-LD Product.name
  const jsonld = parseJsonLdProducts($);
  if (jsonld?.name) {
    title = cleanText(jsonld.name);
    titleSource = "jsonld.product.name";
  }

  // 2) og:title
  if (!title) {
    const og = $('meta[property="og:title"]').attr("content");
    if (og) {
      title = cleanText(og);
      titleSource = "meta.og:title";
    }
  }

  // 3) <title>
  if (!title) {
    const t = $("title").first().text();
    if (t) {
      title = cleanText(t);
      titleSource = "html.title";
    }
  }

  // 4) Fallback: first H1
  if (!title) {
    const h1 = $("h1").first().text();
    if (h1) {
      title = cleanText(h1);
      titleSource = "html.h1";
    }
  }

  // ---------- VARIANTS ----------
  // Try JSON-LD offers array, or select menus that look like size/color/style.
  let variants = extractVariants($, jsonld);
  let variantSource = variants.length ? "jsonld/offers|selects" : null;

  // ---------- PRICE (best-effort) ----------
  // We try JSON-LD offers.price, meta price tags, then visible text scan (last resort).
  let price = null;
  let currency = null;
  let priceSource = null;

  if (jsonld?.offers) {
    const { price: jp, priceCurrency: jc } = pickFirstPriceFromOffers(jsonld.offers);
    if (jp) {
      price = toNumber(jp);
      currency = jc || inferCurrencySymbol($) || "USD";
      priceSource = "jsonld.offers.price";
    }
  }

  if (!price) {
    // Common metas
    const metas = [
      'meta[itemprop="price"]',
      'meta[property="product:price:amount"]',
      'meta[name="price"]',
      'span[itemprop="price"]',
      'div[itemprop="price"]',
    ];

    for (const sel of metas) {
      const node = $(sel).first();
      const val = node.attr("content") || node.text();
      const m = val && val.match(moneyRegex);
      if (m) {
        price = toNumber(m[1]);
        currency = inferCurrencySymbol($) || "USD";
        priceSource = `selector:${sel}`;
        break;
      }
    }
  }

  if (!price) {
    // Last resort: scan for a $x.xx near "price" labels
    const probable = $('[class*="price"], [id*="price"]').first().text();
    const m = probable && probable.match(moneyRegex);
    if (m) {
      price = toNumber(m[1]);
      currency = inferCurrencySymbol($) || "USD";
      priceSource = "scan.near-price";
    }
  }

  // ---------- NOTES / FLAGS ----------
  let note = null;
  if (!price) {
    note = "Price not found — show manual price input on frontend.";
  }

  return {
    title: title || "Item",
    titleSource,
    variants,
    variantSource,
    price: price ?? null,
    currency: currency ?? null,
    priceSource,
    note,
  };
}

// -------- helpers --------

function cleanText(s) {
  return String(s || "").replace(/\s+/g, " ").trim();
}

function toNumber(s) {
  const n = String(s || "").replace(/[^0-9.]/g, "");
  return n ? Number(n) : null;
}

function parseJsonLdProducts($) {
  // Return the first Product object we find, or null
  const scripts = $('script[type="application/ld+json"]');
  for (let i = 0; i < scripts.length; i++) {
    try {
      const txt = scripts.eq(i).contents().text();
      if (!txt) continue;
      const data = JSON.parse(txt.trim());

      // Handle array or single
      const arr = Array.isArray(data) ? data : [data];
      for (const obj of arr) {
        if (!obj || typeof obj !== "object") continue;
        // @type could be array or string
        const t = obj["@type"];
        if (t === "Product" orIsArrayWith(obj["@type"], "Product")) {
          return obj;
        }
        // Some sites nest product inside graph
        if (obj["@graph"] && Array.isArray(obj["@graph"])) {
          for (const g of obj["@graph"]) {
            if (g && (g["@type"] === "Product" orIsArrayWith(g["@type"], "Product"))) {
              return g;
            }
          }
        }
      }
    } catch {}
  }
  return null;
}

function orIsArrayWith(t, val) {
  return Array.isArray(t) ? t.includes(val) : t === val;
}

function pickFirstPriceFromOffers(offers) {
  // offers can be object or array
  const list = Array.isArray(offers) ? offers : [offers];
  for (const o of list) {
    if (!o) continue;
    if (o.price || (o.priceSpecification && o.priceSpecification.price)) {
      return {
        price: o.price ?? o.priceSpecification?.price,
        priceCurrency: o.priceCurrency ?? o.priceSpecification?.priceCurrency,
      };
    }
  }
  return { price: null, priceCurrency: null };
}

function inferCurrencySymbol($) {
  const sym = $('meta[property="product:price:currency"]').attr("content")
           || $('meta[itemprop="priceCurrency"]').attr("content");
  return sym || null;
}

function extractVariants($, jsonld) {
  // 1) Try JSON-LD variations via offers with variant attributes in name/sku
  const variants = new Set();

  if (jsonld?.offers) {
    const list = Array.isArray(jsonld.offers) ? jsonld.offers : [jsonld.offers];
    for (const o of list) {
      const n = cleanText(o?.name || o?.sku || "");
      if (n && n.length < 140) variants.add(n);
      const color = o?.color ? `Color: ${cleanText(o.color)}` : null;
      const size = o?.size ? `Size: ${cleanText(o.size)}` : null;
      const combo = [color, size].filter(Boolean).join(" — ");
      if (combo) variants.add(combo);
    }
  }

  // 2) Look for select menus labeled color/size/style/option
  const selects = $('select[name*="color" i], select[id*="color" i], select[name*="size" i], select[id*="size" i], select[name*="style" i], select[id*="style" i], select[name*="option" i], select[id*="option" i]');
  selects.each((_, sel) => {
    const $sel = $(sel);
    $sel.find("option").each((_, opt) => {
      const txt = cleanText($(opt).text());
      if (txt && !/select/i.test(txt) && txt.length < 140) variants.add(txt);
    });
  });

  return Array.from(variants);
}
