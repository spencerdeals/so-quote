// FULL PASTE-AND-REPLACE BACKEND (CommonJS) — so-quote/index.js
// Purpose: provide /meta endpoint to return product names for given URLs
// Run: npm start
// Env: PORT (optional)

const express = require("express");
const cors = require("cors");
const { request } = require("undici");
const cheerio = require("cheerio");

const app = express();

// CORS: allow all by default; tighten to your domain if needed
app.use(cors({ origin: true }));

app.get(["/", "/health"], (_req, res) => {
  res.json({ ok: true, service: "so-quote-meta", version: "1.0.0" });
});

// GET /meta?url=https://example.com/product/123
app.get("/meta", async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).json({ error: "Missing url" });

  try {
    const { body, statusCode } = await request(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
        "Accept":
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
      maxRedirections: 5,
    });

    const html = await body.text();
    const $ = cheerio.load(html);

    // 1) OpenGraph / twitter
    let name =
      $('meta[property="og:title"]').attr("content") ||
      $('meta[name="og:title"]').attr("content") ||
      $('meta[name="twitter:title"]').attr("content");

    // 2) schema.org Product name
    if (!name) {
      $('script[type="application/ld+json"]').each((_, el) => {
        try {
          const raw = $(el).contents().text();
          if (!raw) return;
          const json = JSON.parse(raw);
          const stack = Array.isArray(json) ? json : [json];
          outer: for (const node of stack) {
            const queue = [node];
            while (queue.length) {
              const cur = queue.shift();
              if (!cur || typeof cur !== "object") continue;
              const type = cur["@type"] || cur.type;
              if (type && String(type).toLowerCase().includes("product")) {
                name = cur.name || cur.title;
                if (name) break outer;
              }
              for (const v of Object.values(cur)) {
                if (v && typeof v === "object") queue.push(v);
              }
            }
          }
        } catch {}
      });
    }

    // 3) Fallback to H1 or <title>
    if (!name) {
      name = $("h1").first().text().trim() || $("title").first().text().trim();
    }

    // 4) Cleanup
    if (name) {
      name = name.replace(/\s+/g, " ").trim();
      // Strip store name suffixes: e.g., " - Amazon"
      name = name.replace(/\s*[\-|·|•|–|—]\s*(Amazon|Wayfair|Target|Crate & Barrel|Walmart|IKEA).*/i, "").trim();
    }

    return res.json({ name: name || null, statusCode });
  } catch (err) {
    console.error("meta fetch error", err?.message || err);
    // Soft-fail: return null so frontend keeps placeholder
    return res.json({ name: null });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`so-quote meta server listening on :${PORT}`);
});
