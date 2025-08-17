// index.js — serves /public, auto-scrapes price & cubic ft, returns quote
const express = require("express");
const path = require("path");
const fs = require("fs");
const cheerio = require("cheerio");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: "1mb" }));

// Serve static; don't cache HTML so you don't see stale builds
app.use(
  express.static(path.join(__dirname, "public"), {
    setHeaders: (res, filePath) => {
      if (filePath.endsWith(".html")) {
        res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
        res.setHeader("Pragma", "no-cache");
        res.setHeader("Expires", "0");
        res.setHeader("Surrogate-Control", "no-store");
      } else {
        res.setHeader("Cache-Control", "public, max-age=3600");
      }
    },
  })
);

// Root
app.get("/", (_req, res) => {
  res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// Health + debug (optional but super helpful)
app.get("/health", (_req, res) => res.status(200).send("OK"));
app.get("/debug-index", (_req, res) => {
  try {
    const html = fs.readFileSync(path.join(__dirname, "public", "index.html"), "utf8");
    res.type("text/plain").send(html);
  } catch (e) {
    res.status(500).type("text/plain").send("Failed to read index.html: " + e.message);
  }
});

/**
 * POST /quote
 * Body: { name, email, link, category, quantity }
 * - Scrapes price & cubic ft (fallbacks if missing)
 * - Applies your tax/duty/wharfage/freight/fixed-fee/margin/card rules
 * - Returns a summary object for the UI
 */
app.post("/quote", async (req, res) => {
  try {
    const { name = "", email = "", link = "", category = "", quantity } = req.body || {};
    const qty = Math.max(1, parseInt(quantity || "1", 10));
    if (!/^https?:\/\//i.test(link)) return res.status(400).json({ error: "Valid product URL required." });

    // --- scrape ---
    let { priceUSD, cubicFt } = await autoScrape(link);
    const notes = [];
    if (!Number.isFinite(priceUSD)) { priceUSD = 0; notes.push("Couldn’t auto-read price."); }
    if (!Number.isFinite(cubicFt) || cubicFt <= 0) { cubicFt = 11.33; notes.push("Couldn’t auto-read dimensions; used default 11.33 ft³ per unit."); }

    // --- rules ---
    const taxRate = /(amazon|wayfair)\./i.test(link) ? 0 : 0.06625;
    const freightRate = 16.17;          // $ per cubic ft
    const fixedFeesTotal = 148;         // spread across items
    const dutyRate = category === "upholstered" ? 0.25 : 0.00;
    const wharfageRate = 0.02;
    const cardFeeRate = 0.0325;

    const volPerUnit = cubicFt;
    const totalVol = volPerUnit * qty;

    let margin =
      totalVol < 10 ? 0.40 :
      totalVol < 20 ? 0.30 :
      totalVol < 50 ? 0.25 : 0.20;

    const firstCost = priceUSD;
    const salesTax = firstCost * taxRate;
    const duty = firstCost * dutyRate;
    const wharfage = firstCost * wharfageRate;
    const freightPerUnit = volPerUnit * freightRate;
    const fixedFeesPerUnit = fixedFeesTotal / qty;

    const landedPerUnit = firstCost + salesTax + duty + wharfage + freightPerUnit + fixedFeesPerUnit;

    // cap margins by landed tiers
    if (landedPerUnit > 1000) margin = Math.min(margin, 0.25);
    if (landedPerUnit > 3000) margin = Math.min(margin, 0.20);
    if (landedPerUnit > 5000) margin = Math.min(margin, 0.15);

    let retailPerUnit = landedPerUnit * (1 + margin);
    retailPerUnit *= (1 + cardFeeRate);
    retailPerUnit = Math.round(retailPerUnit) - 0.05; // nice pricing

    const summary = {
      items: qty,
      firstCost: firstCost,
      salesTax,
      duty,
      wharfage,
      freight: freightPerUnit,
      fixedFees: fixedFeesPerUnit,
      totalLanded: landedPerUnit,
      marginPct: Math.round(margin * 100),
      suggestedRetail: retailPerUnit,
      auto: { priceUSD: firstCost || null, cubicFt: volPerUnit || null, notes }
    };

    res.json({ customer: { name, email }, link, category, summary });
  } catch (e) {
    console.error("QUOTE ERROR:", e);
    res.status(500).json({ error: "Failed to create quote" });
  }
});

// --- helper: scrape price + cubic ft ---
async function autoScrape(url) {
  try {
    const resp = await fetch(url, {
      headers: {
        "user-agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "accept-language": "en-US,en;q=0.9"
      }
    });
    if (!resp.ok) throw new Error(`fetch ${resp.status}`);
    const html = await resp.text();
    const $ = cheerio.load(html);

    const priceUSD = extractPrice($, html, url);
    const cubicFt = extractCubicFt($, html);
    return { priceUSD, cubicFt };
  } catch {
    return { priceUSD: NaN, cubicFt: NaN };
  }
}

function extractPrice($, html, url) {
  if (/amazon\./i.test(url)) {
    const meta = $('meta[property="og:price:amount"]').attr("content")
      || $('span#priceblock_ourprice').text()
      || $('span#corePrice_desktop span.a-offscreen').first().text();
    const p = money(meta); if (p) return p;
  }
  if (/wayfair\./i.test(url)) {
    const wf = $('[data-universal-price]').attr('data-universal-price')
      || $('[data-test-id="pricing"]').text()
      || $('[class*="Price"]').text();
    const p = money(wf); if (p) return p;
  }
  const near = findNear(html, /price|our price|sale/i, /\$[\s]*[0-9\.,]+/);
  const p1 = money(near); if (p1) return p1;
  const any = (html.match(/\$[\s]*[0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})?/i) || [])[0];
  return money(any) || NaN;
}

function extractCubicFt($, html) {
  const explicit =
    firstGroup(html, /(cubic[\s-]*feet|ft³|cu\.?\s*ft|cuft)[^\d]{0,10}([\d\.]+)/i) ||
    firstGroup(html, /([\d\.]+)[^\d]{0,10}(cubic[\s-]*feet|ft³|cu\.?\s*ft|cuft)/i);
  if (explicit) {
    const v = parseFloat(explicit);
    if (isFinite(v) && v > 0.01) return v;
  }

  // try L x W x H with units
  const dimsBlock =
    findNear(html, /dimension|overall|product size|item dimensions/i, /([0-9\.]+\s?("|in|inches|cm|mm)).{0,40}([0-9\.]+\s?("|in|inches|cm|mm)).{0,40}([0-9\.]+\s?("|in|inches|cm|mm))/i) || html;

  const m = /([0-9\.]+)\s*(?:\"|in|inch|inches|cm|mm)[^\d]{0,20}([0-9\.]+)\s*(?:\"|in|inch|inches|cm|mm)[^\d]{0,20}([0-9\.]+)\s*(?:\"|in|inch|inches|cm|mm)/i.exec(dimsBlock);
  if (m) {
    const [Lr, Wr, Hr] = m.slice(1, 4).map(s => s.toLowerCase());
    const L = toInches(Lr), W = toInches(Wr), H = toInches(Hr);
    if ([L, W, H].every(x => isFinite(x) && x > 0)) return (L * W * H) / 1728;
  }
  return NaN;
}

// --- tiny utils ---
function money(s){ if(!s) return 0; const m=String(s).replace(/[, ]/g,"").match(/\$?([0-9]+(?:\.[0-9]{2})?)/); return m?parseFloat(m[1]):0; }
function toInches(val){ const n=parseFloat(val); if(!isFinite(n)) return NaN; if(/cm/.test(val)) return n/2.54; if(/mm/.test(val)) return n/25.4; return n; }
function firstGroup(text,re){ const m=re.exec(text); return m ? (m[2]||m[1]) : null; }
function findNear(text, anchorRe, valueRe){
  const a=anchorRe.exec(text); if(!a) return null;
  const start=Math.max(0,a.index-800), end=Math.min(text.length,a.index+1200);
  const win=text.slice(start,end); const v=valueRe.exec(win); return v? v[0] : null;
}

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
