const express = require("express");
const app = express();
const PORT = process.env.PORT || 3000;

/* ---------- CORS MIDDLEWARE ---------- */
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*"); // allow all, or replace * with frontend URL
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") {
    return res.sendStatus(200);
  }
  next();
});

/* ---------- BODY PARSERS ---------- */
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/* ---------- ROUTES ---------- */
app.get("/", (_req, res) => {
  res.send("so-quote backend running");
});

app.get("/health", (_req, res) => {
  res.json({ ok: true, version: "3.3-container", calc: "landed-v1" });
});

app.post("/quote", (req, res) => {
  const { links, opts } = req.body;

  // For now just echo back the request so frontend can test
  res.json({
    items: (links || []).map((url, i) => ({
      title: `Item ${i + 1}`,
      url,
      qty: 1,
      firstCost: 100,
      volume: opts?.defaultVolume || 11.33,
      freight: (opts?.defaultRate || 6) * (opts?.defaultVolume || 11.33),
      duty: 25,
    })),
    subtotal: 1234,
  });
});

/* ---------- START SERVER ---------- */
app.listen(PORT, () => {
  console.log(`[SO-QUOTE] Backend running on port ${PORT}`);
});
