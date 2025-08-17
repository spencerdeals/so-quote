// index.js — static server + /scrape endpoint
const express = require("express");
const path = require("path");
const cheerio = require("cheerio");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public"), { maxAge: "1h" }));

app.get("/", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// Health check (optional)
app.get("/health", (_req, res) => res.status(200).send("OK"));

// Scrape endpoint
app.post("/scrape", async (req, res) => {
  try {
    const { url } = req.body || {};
    if (!url || !/^https?:\/\//i.test(url)) {
      return res.status(400).json({ error: "Invalid URL" });
    }

    const resp = await fetch(url, {
      headers: {
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

    res.json({
      priceUSD: Number.isFinite(priceUSD) ? priceUSD : null,
      cubicFt: Number.isFinite(cubicFt) ? cubicFt : null,
    });
  } catch (e) {
    console.error("SCRAPE ERROR:", e);
    res.status(500).json({ error: "Scrape error" });
  }
});

// ---------- helpers ----------
function extractPrice($, html, url) {
  if (/amazon\./i.test(url)) {
    const meta = $('meta[property="og:price:amount"]').attr("content")
      || $('span#priceblock_ourprice').text()
      || $('span#corePrice_desktop span.a-offscreen').first().text();
    const p = parseMoney(meta); if (p) return p;
  }
  if (/wayfair\./i.test(url)) {
    const wf = $('[data-universal-price]').attr('data-universal-price')
      || $('[data-test-id="pricing"]').text()
      || $('[class*="Price"]').text();
    const p = parseMoney(wf); if (p) return p;
  }
  const priceNear = findNear(html, /price|our price|sale/i, /\$[\s]*[0-9\.,]+/);
  const p1 = parseMoney(priceNear); if (p1) return p1;
  const any = (html.match(/\$[\s]*[0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})?/i) || [])[0];
  const p2 = parseMoney(any);
  return p2 || NaN;
}

function extractCubicFt($, html) {
  const explicit =
    findFirstMatch(html, /(cubic[\s-]*feet|ft³|cu\.?\s*ft|cuft)[^\d]{0,10}([\d\.]+)/i) ||
    findFirstMatch(html, /([\d\.]+)[^\d]{0,10}(cubic[\s-]*feet|ft³|cu\.?\s*ft|cuft)/i);
  if (explicit) {
    const v = parseFloat(explicit);
    if (isFinite(v) && v > 0.01) return v;
  }

  const dimsBlock =
    findNear(html, /dimension|overall|product size|item dimensions/i, /([0-9\.]+\s?("|in|inches|cm|mm)).{0,40}([0-9\.]+\s?("|in|inches|cm|mm)).{0,40}([0-9\.]+\s?("|in|inches|cm|mm))/i) ||
    html;

  const dimMatch = /([0-9\.]+)\s*(?:\"|in|inch|inches|cm|mm)[^\d]{0,20}([0-9\.]+)\s*(?:\"|in|inch|inches|cm|mm)[^\d]{0,20}([0-9\.]+)\s*(?:\"|in|inch|inches|cm|mm)/i.exec(dimsBlock);
  if (dimMatch) {
    const [Lr, Wr, Hr] = dimMatch.slice(1, 4).map(s => s.toLowerCase());
    const L = toInches(Lr), W = toInches(Wr), H = toInches(Hr);
    if ([L, W, H].every(x => isFinite(x) && x > 0)) {
      const cubicFeet = (L * W * H) / 1728;
      if (cubicFeet > 0.01) return cubicFeet;
    }
  }
  return NaN;
}

function parseMoney(s) {
  if (!s) return NaN;
  const m = String(s).replace(/[, ]/g, "").match(/\$?([0-9]+(?:\.[0-9]{2})?)/);
  return m ? parseFloat(m[1]) : NaN;
}
function toInches(val) {
  const n = parseFloat(val);
  if (!isFinite(n)) return NaN;
  if (/cm/.test(val)) return n / 2.54;
  if (/mm/.test(val)) return n / 25.4;
  return n; // inches by default
}
function findFirstMatch(text, re) {
  const m = re.exec(text);
  return m ? (m[2] || m[1]) : null;
}
function findNear(text, anchorRe, valueRe) {
  const a = anchorRe.exec(text);
  if (!a) return null;
  const start = Math.max(0, a.index - 800);
  const end = Math.min(text.length, a.index + 1200);
  const win = text.slice(start, end);
  const v = valueRe.exec(win);
  return v ? v[0] : null;
}

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
