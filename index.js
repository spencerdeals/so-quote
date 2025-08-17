const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

// Allow embedding in Shopify
app.use((req, res, next) => {
  res.setHeader("X-Frame-Options", "ALLOWALL");
  res.setHeader("Content-Security-Policy", "frame-ancestors *");
  next();
});

// Static
app.use(express.static(path.join(__dirname, "public")));
app.use(express.json());

// Simple homepage check
app.get("/", (_req, res) => {
  res.send("Special Order Quote App is running!");
});

// Quote calculator
app.post("/quote", (req, res) => {
  try {
    const items = Array.isArray(req.body.items) ? req.body.items : [];
    if (!items.length) return res.status(400).json({ error: "No items provided" });

    const isAmazonOrWayfair = (url = "") =>
      /amazon\./i.test(url) || /wayfair\./i.test(url);

    let totalFirstCost = 0;
    let totalFt3 = 0;
    let taxableFirstCost = 0;

    items.forEach((it) => {
      const price = Number(it.priceUSD || 0);
      const ft3 = Number(it.cubicFt || 0);
      totalFirstCost += price;
      totalFt3 += ft3;
      if (!isAmazonOrWayfair(it.url || "")) {
        taxableFirstCost += price;
      }
    });

    // Sales tax only on non Amazon/Wayfair
    const salesTax = taxableFirstCost * 0.06625;

    const duty = totalFirstCost * 0.25;
    const wharfage = totalFirstCost * 0.02;

    // Freight & handling:
    // bulk rate $6.46/ft³ + $10 per item (fixed pool spread)
    const freight = (totalFt3 * 6.46) + (items.length * 10);

    // Subtotal before card fee
    const subBeforeCard = totalFirstCost + salesTax + duty + wharfage + freight;

    const cardFee = subBeforeCard * 0.0375;
    const totalLanded = subBeforeCard + cardFee;

    // Margin tiers by total cubic feet
    let marginPct = 30;
    if (totalFt3 >= 50) marginPct = 20;
    else if (totalFt3 >= 20) marginPct = 25;

    const suggestedRetail = totalLanded / (1 - marginPct / 100);

    return res.json({
      ok: true,
      summary: {
        items: items.length,
        firstCost: totalFirstCost,
        salesTax,
        duty,
        wharfage,
        freight,
        cardFee,
        totalLanded,
        marginPct,
        suggestedRetail,
        totalFt3,
        destinationZip: "07201"
      }
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to compute quote" });
  }
});

// Serve the app HTML at root
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
