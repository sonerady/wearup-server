const express = require("express");
const router = express.Router();

// GoogleGenerativeAI kütüphanesini içe aktaralım
const { GoogleGenerativeAI } = require("@google/generative-ai");

// Gemini API anahtarını alıyoruz
const apiKey = process.env.GEMINI_API_KEY;
const genAI = new GoogleGenerativeAI(apiKey);

/**
 * Giyim ürünü için isim oluşturma
 * @route POST /generate-product-name
 * @param {object} req.body.attributes - Ürünün özellikleri (renk, tür, doku, vs.)
 * @returns {object} 200 - Oluşturulan ürün ismi
 */
router.post("/generate-product-name", async (req, res) => {
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

    // İstek gövdesinden ürün özelliklerini al
    const {
      color = "",
      type = "",
      pattern = "",
      material = "",
      style = "",
      gender = "",
    } = req.body.attributes || {};

    console.log("Alınan ürün özellikleri:", req.body.attributes);

    // Özellikleri birleştirerek bir tanımlama oluştur
    const productDescription = [color, pattern, material, style, type, gender]
      .filter((attr) => attr && attr.trim() !== "")
      .join(" ");

    // Eğer hiçbir özellik verilmediyse hata döndür
    if (!productDescription) {
      return res.status(400).json({
        success: false,
        error: "Geçersiz istek",
        message: "En az bir ürün özelliği belirtilmelidir",
      });
    }

    // Gemini modeli (Gemini 1.5 Flash kullanılıyor)
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    // Prompt hazırlama
    const prompt = `
      Aşağıdaki özelliklere sahip bir giyim ürünü için yaratıcı ve çekici bir isim oluştur:
      
      Ürün özellikleri: ${productDescription}
      
      Lütfen şu kurallara uygun bir isim oluştur:
      1. İsim 2-5 kelimeden oluşmalı
      2. Tüm önemli özellikleri yansıtmalı
      3. Çağdaş ve şık bir hissi olmalı
      4. Yalnızca ismi döndür, başka açıklama ekleme
      5. Türkçe olarak yanıt ver
      
      Şu formatta cevap ver:
      İsim: [önerilen isim]
    `;

    console.log("Gemini'ye gönderilen prompt:", prompt);

    // İstek gönder
    const result = await model.generateContent(prompt);
    const responseText = result.response.text().trim();

    console.log("Gemini'den dönen yanıt:", responseText);

    // Yanıtı ayrıştır ve sadece ismi al
    let productName = responseText;
    const match = responseText.match(/İsim:\s*(.+)/i);
    if (match && match[1]) {
      productName = match[1].trim();
    }

    // Başarılı yanıt döndür
    return res.status(200).json({
      success: true,
      productName,
    });
  } catch (error) {
    console.error("Ürün ismi oluşturma hatası:", error);

    return res.status(500).json({
      success: false,
      error: "İşlem hatası",
      message: error.message || "Ürün ismi oluşturulurken bir hata oluştu",
    });
  }
});

module.exports = router;
