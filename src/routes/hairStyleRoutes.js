const express = require("express");
const router = express.Router();
const fs = require("fs");
const path = require("path");

// JSON dosyalarının yolları
const maleHairStylesPath = path.join(__dirname, "../lib/man_hair_styles.json");
const femaleHairStylesPath = path.join(
  __dirname,
  "../lib/woman_hair_styles.json"
);

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

// JSON dosyalarını oku
let maleHairStyles = [];
let femaleHairStyles = [];

try {
  const maleData = fs.readFileSync(maleHairStylesPath, "utf8");
  maleHairStyles = JSON.parse(maleData);

  // URL'leri optimize et
  maleHairStyles = maleHairStyles.map((style) => ({
    ...style,
    image: optimizeImageUrl(style.image),
  }));

  console.log(`${maleHairStyles.length} erkek saç stili yüklendi`);
} catch (error) {
  console.error("Erkek saç stilleri yüklenirken hata:", error);
}

try {
  const femaleData = fs.readFileSync(femaleHairStylesPath, "utf8");
  femaleHairStyles = JSON.parse(femaleData);

  // URL'leri optimize et
  femaleHairStyles = femaleHairStyles.map((style) => ({
    ...style,
    image: optimizeImageUrl(style.image),
  }));

  console.log(`${femaleHairStyles.length} kadın saç stili yüklendi`);
} catch (error) {
  console.error("Kadın saç stilleri yüklenirken hata:", error);
}

// Test endpointi
router.get("/test", (req, res) => {
  res.json({
    success: true,
    message: "Saç Stilleri API çalışıyor",
    maleHairStylesCount: maleHairStyles.length,
    femaleHairStylesCount: femaleHairStyles.length,
  });
});

// Erkek saç stillerini getir
router.get("/male", (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    
    // Verileri karıştır
    const shuffledStyles = shuffleArray(maleHairStyles);

    const startIndex = (page - 1) * limit;
    const endIndex = page * limit;

    const paginatedStyles = shuffledStyles.slice(startIndex, endIndex);

    res.json({
      success: true,
      total: maleHairStyles.length,
      page: page,
      limit: limit,
      hasMore: endIndex < maleHairStyles.length,
      data: paginatedStyles,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Erkek saç stilleri yüklenirken hata oluştu",
      error: error.message,
    });
  }
});

// Kadın saç stillerini getir
router.get("/female", (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    
    // Verileri karıştır
    const shuffledStyles = shuffleArray(femaleHairStyles);

    const startIndex = (page - 1) * limit;
    const endIndex = page * limit;

    const paginatedStyles = shuffledStyles.slice(startIndex, endIndex);

    res.json({
      success: true,
      total: femaleHairStyles.length,
      page: page,
      limit: limit,
      hasMore: endIndex < femaleHairStyles.length,
      data: paginatedStyles,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Kadın saç stilleri yüklenirken hata oluştu",
      error: error.message,
    });
  }
});

module.exports = router;
