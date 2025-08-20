// index.js (backend for SO-Quote)
import express from "express";
import cors from "cors";
import { scraperProduct } from "./scraper.js";

const app = express();
app.use(cors());
app.use(express.json());

// Health check
app.get("/health", (_req, res) => {
  res.json({ ok: true, version: "3.3-container", calc: "landed-v1" });
});

// Quote endpoint
app.post("/quote", async (req, res) => {
  try {
    const { links = [] } = req.body;

    if (!Array.isArray(links) || links.length === 0) {
      return res.status(400).json({ error: "No links provided" });
    }

    // Scrape each product
    const items = [];
    for (let url of links) {
      const scraped = await scraperProduct(url);
      items.push(scraped);
    }

    res.json({ items, subtotal: items.reduce((s, i) => s + (i.price || 0), 0) });
  } catch (err) {
    console.error("Quote error:", err);
    res.status(500).json({ error: "Failed to generate quote" });
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`SO-Quote backend running on ${PORT}`));
