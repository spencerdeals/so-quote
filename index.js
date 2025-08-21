import express from "express";
import cors from "cors";

const app = express();
const PORT = process.env.PORT || 3000;

/**
 * 🔒 Force CORS headers for every request (preflight + actual)
 * We set headers manually AND use cors() to rule out ordering issues.
 */
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*"); // TEMP: open for debugging
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// Library CORS (kept after manual to add any missing bits)
// NOTE: origin:"*" is fine here because we don't use credentials
app.use(cors({ origin: "*", methods: ["GET", "POST", "OPTIONS"] }));

app.use(express.json());

// Health
app.get(["/", "/health"], (_req, res) => {
  res.json({ ok: true, version: "alpha-open-forced", service: "instant-quote" });
});

// Debug endpoint to inspect what headers the server is returning
app.get("/debug/headers", (req, res) => {
  res.json({
    ok: true,
    request_origin: req.headers.origin || null,
    sent_headers: res.getHeaders()
  });
});

// Quote (simplified)
app.post("/quote", (req, res) => {
  const { items } = req.body;
  if (!items || !Array.isArray(items)) {
    return res.status(400).json({ error: "Invalid request, items required" });
  }
  const quote = items.map(i => {
    const qty = Number(i?.qty || 0);
    const unit = Number(i?.unitPrice || 0);
    return { name: i?.name ?? "Item", qty, unit, total: qty * unit };
  });
  res.json({ quote });
});

app.listen(PORT, () => console.log(`🚀 Server running on ${PORT}`));
