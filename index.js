import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import * as cheerio from "cheerio";

const app = express();
app.use(cors());
app.use(express.json({ limit: "4mb" }));

const VERSION = "InstantImport3-alpha-titles";

app.get(["/", "/health"], (_req, res) => {
  res.json({ ok: true, version: VERSION, calc: "price-sum", time: new Date().toISOString() });
});

/* ---------- Helpers ---------- */
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36";
const ACCEPT_LANG = "en-US,en;q=0.9";

function parseMoney(str) {
  if (!str) return undefined;
  const cleaned = String(str).replace(/[^0-9.,]/g, "");
  const normalized = cleaned.replace(/,(?=\d{3}(\D|$))/g, "");
  const n = parseFloat(normalized.replace(/,/g, "."));
  return Number.isFinite(n) ? n : undefined;
}
function first(...vals) {
  for (const v of vals) if (v !== undefined && v !== null && v !== "") return v;
  return undefined;
}
function cleanTitle(t) {
  if (!t) return undefined;
  let s = String(t).replace(/\s+/g, " ").trim();
  // Common retailer noise
  s = s.replace(/^Amazon\.com:\s*/i, "").replace(/\s*[-–]\s*Amazon\.com$/i, "");
  s = s.replace(/\s*\|\s*Wayfair\s*$/i, "");
  return s || undefined;
}
async function fetchHtml(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 10000);
  try {
    const r = await fetch(url, {
      headers: { "user-agent": UA
