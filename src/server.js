const express = require("express");
const axios = require("axios");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const dotenv = require("dotenv");
const sharp = require("sharp");
const webScrapingRouter = require("./routes/webScraping");
const geminiImageDetectionRouter = require("./routes/geminiImageDetection");
const generateProductNameRouter = require("./routes/generateProductName");

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;
const API_KEY = process.env.SCRAPINGDOG_API_KEY || "6801844612505d276ac0ded9";
const SCRAPINGDOG_URL = "https://api.scrapingdog.com/google_shopping/";

// Middleware
app.use(cors());
app.use(express.json());

// Statik dosyaları servis et
app.use(express.static(path.join(__dirname, "../public")));

// Route'ları kullan
app.use("/api/web-scraping", webScrapingRouter);
app.use("/api/image-detection", geminiImageDetectionRouter);
app.use("/api", generateProductNameRouter);

// Ana endpoint
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "../public", "index.html"));
});

// Helper: data URI'yi decode edip sharp ile dönüştürür
async function convertWebPtoPNGorJPG(dataUri, format = "png") {
  // data:image/webp;base64,AAAA...
  const matches = dataUri.match(/^data:image\/webp;base64,(.+)$/);
  if (!matches) return dataUri;
  const webpBuffer = Buffer.from(matches[1], "base64");

  let outBuffer;
  if (format === "jpg") {
    outBuffer = await sharp(webpBuffer).jpeg().toBuffer();
    return `data:image/jpeg;base64,${outBuffer.toString("base64")}`;
  } else {
    outBuffer = await sharp(webpBuffer).png().toBuffer();
    return `data:image/png;base64,${outBuffer.toString("base64")}`;
  }
}

async function searchProducts(
  query,
  country = "tr",
  language = "tr",
  limit = 10
) {
  try {
    // Virgülleri boşluklarla değiştirerek sorguyu temizle
    const sanitizedQuery = query.replace(/,/g, " ");

    const params = {
      api_key: API_KEY,
      query: sanitizedQuery,
      country: country,
      results: limit,
      language: language,
    };
    const response = await axios.get(SCRAPINGDOG_URL, { params });
    const data = response.data;

    if (!data.shopping_results?.length) return [];

    const results = await Promise.all(
      data.shopping_results.map(async (item) => {
        // Thumbnail yoksa boş string ata
        let thumb = item.thumbnail ?? "";
        // Sadece webp data URI ise dönüştür
        if (typeof thumb === "string" && thumb.startsWith("data:image/webp")) {
          thumb = await convertWebPtoPNGorJPG(thumb, "png");
        }
        return {
          name: item.title,
          price: item.extracted_price,
          originalPrice: item.old_price_extracted || null,
          merchant: item.source,
          image: thumb,
          url: item.product_link,
          rating: item.rating || null,
          reviewCount: item.reviews
            ? parseInt(item.reviews.replace(/[^\d]/g, ""), 10)
            : null,
          delivery: item.delivery || "Standard delivery",
          hasDiscount: item.tag?.includes("OFF") || false,
          discountRate: item.tag?.includes("OFF") ? item.tag : null,
        };
      })
    );

    return results;
  } catch (error) {
    console.error("Ürün araması sırasında hata:", error);
    return [];
  }
}

// AsyncStorage simülasyonu (backend için)
const getAnonymousUserId = async () => {
  // Backend'de gerçek AsyncStorage olmadığı için
  // Bu fonksiyon, mobil tarafta şöyle kullanılır: let userId = await AsyncStorage.getItem("anonymous_user_id");
  return "kullanici_" + Math.floor(Math.random() * 1000);
};

// Google Shopping ürünlerini getiren endpoint
app.get("/search", async (req, res) => {
  try {
    const { query, limit = 10, country = "tr", language = "tr" } = req.query;

    if (!query) {
      return res.status(400).json({ error: "Arama sorgusu gerekli" });
    }

    // Kullanıcı kimliğini al
    let userId = await getAnonymousUserId();
    console.log(`Kullanıcı: ${userId} için "${query}" araması yapılıyor`);

    // Ürünleri ara
    const results = await searchProducts(
      query,
      country,
      language,
      parseInt(limit)
    );

    // Sonuçları JSON dosyasına kaydet
    const jsonData = {
      userId,
      query,
      count: results.length,
      results,
      timestamp: new Date().toISOString(),
    };

    const jsonFileName = `${query.replace(
      /\s+/g,
      "_"
    )}_${new Date().getTime()}.json`;
    const jsonFilePath = path.join(__dirname, "../results", jsonFileName);

    // results klasörü yoksa oluştur
    if (!fs.existsSync(path.join(__dirname, "../results"))) {
      fs.mkdirSync(path.join(__dirname, "../results"), { recursive: true });
    }

    fs.writeFileSync(jsonFilePath, JSON.stringify(jsonData, null, 2), "utf8");
    console.log(`Sonuçlar "${jsonFilePath}" dosyasına kaydedildi.`);

    res.json({
      userId,
      query,
      count: results.length,
      results,
      saved_to: jsonFileName,
    });
  } catch (error) {
    console.error("Hata oluştu:", error.message);
    res.status(500).json({ error: "Sunucu hatası", message: error.message });
  }
});

// POST endpoint for search - form veya JSON verileri için
app.post(
  "/search",
  express.urlencoded({ extended: true }),
  async (req, res) => {
    try {
      const { query, limit = 10, country = "tr", language = "tr" } = req.body;

      if (!query) {
        return res.status(400).json({ error: "Arama sorgusu gerekli" });
      }

      // Kullanıcı kimliğini al
      let userId = await getAnonymousUserId();
      console.log(
        `Kullanıcı: ${userId} için "${query}" araması yapılıyor (POST)`
      );

      // Ürünleri ara
      const results = await searchProducts(
        query,
        country,
        language,
        parseInt(limit)
      );

      res.json({
        userId,
        query,
        count: results.length,
        results,
      });
    } catch (error) {
      console.error("Hata oluştu:", error.message);
      res.status(500).json({ error: "Sunucu hatası", message: error.message });
    }
  }
);

// Sunucuyu başlat
app.listen(port, () => {
  console.log(`Sunucu çalışıyor: http://localhost:${port}`);
});

module.exports = app;
