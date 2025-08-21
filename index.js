import express from "express";
import cors from "cors";

const app = express();
const PORT = process.env.PORT || 3000;

// --- TEMP: Wide-open CORS for debugging ---
// This sends Access-Control-Allow-Origin for ANY origin (no credentials).
app.use(cors({ origin: "*" }));
app.options("*", cors());
// ------------------------------------------

app.use(express.json());

// Health
app.get(["/", "/health"], (_req, res) => {
  res.json({ ok: true, version: "alpha-open", service: "instant-quote" });
});

// Quote (simplified)
app.post("/quote", (req, res) => {
  const { items } = req.body;
  if (!items || !Array.isArray(items)) {
    return res.status(400).json({ error: "Invalid request, items required" });
  }
  const quote = items.map(i => ({
    name: i.name,
    qty: Number(i.qty || 0),
    unit: Number(i.unitPrice || 0),
    total: Number(i.qty || 0) * Number(i.unitPrice || 0)
  }));
  res.json({ quote });
});

app.listen(PORT, () => console.log(`🚀 Server running on ${PORT}`));
