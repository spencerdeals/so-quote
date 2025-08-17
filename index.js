// index.js
const express = require("express");
const path = require("path");
const app = express();

// serve your static frontend if you have one in /public
app.use(express.static(path.join(__dirname, "public")));

app.get("/debug-index", (req, res) => {
  res.type("text/plain").send("✅ Deployed build has /debug-index. v=1");
});

// health check (optional but nice on Railway)
app.get("/health", (req, res) => res.send("ok"));

// listen on Railway's provided port
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
