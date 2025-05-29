const express = require("express");
const supabase = require("../supabaseClient"); // Supabase client'ı
const router = express.Router();
const multer = require("multer"); // Dosya yüklemek için kullanılıyor
const upload = multer(); // Geçici olarak bellekte tutmak için

// Bucket'ın var olup olmadığını kontrol eden ve yoksa oluşturan fonksiyon
const ensureBucketExists = async (bucketName) => {
  try {
    // Önce bucket'ın var olup olmadığını kontrol et
    const { data: buckets, error: listError } =
      await supabase.storage.listBuckets();

    if (listError) {
      console.error("Bucket listesi alınırken hata:", listError);
      return false;
    }

    // Bucket zaten var mı?
    const bucketExists = buckets.some((bucket) => bucket.name === bucketName);

    if (bucketExists) {
      console.log(`Bucket "${bucketName}" zaten mevcut`);
      return true;
    }

    // Bucket yoksa oluştur
    console.log(`Bucket "${bucketName}" oluşturuluyor...`);
    const { data, error: createError } = await supabase.storage.createBucket(
      bucketName,
      {
        public: true, // Herkese açık bucket
        allowedMimeTypes: ["image/*"], // Sadece resim dosyalarına izin ver
        fileSizeLimit: 52428800, // 50MB limit
      }
    );

    if (createError) {
      console.error(`Bucket "${bucketName}" oluşturulurken hata:`, createError);
      return false;
    }

    console.log(`Bucket "${bucketName}" başarıyla oluşturuldu`);
    return true;
  } catch (error) {
    console.error(
      `Bucket "${bucketName}" kontrolü/oluşturulması sırasında hata:`,
      error
    );
    return false;
  }
};

router.post("/upload", upload.array("files", 10), async (req, res) => {
  const files = req.files;
  const { bucket = "images", userId } = req.body; // bucket default "images", userId opsiyonel

  if (!files || files.length === 0) {
    return res.status(400).json({ message: "Dosya gerekli." });
  }

  console.log(`Upload isteği - Bucket: ${bucket}, User ID: ${userId}`);

  try {
    // Bucket'ın var olduğundan emin ol
    const bucketReady = await ensureBucketExists(bucket);
    if (!bucketReady) {
      return res.status(500).json({
        message: `Bucket "${bucket}" hazırlanamadı`,
        bucket: bucket,
      });
    }

    const publicUrls = [];

    for (const file of files) {
      // Dosya yolu oluşturma - eğer userId varsa onun klasörü altında
      let filePath;
      const timestamp = Date.now();
      const cleanFileName = file.originalname.replace(/[^a-zA-Z0-9.-]/g, "_");

      if (userId) {
        filePath = `${userId}/${timestamp}_${cleanFileName}`;
      } else {
        filePath = `${timestamp}_${cleanFileName}`;
      }

      console.log(`Dosya yükleniyor: ${filePath} -> ${bucket} bucket'ına`);

      // Dosyayı Supabase bucket'ına yüklüyoruz
      const { data, error } = await supabase.storage
        .from(bucket) // Dinamik bucket kullanımı
        .upload(filePath, file.buffer, {
          contentType: file.mimetype,
          upsert: false, // Aynı isimde dosya varsa hata ver
        });

      if (error) {
        console.error(`Dosya yükleme hatası (${filePath}):`, error);
        throw error;
      }

      // Dosyanın herkese açık URL'sini alıyoruz
      const { data: publicUrlData, error: urlError } = await supabase.storage
        .from(bucket)
        .getPublicUrl(filePath);

      if (urlError) {
        console.error(`URL alma hatası (${filePath}):`, urlError);
        throw urlError;
      }

      console.log(`Dosya başarıyla yüklendi: ${publicUrlData.publicUrl}`);
      publicUrls.push(publicUrlData.publicUrl);
    }

    // Yüklenen URL'leri console'a yazdır
    console.log("Tüm upload edilen URL'ler:", publicUrls);

    // URL'leri JSON formatında döndür
    res.status(200).json(publicUrls);
  } catch (error) {
    console.error("Dosya yükleme hatası:", error);
    res.status(500).json({
      message: "Dosya yüklenemedi.",
      error: error.message,
      bucket: bucket,
    });
  }
});

module.exports = router;
