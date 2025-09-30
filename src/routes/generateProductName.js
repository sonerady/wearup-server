const express = require("express");
const router = express.Router();
const multer = require("multer");
const upload = multer({ storage: multer.memoryStorage() });
const fs = require("fs");
const path = require("path");
const { v4: uuidv4 } = require("uuid");

// GoogleGenerativeAI kütüphanesini içe aktaralım
const { GoogleGenerativeAI } = require("@google/generative-ai");

// Kategorileri import et
const { CATEGORIES } = require("../constants/categories");

// Gemini API anahtarını alıyoruz
const apiKey = process.env.GEMINI_API_KEY;
const genAI = new GoogleGenerativeAI(apiKey);

/**
 * Giyim ürünü için AI analizi ve isim oluşturma
 * @route POST /generate-product-name
 * @param {file} req.file - Analiz edilecek giyim ürününün fotoğrafı
 * @param {string} req.body.language - Kullanıcının dil tercihi (tr, en, vb.)
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

      // Dil parametresini al
      const language = req.body.language || "en";
      console.log("Detected language for AI prompt:", language);

      // Kategorileri dinamik olarak prompt için hazırla (id: 0 hariç)
      const categoryList = CATEGORIES.filter((cat) => cat.id !== "0") // "add_custom_category" hariç
        .map((cat) => `         - "${cat.id}": "${cat.label}"`)
        .join("\n");

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
      const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

      // Prompt hazırlama - Gemini'ye hangi dilde yanıt vermesi gerektiğini söyle
      const prompt = `
      Analyze the clothing item visible in this photo and respond in ${language}.
      Please identify the following information:
      1. Clothing type/category - Select the most appropriate category ID from this list:
${categoryList}
         
      2. A VERY BRIEF description of the item (MAXIMUM 5 WORDS), focusing on color and type, in ${language}.
      3. The main color(s) of the item in ${language}. For common colors, use appropriate translations. If there are multiple colors, separate them with commas WITHOUT spaces (e.g., "red,blue,black" for English or "kırmızı,mavi,siyah" for Turkish).
      4. Suitable seasons for the item (Return as a list in English ONLY, use: "Spring", "Summer", "Autumn", "Winter", or "All Seasons").
      5. Relevant tags in ${language} (Return as a comma-separated string like "casual, cotton, comfortable").
      6. The material of the item in ${language} (e.g., "Cotton", "Polyester", "Wool"). Always provide a best guess, do not state "Unknown".
      7. The style of the item in ${language} (e.g., "Casual", "Formal", "Sporty", "Vintage"). Always provide a best guess, do not state "Unknown".
      8. The gender category the item belongs to. ONLY return one of these exact values: "men", "women", "unisex", "kids". Do not use any other values.
      9. The brand of the item, if identifiable. If not clearly identifiable, make a best guess based on design, style, or common characteristics (e.g. "Nike", "Adidas", "Zara", "H&M"). If truly impossible to guess, return "Unknown".

      Respond STRICTLY in the following JSON format:
      {
        "type": "ONLY RETURN THE NUMERIC ID as a string, e.g. '1' or '12', etc.",
        "query": "MAX 5 WORDS description in ${language}",
        "color": "main color(s)",
        "seasons": ["season1", "season2"],
        "tags": "tag1, tag2, tag3",
        "material": "material",
        "style": "style",
        "gender": "gender",
        "brand": "brand name"
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
        analysisResult.type = analysisResult.type || "1";
        analysisResult.query =
          analysisResult.query ||
          (language === "tr" ? "Açıklama yok" : "No description");

        // Query en fazla 5 kelime olacak şekilde kırp
        if (analysisResult.query) {
          const words = analysisResult.query.split(" ");
          if (words.length > 5) {
            analysisResult.query = words.slice(0, 5).join(" ");
          }
        }

        analysisResult.color =
          analysisResult.color ||
          (language === "tr" ? "belirlenmedi" : "undetermined");
        analysisResult.seasons = Array.isArray(analysisResult.seasons)
          ? analysisResult.seasons
          : [];
        analysisResult.tags = analysisResult.tags || "";
        analysisResult.material =
          analysisResult.material || (language === "tr" ? "Genel" : "General");
        analysisResult.style =
          analysisResult.style || (language === "tr" ? "Genel" : "General");
        analysisResult.gender = analysisResult.gender || "unisex";
        analysisResult.brand = analysisResult.brand || "Unknown";
      } catch (error) {
        console.error("JSON ayrıştırma hatası veya eksik alanlar:", error);
        console.error("Alınan Ham Yanıt:", responseText);
        // JSON ayrıştırılamadıysa veya alanlar eksikse varsayılan değerleri kullan
        analysisResult = {
          type: "1",
          query: language === "tr" ? "Açıklama yok" : "No description",
          color: language === "tr" ? "belirlenmedi" : "undetermined",
          seasons: [],
          tags: "",
          material: language === "tr" ? "Genel" : "General",
          style: language === "tr" ? "Genel" : "General",
          gender: "unisex",
          brand: "Unknown",
        };
      }

      // --- Mevsim ID Eşleştirmesi ---
      // Gemini her zaman İngilizce seasons döndürüyor
      const SEASON_MAPPING = {
        Spring: "spring",
        Summer: "summer",
        Autumn: "autumn",
        Fall: "autumn",
        Winter: "winter",
        "All Seasons": "all",
      };

      let seasonIdsForApi = [];
      const geminiSeasonNames = Array.isArray(analysisResult.seasons)
        ? analysisResult.seasons
        : [];

      // Gelen mevsim isimlerini ID'lere çevir
      seasonIdsForApi = geminiSeasonNames
        .map((seasonName) => {
          return SEASON_MAPPING[seasonName] || null;
        })
        .filter((id) => id); // null değerleri filtrele

      // Eğer "all" varsa, tüm mevsimleri ekle
      if (seasonIdsForApi.includes("all")) {
        seasonIdsForApi = ["spring", "summer", "autumn", "winter"];
      }

      // Ürün ismi olarak query alanını kullan
      const productName =
        analysisResult.query ||
        (language === "tr" ? "Giyim Ürünü" : "Clothing Item");

      // Geçici dosyayı temizle
      fs.unlinkSync(tempFilePath);

      // Başarılı yanıt döndür
      return res.status(200).json({
        success: true,
        type: analysisResult.type,
        query: analysisResult.query,
        productName,
        color: analysisResult.color,
        seasons: geminiSeasonNames, // Frontend için Gemini'nin döndürdüğü isimleri gönder
        seasonsIds: seasonIdsForApi, // Arka plan için ID'leri de sakla
        tags: analysisResult.tags,
        material: analysisResult.material,
        style: analysisResult.style,
        gender: analysisResult.gender,
        brand: analysisResult.brand,
        language: language, // Hangi dilde yanıt verildiğini de gönder
      });
    } catch (error) {
      console.error("Ürün analizi hatası:", error);

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
        message: error.message || "Ürün analizi sırasında bir hata oluştu",
      });
    }
  }
);

module.exports = router;
