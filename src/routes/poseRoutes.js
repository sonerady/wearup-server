const express = require("express");
const router = express.Router();
const fs = require("fs");
const path = require("path");

// JSON dosyalarının yolları
const malePosesPath = path.join(__dirname, "../../lib/man_poses.json");
const femalePosesPath = path.join(__dirname, "../../lib/woman_poses.json");

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

// JSON dosyalarını oku
let malePoses = [];
let femalePoses = [];

try {
  const maleData = fs.readFileSync(malePosesPath, "utf8");
  malePoses = JSON.parse(maleData);

  // URL'leri optimize et
  malePoses = malePoses.map((pose) => ({
    ...pose,
    image: optimizeImageUrl(pose.image),
  }));

  console.log(`${malePoses.length} erkek pozu yüklendi`);
} catch (error) {
  console.error("Man poses yüklenirken hata:", error);
}

try {
  const femaleData = fs.readFileSync(femalePosesPath, "utf8");
  femalePoses = JSON.parse(femaleData);

  // URL'leri optimize et
  femalePoses = femalePoses.map((pose) => ({
    ...pose,
    image: optimizeImageUrl(pose.image),
  }));

  console.log(`${femalePoses.length} kadın pozu yüklendi`);
} catch (error) {
  console.error("Woman poses yüklenirken hata:", error);
}

// Test endpointi
router.get("/test", (req, res) => {
  res.json({
    success: true,
    message: "Poz API çalışıyor",
    malePosesCount: malePoses.length,
    femalePosesCount: femalePoses.length,
  });
});

// Erkek pozlarını getir
router.get("/male", (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;

    const startIndex = (page - 1) * limit;
    const endIndex = page * limit;

    const paginatedPoses = malePoses.slice(startIndex, endIndex);

    res.json({
      success: true,
      total: malePoses.length,
      page: page,
      limit: limit,
      hasMore: endIndex < malePoses.length,
      data: paginatedPoses,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Erkek pozları yüklenirken hata oluştu",
      error: error.message,
    });
  }
});

// Kadın pozlarını getir
router.get("/female", (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;

    const startIndex = (page - 1) * limit;
    const endIndex = page * limit;

    const paginatedPoses = femalePoses.slice(startIndex, endIndex);

    res.json({
      success: true,
      total: femalePoses.length,
      page: page,
      limit: limit,
      hasMore: endIndex < femalePoses.length,
      data: paginatedPoses,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Kadın pozları yüklenirken hata oluştu",
      error: error.message,
    });
  }
});

module.exports = router;
