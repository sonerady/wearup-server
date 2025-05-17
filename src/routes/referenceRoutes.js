const express = require("express");
const router = express.Router();
const RunwayML = require("@runwayml/sdk");
const { GoogleGenerativeAI } = require("@google/generative-ai");

// Gemini API için istemci oluştur
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Prompt'u iyileştirmek için Gemini'yi kullan
async function enhancePromptWithGemini(
  originalPrompt,
  referenceImages,
  settings = {}
) {
  try {
    console.log("Gemini ile prompt iyileştirme başlatılıyor");

    // Referans görsellerden tag listesi oluştur
    const imageTags = referenceImages.map((img) => img.tag).filter(Boolean);

    // Gemini modeli
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    // Kullanıcının seçtiği ayarlardan bir metin oluşturalım
    const settingsText = Object.entries(settings)
      .filter(([key, value]) => value) // Boş değerleri filtrele
      .map(([key, value]) => `${key}: ${value}`)
      .join(", ");

    // Gemini'ye gönderilecek metin
    let promptForGemini = `
    The following is an original prompt from a user: "${originalPrompt}"
    
    Reference image tags: ${imageTags.join(", ")}
    
    User selected settings: ${settingsText || "None"}
    
    This original prompt could be in any language since it comes directly from a client-side user input. The prompt may already contain references to images with their actual names (which could be anything, not just "img_1" or "img_2").
    
    I need you to:
    1. Convert this prompt to English if it's not already in English
    2. Enhance and rewrite it using proper prompt engineering techniques to be more effective for an AI image generator
    3. Keep any existing image references intact exactly as they appear in the original prompt
    4. If there are image names from the reference image tags list that are not already prefixed with @ in the prompt, add the @ symbol before them
    5. Incorporate all the user settings to enhance the prompt. For example:
       - If season is "Winter", add details about snow, cold weather, or winter clothing
       - If location is "Beach", describe a beach setting with sand, ocean, and relevant elements
       - If hairStyle or hairColor is selected, emphasize these features in the description
       - If mood is specified, adjust the tone of the description accordingly
    
    IMPORTANT: The @ symbol indicates that the text following it is the actual name of a reference image. These names can be anything (not just "img_1", "img_2") and should be preserved exactly as they appear in the tags list.
    
    Your output should only be the enhanced prompt in English, without any explanations or additional text. Maintain all image references from the original prompt with the @ prefix.
    `;

    console.log("Gemini'ye gönderilen istek:", promptForGemini);

    // Gemini'den cevap al
    const result = await model.generateContent(promptForGemini);
    let enhancedPrompt = result.response.text().trim();

    console.log("Gemini'nin ilk ürettiği prompt:", enhancedPrompt);

    // Güvenlik kontrolü: Eğer Gemini tag'lerin başına @ eklemediyse manuel olarak ekleyelim
    if (imageTags.length > 0) {
      // Her bir image tag için kontrol
      imageTags.forEach((tag) => {
        // Eğer tag prompt içinde varsa ve başında @ yoksa
        const tagRegex = new RegExp(`(?<!@)\\b${tag}\\b`, "g");
        if (tagRegex.test(enhancedPrompt)) {
          enhancedPrompt = enhancedPrompt.replace(tagRegex, `@${tag}`);
        }
      });
    }

    console.log(
      "Gemini tarafından iyileştirilmiş ve @ kontrolü yapılmış prompt:",
      enhancedPrompt
    );

    return enhancedPrompt;
  } catch (error) {
    console.error("Prompt iyileştirme hatası:", error);
    // Hata durumunda orijinal prompt'u döndür
    return originalPrompt;
  }
}

// RunwayML client'ı oluştur
router.post("/generate", async (req, res) => {
  try {
    const { ratio, promptText, referenceImages, settings } = req.body;

    if (
      !promptText ||
      !referenceImages ||
      !Array.isArray(referenceImages) ||
      referenceImages.length === 0
    ) {
      return res.status(400).json({
        success: false,
        result: {
          message:
            "Geçerli bir promptText ve en az bir referenceImage sağlanmalıdır.",
        },
      });
    }

    // Kullanıcının prompt'unu Gemini ile iyileştir - settings parametresi de ekledik
    const enhancedPrompt = await enhancePromptWithGemini(
      promptText,
      referenceImages,
      settings || {} // settings yoksa boş obje gönder
    );

    // RunwayML client oluştur
    const client = new RunwayML({ apiKey: process.env.RUNWAY_API_KEY });

    // Özet bilgileri logla
    console.log("Resim oluşturma isteği başlatılıyor:", {
      model: "gen4_image",
      ratio: ratio || "1080:1920",
      promptText: enhancedPrompt, // İyileştirilmiş prompt'u kullan
      referenceImagesCount: referenceImages.length,
    });

    // RunwayML'e gönderilen tam veri yapısını logla
    console.log("RunwayML'e gönderilen tam veri yapısı:", {
      model: "gen4_image",
      ratio: ratio || "1080:1920",
      promptText: enhancedPrompt,
      referenceImages: referenceImages.map((img) => ({
        uri: img.uri,
        tag: img.tag,
      })),
    });

    // Resim oluşturma görevi oluştur
    let task = await client.textToImage.create({
      model: "gen4_image",
      ratio: ratio || "1080:1920",
      promptText: enhancedPrompt, // İyileştirilmiş prompt'u kullan
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
        result: {
          task,
          imageUrl: task.output[0],
          originalPrompt: promptText,
          enhancedPrompt: enhancedPrompt,
        },
      });
    } else if (task.status === "FAILED") {
      console.error("Görev başarısız oldu:", task.error);
      return res.status(500).json({
        success: false,
        result: {
          message: "Resim oluşturma görevi başarısız oldu",
          error: task.error,
        },
      });
    } else {
      console.error("Görev zaman aşımına uğradı");
      return res.status(408).json({
        success: false,
        result: {
          message: "Resim oluşturma görevi zaman aşımına uğradı",
          taskId: task.id,
        },
      });
    }
  } catch (error) {
    console.error("Resim oluşturma hatası:", error);
    return res.status(500).json({
      success: false,
      result: {
        message: "Resim oluşturma sırasında bir hata oluştu",
        error: error.message,
      },
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

    // Test için prompt'u iyileştir
    const enhancedTestPrompt = await enhancePromptWithGemini(
      testPrompt,
      testReferenceImages
    );
    console.log("İyileştirilmiş test promptu:", enhancedTestPrompt);

    console.log("Test işlemi başlatılıyor");

    // Resim oluşturma görevi oluştur
    let task = await client.textToImage.create({
      model: "gen4_image",
      ratio: "1080:1920",
      promptText: enhancedTestPrompt, // İyileştirilmiş prompt'u kullan
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
        result: {
          task,
          imageUrl: task.output[0],
          originalPrompt: testPrompt,
          enhancedPrompt: enhancedTestPrompt,
        },
      });
    } else if (task.status === "FAILED") {
      console.error("Test görevi başarısız oldu:", task.error);
      return res.status(500).json({
        success: false,
        result: {
          message: "Test resmi oluşturma görevi başarısız oldu",
          error: task.error,
        },
      });
    } else {
      console.error("Test görevi zaman aşımına uğradı");
      return res.status(408).json({
        success: false,
        result: {
          message: "Test resmi oluşturma görevi zaman aşımına uğradı",
          taskId: task.id,
        },
      });
    }
  } catch (error) {
    console.error("Test hatası:", error);
    return res.status(500).json({
      success: false,
      result: {
        message: "Test sırasında bir hata oluştu",
        error: error.message,
      },
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
        result: {
          message: "Görev ID'si gereklidir",
        },
      });
    }

    const client = new RunwayML();
    const task = await client.tasks.retrieve(taskId);

    return res.status(200).json({
      success: true,
      result: {
        task,
        imageUrl: task.status === "SUCCEEDED" ? task.output[0] : null,
      },
    });
  } catch (error) {
    console.error("Görev durumu kontrolü hatası:", error);
    return res.status(500).json({
      success: false,
      result: {
        message: "Görev durumu kontrolü sırasında bir hata oluştu",
        error: error.message,
      },
    });
  }
});

module.exports = router;
