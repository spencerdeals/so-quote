// BUILD STAMP D — 2025-08-17
const express = require("express");
const path = require("path");
const fs = require("fs");

const app = express();
const PORT = process.env.PORT || 3000;

// Serve /public; never cache HTML so old builds can't stick
app.use(
  express.static(path.join(__dirname, "public"), {
    setHeaders: (res, filePath) => {
      if (filePath.endsWith(".html")) {
        res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
        res.setHeader("Pragma", "no-cache");
        res.setHeader("Expires", "0");
        res.setHeader("Surrogate-Control", "no-store");
      } else {
        res.setHeader("Cache-Control", "public, max-age=3600");
      }
    },
  })
);

// Root
app.get("/", (_req, res) => {
  res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// Health
app.get("/health", (_req, res) => res.status(200).send("OK"));

// TRUTH SERUM: dumps the exact index.html bytes on disk
app.get("/debug-index", (_req, res) => {
  try {
    const html = fs.readFileSync(path.join(__dirname, "public", "index.html"), "utf8");
    res.type("text/plain").send(html);
  } catch (e) {
    res.status(500).type("text/plain").send("Failed to read index.html: " + e.message);
  }
});

app.listen(PORT, () => console.log(`Server running on ${PORT}`));
