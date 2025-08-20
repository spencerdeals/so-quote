const express = require("express");
const app = express();
const PORT = process.env.PORT || 3000;

/* ---------- CORS FIRST ---------- */
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");  // or your exact frontend domain
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

/* ---------- PARSERS ---------- */
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
