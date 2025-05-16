const express = require("express");
const router = express.Router();
const RunwayML = require("@runwayml/sdk");

// RunwayML client'ı oluştur
router.post("/generate", async (req, res) => {
  try {
    const { ratio, promptText, referenceImages } = req.body;

    if (
      !promptText ||
      !referenceImages ||
      !Array.isArray(referenceImages) ||
      referenceImages.length === 0
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Geçerli bir promptText ve en az bir referenceImage sağlanmalıdır.",
      });
    }

    // RunwayML client oluştur
    const client = new RunwayML({ apiKey: process.env.RUNWAY_API_KEY });

    console.log("Resim oluşturma isteği başlatılıyor:", {
      model: "gen4_image",
      ratio: ratio || "1080:1920",
      promptText,
      referenceImagesCount: referenceImages.length,
    });

    // Resim oluşturma görevi oluştur
    let task = await client.textToImage.create({
      model: "gen4_image",
      ratio: ratio || "1080:1920",
      promptText,
      referenceImages,
    });

    console.log("Görev başlatıldı, görev ID:", task.id);

    // İşlemin durumunu kontrol et (polling)
    let timeoutCount = 0;
    const maxTimeouts = 60; // 60 saniye maksimum bekleme süresi

    while (
      !["SUCCEEDED", "FAILED"].includes(task.status) &&
      timeoutCount < maxTimeouts
    ) {
      // 1 saniye bekle
      await new Promise((resolve) => setTimeout(resolve, 1000));
      timeoutCount++;

      // Görev durumunu güncelle
      task = await client.tasks.retrieve(task.id);
      console.log(`Görev durumu kontrolü (${timeoutCount}): ${task.status}`);
    }

    if (task.status === "SUCCEEDED") {
      console.log("Görev başarıyla tamamlandı");
      return res.status(200).json({
        success: true,
        task,
        imageUrl: task.output[0],
      });
    } else if (task.status === "FAILED") {
      console.error("Görev başarısız oldu:", task.error);
      return res.status(500).json({
        success: false,
        message: "Resim oluşturma görevi başarısız oldu",
        error: task.error,
      });
    } else {
      console.error("Görev zaman aşımına uğradı");
      return res.status(408).json({
        success: false,
        message: "Resim oluşturma görevi zaman aşımına uğradı",
        taskId: task.id,
      });
    }
  } catch (error) {
    console.error("Resim oluşturma hatası:", error);
    return res.status(500).json({
      success: false,
      message: "Resim oluşturma sırasında bir hata oluştu",
      error: error.message,
    });
  }
});

// Örnek referans resimlerle test endpoint'i
router.get("/test", async (req, res) => {
  try {
    const client = new RunwayML({ apiKey: process.env.RUNWAY_API_KEY });

    // Test için örnek resimler
    const testPrompt = "Eiffel Tower painted in the style of Starry Night";
    const testReferenceImages = [
      {
        uri: "https://upload.wikimedia.org/wikipedia/commons/8/85/Tour_Eiffel_Wikimedia_Commons_(cropped).jpg",
        tag: "EiffelTower",
      },
      {
        uri: "https://upload.wikimedia.org/wikipedia/commons/thumb/e/ea/Van_Gogh_-_Starry_Night_-_Google_Art_Project.jpg/1513px-Van_Gogh_-_Starry_Night_-_Google_Art_Project.jpg",
        tag: "StarryNight",
      },
    ];

    console.log("Test işlemi başlatılıyor");

    // Resim oluşturma görevi oluştur
    let task = await client.textToImage.create({
      model: "gen4_image",
      ratio: "1080:1920",
      promptText: testPrompt,
      referenceImages: testReferenceImages,
    });

    console.log("Test görevi başlatıldı, görev ID:", task.id);

    // İşlemin durumunu kontrol et
    let timeoutCount = 0;
    const maxTimeouts = 30; // 30 saniye maksimum bekleme süresi

    while (
      !["SUCCEEDED", "FAILED"].includes(task.status) &&
      timeoutCount < maxTimeouts
    ) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      timeoutCount++;
      task = await client.tasks.retrieve(task.id);
      console.log(
        `Test görevi durumu kontrolü (${timeoutCount}): ${task.status}`
      );
    }

    if (task.status === "SUCCEEDED") {
      console.log("Test görevi başarıyla tamamlandı");
      return res.status(200).json({
        success: true,
        task,
        imageUrl: task.output[0],
      });
    } else if (task.status === "FAILED") {
      console.error("Test görevi başarısız oldu:", task.error);
      return res.status(500).json({
        success: false,
        message: "Test resmi oluşturma görevi başarısız oldu",
        error: task.error,
      });
    } else {
      console.error("Test görevi zaman aşımına uğradı");
      return res.status(408).json({
        success: false,
        message: "Test resmi oluşturma görevi zaman aşımına uğradı",
        taskId: task.id,
      });
    }
  } catch (error) {
    console.error("Test hatası:", error);
    return res.status(500).json({
      success: false,
      message: "Test sırasında bir hata oluştu",
      error: error.message,
    });
  }
});

// Görev durumunu kontrol etmek için endpoint
router.get("/task/:taskId", async (req, res) => {
  try {
    const { taskId } = req.params;

    if (!taskId) {
      return res.status(400).json({
        success: false,
        message: "Görev ID'si gereklidir",
      });
    }

    const client = new RunwayML();
    const task = await client.tasks.retrieve(taskId);

    return res.status(200).json({
      success: true,
      task,
      imageUrl: task.status === "SUCCEEDED" ? task.output[0] : null,
    });
  } catch (error) {
    console.error("Görev durumu kontrolü hatası:", error);
    return res.status(500).json({
      success: false,
      message: "Görev durumu kontrolü sırasında bir hata oluştu",
      error: error.message,
    });
  }
});

module.exports = router;
