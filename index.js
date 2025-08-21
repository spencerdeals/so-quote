import express from "express";
import cors from "cors";

const app = express();
const PORT = process.env.PORT || 3000;

// allow ONLY your site (add www if you use it) + local dev if needed
app.use(cors({
  origin: [
    "https://sdl.bm",
    // "https://www.sdl.bm",     // <- un-comment if your site uses www
    "http://localhost:3000"     // <- keep if you test locally; remove if not
  ],
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));

app.use(express.json());

// health
app.get(["/", "/health"], (_req, res) => {
  res.json({ ok: true, version: "alpha", service: "instant-quote" });
});

// quote
app.post("/quote", (req, res) => {
  const { items } = req.body;
  if (!items || !Array.isArray(items)) {
    return res.status(400).json({ error: "Invalid request, items required" });
  }
  const quote = items.map(i => ({
    name: i.name,
    qty: i.qty,
    unit: i.unitPrice,
    total: i.qty * i.unitPrice
  }));
  res.json({ quote });
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on ${PORT}`);
});
