const express = require("express");
const router = express.Router();
const supabase = require("../supabaseClient");

// Resim URL'lerine boyut parametresi ekleyen yardımcı fonksiyon
const optimizeImageUrl = (imageUrl) => {
  if (!imageUrl) return imageUrl;
  // Sadece supabase URL'lerini işle
  if (imageUrl.includes("supabase.co/storage")) {
    const hasParams = imageUrl.includes("?");
    return `${imageUrl}${hasParams ? "&" : "?"}width=512&height=512`;
  }
  return imageUrl;
};

// Diziyi karıştıran yardımcı fonksiyon
const shuffleArray = (array) => {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
};

// Dosya adından başlık oluşturan yardımcı fonksiyon
const formatTitle = (filename) => {
  if (!filename) return "style";
  return filename
    .replace(/\.(png|jpg|jpeg|gif|webp)$/gi, "") // Tüm resim uzantılarını kaldır
    .replace(/[-]/g, "_") // Tire'yi alt çizgiyle değiştir
    .toLowerCase() // Küçük harflere çevir
    .replace(/\s+/g, "_"); // Boşlukları alt çizgiyle değiştir
};

// Supabase bucket'tan resimleri getiren fonksiyon
const getImagesFromBucket = async (bucketName) => {
  try {
    console.log(`Fetching images from bucket: ${bucketName}`);

    const { data: files, error } = await supabase.storage
      .from(bucketName)
      .list("", {
        limit: 1000,
        sortBy: { column: "name", order: "asc" },
      });

    if (error) {
      console.error(`Error fetching from ${bucketName}:`, error);
      return [];
    }

    if (!files || files.length === 0) {
      console.log(`No files found in bucket: ${bucketName}`);
      return [];
    }

    // Sadece resim dosyalarını filtrele
    const imageFiles = files.filter((file) =>
      file.name.match(/\.(jpg|jpeg|png|gif|webp)$/i)
    );

    console.log(`Found ${imageFiles.length} image files in ${bucketName}`);

    // Her dosya için public URL oluştur
    const hairStyles = imageFiles.map((file, index) => {
      const { data } = supabase.storage
        .from(bucketName)
        .getPublicUrl(file.name);

      return {
        id: `hairstyle-${file.name.replace(/\.[^/.]+$/, "")}-${index}`,
        title: formatTitle(file.name),
        image: optimizeImageUrl(data.publicUrl),
        fileName: file.name,
      };
    });

    console.log(`Processed ${hairStyles.length} hair styles`);
    return hairStyles;
  } catch (error) {
    console.error(`Error processing ${bucketName}:`, error);
    return [];
  }
};

// Verileri sayfalama fonksiyonu
const paginateData = (data, page, limit) => {
  const shuffledData = shuffleArray(data);
  const startIndex = (page - 1) * limit;
  const endIndex = page * limit;
  const paginatedItems = shuffledData.slice(startIndex, endIndex);
  return {
    paginatedItems,
    hasMore: endIndex < data.length,
    total: data.length,
  };
};

// Test endpointi
router.get("/test", async (req, res) => {
  try {
    const womanHairStyles = await getImagesFromBucket(
      "woman-hair-style-images"
    );
    const manHairStyles = await getImagesFromBucket("man-hair-style-images");

    res.json({
      success: true,
      message: "Hair Style API çalışıyor",
      womanCount: womanHairStyles.length,
      manCount: manHairStyles.length,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Test endpoint hatası",
      error: error.message,
    });
  }
});

// Woman hair styles endpoint
router.get("/woman", async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 80;

    const hairStyles = await getImagesFromBucket("woman-hair-style-images");
    const { paginatedItems, hasMore, total } = paginateData(
      hairStyles,
      page,
      limit
    );

    res.json({
      success: true,
      total,
      page,
      limit,
      hasMore,
      data: paginatedItems,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Woman hair styles yüklenirken hata oluştu",
      error: error.message,
    });
  }
});

// Man hair styles endpoint
router.get("/man", async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 80;

    const hairStyles = await getImagesFromBucket("man-hair-style-images");
    const { paginatedItems, hasMore, total } = paginateData(
      hairStyles,
      page,
      limit
    );

    res.json({
      success: true,
      total,
      page,
      limit,
      hasMore,
      data: paginatedItems,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Man hair styles yüklenirken hata oluştu",
      error: error.message,
    });
  }
});

module.exports = router;
