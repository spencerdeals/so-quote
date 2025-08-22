import express from "express";
import bodyParser from "body-parser";

const app = express();
app.use(bodyParser.json());

app.post("/quote", (req, res) => {
  const { links } = req.body;
  // demo data — replace with scraper logic
  const items = links.filter(l => l.trim()).map((link, idx) => {
    const qty = 1;
    const unit = 500; // placeholder, your calc goes here
    const total = unit * qty;
    return { name: `Item ${idx+1}`, qty, unit, total };
  });
  res.json({ items });
});

app.listen(3000, () => console.log("Server running on 3000"));
