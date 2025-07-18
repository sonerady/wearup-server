const sharp = require("sharp");
const axios = require("axios");
const path = require("path");
const fs = require("fs");

/**
 * Resim URL'sini alıp 2048x2048 boyutuna center crop yapar ve buffer döndürür
 * @param {string} imageUrl - İşlenecek resmin URL'si
 * @returns {Promise<Buffer>} - İşlenmiş resmin buffer'ı
 */
async function resizeImageFromUrlToBuffer(imageUrl) {
    try {
        console.log('🔄 Resim indiriliyor:', imageUrl);
        
        // URL'den resmi indir
        const response = await axios({
            method: 'GET',
            url: imageUrl,
            responseType: 'arraybuffer'
        });

        const imageBuffer = Buffer.from(response.data);
        
        console.log('🖼️  Resim işleniyor...');

        // Sharp ile padding silme ve resize işlemi - buffer döndür
        const processedBuffer = await sharp(imageBuffer)
            .trim({ // Padding/boşlukları sil
                background: { r: 255, g: 255, b: 255, alpha: 0 }, // Şeffaf alanları sil
                threshold: 10 // Hassaslık (0-100)
            })
            .resize(2048, 2048, { // 2048x2048 alana sığdır
                fit: 'contain', // Aspect ratio'yu koru, sıkıştırma!
                background: { r: 255, g: 255, b: 255, alpha: 0 }, // Şeffaf arkaplan
                withoutEnlargement: false // Küçük resimleri büyütmeye izin ver
            })
            .png() // PNG formatında
            .toBuffer(); // Buffer olarak döndür

        console.log('✅ Resim başarıyla işlendi! Buffer boyutu:', processedBuffer.length, 'bytes');
        
        return processedBuffer;

    } catch (error) {
        console.error('❌ Hata oluştu:', error.message);
        throw error;
    }
}

/**
 * Resim URL'sini alıp 2048x2048 boyutuna center crop yapar
 * @param {string} imageUrl - İşlenecek resmin URL'si
 * @param {string} outputFileName - Çıktı dosya adı (opsiyonel)
 * @returns {Promise<string>} - İşlenmiş dosyanın yolu
 */
async function resizeImageFromUrl(imageUrl, outputFileName = null) {
  try {
    console.log("🔄 Resim indiriliyor:", imageUrl);

    // URL'den resmi indir
    const response = await axios({
      method: "GET",
      url: imageUrl,
      responseType: "arraybuffer",
    });

    const imageBuffer = Buffer.from(response.data);

    // Çıktı dosya adını belirle
    if (!outputFileName) {
      const timestamp = Date.now();
      const extension = path.extname(imageUrl).split("?")[0] || ".jpg";
      outputFileName = `resized_${timestamp}${extension}`;
    }

    // Çıktı dizinini oluştur
    const outputDir = path.join(__dirname, "../temp");
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const outputPath = path.join(outputDir, outputFileName);

    console.log("🖼️  Resim işleniyor...");

    // Sharp ile padding silme ve resize işlemi
    await sharp(imageBuffer)
      .trim({ // Padding/boşlukları sil
        background: { r: 255, g: 255, b: 255, alpha: 0 }, // Şeffaf alanları sil
        threshold: 10 // Hassaslık (0-100)
      })
      .resize(2048, 2048, { // 2048x2048 alana sığdır
        fit: "contain", // Aspect ratio'yu koru, sıkıştırma!
        background: { r: 255, g: 255, b: 255, alpha: 0 }, // Şeffaf arkaplan
        withoutEnlargement: false // Küçük resimleri büyütmeye izin ver
      })
      .png() // PNG formatında kaydet
      .toFile(outputPath);

    console.log("✅ Resim başarıyla işlendi!");
    console.log("📁 Dosya yolu:", outputPath);

    return outputPath;
  } catch (error) {
    console.error("❌ Hata oluştu:", error.message);
    throw error;
  }
}

/**
 * Birden fazla resmi işle
 * @param {string[]} imageUrls - İşlenecek resim URL'leri dizisi
 */
async function batchResizeImages(imageUrls) {
  console.log(`🚀 ${imageUrls.length} resim işlenecek...`);

  const results = [];
  for (let i = 0; i < imageUrls.length; i++) {
    try {
      console.log(`\n[${i + 1}/${imageUrls.length}] İşleniyor...`);
      const result = await resizeImageFromUrl(imageUrls[i]);
      results.push({ url: imageUrls[i], success: true, path: result });
    } catch (error) {
      console.error(`❌ Hata (${i + 1}/${imageUrls.length}):`, error.message);
      results.push({ url: imageUrls[i], success: false, error: error.message });
    }
  }

  console.log("\n📊 İşlem Özeti:");
  console.log("✅ Başarılı:", results.filter((r) => r.success).length);
  console.log("❌ Başarısız:", results.filter((r) => !r.success).length);

  return results;
}

// Command line kullanımı
if (require.main === module) {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log(`
🖼️  Resim Boyutlandırıcı Kullanımı:

Tek resim:
node image-resizer.js "https://example.com/image.jpg"

Çıktı dosya adı ile:
node image-resizer.js "https://example.com/image.jpg" "my-image.png"

Birden fazla resim:
node image-resizer.js "url1" "url2" "url3"

📝 Not: Resimler 2048x2048 boyutuna center crop edilir ve /temp klasörüne kaydedilir.
        `);
    process.exit(1);
  }

  // Tek resim işleme
  if (args.length === 1 || args.length === 2) {
    const imageUrl = args[0];
    const outputFileName = args[1] || null;

    resizeImageFromUrl(imageUrl, outputFileName)
      .then((filePath) => {
        console.log("\n🎉 İşlem tamamlandı!");
        console.log("📂 Dosya:", filePath);
      })
      .catch((error) => {
        console.error("\n💥 İşlem başarısız:", error.message);
        process.exit(1);
      });
  }
  // Birden fazla resim işleme
  else {
    batchResizeImages(args)
      .then((results) => {
        console.log("\n🎉 Toplu işlem tamamlandı!");
      })
      .catch((error) => {
        console.error("\n💥 Toplu işlem başarısız:", error.message);
        process.exit(1);
      });
  }
}

module.exports = {
  resizeImageFromUrl,
  resizeImageFromUrlToBuffer,
  batchResizeImages,
};
