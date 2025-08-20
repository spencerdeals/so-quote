// backend/index.js — Instant Import V5 backend
import express from "express";
import cors from "cors";
import { request } from "undici";
import * as cheerio from "cheerio";

const app = express();

// allow CORS from anywhere (adjust if needed)
app.use(cors({ origin: true }));

// ===== /meta — fetch product title from a product URL =====
app.get("/meta", async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).json({ name: null, error: "Missing url" });

  try {
    const { body } = await request(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
      maxRedirections: 5,
    });

    const html = await body.text();
    const $ = cheerio.load(html);

    // Try common meta tags
    let name =
      $('meta[property="og:title"]').attr("content") ||
      $('meta[name="og:title"]').attr("content") ||
      $('meta[name="twitter:title"]').attr("content");

    // Try JSON-LD Product if needed
    if (!name) {
      $('script[type="application/ld+json"]').each((_, el) => {
        try {
          const json = JSON.parse($(el).contents().text());
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

    // Fallback to h1 or title
    if (!name) {
      name = $("h1").first().text().trim() || $("title").first().text().trim();
    }

    // Clean noisy suffixes
    if (name) {
      name = name.replace(/\s+/g, " ").trim();
      name = name.replace(/\s*[-–—·•]\s*(Amazon|Wayfair|Target|Crate & Barrel).*/i, "").trim();
    }

    return res.json({ name: name || null });
  } catch (err) {
    console.error("meta error:", err?.message || err);
    return res.json({ name: null });
  }
});

// Health check — must say "Instant Import V5"
app.get(["/", "/health"], (_req, res) => {
  res.json({ ok: true, service: "Instant Import V5" });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Instant Import V5 server running on port ${PORT}`);
});
