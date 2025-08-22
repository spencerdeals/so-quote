// index.js — CORS-safe quote API with Scraper B + Amazon fallback
import express from "express";
import cors from "cors";

// ---------- CONFIG ----------
const SETTINGS = {
  CARD_FEE_RATE: 0.05,
  DEFAULT_FT3: 11.33,
  FREIGHT_PER_FT3: 6.00,
  FIXED_FEES_TOTAL: 148.00,
  US_SALES_TAX_RATE: 0.06625,
  DUTY_RATE: 0.25,
  COMPETITIVE: true, // SDL import competitive margin (temporary)
};
const SCRAPER_B_URL = process.env.SCRAPER_B_URL || ""; // e.g. https://scraper-b.yourdomain/scrape

// ---------- SERVER ----------
const app = express();
app.use(express.json({ limit: "1mb" }));

// CORS: allow Canva + everywhere (we can tighten later)
app.use(
  cors({
    origin: (origin, cb) => cb(null, true),
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type"],
    credentials: false,
    maxAge: 86400,
  })
);
app.options("*", cors());

// Health
app.get(["/", "/health"], (_req, res) =>
  res.json({ ok: true, version: "alpha-sdl-canva", cors: "enabled" })
);

// ---------- Helpers ----------
function marginRateByVolume(totalFt3) {
  const standard = (v) => (v < 10 ? 0.40 : v < 20 ? 0.30 : v < 50 ? 0.25 : 0.20);
  const competitive = (v) => Math.max(0, standard(v) - 0.05); // 35/25/20/15
  return SETTINGS.COMPETITIVE ? competitive(totalFt3) : standard(totalFt3);
}
function to95(n) { const w = Math.floor(n); return w + 0.95; }

function priceOrder(
