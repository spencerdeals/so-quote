app.post("/quote", async (req, res) => {
  try {
    const { links } = req.body || {};
    if (!Array.isArray(links) || links.length === 0) {
      return res.json({ items: [] });
    }

    const results = [];
    for (const link of links) {
      try {
        // Call Scraper B
        const resp = await fetch(process.env.SCRAPER_B_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: link }),
        });
        if (!resp.ok) throw new Error(`Scraper B ${resp.status}`);
        const data = await resp.json();

        // Price it
        const firstCost = Number(data.price) || 0;
        const priced = priceOrder([
          { link, name: data.name, image: data.image, variants: data.variants, firstCost, qty: 1 },
        ])[0];

        results.push(priced);
      } catch (err) {
        results.push({ link, name: null, error: String(err), qty: 1, unit: null, total: null });
      }
    }

    res.json({ items: results });
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});
