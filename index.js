// SDL Instant Import — FINAL build (CORS + Deep Extractor + Fallbacks)
// Version: alpha-3-final
// Endpoints: /health, /extractProduct, /quote, /shopify/draft
// Env required: SCRAPINGBEE_API_KEY
// Optional: SCRAPINGBEE_PREMIUM=true
// Optional: SHOPIFY_SHOP, SHOPIFY_ACCESS_TOKEN

const express = require("express");
const { JSDOM } = require("jsdom");

const app = express();
const PORT = process.env.PORT || 3000;

/* --------------------- CORS (allow all; no cookies used) --------------------- */
app.use(function (req, res, next) {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Vary", "Origin");
  res.header("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});
app.use(express.json({ limit: "2mb" }));

/* --------------------- Utils --------------------- */
function safeHost(u) { try { return new URL(u).hostname; } catch (e) { return ""; } }
function parsePrice(s) { const n = parseFloat(String(s).replace(/[^\d.]/g, "")); return isFinite(n) ? n : 0; }
function pick() {
  for (var i = 0; i < arguments.length; i++) {
    var v = arguments[i];
    if (v != null && String(v).trim() !== "") return v;
  }
  return null;
}
function slugTitle(u) {
  try {
    var path = new URL(u).pathname || "";
    var segs = path.split("/").filter(Boolean);
    var last = segs.length ? segs[segs.length - 1] : "";
    var cleaned = last.replace(/[-_]+/g, " ").replace(/\b(pdp|html|w\d+)\b/gi, "").trim();
    return cleaned && /[a-z]/i.test(cleaned) ? cleaned : null;
  } catch (e) { return null; }
}

/* --------------------- ScrapingBee (render_js + long wait) --------------------- */
async function beeGet(url, opts) {
  var qs = new URLSearchParams();
  qs.set("api_key", opts.apiKey);
  qs.set("url", url);
  qs.set("country_code", "us");
  qs.set("render_js", "true");
  qs.set("wait", String(opts.wait));
  qs.set("block_resources", "false");
  if (opts.premium) qs.set("premium_proxy", "true");
  if (opts.headers) qs.set("custom_headers", JSON.stringify(opts.headers));
  var api = "https://app.scrapingbee.com/api/v1?" + qs.toString();
  var resp = await fetch(api);
  var html = await resp.text();
  return { status: resp.status, html: html };
}

async function fetchWithBee(url) {
  var apiKey = process.env.SCRAPINGBEE_API_KEY;
  if (!apiKey) throw new Error("Missing SCRAPINGBEE_API_KEY");

  var host = safeHost(url).toLowerCase();
  var isWayfair = /(^|\.)wayfair\./.test(host);
  var isAmazon = /(^|\.)amazon\./.test(host);
  var premium = String(process.env.SCRAPINGBEE_PREMIUM || "").toLowerCase() === "true";

  var wait = (isWayfair || isAmazon) ? 9000 : 5000;
  var headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:115.0) Gecko/20100101 Firefox/115.0",
    "Accept-Language": "en-US,en;q=0.9"
  };

  var r = await beeGet(url, { apiKey: apiKey, wait: wait, premium: premium, headers: headers });
  if (r.status >= 400 && r.status < 500) {
    r = await beeGet(url, { apiKey: apiKey, wait: wait + 3000, premium: premium, headers: headers });
  }
  return { status: r.status, html: r.html, host: host, wait: wait, premium: premium };
}

/* --------------------- Variants --------------------- */
function extractVariants(document) {
  var out = [];
  var selects = Array.from(document.querySelectorAll("select"));
  selects.forEach(function (sel) {
    var labelEl = sel.closest("label") || sel.previousElementSibling;
    var nameGuess = (labelEl && labelEl.textContent ? labelEl.textContent : (sel.name || sel.id || "Option")).trim();
    var options = Array.from(sel.querySelectorAll("option")).map(function (o) { return (o.textContent || "").trim(); }).filter(Boolean);
    if (options.length >= 2 && options.length <= 50) out.push({ name: nameGuess, options: options });
  });
  var twister = document.querySelector("#twister, #variation_color_name, #variation_size_name");
  if (twister) {
    var labels = Array.from(twister.querySelectorAll("label, span.a-size-base")).map(function (x) { return (x.textContent || "").trim(); }).filter(Boolean);
    if (labels.length > 1) out.push({ name: "Variant", options: labels });
  }
  return out;
}

/* --------------------- Deep Extraction --------------------- */
function extractFromHTML(html, url) {
  var dom = new JSDOM(html);
  var document = dom.window.document;

  var title = null, image = null, price = null, currency = null;

  // 1) JSON-LD Product (including @graph)
  var ldScripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));
  function scanLD(json) {
    var arr = Array.isArray(json) ? json : [json];
    for (var j = 0; j < arr.length; j++) {
      var node = arr[j];
      if (!node || typeof node !== "object") continue;
      if (node["@graph"] && Array.isArray(node["@graph"])) { scanLD(node["@graph"]); }
      var type = String(node["@type"] || "").toLowerCase();
      var isProduct = type.indexOf("product") >= 0 || node.offers;
      if (isProduct) {
        if (!title && node.name) title = String(node.name);
        if (!image) {
          if (Array.isArray(node.image)) image = node.image[0] || null;
          else if (typeof node.image === "string") image = node.image;
        }
        if (!price && node.offers) {
          var offers = Array.isArray(node.offers) ? node.offers[0] : node.offers;
          var p = offers && (offers.price || offers.lowPrice || offers.highPrice);
          if (typeof p === "string") p = parsePrice(p);
          if (isFinite(p)) price = Number(p);
          currency = offers && offers.priceCurrency || currency;
        }
      }
    }
  }
  for (var i = 0; i < ldScripts.length; i++) { try { scanLD(JSON.parse(ldScripts[i].textContent || "{}")); } catch (e) {} if (title || image || price) break; }

  // 2) Wayfair price attribute
  if (!price) {
    var wf = document.querySelector("[data-hbkit-price]");
    if (wf) {
      var wp = parsePrice(wf.getAttribute("data-hbkit-price"));
      if (wp > 0) price = wp;
    }
  }

  // 3) __NEXT_DATA__ and any application/json blocks
  var blocks = [];
  var nextData = document.querySelector("#__NEXT_DATA__");
  if (nextData && nextData.textContent) blocks.push(nextData.textContent);
  var appJson = Array.from(document.querySelectorAll('script[type="application/json"]'));
  appJson.forEach(function (s) { if (s.textContent) blocks.push(s.textContent); });
  var matches = html.match(/<script[^>]*type=["']application\/json["'][^>]*>[\s\S]*?<\/script>/gi) || [];
  matches.forEach(function (blk) {
    var body = blk.replace(/^.*?>/s, "").replace(/<\/script>$/i, "");
    blocks.push(body);
  });

  function scanObj(obj) {
    var stack = [obj];
    var safety = 0;
    while (stack.length && safety++ < 600000) {
      var cur = stack.pop();
      if (!cur || typeof cur !== "object") continue;

      if (!title) {
        if (cur.title) title = String(cur.title);
        else if (cur.name) title = String(cur.name);
      }
      if (!image) {
        if (cur.image && typeof cur.image === "string") image = cur.image;
        else if (cur.imageUrl) image = cur.imageUrl;
        else if (cur.primaryImage) image = cur.primaryImage;
        else if (cur.url && /^https?:\/\//i.test(cur.url) && /\.(jpg|jpeg|png|webp|gif)(\?|$)/i.test(cur.url)) image = cur.url;
      }
      if (!price) {
        var keys = ["price","formattedPrice","displayPrice","currentPrice","priceAmount","amount","value","sellingPrice","salePrice","listPrice","buyBoxPrice","lowPrice","highPrice"];
        for (var k = 0; k < keys.length; k++) {
          var key = keys[k];
          if (cur.hasOwnProperty(key)) {
            var n = parsePrice(cur[key]);
            if (n > 0) { price = n; break; }
          }
        }
      }

      if (Array.isArray(cur)) for (var a = 0; a < cur.length; a++) stack.push(cur[a]);
      else for (var v in cur) if (cur.hasOwnProperty(v)) stack.push(cur[v]);
    }
  }
  for (var b = 0; b < blocks.length; b++) { try { scanObj(JSON.parse(blocks[b])); } catch (e) {} if (title && (image || price)) break; }

  // 4) Scan ALL <script> text for `"price":` style hints (non-JSON)
  if (!price) {
    var scripts = Array.from(document.querySelectorAll("script")).map(function (s) { return s.textContent || ""; }).join("\n");
    var priceJsonRegex = /"price"\s*:\s*"?(\d{1,3}(?:,\d{3})*|\d+)(?:\.(\d{2}))?"?/gi;
    var m; var minFound = null;
    while ((m = priceJsonRegex.exec(scripts)) !== null) {
      var n = parsePrice(m[0]);
      if (n > 0 && (minFound === null || n < minFound)) minFound = n;
    }
    if (minFound != null) price = minFound;
  }

  // 5) Generic DOM selectors
  if (!price) {
    var sels = [
      "#corePriceDisplay_desktop_feature_div .a-offscreen",
      "#corePrice_feature_div .a-offscreen",
      "#price_inside_buybox",
      "#priceblock_ourprice",
      "#priceblock_dealprice",
      "[itemprop=price]", 'meta[itemprop="price"]', 'meta[property="product:price:amount"]',
      ".price", ".sale-price", ".our-price", "[data-test*='price']", ".c-price",
      "span.price", "div.product-price", "#price"
    ];
    for (var si = 0; si < sels.length; si++) {
      var el = document.querySelector(sels[si]);
      if (!el) continue;
      var txt = el.getAttribute && el.getAttribute("content") ? el.getAttribute("content") : (el.textContent || "");
      var n2 = parsePrice(txt);
      if (n2 > 0) { price = n2; break; }
    }
  }

  // 6) OG/Twitter/meta for title/image
  if (!title) {
    var og  = document.querySelector('meta[property="og:title"]');
    var twt = document.querySelector('meta[name="twitter:title"]');
    var h1  = document.querySelector("h1");
    var amz = document.querySelector("#productTitle");
    var ttag= document.querySelector("title");
    title = (pick(amz && amz.textContent, og && og.getAttribute("content"), twt && twt.getAttribute("content"), h1 && h1.textContent, ttag && ttag.textContent) || "").trim() || slugTitle(url);
  }
  if (!image) {
    var ogi  = document.querySelector('meta[property="og:image"]');
    var twi  = document.querySelector('meta[name="twitter:image"]');
    var link = document.querySelector('link[rel="image_src"]');
    var amzi = document.querySelector("#landingImage");
    var img2 = document.querySelector("#imgTagWrapperId img");
    image = pick(ogi && ogi.getAttribute("content"), twi && twi.getAttribute("content"), link && link.getAttribute("href"),
      (amzi && amzi.getAttribute("data-old-hires")) || (img2 && img2.getAttribute("src")));
  }

  // 7) Final price regex
  if (!price) {
    var rx = /(USD\s*)?\$?\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})|[0-9]+(?:\.[0-9]{2}))/gi;
    var best = null, mm;
    while ((mm = rx.exec(html)) !== null) {
      var nn = parsePrice(mm[0]);
      if (nn >= 5 && (best === null || nn < best)) best = nn;
    }
    if (best !== null) price = best;
  }

  var vendor = null;
  try { vendor = new URL(url).hostname.replace(/^www\./, ""); } catch (e) {}

  return {
    title: title || null,
    image: image || null,
    price: isFinite(price) ? Number(price) : 0,
    currency: currency || null,
    vendor: vendor,
    variants: extractVariants(document)
  };
}

/* --------------------- Quote rules --------------------- */
var DEFAULT_US_SALES_TAX = 0.06625;
var DEFAULT_FREIGHT_PER_FT3 = 6.00;
var CARD_FEE_RATE = 0.0325;
var DEFAULT_DUTY_UPHOLSTERED = 0.25;
var DEFAULT_VOLUME_FT3 = 11.33;
var FIXED_FEES_PER_SHIPMENT = 0;

function marginByVolume(ft3) {
  if (ft3 < 10) return 0.40;
  if (ft3 < 20) return 0.30;
  if (ft3 < 50) return 0.25;
  return 0.20;
}
function capByLanded(landed) {
  if (landed > 5000) return 0.15;
  if (landed > 3000) return 0.20;
  if (landed > 1000) return 0.25;
  return 1.0;
}
function roundTo95(n) {
  var r = Math.round(n / 0.05) * 0.05;
  var d = Math.floor(r);
  return Number((d + 0.95).toFixed(2));
}

/* --------------------- Routes --------------------- */
app.get(["/", "/health"], function (_req, res) {
  res.json({ ok: true, version: "alpha-3-final" });
});

app.post("/extractProduct", async function (req, res) {
  try {
    var url = (req.body && req.body.url) || "";
    if (!url) return res.status(400).json({ ok: false, error: "Missing url" });
    var fetched = await fetchWithBee(url);
    var prod = extractFromHTML(fetched.html, url);
    res.json({ ok: true, url: url, used: { host: fetched.host, status: fetched.status, wait: fetched.wait, premium: fetched.premium }, ...prod });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

app.post("/quote", async function (req, res) {
  try {
    var items = Array.isArray(req.body && req.body.items) ? req.body.items : [];
    if (!items.length) return res.status(400).json({ ok: false, error: "No items provided." });

    var resolved = await Promise.all(items.map(async function (it) {
      var out = Object.assign({}, it);
      var fc = Number(out.firstCost);
      var need = !(isFinite(fc) && fc > 0) && typeof out.link === "string" && out.link.length > 4;
      if (need) {
        try {
          var fetched = await fetchWithBee(out.link);
          var prod = extractFromHTML(fetched.html, out.link);
          if (isFinite(prod.price) && prod.price > 0) { out.firstCost = Number(prod.price); out._product = prod; out._scrapeOk = true; }
          else { out._product = prod; out._scrapeOk = false; }
        } catch (e) { out._scrapeOk = false; out._scrapeError = String(e.message || e); }
      }
      return out;
    }));

    var totalFt3 = resolved.reduce(function (s, it) {
      var qty = Number(it.qty) || 1;
      var v = isFinite(it.volumeFt3) ? Number(it.volumeFt3) : DEFAULT_VOLUME_FT3;
      return s + v * qty;
    }, 0);

    var volMargin = marginByVolume(totalFt3);
    var totalQty = resolved.reduce(function (s, it) { return s + (Number(it.qty) || 1); }, 0);
    var perUnitFixed = totalQty > 0 ? (FIXED_FEES_PER_SHIPMENT / totalQty) : 0;

    var lines = resolved.map(function (it) {
      var name = it.name || (it._product && it._product.title) || "Item";
      var qty = Number(it.qty) || 1;
      var firstCost = Math.max(0, Number(it.firstCost) || 0);
      var volumeFt3 = isFinite(it.volumeFt3) ? Number(it.volumeFt3) : DEFAULT_VOLUME_FT3;

      var category = (it.category || "").toLowerCase();
      var dutyRate = isFinite(it.dutyRate) ? Number(it.dutyRate) : (category.indexOf("upholster") >= 0 ? DEFAULT_DUTY_UPHOLSTERED : 0.0);
      var taxExempt = Boolean(it.taxExempt);

      var usTax = taxExempt ? 0 : firstCost * DEFAULT_US_SALES_TAX;
      var freight = volumeFt3 * DEFAULT_FREIGHT_PER_FT3;
      var fixedFee = perUnitFixed;
      var duty = firstCost * dutyRate;

      var landed = firstCost + usTax + freight + fixedFee + duty;
      var marginRate = Math.min(volMargin, capByLanded(landed));
      var retail = roundTo95(landed * (1 + marginRate) * (1 + CARD_FEE_RATE));
      var total = retail * qty;

      return {
        name: name,
        link: it.link || null,
        qty: qty,
        firstCost: firstCost,
        volumeFt3: volumeFt3,
        image: (it._product && it._product.image) || null,
        vendor: (it._product && it._product.vendor) || (it.link ? safeHost(it.link).replace(/^www\./, "") : null),
        variants: (it._product && it._product.variants) || [],
        retailUnit: Number(retail.toFixed(2)),
        retailTotal: Number(total.toFixed(2)),
        scraped: Boolean(it._product),
        scrapeOk: Boolean(it._scrapeOk),
        scrapeError: it._scrapeError || null
      };
    });

    var grandTotal = lines.reduce(function (s, r) { return s + r.retailTotal; }, 0);
    res.json({ ok: true, version: "alpha-3-final", totals: { totalFt3: Number(totalFt3.toFixed(2)), grandTotal: Number(grandTotal.toFixed(2)) }, lines: lines });
  } catch (e) {
    res.status(500).json({ ok: false, error: "Server error." });
  }
});

app.post("/shopify/draft", async function (req, res) {
  try {
    var shop = process.env.SHOPIFY_SHOP;
    var token = process.env.SHOPIFY_ACCESS_TOKEN;
    if (!shop || !token) return res.status(500).json({ ok: false, error: "Shopify env vars missing" });

    var body = req.body || {};
    var items = Array.isArray(body.items) ? body.items : [];
    if (!items.length) return res.status(400).json({ ok: false, error: "No items" });

    var line_items = items.map(function (it) {
      var props = [];
      if (it.link) props.push({ name: "Source Link", value: it.link });
      if (it.image) props.push({ name: "Image", value: it.image });
      if (it.vendor) props.push({ name: "Vendor", value: it.vendor });
      if (Array.isArray(it.variantSelections)) it.variantSelections.forEach(function (v) { props.push({ name: v.name, value: v.value }); });

      return { title: it.name || "Special Order — Customer Provided Link", quantity: Number(it.qty) || 1, price: Number(it.unitPrice) || undefined, properties: props };
    });

    var payload = { draft_order: { line_items: line_items, email: body.customerEmail || undefined, tags: "Special Order,Instant Import", note: body.note || "Instant Import draft order created automatically.", use_customer_default_address: true } };

    var url = "https://" + shop + "/admin/api/2024-07/draft_orders.json";
    var resp = await fetch(url, { method: "POST", headers: { "X-Shopify-Access-Token": token, "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    var data = await resp.json();
    if (!resp.ok) return res.status(500).json({ ok: false, error: "Shopify error", detail: data });
    res.json({ ok: true, draft_order: data.draft_order });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

app.listen(PORT, function () { console.log("Backend running on :" + PORT); });
