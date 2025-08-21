// index.js — #alpha backend (full paste-and-replace)
// Express backend that extracts product details (title, price, image, store, variant)
// from a given product URL. Designed for Amazon, Wayfair, and generic stores.
// Notes:
// - Keep items in the order pasted by the customer (frontend handles ordering).
// - We expose /extract (POST) expecting { url } and return normalized fields.
// - Variant detection uses JSON-LD + heuristics for common labels: Color, Size, Orientation, Finish, Configuration.
{
  "title": "…",
  "price": 123.45,
  "image": "https://…",
  "store": "Amazon",
  "variant": "Color: Brown, Orientation: Left-Facing",
  "source": "https://…",
  "confidence": { "title": true, "price": true, "image": true, "variant": true }
}
io");
const cors = require("cors");

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(cors());

// ---- Utilities ----
function detectStore(urlStr) {
  try {
    const u = new URL(urlStr);
    const host = u.hostname.toLowerCase();
    if (host.includes("amazon.")) return "Amazon";
    if (host.includes("wayfair.")) return "Wayfair";
    if (host.includes("walmart.")) return "Walmart";
    if (host.includes("target.")) return "Target";
    return host.replace("www.", "");
  } catch {
    return "Unknown";
  }
}

function safeNumber(s) {
  if (!s) return null;
  // remove currency symbols and commas
  const n = parseFloat(
    String(s)
      .replace(/[^\d.,-]/g, "")
      .replace(/,/g, "")
  );
  return Number.isFinite(n) ? n : null;
}

function firstNonEmpty(...vals) {
  for (const v of vals) {
    if (v === 0) return 0;
    if (v !== undefined && v !== null && String(v).trim() !== "") return v;
  }
  return null;
}

function extractJSONLD($) {
  const out = [];
  $('script[type="application/ld+json"]').each((_i, el) => {
    const text = $(el).contents().text();
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) {
        for (const p of parsed) out.push(p);
      } else {
        out.push(parsed);
      }
    } catch { /* ignore bad JSON */ }
  });
  return out;
}

function flattenText($, el) {
  return $(el).text().replace(/\s+/g, " ").trim();
}

// Try to pick the best image from JSON-LD structure
function pickImage(jsonld) {
  for (const block of jsonld) {
    // Look for Product
    if ((block["@type"] || "").toString().toLowerCase() === "product") {
      if (typeof block.image === "string") return block.image;
      if (Array.isArray(block.image) && block.image.length) return block.image[0];
    }
    // Sometimes nested graph
    if (Array.isArray(block["@graph"])) {
      for (const g of block["@graph"]) {
        if ((g["@type"] || "").toString().toLowerCase() === "product") {
          if (typeof g.image === "string") return g.image;
          if (Array.isArray(g.image) && g.image.length) return g.image[0];
        }
      }
    }
  }
  return null;
}

function pickTitle(jsonld, $) {
  // Prefer Product.name from JSON-LD
  for (const block of jsonld) {
    if ((block["@type"] || "").toString().toLowerCase() === "product" && block.name) {
      return String(block.name).trim();
    }
    if (Array.isArray(block["@graph"])) {
      for (const g of block["@graph"]) {
        if ((g["@type"] || "").toString().toLowerCase() === "product" && g.name) {
          return String(g.name).trim();
        }
      }
    }
  }
  // Fallback to og:title or <title>
  const og = $('meta[property="og:title"]').attr("content");
  if (og) return og.trim();
  const t = $("title").first().text();
  return t ? t.trim() : null;
}

function pickPrice(jsonld, $) {
  // Try JSON-LD offers.price
  for (const block of jsonld) {
    if ((block["@type"] || "").toString().toLowerCase() === "product") {
      const offers = Array.isArray(block.offers) ? block.offers : [block.offers];
      for (const ofr of offers) {
        const v = safeNumber(ofr && (ofr.price || ofr.lowPrice));
        if (v) return v;
      }
    }
    if (Array.isArray(block["@graph"])) {
      for (const g of block["@graph"]) {
        if ((g["@type"] || "").toString().toLowerCase() === "product") {
          const offers = Array.isArray(g.offers) ? g.offers : [g.offers];
          for (const ofr of offers) {
            const v = safeNumber(ofr && (ofr.price || ofr.lowPrice));
            if (v) return v;
          }
        }
      }
    }
  }
  // Fallback: common meta tags
  const metaPrice = $('meta[itemprop="price"]').attr("content")
    || $('meta[property="product:price:amount"]').attr("content");
  const mp = safeNumber(metaPrice);
  if (mp) return mp;

  // Ultimate fallback: scan for $xx.xx in the page (first occurrence)
  const bodyText = $("body").text();
  const m = bodyText.match(/(?:\$|USD\s*)\s?(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/);
  if (m) {
    const v = safeNumber(m[0]);
    if (v) return v;
  }
  return null;
}

// Heuristic variant extraction
function pickVariant(jsonld, $) {
  // 1) If JSON-LD Product.name includes details in parentheses after the main title
  // Try to infer difference vs og:title to extract variant hints
  const name = pickTitle(jsonld, $) || "";
  const og = $('meta[property="og:title"]').attr("content") || "";
  if (name && og && name !== og) {
    // If name is longer, take the extra tail as variant
    if (name.startsWith(og)) {
      const extra = name.slice(og.length).trim();
      if (extra) return extra.replace(/^[\-\–:\(\)\s]+|[\-\–:\(\)\s]+$/g, "");
    }
  }

  // 2) Scan for common spec labels near selected values (Wayfair/Amazon-like)
  const LABELS = ["Color", "Colour", "Finish", "Orientation", "Configuration", "Size", "Style", "Material"];
  // Look for label:value pairs in text blocks
  const text = $("body").text().replace(/\s+/g, " ");
  for (const lbl of LABELS) {
    const re = new RegExp(`${lbl}\\s*[:\\-]\\s*([A-Za-z0-9\\-\\s/]+?)\\s{1,3}`, "i");
    const m = text.match(re);
    if (m && m[1]) {
      return `${lbl}: ${m[1].trim()}`;
    }
  }

  // 3) Amazon URL params sometimes carry clues (color_name, size_name)
  try {
    const urlEl = $('link[rel="canonical"]').attr("href") || "";
    const u = new URL(urlEl);
    const color = u.searchParams.get("color_name") || u.searchParams.get("color");
    const size  = u.searchParams.get("size_name") || u.searchParams.get("size");
    const parts = [];
    if (color) parts.push(`Color: ${color}`);
    if (size) parts.push(`Size: ${size}`);
    if (parts.length) return parts.join(", ");
  } catch { /* ignore */ }

  // 4) Wayfair often embeds JSON-LD with variant in name; already handled. If nothing, return null
  return null;
}

// Basic image fallbacks if JSON-LD misses it
function pickImageFallback($) {
  const ogImg = $('meta[property="og:image"]').attr("content");
  if (ogImg) return ogImg;
  // First prominent image on page
  const firstImg = $("img").first().attr("src");
  if (firstImg && /^https?:\/\//.test(firstImg)) return firstImg;
  return null;
}

// ---- Route ----
app.post("/extract", async (req, res) => {
  const { url } = req.body || {};
  if (!url) return res.status(400).json({ error: "Missing url" });

  const store = detectStore(url);
  try {
    const resp = await axios.get(url, {
      // Some sites block unknown agents; this UA is benign
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
        "Accept-Language": "en-US,en;q=0.9"
      },
      timeout: 20000,
      // Allow redirects
      maxRedirects: 5,
      validateStatus: (s) => s >= 200 && s < 400
    });
    const html = resp.data;
    const $ = cheerio.load(html);
    const jsonld = extractJSONLD($);

    const title  = pickTitle(jsonld, $);
    const price  = pickPrice(jsonld, $);
    const image  = firstNonEmpty(pickImage(jsonld), pickImageFallback($));
    const variant = pickVariant(jsonld, $);

    // Basic guardrails
    const payload = {
      title: title || null,
      price: price !== null ? Number(price) : null,
      image: image || null,
      store,
      variant: variant || null,
      source: url
    };

    // Indicate to the frontend if we think the page had weak signals
    payload.confidence = {
      title: !!title,
      price: !!price,
      image: !!image,
      variant: !!variant
    };

    return res.json(payload);
  } catch (err) {
    const status = err.response ? err.response.status : 500;
    return res.status(200).json({
      error: "FETCH_FAILED",
      httpStatus: status,
      store,
      source: url,
      // Return a minimal stub so the frontend can still render and let the user edit
      title: null,
      price: null,
      image: null,
      variant: null
    });
  }
});

// Health
app.get(["/", "/health"], (_req, res) => {
  res.json({ ok: true, version: "alpha-backend-variants-1.0" });
});

// Start
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Server running on", PORT);
});
