
// so-quote — ScrapingBee primary, Scraper B fallback, SDL pricing
import express from "express";
import cors from "cors";

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(
  cors({
    origin: (o, cb) => cb(null, true),
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type"],
    maxAge: 86400,
  })
);
app.options("*", cors());

// -------- ENV --------
const SCRAPINGBEE_API_KEY = process.env.SCRAPINGBEE_API_KEY; // primary
const SCRAPER_B_URL = process.env.SCRAPER_B_URL;             // fallback

// -------- SDL SETTINGS --------
const SETTINGS = {
  CARD_FEE_RATE: 0.05,
  DEFAULT_FT3: 11.33,
  FREIGHT_PER_FT3: 6.0,
  FIXED_FEES_TOTAL: 148.0,
  US_SALES_TAX_RATE: 0.06625,
  DUTY_RATE: 0.25,
  COMPETITIVE: true, // 35/25/20/15
};

function marginRateByVolume(totalFt3){
  const standard = (v)=> v<10?0.40 : v<20?0.30 : v<50?0.25 : 0.20;
  const competitive = (v)=> Math.max(0, standard(v)-0.05);
  return SETTINGS.COMPETITIVE ? competitive(totalFt3) : standard(totalFt3);
}
function to95(n){ const w = Math.floor(n); return w + 0.95; }

function priceOrder(items){
  const totalFt3 = items.reduce((s,i)=> s + (i.ft3 ?? SETTINGS.DEFAULT_FT3) * (i.qty ?? 1), 0);
  const margin = marginRateByVolume(totalFt3);
  const perVol = (ft3)=> totalFt3>0 ? ft3/totalFt3 : 0;

  return items.map(it=>{
    const qty = it.qty ?? 1;
    const ft3 = it.ft3 ?? SETTINGS.DEFAULT_FT3;
    const first = Number(it.firstCost) || 0;

    const usTax = first * SETTINGS.US_SALES_TAX_RATE;
    const dutyBase = first + usTax;
    const duty = dutyBase * SETTINGS.DUTY_RATE;
    const freight = ft3 * SETTINGS.FREIGHT_PER_FT3;
    const fixed = SETTINGS.FIXED_FEES_TOTAL * perVol(ft3 * qty) / Math.max(1, qty);

    const landed = first + usTax + duty + freight + fixed;
    const preCard = landed * (1 + margin);
    const cardFee = preCard * SETTINGS.CARD_FEE_RATE;
    const unit = to95(preCard + cardFee);
    const total = unit * qty;

    return { ...it, qty, ft3, unit, total };
  });
}

// -------- SCRAPERS --------
async function scrapeViaBee(url){
  if (!SCRAPINGBEE_API_KEY) throw new Error("SCRAPINGBEE_API_KEY not set");
  const api = "https://app.scrapingbee.com/api/v1";
  const q = new URLSearchParams({ api_key: SCRAPINGBEE_API_KEY, url, render_js: "true" });
  const resp = await fetch(`${api}?${q.toString()}`);
  if (!resp.ok) throw new Error(`Bee HTTP ${resp.status}`);
  const html = await resp.text();

  const pick = (re) => {
    const m = html.match(re);
    return m ? m[1] : null;
  };

  let name = pick(/<span[^>]*id=["']productTitle["'][^>]*>([^<]+)<\/span>/i);
  if (name) name = name.replace(/\s+/g," ").trim();

  let price = null;
  let m = html.match(/"priceToPay"[^}]*"amount"\s*:\s*([0-9.]+)/i);
  if (m) price = parseFloat(m[1]);
  if (price == null) {
    m = html.match(/<span[^>]*class=["']a-offscreen["'][^>]*>\$([0-9.,]+)<\/span>/i);
    if (m) price = parseFloat(m[1].replace(/,/g,""));
  }

  let image = pick(/"hiRes":"(https:[^"]+)"/i);
  if (!image) image = pick(/"large":"(https:[^"]+)"/i);
  if (image) image = image.replace(/\\u0026/g,"&");

  const variants = [];
  const dv = pick(/"dimensionValuesDisplayData"\s*:\s*(\{[^}]+\})/i);
  if (dv) {
    try {
      const obj = JSON.parse(dv.replace(/\\u0022/g,'"'));
      for (const k of Object.keys(obj)) variants.push(`${k}: ${obj[k]}`);
    } catch {}
  } else {
    const color = pick(/"color_name"\s*:\s*"([^"]+)"/i);
    const style = pick(/"style_name"\s*:\s*"([^"]+)"/i);
    if (color) variants.push(`Color: ${color}`);
    if (style) variants.push(`Configuration: ${style}`);
  }

  return { name, price, image, variants };
}

async function scrapeViaScraperB(url){
  if (!SCRAPER_B_URL) throw new Error("SCRAPER_B_URL not set");
  const resp = await fetch(SCRAPER_B_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url })
  });
  if (!resp.ok) throw new Error(`Scraper B ${resp.status}`);
  const j = await resp.json();
  return {
    name: j.name ?? null,
    price: typeof j.price === "number" ? j.price : (j.price ? Number(j.price) : null),
    image: j.image ?? null,
    variants: Array.isArray(j.variants) ? j.variants : []
  };
}

async function scrapeOne(url){
  try {
    const a = await scrapeViaBee(url);
    if (a && (a.price || a.name)) return a;
    throw new Error("Bee returned no data");
  } catch (e) {
    const b = await scrapeViaScraperB(url);
    return b;
  }
}

// -------- ROUTES --------
app.get(["/","/health"], (_req,res)=>{
  res.json({
    ok: true,
    service: "so-quote",
    cors: "enabled",
    bee: !!SCRAPINGBEE_API_KEY,
    scraperB: !!SCRAPER_B_URL
  });
});

app.post("/quote", async (req,res)=>{
  try{
    const { links } = req.body || {};
    if (!Array.isArray(links) || links.length === 0) return res.json({ items: [] });

    const scraped = [];
    for (const link of links) {
      try {
        const s = await scrapeOne(link);
        scraped.push({
          link,
          name: s.name ?? null,
          image: s.image ?? null,
          variants: s.variants ?? [],
          firstCost: s.price ?? null,
          qty: 1,
          ft3: SETTINGS.DEFAULT_FT3
        });
      } catch (e) {
        scraped.push({ link, name: null, image: null, variants: [], firstCost: null, qty: 1, ft3: SETTINGS.DEFAULT_FT3, error: String(e?.message || e) });
      }
    }

    const toPrice = scraped.filter(x => typeof x.firstCost === "number" && isFinite(x.firstCost));
    const priced = priceOrder(toPrice);

    const items = scraped.map(x => {
      const p = priced.find(y => y.link === x.link);
      return {
        link: x.link,
        name: x.name,
        image: x.image,
        variants: x.variants,
        qty: x.qty,
        unit: p ? p.unit : null,
        total: p ? p.total : null,
        error: x.error || (p ? null : (typeof x.firstCost !== "number" ? "No price" : null))
      };
    });

    res.json({ items });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, ()=> console.log("so-quote running on", PORT));
