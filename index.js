import express from "express";
import cors from "cors";
import multer from "multer";

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "OCR", version: "1.0.0" });
});

app.post("/extract", upload.array("file"), async (req, res) => {
  try {
    const files = req.files || [];
    const texts = files.map((f) => `Scanned text from ${f.originalname}`);
    res.json({ text: texts.join("\n"), texts, links: [] });
  } catch (err) {
    res.status(500).json({ error: err?.message || String(err) });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`OCR server running on port ${PORT}`));
