import express from "express";
import fetch from "node-fetch";
import * as cheerio from "cheerio";

const app = express();
const PORT = process.env.PORT || 3000;

// Health check
app.get("/health", (_req, res) => {
  res.json({ ok: true, version: "alpha" });
});

// Meta scraping endpoint
app.get("/meta", async (req, res) => {
  const { url } = req.query;
  if (!url) {
    return res.status(400).json({ error: "Missing url parameter" });
  }

  try {
    const response = await fetch(url);
    if (!response.ok) {
      return res.status(500).json({ error: "Failed to fetch URL" });
    }
    const html = await response.text();
    const $ = cheerio.load(html);

    // Try to extract title
    let title =
      $("meta[property='og:title']").attr("content") ||
      $("title").text() ||
      "Title unavailable";

    // Try to extract price (basic attempt)
    let price =
      $("meta[property='product:price:amount']").attr("content") ||
      $('[itemprop="price"]').attr("content") ||
      $("span.price").first().text().trim() ||
      null;

    res.json({ title, price });
  } catch (err) {
    console.error("Error fetching meta:", err);
    res.status(500).json({ error: "Error scraping URL" });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
