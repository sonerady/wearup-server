const express = require("express");
const router = express.Router();
const sharp = require("sharp");
const axios = require("axios");
const path = require("path");
const fs = require("fs").promises;
const { v4: uuidv4 } = require("uuid");
const supabase = require("../supabaseClient");

// ⚡ HTTP Performance Optimization
const httpAgent = new (require("http").Agent)({
  keepAlive: true,
  maxSockets: 50, // Maximum concurrent connections
  timeout: 10000, // 10 second timeout
});

const httpsAgent = new (require("https").Agent)({
  keepAlive: true,
  maxSockets: 50,
  timeout: 10000,
});

// ⚡ Optimized axios instance for image downloads
const imageAxios = axios.create({
  timeout: 15000, // 15 second timeout
  maxRedirects: 3,
  httpAgent: httpAgent,
  httpsAgent: httpsAgent,
  headers: {
    "User-Agent": "WearUp-ImageProcessor/1.0",
  },
});

// Outfit kompozisyonu oluşturan endpoint
router.post("/compose", async (req, res) => {
  try {
    const {
      outfitId,
      items,
      backgroundSettings,
      canvasWidth = 512,
      canvasHeight = 512,
      resolutionScale = 3,
      clientCanvasWidth = 256,
      clientCanvasHeight = 256,
    } = req.body;

    console.log(`🎨 Outfit kompozisyonu oluşturuluyor: ${outfitId}`);
    console.log(
      `📱 Client canvas görünümü: ${clientCanvasWidth.toFixed(
        1
      )}x${clientCanvasHeight.toFixed(1)}`
    );
    console.log(
      `📐 Server canvas boyutu: ${canvasWidth}x${canvasHeight} (${resolutionScale}x yüksek çözünürlük)`
    );

    // Aspect ratio kontrolü
    const clientAspectRatio = (clientCanvasWidth / clientCanvasHeight).toFixed(
      3
    );
    const serverAspectRatio = (canvasWidth / canvasHeight).toFixed(3);
    console.log(
      `📏 Aspect ratio kontrolü: Client=${clientAspectRatio}, Server=${serverAspectRatio} ${
        clientAspectRatio === serverAspectRatio ? "✅" : "❌"
      }`
    );

    console.log(`🖼️  ${items.length} item işlenecek`);

    // Canvas'ı oluştur - Client'tan gelen arkaplan ayarlarına göre
    console.log("🎨 Arkaplan ayarları:", backgroundSettings);

    let canvas;
    let canvasBackgroundColor = { r: 255, g: 255, b: 255, alpha: 1 }; // Varsayılan beyaz

    if (
      backgroundSettings?.backgroundColor &&
      backgroundSettings.backgroundColor !== "#FFFFFF"
    ) {
      console.log(
        `🎨 Client arkaplan rengi uygulanıyor: ${backgroundSettings.backgroundColor}`
      );
      // Hex rengi RGB'ye çevir
      const hex = backgroundSettings.backgroundColor.replace("#", "");
      const r = parseInt(hex.substr(0, 2), 16);
      const g = parseInt(hex.substr(2, 2), 16);
      const b = parseInt(hex.substr(4, 2), 16);
      canvasBackgroundColor = { r, g, b, alpha: 1 };
      console.log(`✅ Canvas arkaplanı RGB(${r}, ${g}, ${b}) olarak ayarlandı`);
    } else {
      console.log("🎨 Varsayılan beyaz arkaplan kullanılıyor");
    }

    canvas = sharp({
      create: {
        width: canvasWidth,
        height: canvasHeight,
        channels: 4,
        background: canvasBackgroundColor,
      },
    });

    // Arkaplan ayarları uygula
    if (backgroundSettings) {
      // Arkaplan resmi varsa
      if (backgroundSettings.backgroundImageUrl) {
        console.log(
          `🖼️  Arkaplan resmi uygulanıyor: ${
            backgroundSettings.backgroundImageUrl
          } (Opacity: ${backgroundSettings.backgroundOpacity || 0.2})`
        );
        try {
          const bgResponse = await imageAxios.get(
            backgroundSettings.backgroundImageUrl,
            {
              responseType: "arraybuffer",
            }
          );

          const bgBuffer = Buffer.from(bgResponse.data);
          const opacity = backgroundSettings.backgroundOpacity || 0.2;

          // Arkaplan resmini canvas boyutuna göre yeniden boyutlandır
          const resizedBg = await sharp(bgBuffer)
            .resize(canvasWidth, canvasHeight, { fit: "cover" })
            .composite([
              {
                input: Buffer.from([
                  255,
                  255,
                  255,
                  Math.round(255 * (1 - opacity)),
                ]),
                raw: { width: 1, height: 1, channels: 4 },
                tile: true,
                blend: "over",
              },
            ])
            .png()
            .toBuffer();

          canvas = sharp(resizedBg);
        } catch (bgError) {
          console.error("Arkaplan resmi işlenirken hata:", bgError);
        }
      }
    }

    // Item'ları z-index'e göre sırala
    const sortedItems = items.sort((a, b) => (a.zIndex || 0) - (b.zIndex || 0));
    console.log(
      `🔢 Item'lar z-index'e göre sıralandı. Sıralama:`,
      sortedItems.map((item) => `${item.id}(z:${item.zIndex || 0})`)
    );

    // ⚡ PERFORMANCE OPTIMIZATION: Parallel item processing
    console.log("🚀 Paralel item işleme başlatılıyor...");
    const startTime = Date.now();

    // Canvas scale faktörünü frontend'ten al
    const scaleFactor = resolutionScale;
    console.log(`📏 Canvas scale faktörü: ${scaleFactor}x`);

    // ⚡ 1. Paralel resim indirme ve işleme
    const itemProcessingPromises = sortedItems.map(async (item, index) => {
      try {
        if (!item.imageUrl) {
          console.log(`⚠️ Item atlandı (image URL yok): ${item.id}`);
          return null;
        }

        const processStartTime = Date.now();

        // Pozisyon ve boyut hesaplamaları (optimize edilmiş)
        const baseItemWidth = 110 * scaleFactor;
        const baseItemHeight = 120 * scaleFactor;
        const finalItemWidth = baseItemWidth * (item.scale || 1);
        const finalItemHeight = baseItemHeight * (item.scale || 1);

        const centerOffsetX = (finalItemWidth - baseItemWidth) / 2;
        const centerOffsetY = (finalItemHeight - baseItemHeight) / 2;

        const baseScaledX = item.x * scaleFactor;
        const baseScaledY = item.y * scaleFactor;
        const scaledX = baseScaledX - centerOffsetX;
        const scaledY = baseScaledY - centerOffsetY;

        // ⚡ 2. Optimized HTTP request with connection pooling
        const itemResponse = await imageAxios.get(item.imageUrl, {
          responseType: "arraybuffer",
        });

        const itemBuffer = Buffer.from(itemResponse.data);

        // ⚡ 3. Optimized Sharp pipeline - tek seferde tüm transformations
        let sharpPipeline = sharp(itemBuffer).resize(
          Math.round(finalItemWidth),
          Math.round(finalItemHeight),
          {
            fit: "contain",
            background: { r: 0, g: 0, b: 0, alpha: 0 },
            withoutEnlargement: false, // Büyütmeye izin ver
          }
        );

        // ⚡ 4. Basitleştirilmiş border radius (sadece gerekirse)
        const shouldAddBorderRadius = scaleFactor >= 2; // Sadece yüksek çözünürlükte
        if (shouldAddBorderRadius) {
          const borderRadius = Math.min(
            20,
            Math.round(15 * scaleFactor * (item.scale || 1))
          );

          // ⚡ Optimized SVG - daha basit
          const roundedCornerSvg = `<svg><rect width="${Math.round(
            finalItemWidth
          )}" height="${Math.round(
            finalItemHeight
          )}" rx="${borderRadius}" fill="white"/></svg>`;

          sharpPipeline = sharpPipeline.composite([
            {
              input: Buffer.from(roundedCornerSvg),
              blend: "dest-in",
            },
          ]);
        }

        // ⚡ 5. Rotation optimizasyonu
        if (item.rotation && Math.abs(item.rotation) > 1) {
          // Sadece anlamlı rotasyonlar
          sharpPipeline = sharpPipeline.rotate(item.rotation, {
            background: { r: 0, g: 0, b: 0, alpha: 0 },
          });
        }

        // ⚡ 6. Tek seferde buffer'a çevir
        const processedBuffer = await sharpPipeline
          .png({
            quality: 90, // Slightly lower quality for speed
            compressionLevel: 6, // Faster compression
          })
          .toBuffer();

        const processTime = Date.now() - processStartTime;
        console.log(
          `⚡ Item ${index + 1}/${sortedItems.length} işlendi: ${
            item.id
          } (${processTime}ms)`
        );

        return {
          input: processedBuffer,
          left: Math.round(scaledX),
          top: Math.round(scaledY),
          itemId: item.id,
        };
      } catch (itemError) {
        console.error(`❌ Item işleme hatası (${item.id}):`, itemError.message);
        return null; // Hatalı item'ları atla
      }
    });

    // ⚡ 7. Paralel olarak tüm item'ları işle
    console.log(`🔄 ${sortedItems.length} item paralel olarak işleniyor...`);
    const processedItems = await Promise.all(itemProcessingPromises);

    // Null olanları filtrele (hatalı item'lar)
    const compositeArray = processedItems.filter(Boolean);

    const totalProcessTime = Date.now() - startTime;
    console.log(
      `✅ ${compositeArray.length}/${sortedItems.length} item başarıyla işlendi (${totalProcessTime}ms total)`
    );
    console.log(
      `📊 Ortalama item başına: ${(
        totalProcessTime / compositeArray.length
      ).toFixed(1)}ms`
    );

    // ⚡ 8. Optimized final composition
    const compositionStartTime = Date.now();
    console.log(
      `🎯 ${compositeArray.length} item canvas'a composite ediliyor...`
    );

    const finalImage = await canvas
      .composite(compositeArray)
      .png({
        quality: 95, // High quality for final output
        compressionLevel: 6, // Balanced compression
        progressive: true, // Progressive loading
      })
      .toBuffer();

    const compositionTime = Date.now() - compositionStartTime;
    const totalTime = Date.now() - startTime;
    const fileSizeMB = (finalImage.length / 1024 / 1024).toFixed(2);

    console.log(`✅ Kompozisyon tamamlandı! (${compositionTime}ms)`);
    console.log(`📁 Dosya boyutu: ${fileSizeMB} MB`);
    console.log(`⏱️ Toplam süre: ${totalTime}ms`);
    console.log(
      `🚀 Performance: ${((1000 / totalTime) * compositeArray.length).toFixed(
        1
      )} items/second`
    );

    // Önceki cover'ı sil (eğer varsa)
    try {
      if (outfitId) {
        console.log(`🗑️ Önceki cover kontrol ediliyor: ${outfitId}`);

        // Mevcut outfit'in cover URL'ini al
        const { data: outfitData, error: outfitError } = await supabase
          .from("outfits")
          .select("outfit_cover_url")
          .eq("id", outfitId)
          .single();

        if (!outfitError && outfitData?.outfit_cover_url) {
          // URL'den dosya adını çıkar
          const oldCoverUrl = outfitData.outfit_cover_url;
          const urlParts = oldCoverUrl.split("/");
          const oldFileName = urlParts[urlParts.length - 1];

          // Eğer eski dosya covers bucket'ında ise sil
          if (oldFileName && oldFileName.includes("outfit_composed_")) {
            console.log(`🗑️ Eski cover siliniyor: ${oldFileName}`);

            const { error: deleteError } = await supabase.storage
              .from("covers")
              .remove([oldFileName]);

            if (deleteError) {
              console.warn(`⚠️ Eski cover silinemedi: ${deleteError.message}`);
            } else {
              console.log(`✅ Eski cover başarıyla silindi: ${oldFileName}`);
            }
          }
        }
      }
    } catch (deleteError) {
      console.warn("⚠️ Eski cover silme işleminde hata:", deleteError);
    }

    // Supabase'e yeni cover'ı yükle
    const fileName = `outfit_composed_${outfitId}_${Date.now()}.png`;
    console.log(`📤 Yeni cover Supabase'e yükleniyor: ${fileName}`);

    const { data: uploadData, error: uploadError } = await supabase.storage
      .from("covers")
      .upload(fileName, finalImage, {
        contentType: "image/png",
        cacheControl: "3600",
      });

    if (uploadError) {
      console.error("❌ Supabase upload hatası:", uploadError);
      return res.status(500).json({
        success: false,
        message: "Resim yüklenirken hata oluştu",
      });
    }

    console.log("✅ Supabase upload başarılı!");
    console.log("📁 Upload data:", uploadData);

    // Public URL'i al
    const {
      data: { publicUrl },
    } = supabase.storage.from("covers").getPublicUrl(fileName);

    console.log("🔗 Oluşturulan Public URL:", publicUrl);
    console.log("🎯 Bucket: covers");
    console.log("📝 Dosya adı:", fileName);
    console.log(`🎉 Outfit kompozisyonu başarıyla oluşturuldu!`);

    res.json({
      success: true,
      data: {
        imageUrl: publicUrl,
        fileName: fileName,
      },
    });
  } catch (error) {
    console.error("Outfit kompozisyonu oluşturulurken hata:", error);
    res.status(500).json({
      success: false,
      message: "Outfit kompozisyonu oluşturulamadı",
    });
  }
});

module.exports = router;
