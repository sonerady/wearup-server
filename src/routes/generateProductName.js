const express = require("express");
const router = express.Router();
const multer = require("multer");
const upload = multer({ storage: multer.memoryStorage() });
const fs = require("fs");
const path = require("path");
const { v4: uuidv4 } = require("uuid");

// GoogleGenerativeAI kütüphanesini içe aktaralım
const { GoogleGenerativeAI } = require("@google/generative-ai");

// Gemini API anahtarını alıyoruz
const apiKey = process.env.GEMINI_API_KEY;
const genAI = new GoogleGenerativeAI(apiKey);

/**
 * Giyim ürünü için AI analizi ve isim oluşturma
 * @route POST /generate-product-name
 * @param {file} req.file - Analiz edilecek giyim ürününün fotoğrafı
 * @returns {object} 200 - Analiz sonuçları (type ve query) ve oluşturulan ürün ismi
 */
router.post(
  "/generate-product-name",
  upload.single("image"),
  async (req, res) => {
    try {
      // API anahtarının mevcut olup olmadığını kontrol et
      if (!apiKey) {
        console.error("GEMINI_API_KEY ortam değişkenlerinde yapılandırılmamış");
        return res.status(500).json({
          success: false,
          error: "Yapılandırma hatası",
          message: "API anahtarı yapılandırılmamış",
        });
      }

      // Resim dosyasını kontrol et
      if (!req.file) {
        return res.status(400).json({
          success: false,
          error: "Geçersiz istek",
          message: "Resim dosyası bulunamadı",
        });
      }

      // Geçici olarak resmi kaydet
      const tempDir = path.join(__dirname, "../../../temp");
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }

      const uniqueFilename = `${uuidv4()}.jpg`;
      const tempFilePath = path.join(tempDir, uniqueFilename);

      fs.writeFileSync(tempFilePath, req.file.buffer);
      const imageData = fs.readFileSync(tempFilePath, { encoding: "base64" });

      // Gemini modeli (Gemini 1.5 Flash kullanılıyor)
      const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

      // Prompt hazırlama
      const prompt = `
      Analyze the clothing item visible in this photo.
      Please identify the following information:
      1. Clothing type/category - Select the most appropriate category ID from this list:
         - "1": "Tişört" (T-shirt)
         - "2": "Jean" (Jeans)
         - "3": "Elbise" (Dress)
         - "4": "Sneaker"
         - "5": "Gömlek" (Shirt)
         - "6": "Sweatshirt"
         - "7": "Mont" (Coat/Jacket)
         - "8": "Kazak" (Sweater)
         - "9": "Şort" (Shorts)
         - "10": "Ceket" (Jacket)
         - "11": "Çanta" (Bag)
         - "12": "Pantolon" (Pants/Trousers)
         - "13": "Ayakkabı" (Shoes)
         - "14": "Etek" (Skirt)
         - "15": "Takı" (Jewelry)
         - "16": "Bluz" (Blouse)
         - "17": "Polo Tişört" (Polo Shirt)
         - "18": "Atlet" (Tank Top/Sleeveless)
         - "19": "Hırka" (Cardigan)
         - "20": "Yelek" (Vest)
         - "21": "Kapüşonlu" (Hooded)
         - "22": "Uzun Kollu" (Long Sleeve)
         - "23": "Crop Top"
         - "24": "Kot Pantolon" (Jeans)
         - "25": "Kumaş Pantolon" (Fabric Pants)
         - "26": "Eşofman" (Sweatpants)
         - "27": "Tayt" (Leggings)
         
      2. Distinctive features or a brief description of the item.
      3. The main color(s) of the item. Return ONLY standard CSS color names like "red", "blue", "green", "black", "white", "gray", "yellow", "orange", "purple", "pink", "brown", "navy", "teal", "olive", "maroon". If there are multiple colors, separate them with commas WITHOUT spaces (e.g., "red,blue,black").
      4. Suitable seasons for the item (Return as a list like ["İlkbahar", "Yaz"] or ["Tüm Mevsimler"]).
      5. Relevant tags (Return as a comma-separated string like "casual, cotton, comfortable").
      6. The material of the item (e.g., "Cotton", "Polyester", "Wool"). Always provide a best guess, do not state "Unknown".
      7. The style of the item (e.g., "Casual", "Formal", "Sporty", "Vintage"). Always provide a best guess, do not state "Unknown".
      8. The gender category the item belongs to. ONLY return one of these exact values: "men", "women", "unisex", "kids". Do not use any other values.

      Respond STRICTLY in the following JSON format:
      {
        "type": "ONLY RETURN THE NUMERIC ID as a string, e.g. '1' or '12', etc.",
        "query": "brief description of the item",
        "color": "main color(s)",
        "seasons": ["season1", "season2"],
        "tags": "tag1, tag2, tag3",
        "material": "material",
        "style": "style",
        "gender": "gender"
      }

      Respond only with the JSON object, do not add any other explanation or markdown formatting like \`\`\`json.
    `;

      // İstek gönder (resimle birlikte)
      const result = await model.generateContent({
        contents: [
          {
            parts: [
              { text: prompt },
              {
                inlineData: {
                  mimeType: req.file.mimetype || "image/jpeg",
                  data: imageData,
                },
              },
            ],
          },
        ],
      });

      const responseText = result.response.text().trim();
      console.log("Gemini'den dönen yanıt:", responseText);

      // JSON yanıtı ayrıştır
      let analysisResult;
      try {
        // Markdown kod bloğu formatını temizle
        let cleanJson = responseText;
        // ```json ve ``` formatını temizle
        cleanJson = cleanJson.replace(/^```json\s*/, "").replace(/\s*```$/, "");
        // Satır başı/sonu boşlukları temizle
        cleanJson = cleanJson.trim();
        // Eğer hala geçerli JSON değilse, JSON içeriğini çıkarmayı dene
        if (!cleanJson.startsWith("{") || !cleanJson.endsWith("}")) {
          const jsonMatch = cleanJson.match(/{[\s\S]*}/);
          if (jsonMatch) {
            cleanJson = jsonMatch[0];
          } else {
            // JSON bulunamadıysa hata fırlat
            throw new Error("Valid JSON object not found in the response.");
          }
        }

        analysisResult = JSON.parse(cleanJson);

        // Eksik alanlar için varsayılan değerler ata
        analysisResult.type = analysisResult.type || "Giyim Ürünü";
        analysisResult.query = analysisResult.query || "Açıklama yok";
        analysisResult.color = analysisResult.color || "Belirlenmedi";
        analysisResult.seasons = Array.isArray(analysisResult.seasons)
          ? analysisResult.seasons
          : [];
        analysisResult.tags = analysisResult.tags || "";
        analysisResult.material = analysisResult.material || "Genel";
        analysisResult.style = analysisResult.style || "Genel";
        analysisResult.gender = analysisResult.gender || "Unisex";
      } catch (error) {
        console.error("JSON ayrıştırma hatası veya eksik alanlar:", error);
        console.error("Alınan Ham Yanıt:", responseText);
        // JSON ayrıştırılamadıysa veya alanlar eksikse varsayılan değerleri kullan
        analysisResult = {
          type: "Giyim Ürünü",
          query: "Açıklama yok",
          color: "Belirlenmedi",
          seasons: [],
          tags: "",
          material: "Genel",
          style: "Genel",
          gender: "Unisex",
        };
      }

      // --- Mevsim ID Eşleştirmesi ve "Tüm Mevsimler" Mantığı ---
      const SEASON_IDS = {
        İlkbahar: "spring",
        Yaz: "summer",
        Sonbahar: "autumn",
        Kış: "winter",
      };
      const ALL_SEASONS_IDENTIFIER = "Tüm Mevsimler";

      let seasonIdsForApi = [];
      let seasonNamesForFrontend = [];
      const geminiSeasonNames = Array.isArray(analysisResult.seasons)
        ? analysisResult.seasons
        : []; // Gemini'den gelen dizi (güvenlik kontrolü)

      if (geminiSeasonNames.includes(ALL_SEASONS_IDENTIFIER)) {
        // Eğer "Tüm Mevsimler" geldiyse, tüm mevsim ID'lerini ekle
        seasonIdsForApi = Object.values(SEASON_IDS);
        seasonNamesForFrontend = ["Tüm Mevsimler"];
      } else {
        // Aksi takdirde, gelen isimleri ID'lere çevir
        seasonIdsForApi = geminiSeasonNames
          .map((name) => SEASON_IDS[name]) // İsmi ID'ye çevir
          .filter((id) => id); // Geçersiz isimlerden kaynaklanan null/undefined ID'leri filtrele

        // Frontend için doğrudan Türkçe mevsim isimlerini kullan
        seasonNamesForFrontend = geminiSeasonNames.filter(
          (name) =>
            Object.keys(SEASON_IDS).includes(name) ||
            name === ALL_SEASONS_IDENTIFIER
        );
      }
      // ----------------------------------------------------------

      // Ürün ismi olarak query alanını veya type + color kullanabiliriz.
      // Şimdilik query'yi kullanalım. Gerekirse daha sonra değiştirilebilir.
      const productName =
        analysisResult.query ||
        `${analysisResult.color} ${analysisResult.type}`;

      // Geçici dosyayı temizle
      fs.unlinkSync(tempFilePath);

      // Başarılı yanıt döndür
      return res.status(200).json({
        success: true,
        type: analysisResult.type,
        query: analysisResult.query,
        productName, // query'yi productName olarak kullanıyoruz
        color: analysisResult.color,
        seasons: seasonNamesForFrontend, // Frontend için Türkçe isimleri gönder
        seasonsIds: seasonIdsForApi, // Arka plan için ID'leri de sakla
        tags: analysisResult.tags, // Virgülle ayrılmış string
        material: analysisResult.material,
        style: analysisResult.style,
        gender: analysisResult.gender,
      });
    } catch (error) {
      console.error("Ürün analizi hatası:", error); // Hata mesajı güncellendi

      // Geçici dosya oluşturulduysa silmeyi dene
      if (fs.existsSync(tempFilePath)) {
        try {
          fs.unlinkSync(tempFilePath);
        } catch (unlinkErr) {
          console.error("Geçici dosya silinemedi:", unlinkErr);
        }
      }

      return res.status(500).json({
        success: false,
        error: "İşlem hatası",
        message: error.message || "Ürün analizi sırasında bir hata oluştu", // Mesaj güncellendi
      });
    }
  }
);

module.exports = router;
