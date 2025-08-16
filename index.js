const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

// (Optional but helpful) make sure the page can be embedded in Shopify
app.use((req, res, next) => {
  res.setHeader("X-Frame-Options", "ALLOWALL");
  res.setHeader("Content-Security-Policy", "frame-ancestors *");
  next();
});

// Serve the /public folder (css/js/images, etc.)
app.use(express.static(path.join(__dirname, "public")));

// Send your HTML app at the root
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
