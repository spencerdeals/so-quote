import express from "express";
import fetch from "node-fetch";
import * as cheerio from "cheerio";

const app = express();
const PORT = process.env.PORT || 3000;

// Health check
app.get(["/", "/health"], (_req, res) => {
  res.json({ ok: true, version: "alpha", service: "so-quote" });
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

    // Extract title
    const title =
      $("meta[property='og:title']").attr("content") ||
      $("title").text() ||
      "Title unavailable";

    // Extract price (basic patterns)
    const price =
      $("meta[property='product:price:amount']").attr("content") ||
      $("[itemprop='price']").attr("content") ||
      $("span.price").first().text().trim() ||
      null;

    res.json({ title, price });
  } catch (error) {
    console.error("Error scraping URL:", error);
    res.status(500).json({ error: "Error scraping URL" });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
