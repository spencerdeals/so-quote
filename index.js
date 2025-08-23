// index.js — Instant Quote (#alpha) — full paste-and-replace
// Server: Express app that serves the live Instant Quote UI at `/`
// and provides health/debug endpoints. Frontend is embedded below.
//
// Notes for Richard:
// - Paste this entire file over your current index.js in your Railway app.
// - No surgery needed. Deploy after paste.
// - Root `/` serves the actual quote UI (replaces the placeholder).
// - Health shows version so you can confirm the right build is running.
//
// Assumptions from our setup:
// - Backend quote API: https://so-quote.fly.dev/quote  (from our V4 build)
// - If you later swap to your own endpoint, change QUOTE_API below.
// - Uses ScrapingBee on the backend per our standing preference.
//
// Version tag: 2025-08-23 #alpha
//
const express = require("express");
const cors = require("cors");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

// ===== Config you may tweak quickly =====
const QUOTE_API = process.env.QUOTE_API || "https://so-quote.fly.dev/quote";
const APP_VERSION = process.env.APP_VERSION || "alpha-2025-08-23";
// =======================================

app.use(cors());
app.use(express.json({ limit: "2mb" }));

// Serve any static files if you add them later (optional)
app.use("/public", express.static(path.join(__dirname, "public")));

// Health & debug
app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    version: "3.3-prices",
    calc: "price-sum",
    app: APP_VERSION,
  });
});

app.get("/debug-index", (_req, res) => {
  res.type("text/plain").send(`index.js loaded: ${APP_VERSION}`);
});

// Root: serve the Instant Quote UI (embedded HTML + JS)
app.get("/", (_req, res) => {
  res.type("html").send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>SDL — Instant Quote (#alpha)</title>
  <style>
    :root {
      --sdl-green: #2c7a3f;
      --sdl-green-2: #1f5a2d;
      --bg: #f5f7f5;
      --card: #ffffff;
      --muted: #6b7280;
      --danger: #b91c1c;
      --ring: rgba(44,122,63,0.25);
    }
    * { box-sizing: border-box; }
    html, body {
      margin: 0; padding: 0; background: var(--bg);
      font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, "Apple Color Emoji","Segoe UI Emoji";
      color: #111827;
    }
    .wrap { max-width: 1100px; margin: 28px auto; padding: 0 16px; }
    .topbar {
      display:flex; align-items:center; justify-content:space-between;
      margin-bottom: 16px;
    }
    .brand { display:flex; align-items:center; gap:12px; }
    .logo {
      width: 36px; height: 36px; border-radius: 8px;
      background: linear-gradient(135deg, var(--sdl-green), var(--sdl-green-2));
      display:flex; align-items:center; justify-content:center;
      color: #fff; font-weight: 800;
      box-shadow: 0 6px 16px rgba(0,0,0,0.12);
    }
    .brand h1 { font-size: 18px; margin: 0; }
    .card {
      background: var(--card); border-radius: 14px; padding: 18px;
      box-shadow: 0 8px 26px rgba(0,0,0,0.06);
      border: 1px solid #e5e7eb;
    }
    .steps { display:flex; gap:8px; margin-bottom: 14px; flex-wrap: wrap; }
    .step {
      padding: 10px 12px; border-radius: 999px; font-size: 14px;
      border: 1px solid #e5e7eb; background: #fff; color:#111827;
    }
    .step.active { background: var(--sdl-green); color: #fff; border-color: var(--sdl-green); }
    .grid { display:grid; grid-template-columns: 1fr; gap: 12px; }
    @media (min-width: 900px) {
      .grid { grid-template-columns: 1.2fr 1fr; }
    }
    label { font-size: 13px; color: #374151; }
    textarea, input[type="text"] {
      width: 100%; padding: 12px 12px; border-radius: 10px;
      border: 1px solid #d1d5db; background: #fff; outline: none;
    }
    textarea:focus, input:focus { border-color: var(--sdl-green); box-shadow: 0 0 0 4px var(--ring); }
    .btn {
      display:inline-flex; align-items:center; justify-content:center;
      padding: 10px 14px; border-radius: 10px; border: 1px solid transparent;
      background: var(--sdl-green); color: #fff; font-weight: 600; cursor: pointer;
    }
    .btn.secondary { background:#fff; color:#111827; border-color:#d1d5db; }
    .btn:disabled { opacity:.6; cursor:not-allowed; }
    .muted { color: var(--muted); font-size: 13px; }
    .table {
      width:100%; border-collapse: collapse; overflow: hidden; border-radius: 10px;
      border: 1px solid #e5e7eb;
    }
    .table th, .table td { padding: 10px 12px; text-align:left; border-bottom:1px solid #f1f5f9; }
    .table th { background:#f8fafc; font-size: 13px; color:#374151; }
    .pill { font-size:12px; padding: 4px 8px; border-radius: 999px; background:#eef2ff; }
    .warn { color: var(--danger); font-weight: 600; }
    .footer { margin-top: 14px; display:flex; align-items:center; justify-content: space-between; }
    .okbar {
      margin-top: 12px; padding: 10px 12px; border: 1px dashed #d1d5db; border-radius: 10px; background: #fafafa;
      font-size: 13px;
    }
    .total { font-size: 18px; font-weight: 700; }
    .sticky-actions { display:flex; gap:8px; flex-wrap: wrap; }
    .sublabel { font-size: 12px; color: #6b7280; }
    .badge { background:#e8f5ee; border:1px solid #cce9d9; color:#0b4722; padding:4px 8px; border-radius: 999px; font-size:12px; }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="topbar">
      <div class="brand">
        <div class="logo">$</div>
        <h1>SDL — Instant Quote</h1>
        <span class="badge">#alpha</span>
      </div>
      <div class="sticky-actions">
        <button id="btnHealth" class="btn secondary" type="button">Check Health</button>
        <button id="btnReset" class="btn secondary" type="button">Reset</button>
      </div>
    </div>

    <div class="card">
      <div class="steps">
        <div class="step active">1 · Upload Links</div>
        <div class="step">2 · Quote Review</div>
        <div class="step">3 · Approve & Pay</div>
      </div>

      <div class="grid">
        <div>
          <label for="links"><strong>Paste product links (one per line)</strong></label>
          <textarea id="links" rows="8" placeholder="https://example.com/product-1
https://another.com/sku-ABC123"></textarea>

          <div style="display:flex; gap:8px; margin-top:10px; align-items:center;">
            <button id="btnQuote" class="btn" type="button">Generate Quote</button>
            <span class="muted">Backend: <code id="apiSpan"></code></span>
          </div>

          <div id="noteBar" class="okbar" style="display:none;"></div>
        </div>

        <div>
          <div style="display:flex; align-items:center; justify-content:space-between">
            <div>
              <div><strong>Summary</strong></div>
              <div class="sublabel">Customer-friendly totals only.</div>
            </div>
            <div><span class="pill" id="statusPill">Idle</span></div>
          </div>
          <div style="margin-top:10px;">
            <table class="table" id="quoteTable" style="display:none;">
              <thead>
                <tr>
                  <th style="width: 40%;">Item</th>
                  <th>Qty</th>
                  <th>Unit</th>
                  <th>Total</th>
                </tr>
              </thead>
              <tbody id="quoteBody"></tbody>
            </table>
            <div id="totalsBlock" style="display:none; margin-top: 10px;" class="total"></div>
          </div>
        </div>
      </div>

      <div class="footer">
        <div class="muted">Hidden settings: consolidated freight $6.00/ft³; import margin SDL.</div>
        <div style="display:flex; gap:8px;">
          <button class="btn secondary" id="btnExport" type="button">Export JSON</button>
          <button class="btn" id="btnApprove" type="button" disabled>Approve & Continue</button>
        </div>
      </div>
    </div>
  </div>

  <script>
    const QUOTE_API = ${JSON.stringify(QUOTE_API)};
    document.getElementById("apiSpan").textContent = QUOTE_API;

    const el = {
      links: document.getElementById("links"),
      btnQuote: document.getElementById("btnQuote"),
      btnReset: document.getElementById("btnReset"),
      btnHealth: document.getElementById("btnHealth"),
      quoteTable: document.getElementById("quoteTable"),
      quoteBody: document.getElementById("quoteBody"),
      totalsBlock: document.getElementById("totalsBlock"),
      statusPill: document.getElementById("statusPill"),
      noteBar: document.getElementById("noteBar"),
      btnExport: document.getElementById("btnExport"),
      btnApprove: document.getElementById("btnApprove"),
    };

    let lastQuote = null;

    function setStatus(text) {
      el.statusPill.textContent = text;
    }

    function showNote(text, warn=false) {
      el.noteBar.style.display = "block";
      el.noteBar.textContent = text;
      el.noteBar.style.borderColor = warn ? "#fca5a5" : "#d1d5db";
      el.noteBar.style.background = warn ? "#fef2f2" : "#fafafa";
    }

    function hideNote() {
      el.noteBar.style.display = "none";
      el.noteBar.textContent = "";
    }

    function parseLinks(raw) {
      return raw.split(/\\r?\\n/).map(s => s.trim()).filter(Boolean);
    }

    function renderQuote(quote) {
      // Expecting { items: [{title, qty, unitPrice, total}], totals: {grandTotal} }
      // We'll be resilient to shapes we know from V4.
      el.quoteBody.innerHTML = "";
      let grand = 0;

      const items = Array.isArray(quote?.items) ? quote.items : [];
      items.forEach((it) => {
        const tr = document.createElement("tr");
        const qty = Number(it.qty || it.quantity || 1);
        const unit = Number(it.unitPrice || it.unit || 0);
        const total = Number(it.total || (unit * qty) || 0);
        grand += total;

        const td1 = document.createElement("td"); td1.textContent = it.title || it.name || "Item";
        const td2 = document.createElement("td"); td2.textContent = qty;
        const td3 = document.createElement("td"); td3.textContent = unit.toFixed(2);
        const td4 = document.createElement("td"); td4.textContent = total.toFixed(2);

        tr.appendChild(td1); tr.appendChild(td2); tr.appendChild(td3); tr.appendChild(td4);
        el.quoteBody.appendChild(tr);
      });

      // Fallback: if API returns totals.grandTotal, use that.
      const apiGrand = Number(quote?.totals?.grandTotal || quote?.grandTotal || 0);
      if (apiGrand > 0) grand = apiGrand;

      el.quoteTable.style.display = items.length ? "table" : "none";
      el.totalsBlock.style.display = "block";
      el.totalsBlock.textContent = "Grand total: $" + grand.toFixed(2);
      el.btnApprove.disabled = grand <= 0;
    }

    async function fetchQuote(urls) {
      setStatus("Fetching…");
      hideNote();
      try {
        const resp = await fetch(QUOTE_API, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ urls }),
        });
        if (!resp.ok) {
          const text = await resp.text();
          throw new Error("API error " + resp.status + ": " + text);
        }
        const data = await resp.json();
        lastQuote = data;
        renderQuote(data);

        // Show manual override hint if any item has unitPrice 0
        const zero = (data?.items || []).some(i => Number(i.unitPrice || 0) <= 0);
        if (zero) {
          showNote("Some items returned a unit price of $0. You can override unit prices in the review step.", true);
        }
        setStatus("Done");
      } catch (err) {
        console.error(err);
        setStatus("Error");
        showNote("Failed to generate quote: " + err.message, true);
      }
    }

    el.btnQuote.addEventListener("click", () => {
      const urls = parseLinks(el.links.value);
      if (!urls.length) {
        showNote("Please paste one or more product links (one per line).", true);
        return;
      }
      fetchQuote(urls);
    });

    el.btnReset.addEventListener("click", () => {
      el.links.value = "";
      el.quoteBody.innerHTML = "";
      el.quoteTable.style.display = "none";
      el.totalsBlock.style.display = "none";
      el.btnApprove.disabled = true;
      setStatus("Idle");
      hideNote();
    });

    el.btnHealth.addEventListener("click", async () => {
      try {
        const r = await fetch("/health");
        const j = await r.json();
        showNote("Health: " + JSON.stringify(j));
      } catch (e) {
        showNote("Health check failed: " + e.message, true);
      }
    });

    el.btnExport.addEventListener("click", () => {
      const blob = new Blob([JSON.stringify(lastQuote || {}, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = "instant-quote.json"; a.click();
      URL.revokeObjectURL(url);
    });

    el.btnApprove.addEventListener("click", () => {
      showNote("Approval flow coming next — this button is wired and can post to checkout when ready.");
    });
  </script>
</body>
</html>`);
});

// 404
app.use((_req, res) => {
  res.status(404).json({ ok: false, error: "Not found" });
});

app.listen(PORT, () => {
  console.log("Server running on http://localhost:" + PORT);
});
