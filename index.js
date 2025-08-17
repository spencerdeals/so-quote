// index.js — static server + /scrape endpoint
const express = require("express");
const path = require("path");
const cheerio = require("cheerio");
const fetch = require("node-fetch");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public"), { maxAge: "1h" }));

app.get("/", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.get("/health", (_req, res) => res.status(200).send("OK"));

// ---------- SCRAPER ----------
app.post("/scrape", async (req, res) => {
  try {
    const { url } = req.body || {};
    if (!url || !/^https?:\/\//i.test(url)) {
      return res.status(400).json({ error: "Invalid URL" });
    }

    const resp = await fetch(url, {
      headers: {
        // Helps some sites return full HTML
        "user-agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "accept-language": "en-US,en;q=0.9",
      },
    });

    if (!resp.ok) {
      return res.status(502).json({ error: `Fetch failed (${resp.status})` });
    }

    const html = await resp.text();
    const $ = cheerio.load(html);

    const priceUSD = extractPrice($, html, url);
    const cubicFt = extractCubicFt($, html);

    return res.json({
      priceUSD: isFinite(priceUSD) ? priceUSD : null,
      cubicFt: isFinite(cubicFt) ? cubicFt : null,
    });
  } catch (e) {
    console.error("SCRAPE ERROR:", e);
    return res.status(500).json({ error: "Scrape error" });
  }
});

// ---------- helpers ----------
function extractPrice($, html, url) {
  // AMAZON
  if (/amazon\./i.test(url)) {
    // meta price
    const meta = $('meta[property="og:price:amount"]').attr("content")
      || $('span#priceblock_ourprice').text()
      || $('span#corePrice_desktop span.a-offscreen').first().text();
    const p = parseMoney(meta);
    if (p) return p;
  }

  // WAYFAIR
  if (/wayfair\./i.test(url)) {
    // common places
    const wf = $('[data-universal-price]').attr('data-universal-price')
      || $('[data-test-id="pricing"]').text()
      || $('[class*="Price"]').text();
    const p = parseMoney(wf);
    if (p) return p;
  }

  // GENERIC: look for $123.45 near “price”
  const priceNear = findNear(html, /price|our price|sale/i, /\$[\s]*[0-9\.,]+/);
  const p1 = parseMoney(priceNear);
  if (p1) return p1;

  // fallback: first currency-looking number
  const any = (html.match(/\$[\s]*[0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})?/i) || [])[0];
  const p2 = parseMoney(any);
  return p2 || NaN;
}

function extractCubicFt($, html) {
  // If site provides cubic feet explicitly
  const explicit =
    findFirstMatch(html, /(cubic[\s-]*feet|ft³|cu\.?\s*ft|cuft)[^\d]{0,10}([\d\.]+)/i) ||
    findFirstMatch(html, /([\d\.]+)[^\d]{0,10}(cubic[\s-]*feet|ft³|cu\.?\s*ft|cuft)/i);
  if (explicit) {
    const v = parseFloat(explicit);
    if (isFinite(v) && v > 0.01) return v;
  }

  // Try to parse dimensions like: 80" L x 35" W x 30" H (inches)
  const dimsBlock =
    findNear(html, /dimension|overall|product size|item dimensions/i, /([0-9\.]+\s?("|in|inches|cm|mm)).{0,40}([0-9\.]+\s?("|in|inches|cm|mm)).{0,40}([0-9\.]+\s?("|in|inches|cm|mm))/i) ||
    html;

  const dimMatch = /([0-9\.]+)\s*(?:\"|in|inch|inches|cm|mm)[^\d]{0,20}([0-9\.]+)\s*(?:\"|in|inch|inches|cm|mm)[^\d]{0,20}([0-9\.]+)\s*(?:\"|in|inch|inches|cm|mm)/i.exec(
    dimsBlock
  );

  if (dimMatch) {
    const [Lr, Wr, Hr] = dimMatch.slice(1, 4).map(s => s.toLowerCase());
    const L = toInches(Lr);
    const W = toInches(Wr);
    const H = toInches(Hr);
    if ([L, W, H].every(x => isFinite(x) && x > 0)) {
      const cubicInches = L * W * H;
      const cubicFeet = cubicInches / 1728; // 12^3
      if (cubicFeet > 0.01) return cubicFeet;
    }
  }

  // Couldn’t find — return NaN; frontend will fall back to 11.33
  return NaN;
}

function parseMoney(s) {
  if (!s) return NaN;
  const m = String(s).replace(/[, ]/g, "").match(/\$?([0-9]+(?:\.[0-9]{2})?)/);
  return m ? parseFloat(m[1]) : NaN;
}
function toInches(val) {
  const num = parseFloat(val);
  if (!isFinite(num)) return NaN;
  if (/cm/.test(val)) return num / 2.54;
  if (/mm/.test(val)) return num / 25.4;
  return num; // inches by default
}
function findFirstMatch(text, re) {
  const m = re.exec(text);
  return m ? (m[2] || m[1]) : null;
}
function findNear(text, anchorRe, valueRe) {
  const a = anchorRe.exec
