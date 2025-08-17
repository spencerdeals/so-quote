// Simple static server for Railway
const express = require("express");
const path = require("path");
const app = express();
const PORT = process.env.PORT || 3000;

// Serve /public as static files
app.use(express.static(path.join(__dirname, "public"), { maxAge: "1h" }));

// Root -> public/index.html
app.get("/", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// Optional healthcheck
app.get("/health", (_req, res) => res.status(200).send("OK"));

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
