import express from "express";
import cors from "cors";

const app = express();
const PORT = process.env.PORT || 3000;

// Enable JSON parsing
app.use(express.json());

// Allow CORS from your frontend
app.use(cors({
  origin: ["https://sdl.bm", "http://localhost:3000"], // adjust if needed
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));

// Health check
app.get(["/", "/health"], (_req, res) => {
  res.json({ ok: true, version: "alpha", service: "instant-quote" });
});

// Example quote endpoint
app.post("/quote", (req, res) => {
  const { items } = req.body;

  if (!items || !Array.isArray(items)) {
    return res.status(400).json({ error: "Invalid request, items required" });
  }

  // Simplified customer-facing totals (hide internal freight/cost details)
  const response = items.map((item) => {
    const total = item.qty * item.unitPrice;
    return {
      name: item.name,
      qty: item.qty,
      unit: item.unitPrice,
      total
    };
  });

  res.json({ quote: response });
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
