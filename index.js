const express = require("express");
const path = require("path");
const fetch = require("node-fetch");            // npm i node-fetch@2
const { google } = require("googleapis");       // npm i googleapis

const app = express();
const PORT = process.env.PORT || 3000;

/** ====== ENV you must set in Railway ======
 * SHOPIFY_STORE=spencer-deals-ltd.myshopify.com (your .myshopify.com domain)
 * SHOPIFY_TOKEN=shpat_xxxxxxxxxxxxxxxxxxxxxxxxx (Admin REST token)
 * SHEETS_ID=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx (Google Sheet ID)
 * GCP_SA_JSON={"type":"service_account",...}  (Service account JSON string)
 * ===========================================
 */

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

/* ---------- Helpers ---------- */

// Try to guess vendor from link
function vendorFrom(link) {
  const u = (link||"").toLowerCase();
  if (u.includes("amazon.")) return "Amazon";
  if (u.includes("wayfair.")) return "Wayfair";
  return "Other";
}

// Try to scrape price if not provided (very light heuristic; optional)
async function tryFetchPrice(link) {
  try {
    const r = await fetch(link, { headers: { "user-agent": "Mozilla/5.0" } });
    const html = await r.text();
    // extremely naive patterns – good enough as fallback
    const m1 = html.match(/"price"\s*:\s*"(\d+(\.\d{1,2})?)"/i);
    if (m1) return parseFloat(m1[1]);
    const m2 = html.match(/\$([\d,]+\.\d{2})/);
    if (m2) return parseFloat(m2[1].replace(/,/g,""));
  } catch (e) {}
  return 0;
}

// cubic feet from inches; default carton if missing
function ft3(L, W, H) {
  const valid = L>0 && W>0 && H>0;
  return valid ? (L*W*H)/1728 : 11.33; // default fallback carton ft³
}

// Your landed rules for a single item (qty applied outside)
function calcLandedForItem({ firstCost, ft3Val, vendor }) {
  const usTax = (vendor === "Amazon" || vendor === "Wayfair") ? 0 : firstCost * 0.06625;
  const duty = firstCost * 0.25;
  const wharfage = firstCost * 0.02;
  const freight = ft3Val * 6.46;
  const fixedFee = 10; // per item
  const preCard = firstCost + usTax + duty + wharfage + freight + fixedFee;
  const cardFee = preCard * 0.0375;
  const landed = preCard + cardFee;
  return { usTax, duty, wharfage, freight, fixedFee, cardFee, landed };
}

// Margin by total ft³
function marginByFt3(totalFt3) {
  if (totalFt3 < 20) return 0.30;
  if (totalFt3 < 50) return 0.25;
  return 0.20;
}

// Google Sheets append
async function appendToSheet(rows) {
  try {
    const creds = JSON.parse(process.env.GCP_SA_JSON || "{}");
    const auth = new google.auth.JWT(
      creds.client_email,
      null,
      creds.private_key,
      ["https://www.googleapis.com/auth/spreadsheets"]
    );
    const sheets = google.sheets({ version: "v4", auth });
    const res = await sheets.spreadsheets.values.append({
      spreadsheetId: process.env.SHEETS_ID,
      range: "Orders!A1",
      valueInputOption: "USER_ENTERED",
      requestBody: { values: rows }
    });
    return res.data;
  } catch (e) {
    console.error("Sheets append error:", e.message);
  }
}

/* ---------- QUOTE ---------- */

app.post("/quote", async (req, res) => {
  try {
    const { name, email, items = [] } = req.body;

    // enrich items with price/ft3/vendor
    const detailed = [];
    for (const it of items) {
      const vendor = vendorFrom(it.link);
      const firstCost = it.price > 0 ? it.price : (await tryFetchPrice(it.link));
      const ft3Val = ft3(it.L, it.W, it.H);
      const qty = Math.max(1, parseInt(it.qty || 1, 10));
      const per = calcLandedForItem({ firstCost, ft3Val, vendor });
      detailed.push({
        link: it.link,
        vendor, qty,
        firstCost, ft3: ft3Val,
        ...per
      });
    }

    // totals (before margin; you asked to show just landed total to customer)
    const totalFt3 = detailed.reduce((s, x) => s + x.ft3 * x.qty, 0);
    const totalLanded = detailed.reduce((s, x) => s + x.landed * x.qty, 0);

    // If you ever want to show suggested retail (not required now):
    // const margin = marginByFt3(totalFt3);
    // const suggestedRetail = totalLanded / (1 - margin);

    res.json({
      ok: true,
      customer: { name, email },
      items: detailed,
      totalFt3,
      totalLanded: Math.round(totalLanded * 100) / 100
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok:false, error: "quote_failed" });
  }
});

/* ---------- CHECKOUT (Shopify Draft Order) ---------- */

async function shopify(path, opts={}) {
  const base = `https://${process.env.SHOPIFY_STORE}/admin/api/2024-07`;
  const r = await fetch(`${base}${path}`, {
    ...opts,
    headers: {
      "X-Shopify-Access-Token": process.env.SHOPIFY_TOKEN,
      "Content-Type": "application/json",
      ...(opts.headers || {})
    }
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`Shopify ${r.status}: ${t}`);
  }
  return r.json();
}

async function ensureCustomer(email, first_name) {
  // search customer
  const q = encodeURIComponent(`email:${email}`);
  const found = await shopify(`/customers/search.json?query=${q}`);
  if (found.customers && found.customers[0]) return found.customers[0];

  // create
  const created = await shopify(`/customers.json`, {
    method: "POST",
    body: JSON.stringify({ customer: { email, first_name, verified_email: true } })
  });
  return created.customer;
}

app.post("/checkout", async (req, res) => {
  try {
    const { name, email, items = [], quote } = req.body;
    if (!email) return res.status(400).json({ ok:false, error: "email_required" });

    // Require a latest quote so we have priced lines
    const q = quote || (await (await fetch("http://localhost:"+PORT+"/quote",{method:"POST",headers:{'content-type':'application/json'},body:JSON.stringify({name,email,items})})).json());

    // Build custom line items
    const lines = q.items.map((it, idx) => ({
      title: `Special Order ${idx+1} – ${it.vendor}`,
      quantity: it.qty,
      price: (Math.round(it.landed*100)/100).toFixed(2),
      // You can attach SKU or properties for the vendor link
      properties: [
        { name: "Link", value: it.link },
        { name: "ft3", value: it.ft3.toFixed(2) }
      ]
    }));

    const customer = await ensureCustomer(email, (name||"").split(" ")[0] || "SO");
    // Create draft order
    const draft = await shopify(`/draft_orders.json`, {
      method: "POST",
      body: JSON.stringify({
        draft_order: {
          line_items: lines,
          customer: { id: customer.id },
          use_customer_default_address: true,
          note: "Special Order via Instant Import",
          tags: "special-order, instant-import",
          applied_discount: null,
          // invoice will reflect these custom prices
        }
      })
    });

    const draftId = draft.draft_order.id;
    // invoice URL
    const invo = await shopify(`/draft_orders/${draftId}/send_invoice.json`, {
      method: "POST",
      body: JSON.stringify({
        draft_order_invoice: { to: email, from: null, subject: null, bcc: null, custom_message: null }
      })
    });

    const invoiceUrl = invo?.draft_order_invoice?.invoice_url || draft.draft_order?.invoice_url;

    // Log to Google Sheets
    const time = new Date().toISOString();
    const rows = [
      [
        time,
        name || "",
        email || "",
        q.totalFt3,
        q.totalLanded,
        draft.draft_order?.name || draftId,
        invoiceUrl || "",
        // Flatten links for convenience
        q.items.map(x=>`${x.qty}× ${x.vendor} | ${x.link}`).join("\n"),
        "FALSE" // Placed? (checkbox column in sheet)
      ]
    ];
    await appendToSheet(rows);

    res.json({ ok:true, checkoutUrl: invoiceUrl || null });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok:false, error: "checkout_failed" });
  }
});

/* ---------- start ---------- */
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
