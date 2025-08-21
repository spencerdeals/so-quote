const express = require("express");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

// Health/version for #alpha
app.get(["/", "/health"], (_req, res) => {
  res.json({ ok: true, version: "#alpha", service: "sdl-instant-quote" });
});

// TODO: add your other routes here
// e.g. app.post("/quote", (req, res) => { ... });

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
});
