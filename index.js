// index.js — Zero-dependency server with fetch + robust fallbacks
const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

// allow embed in Shopify
app.use((req, res, next) => {
  res.setHeader("X-Frame-Options", "ALLOWALL");
  res.setHeader("Content-Security-Policy", "frame-ancestors *");
  next();
});

app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

// ---------------------- helpers ----------------------
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function fetchText(url) {
  // Try direct fetch with a realistic UA; if blocked, use r.jina.ai text proxy
  const headers = { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123 Safari/537.36" };
  try {
    const r = await fetch(url, { headers });
    if (r.ok) {
      const txt = await r.text();
      if (txt && txt.length > 2000) return { text: txt, via: "direct" };
    }
  } catch {}
  // Fallback via proxy
  try {
    const proxied = url.startsWith("http") ? url : `https://${url}`;
    const r2 = await fetch(`https://r.jina.ai/http://${proxied.replace(/^https?:\/\//,'')}`, { headers });
    if (r2.ok) {
      const txt2 = await r2.text();
      if (txt2 && txt2.length > 1000) return { text: txt2, via: "proxy" };
    }
  } catch {}
  return { text: "", via: "none" };
}

const num = (s) => {
  if (s == null) return null;
  const n = parseFloat(String(s).replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? n : null;
};

// Try to find a dollars value near the word "price" or a $xx.xx pattern
function extractPrice(html) {
  // JSON-ish price
  const jld = [...html.matchAll(/"price"\s*:\s*"?([0-9.,]+)"?/gi)];
  for (const m of jld) {
    const n = num(m[1]);
    if (n) return n;
  }
  // $xx.xx
  const dollar = html.match(/\$\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})|[0-9]+\.[0-9]{2})/);
  if (dollar) return num(dollar[0]);
  return null;
}

function extractTitle(html) {
  const t = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (t) return t[1].trim().replace(/\s+/g, " ").slice(0, 140);
  // Fallback: first H1-ish
  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (h1) return h1[1].replace(/<[^>]+>/g,"").trim().replace(/\s+/g," ").slice(0, 140);
  return "Special Order Item";
}

// Accepts typical patterns: 20x16x12 in, 20" x 16" x 12", Product Dimensions: 20 x 16 x 12 inches, etc.
function extractDimsInches(text) {
  const t = text.replace(/\s+/g, " ").replace(/–|—/g, "-").toLowerCase();
  const patt = [
    /(\d+(?:\.\d+)?)\s*(?:in|")?\s*[x×]\s*(\d+(?:\.\d+)?)\s*(?:in|")?\s*[x×]\s*(\d+(?:\.\d+)?)(?:\s*(?:in|inches|"))/,
    /dimensions[^:]{0,30}:\s*(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)/,
    /package[^:]{0,30}dimensions[^:]*:\s*(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)/,
    /product[^:]{0,30}dimensions[^:]*:\s*(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)/,
  ];
  for (const p of patt) {
    const m = t.match(p);
    if (m && m[1] && m[2] && m[3]) {
      return [num(m[1]), num(m[2]), num(m[3])];
    }
  }
  return null;
}

const in3ToFt3 = (L, W, H) => (L * W * H) / 1728;

// ----------------------- rules -----------------------
const SALES_TAX = 0.06625;
const DUTY = 0.25;
const WHARFAGE = 0.02;
const FREIGHT_PER_FT3 = 6.46;
const FIXED_FFF_PER_ITEM = 10;
const CARD_FEE = 0.0375;

const isTaxExemptVendor = (vendor, url) =>
  /amazon/i.test(vendor || url || "") || /wayfair/i.test(vendor || url || "");

function marginByFt3(totalFt3) {
  if (totalFt3 < 20) return 0.30;
  if (totalFt3 <= 50) return 0.25;
  return 0.20;
}

const r2 = (n) => Math.round(n * 100) / 100;

// ----------------------- scraping -----------------------
async function resolveOne(url) {
  const { text, via } = await fetchText(url);
  if (!text) return { url, error: "Could not load page" };

  const vendor = /wayfair/i.test(url) ? "Wayfair" : /amazon/i.test(url) ? "Amazon" : "Vendor";
  const title = extractTitle(text);
  const price = extractPrice(text);

  let ft3 = 0;
  let dimNote = "";
  const dims = extractDimsInches(text);
  if (dims) {
    const [a,b,c] = dims.sort((x,y)=>y-x);
    ft3 = in3ToFt3(a,b,c);
    // exact dims used; if we later mark “similar but nearly identical”, we’ll change +10%
  } else {
    // No dims → use comparable estimate +15% buffer for safety
    ft3 = 2.0 * 1.15;
    dimNote = "Shipping dimensions estimated from comparable item (+15% buffer).";
  }

  if (!price) return { url, vendor, title, error: "No price found" };

  return {
    url, vendor, title,
    firstCost: Number(price),
    ft3: Number(r2(ft3)),
    qty: 1,
    dimNote,
    via
  };
}

// ----------------------- math -----------------------
function calcQuote(items) {
  let subtotalBeforeCard = 0;
  let totalFt3 = 0;
  const seenVendorFee = {};

  const lines = items.map((it, idx) => {
    const qty = Math.max(1, Number(it.qty || 1));
    const fcEach = Number(it.firstCost || 0);
    const volEach = Number(it.ft3 || 0);

    const firstCost = fcEach * qty;
    const ft3 = volEach * qty;

    const tax = isTaxExemptVendor(it.vendor, it.url) ? 0 : fcEach * SALES_TAX * qty;
    const duty = fcEach * DUTY * qty;
    const wharfage = fcEach * WHARFAGE * qty;
    const freight = volEach * FREIGHT_PER_FT3 * qty;
    const fixedFFF = FIXED_FFF_PER_ITEM * qty;

    let customsEntryFee = 0;
    const vkey = (it.vendor || "Vendor").toLowerCase();
    if (!seenVendorFee[vkey]) {
      customsEntryFee = 9;                // $9 per unique vendor
      seenVendorFee[vkey] = true;
    }

    const preCard = firstCost + tax + duty + wharfage + freight + fixedFFF + customsEntryFee;

    subtotalBeforeCard += preCard;
    totalFt3 += ft3;

    return {
      i: idx + 1,
      vendor: it.vendor || "Vendor",
      title: it.title || "Special Order Item",
      url: it.url || "",
      qty,
      firstCost: r2(firstCost),
      salesTax: r2(tax),
      duty: r2(duty),
      wharfage: r2(wharfage),
      freight: r2(freight),
      fixedFFF: r2(fixedFFF),
      customsEntryFee: customsEntryFee,
      preCard: r2(preCard),
      dimNote: it.dimNote || ""
    };
  });

  const cardFee = subtotalBeforeCard * CARD_FEE;
  const totalLanded = subtotalBeforeCard + cardFee;
  const m = marginByFt3(totalFt3);
  const suggestedRetail = totalLanded / (1 - m);

  const linesOut = lines.map((l) => {
    const share = subtotalBeforeCard ? (l.preCard / subtotalBeforeCard) * cardFee : 0;
    return { ...l, cardShare: r2(share), lineLanded: r2(l.preCard + share) };
  });

  return {
    lines: linesOut,
    totals: {
      totalFt3: r2(totalFt3),
      subtotalBeforeCard: r2(subtotalBeforeCard),
      cardFee: r2(cardFee),
      totalLanded: r2(totalLanded),
      marginRate: m,
      suggestedRetail: r2(suggestedRetail),
    },
  };
}

// ----------------------- API -----------------------

// Step 1: Confirm products
app.post("/api/resolve", async (req, res) => {
  try {
    const { urls } = req.body || {};
    if (!Array.isArray(urls) || urls.length === 0) {
      return res.status(400).json({ error: "No URLs" });
    }
    const out = [];
    for (const u of urls) {
      try {
        const r = await resolveOne(u);
        out.push(r);
        // slight stagger to be a polite client
        await sleep(200);
      } catch (e) {
        out.push({ url: u, error: "Resolve failed" });
      }
    }
    res.json({ items: out.filter(x => !x.error), errors: out.filter(x => x.error) });
  } catch (e) {
    console.error("RESOLVE ERROR", e);
    res.status(500).json({ error: "Resolve failed" });
  }
});

// Step 2: Quote
app.post("/api/quote", (req, res) => {
  try {
    const { items } = req.body || {};
    if (!Array.isArray(items) || !items.length) return res.status(400).json({ error: "No items" });
    return res.json(calcQuote(items));
  } catch (e) {
    console.error("QUOTE ERROR", e);
    res.status(500).json({ error: "Quote failed" });
  }
});

// Step 3: Checkout (Draft Order) — requires env vars set in Railway
app.post("/api/checkout", async (req, res) => {
  try {
    const token = process.env.SHOPIFY_TOKEN;
    const shop = process.env.SHOPIFY_SHOP; // e.g. spencer-deals-ltd.myshopify.com
    if (!token || !shop) return res.status(500).json({ error: "Shopify env vars missing" });

    const { items, totals, customer } = req.body || {};
    if (!Array.isArray(items) || !items.length) return res.status(400).json({ error: "No items" });

    const line_items = items.map(it => ({
      title: `Special Order – ${it.title}`,
      quantity: it.qty || 1,
      price: it.lineLanded,
      properties: [
        ...(it.url ? [{ name: "URL", value: it.url }] : []),
        { name: "Vendor", value: it.vendor || "Vendor" },
        ...(it.dimNote ? [{ name: "Notes", value: it.dimNote }] : []),
      ],
    }));

    const payload = {
      draft_order: {
        line_items,
        note: "Created via Instant Import",
        ...(customer?.email ? { email: customer.email } : {}),
        ...(customer?.phone ? { phone: customer.phone } : {}),
        use_customer_default_address: true,
      },
    };

    const r = await fetch(`https://${shop}/admin/api/2024-07/draft_orders.json`, {
      method: "POST",
      headers: {
        "X-Shopify-Access-Token": token,
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      body: JSON.stringify(payload),
    });
    const txt = await r.text();
    if (!r.ok) return res.status(400).json({ error: "Shopify draft order failed", detail: txt });

    const data = JSON.parse(txt);
    res.json({
      id: data?.draft_order?.id,
      name: data?.draft_order?.name,
      invoice_url: data?.draft_order?.invoice_url || data?.draft_order?.status_url || null,
    });
  } catch (e) {
    console.error("CHECKOUT ERROR", e);
    res.status(500).json({ error: "Checkout failed" });
  }
});

// health + root
app.get("/health", (_req, res) => res.json({ ok: true }));
app.get("/", (_req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
