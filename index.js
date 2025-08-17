const express = require("express");
const path = require("path");
const app = express();

// serve files from "public" folder
app.use(express.static(path.join(__dirname, "public")));

// debug route
app.get("/debug-index", (req, res) => {
  res.type("text/plain").send("✅ Deployed build has /debug-index. v=1");
});

// health check
app.get("/health", (req, res) => res.send("ok"));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
