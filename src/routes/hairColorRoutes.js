const express = require("express");
const router = express.Router();
const fs = require("fs");
const path = require("path");

// JSON dosyasının yolu
const hairColorsPath = path.join(__dirname, "../lib/hair_colors.json");

// Resim URL'lerine boyut parametresi ekleyen yardımcı fonksiyon
const optimizeImageUrl = (imageUrl) => {
  if (!imageUrl) return imageUrl;

  // Sadece supabase URL'lerini işle
  if (imageUrl.includes("supabase.co/storage")) {
    // URL'de zaten parametre var mı kontrol et
    const hasParams = imageUrl.includes("?");
    return `${imageUrl}${hasParams ? "&" : "?"}width=512&height=512`;
  }

  return imageUrl;
};

// Diziyi karıştırmak için Fisher-Yates shuffle algoritması
const shuffleArray = (array) => {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
};

// JSON dosyasını oku
let hairColors = [];

try {
  const data = fs.readFileSync(hairColorsPath, "utf8");
  hairColors = JSON.parse(data);

  // URL'leri optimize et
  hairColors = hairColors.map((color) => ({
    ...color,
    image: optimizeImageUrl(color.image),
  }));

  console.log(`${hairColors.length} saç rengi yüklendi`);
} catch (error) {
  console.error("Saç renkleri yüklenirken hata:", error);
}

// Test endpointi
router.get("/test", (req, res) => {
  res.json({
    success: true,
    message: "Saç Renkleri API çalışıyor",
    hairColorsCount: hairColors.length,
  });
});

// Tüm saç renklerini getir
router.get("/", (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;

    // Verileri karıştır
    const shuffledColors = shuffleArray(hairColors);

    const startIndex = (page - 1) * limit;
    const endIndex = page * limit;

    const paginatedColors = shuffledColors.slice(startIndex, endIndex);

    res.json({
      success: true,
      total: hairColors.length,
      page: page,
      limit: limit,
      hasMore: endIndex < hairColors.length,
      data: paginatedColors,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Saç renkleri yüklenirken hata oluştu",
      error: error.message,
    });
  }
});

// Kadın saç renklerini getir
router.get("/female", (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;

    // Tüm renkleri kullan (veri ayrımı yoksa)
    const shuffledColors = shuffleArray(hairColors);

    const startIndex = (page - 1) * limit;
    const endIndex = page * limit;

    const paginatedColors = shuffledColors.slice(startIndex, endIndex);

    res.json({
      success: true,
      total: hairColors.length,
      page: page,
      limit: limit,
      hasMore: endIndex < hairColors.length,
      data: paginatedColors,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Kadın saç renkleri yüklenirken hata oluştu",
      error: error.message,
    });
  }
});

// Erkek saç renklerini getir
router.get("/male", (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;

    // Tüm renkleri kullan (veri ayrımı yoksa)
    const shuffledColors = shuffleArray(hairColors);

    const startIndex = (page - 1) * limit;
    const endIndex = page * limit;

    const paginatedColors = shuffledColors.slice(startIndex, endIndex);

    res.json({
      success: true,
      total: hairColors.length,
      page: page,
      limit: limit,
      hasMore: endIndex < hairColors.length,
      data: paginatedColors,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Erkek saç renkleri yüklenirken hata oluştu",
      error: error.message,
    });
  }
});

module.exports = router;
