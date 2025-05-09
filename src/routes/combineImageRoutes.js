require("dotenv").config();
const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const axios = require("axios");
const FormData = require("form-data");
const supabase = require("../supabaseClient");

const router = express.Router();
const upload = multer({ dest: "uploads/" });

router.post("/combine-images", upload.array("images", 2), async (req, res) => {
  const { prompt, userId = "anonymous" } = req.body;
  const imagePaths = req.files.map((file) => file.path);

  if (imagePaths.length !== 2) {
    return res.status(400).json({
      success: false,
      error: "İki resim gereklidir (model ve ürün görseli).",
    });
  }

  try {
    const form = new FormData();
    form.append("model", "gpt-image-1");
    form.append(
      "prompt",
      prompt ||
        "Combine these images naturally by placing the product on the person. Show the full body from a medium distance to ensure the entire outfit is clearly visible. Make sure the product fits properly and looks realistic on the model. Use professional studio lighting and ensure the perspective and proportions are correct. The image should look like a high-quality fashion photograph with the person centered in the frame, standing in a natural pose that showcases the outfit effectively."
    );

    // Her bir görüntü için MIME tipini doğru şekilde belirt
    imagePaths.forEach((imagePath, index) => {
      const fileExtension = path.extname(imagePath).toLowerCase();
      let mimeType = "image/jpeg"; // Varsayılan olarak JPEG

      if (fileExtension === ".png") {
        mimeType = "image/png";
      } else if (fileExtension === ".webp") {
        mimeType = "image/webp";
      }

      // MIME tipini açıkça belirterek dosyayı ekle
      form.append("image[]", fs.createReadStream(imagePath), {
        filename: `image${index}${fileExtension || ".jpg"}`,
        contentType: mimeType,
      });
    });

    // Size'ı 2:3 oranına değiştir
    form.append("size", "1024x1536");

    const response = await axios.post(
      "https://api.openai.com/v1/images/edits",
      form,
      {
        headers: {
          ...form.getHeaders(),
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        },
      }
    );

    // Geçici dosyaları sil
    imagePaths.forEach((imagePath) => fs.unlinkSync(imagePath));

    const imageBase64 = response.data.data[0].b64_json;
    const imageBuffer = Buffer.from(imageBase64, "base64");

    // Benzersiz dosya adı oluştur
    const timestamp = Date.now();
    const outputFileName = `combined_${timestamp}.png`;

    // Supabase'e yükleme için dosya yolu
    const userIdForPath = userId || "anonymous";
    const filePath = `${userIdForPath}/${outputFileName}`;

    // Supabase'e yükle (virtual-trys bucket'ına)
    const { data, error } = await supabase.storage
      .from("virtual-trys")
      .upload(filePath, imageBuffer, {
        contentType: "image/png",
        upsert: true,
      });

    if (error) {
      console.error("Supabase yükleme hatası:", error);
      throw new Error(`Supabase'e yüklenemedi: ${error.message}`);
    }

    // Supabase URL'ini al
    const { data: publicUrlData } = supabase.storage
      .from("virtual-trys")
      .getPublicUrl(filePath);

    const supabaseUrl = publicUrlData.publicUrl;
    console.log("Supabase URL:", supabaseUrl);

    // Yerel kopya oluştur (yedek olarak)
    const outputDir = path.join(__dirname, "../outputs");
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    const outputPath = path.join(outputDir, outputFileName);
    fs.writeFileSync(outputPath, imageBuffer);

    // JSON yanıtı döndür
    res.json({
      success: true,
      imageUrl: supabaseUrl,
      localImageUrl: `${req.protocol}://${req.get(
        "host"
      )}/outputs/${outputFileName}`,
    });
  } catch (error) {
    console.error(
      "Hata:",
      error.response ? error.response.data : error.message
    );

    // Hata durumunda, geçici dosyaları temizle
    try {
      imagePaths.forEach((imagePath) => {
        if (fs.existsSync(imagePath)) {
          fs.unlinkSync(imagePath);
        }
      });
    } catch (cleanupError) {
      console.error("Geçici dosyalar temizlenirken hata:", cleanupError);
    }

    res.status(500).json({
      success: false,
      error: "Görseller birleştirilemedi.",
      message: error.response
        ? error.response.data.error.message
        : error.message,
    });
  }
});

module.exports = router;
