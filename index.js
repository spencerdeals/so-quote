
// so-quote — backend API wired to Scraper B + SDL pricing
// Routes:
//   GET  /health  -> { ok: true, service: "so-quote", ... }
//   POST /quote   -> { items: [ { link, name, image, variants, qty, unit, total } ] }

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

// Config
const SCRAPER_B_URL = process.env.SCRAPER_B_URL;
const SETTINGS = {
  CARD_FEE_RATE: 0.05,
  DEFAULT_FT3: 11.33,
  FREIGHT_PER_FT3: 6.0,
  FIXED_FEES_TOTAL: 148.0,
  US_SALES_TAX_RATE: 0.06625,
  DUTY_RATE: 0.25,
  COMPETITIVE: true,
};

// Helpers
function marginRateByVolume(totalFt3){
  const standard = (v)=> v<10?0.40 : v<20?0.30 : v<50?0.25 : 0.20;
  const competitive = (v)=> Math.max(0, standard(v)-0.05);
  return SETTINGS.COMPETITIVE? competitive(totalFt3) : standard(totalFt3);
}
function to95(n){ const w=Math.floor(n); return w+0.95; }

function priceOrder(items){
  const totalFt3 = items.reduce((s,i)=> s+(i.ft3||SETTINGS.DEFAULT_FT3)*(i.qty||1),0);
  const margin = marginRateByVolume(totalFt3);
  const perVol = (ft3)=> totalFt3>0? ft3/totalFt3 : 0;

  return items.map(it=>{
    const qty = it.qty||1;
    const ft3 = it.ft3||SETTINGS.DEFAULT_FT3;
    const first = Number(it.firstCost)||0;

    const usTax = first*SETTINGS.US_SALES_TAX_RATE;
    const dutyBase = first+usTax;
    const duty = dutyBase*SETTINGS.DUTY_RATE;
    const freight = ft3*SETTINGS.FREIGHT_PER_FT3;
    const fixed = SETTINGS.FIXED_FEES_TOTAL*perVol(ft3*qty)/Math.max(1,qty);

    const landed = first+usTax+duty+freight+fixed;
    const preCard = landed*(1+margin);
    const cardFee = preCard*SETTINGS.CARD_FEE_RATE;
    const unit = to95(preCard+cardFee);
    const total = unit*qty;

    return { ...it, qty, ft3, unit, total };
  });
}

async function scrapeOne(url){
  if(!SCRAPER_B_URL) throw new Error("SCRAPER_B_URL not set");
  const resp = await fetch(SCRAPER_B_URL,{ method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ url }) });
  if(!resp.ok) throw new Error(`Scraper B ${resp.status}`);
  const j = await resp.json();
  return { link:url, name:j.name??null, image:j.image??null, variants:Array.isArray(j.variants)? j.variants:[], firstCost: typeof j.price==="number"? j.price: (j.price? Number(j.price):0) };
}

// Routes
app.get(["/","/health"], (_req,res)=>{ res.json({ ok:true, service:"so-quote", cors:"enabled", scraperB:!!SCRAPER_B_URL }); });

app.post("/quote", async (req,res)=>{
  try{
    const { links } = req.body || {};
    if(!Array.isArray(links)||!links.length) return res.json({ items:[] });

    const scraped=[];
    for(const link of links){
      try{ scraped.push(await scrapeOne(link)); }
      catch(e){ scraped.push({ link, error:String(e), name:null, firstCost:0, qty:1, ft3:SETTINGS.DEFAULT_FT3 }); }
    }

    const priced = priceOrder(scraped.map(x=>({ ...x, qty:1, ft3:SETTINGS.DEFAULT_FT3 })));
    res.json({ items: priced });
  }catch(e){ res.status(500).json({ error:String(e) }); }
});

const PORT=process.env.PORT||3000;
app.listen(PORT,()=>console.log("so-quote running on",PORT));
