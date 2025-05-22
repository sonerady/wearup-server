const express = require("express");
const router = express.Router();
const RunwayML = require("@runwayml/sdk");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { createClient } = require("@supabase/supabase-js");
const got = require("got");
const sharp = require("sharp");
const fs = require("fs");
const path = require("path");
const { v4: uuidv4 } = require("uuid");

// Supabase istemci oluştur
const supabaseUrl =
  process.env.SUPABASE_URL || "https://halurilrsdzgnieeajxm.supabase.co";
const supabaseKey =
  process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

// Görüntülerin geçici olarak saklanacağı klasörü oluştur
const tempDir = path.join(__dirname, "../../temp");
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true });
}

// Görüntü normalleştirme fonksiyonu
async function normalizeImage(imageUrl) {
  try {
    console.log(`Görüntü normalize ediliyor: ${imageUrl}`);

    // URL'den görüntüyü indir
    const buffer = await got(imageUrl).buffer();

    // Görüntü bilgilerini al
    const metadata = await sharp(buffer).metadata();
    const { width, height } = metadata;
    const ratio = width / height;

    console.log(
      `Orijinal görüntü boyutu: ${width}x${height}, oran: ${ratio.toFixed(3)}`
    );

    // Oranı kontrol et ve gerekirse düzelt
    let outputBuffer;

    if (ratio < 0.5) {
      // Çok dar görüntü (width çok küçük) - genişliği arttır
      const targetWidth = Math.ceil(height * 0.5);
      console.log(`Görüntü çok dar. Yeni boyut: ${targetWidth}x${height}`);

      outputBuffer = await sharp(buffer)
        .resize(targetWidth, height, {
          fit: "contain",
          background: { r: 255, g: 255, b: 255, alpha: 1 },
        })
        .toBuffer();
    } else if (ratio > 2.0) {
      // Çok geniş görüntü (height çok küçük) - yüksekliği arttır
      const targetHeight = Math.ceil(width / 2);
      console.log(`Görüntü çok geniş. Yeni boyut: ${width}x${targetHeight}`);

      outputBuffer = await sharp(buffer)
        .resize(width, targetHeight, {
          fit: "contain",
          background: { r: 255, g: 255, b: 255, alpha: 1 },
        })
        .toBuffer();
    } else {
      // Oran zaten geçerli
      console.log("Görüntü oranı zaten geçerli, değişiklik yapılmadı.");
      outputBuffer = buffer;
    }

    // Normalize edilmiş görüntüyü geçici dosyaya kaydet
    const fileName = `normalized_${uuidv4()}.png`;
    const filePath = path.join(tempDir, fileName);

    await fs.promises.writeFile(filePath, outputBuffer);

    // Supabase'e yükle
    const remotePath = `normalized/${fileName}`;
    const { data, error } = await supabase.storage
      .from("reference")
      .upload(remotePath, outputBuffer, {
        contentType: "image/png",
        upsert: true,
      });

    if (error) {
      console.error("Normalize edilmiş görüntü yükleme hatası:", error);
      throw error;
    }

    // Public URL al
    const { data: publicUrlData } = supabase.storage
      .from("reference")
      .getPublicUrl(remotePath);

    // Geçici dosyayı sil
    fs.promises
      .unlink(filePath)
      .catch((err) => console.warn("Geçici dosya silinemedi:", err));

    // Public URL'i döndür
    return publicUrlData.publicUrl;
  } catch (error) {
    console.error("Görüntü normalize edilirken hata:", error);
    // Hata durumunda orijinal URL'i döndür
    return imageUrl;
  }
}

// Görüntüye metin ekleme fonksiyonu
async function addTextToImage(imageUrl, text) {
  try {
    console.log(`Görüntüye metin ekleniyor: ${text}`);

    // URL'den görüntüyü indir
    const buffer = await got(imageUrl).buffer();

    // Görüntü bilgilerini al
    const metadata = await sharp(buffer).metadata();
    const { width, height } = metadata;

    // Metin boyutunu belirle (görüntü genişliğinin %5'i)
    const fontSize = Math.max(20, Math.round(width * 0.05));

    // SVG tabanlı metin oluştur
    // Not: Resmin alt kısmına tam genişlikte yerleştirme
    const textOverlay = {
      create: {
        width: width,
        height: height,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    };

    // Arka plan için tam siyah dikdörtgen oluştur
    const svgPadding = fontSize * 0.5;
    const svgX = 0; // Sol kenardan başla
    const svgY = height - fontSize - svgPadding * 2; // Alttan başla
    const textWidth = width; // Tam genişlik

    const svgText = `
      <svg width="${width}" height="${height}">
        <rect
          x="${svgX}"
          y="${svgY}"
          width="${textWidth}"
          height="${fontSize + svgPadding * 2}"
          fill="#000000"
          rx="0"
          ry="0"
        />
        <text
          x="${width / 2}"
          y="${svgY + fontSize + svgPadding * 0.5}"
          font-family="Arial, Helvetica, sans-serif"
          font-size="${fontSize}px"
          font-weight="bold"
          text-anchor="middle"
          fill="white"
        >${text}</text>
      </svg>`;

    // Metni görüntüye ekle
    const outputBuffer = await sharp(buffer)
      .composite([
        {
          input: Buffer.from(svgText),
          gravity: "southeast",
        },
      ])
      .toBuffer();

    // İşlenmiş görüntüyü geçici dosyaya kaydet
    const fileName = `text_added_${uuidv4()}.png`;
    const filePath = path.join(tempDir, fileName);

    await fs.promises.writeFile(filePath, outputBuffer);

    // Supabase'e yükle
    const remotePath = `processed/${fileName}`;
    const { data, error } = await supabase.storage
      .from("reference")
      .upload(remotePath, outputBuffer, {
        contentType: "image/png",
        upsert: true,
      });

    if (error) {
      console.error("İşlenmiş görüntü yükleme hatası:", error);
      throw error;
    }

    // Public URL al
    const { data: publicUrlData } = supabase.storage
      .from("reference")
      .getPublicUrl(remotePath);

    // Geçici dosyayı sil
    fs.promises
      .unlink(filePath)
      .catch((err) => console.warn("Geçici dosya silinemedi:", err));

    // Public URL'i döndür
    return publicUrlData.publicUrl;
  } catch (error) {
    console.error("Görüntüye metin eklenirken hata:", error);
    // Hata durumunda orijinal URL'i döndür
    return imageUrl;
  }
}

// Görsel oluşturma sonuçlarını veritabanına kaydetme fonksiyonu
async function saveGenerationToDatabase(
  userId,
  data,
  originalPrompt,
  referenceImages
) {
  try {
    // User ID yoksa, "anonymous" olarak kaydedelim
    const userIdentifier = userId || "anonymous_" + Date.now();

    const { data: insertData, error } = await supabase
      .from("reference_explores")
      .insert([
        {
          user_id: userIdentifier,
          image_url: data.result.imageUrl,
          prompt: originalPrompt,
          enhanced_prompt: data.result.enhancedPrompt,
          reference_images: referenceImages.map((img) => img.uri),
          created_at: new Date().toISOString(),
        },
      ]);

    if (error) {
      console.error("Veritabanına kaydetme hatası:", error);
      return false;
    }

    console.log("Görsel başarıyla veritabanına kaydedildi");
    return true;
  } catch (dbError) {
    console.error("Veritabanı işlemi sırasında hata:", dbError);
    return false;
  }
}

// Gemini API için istemci oluştur
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Ratio formatını düzelten yardımcı fonksiyon
function formatRatio(ratioStr) {
  // RunwayML tarafından resmi olarak desteklenen piksel formatları
  const validPixelValues = [
    "1920:1080",
    "1080:1920",
    "1024:1024",
    "1360:768",
    "1080:1080",
    "1168:880",
    "1440:1080",
    "1080:1440",
    "1808:768",
    "2112:912",
  ];

  // Kullanıcı arayüzündeki oranların piksel karşılıkları
  const validPixelRatios = {
    "1:1": "1024:1024", // veya "1080:1080"
    "4:3": "1440:1080",
    "3:4": "1080:1440",
    "16:9": "1920:1080",
    "9:16": "1080:1920",
    "21:9": "2112:912", // buna en yakın değer
  };

  try {
    // Ratio string'inin geçerli olup olmadığını kontrol et
    if (!ratioStr || !ratioStr.includes(":")) {
      console.log(
        `Geçersiz ratio formatı: ${ratioStr}, varsayılan değer kullanılıyor: 1080:1920`
      );
      return "1080:1920";
    }

    // Eğer gelen değer piksel cinsinden ve doğrudan desteklenen bir formatsa kullan
    if (validPixelValues.includes(ratioStr)) {
      console.log(`Gelen ratio değeri geçerli piksel formatında: ${ratioStr}`);
      return ratioStr;
    }

    // Eğer gelen değer oran cinsinden ve doğrudan karşılığı varsa dönüştür
    if (validPixelRatios[ratioStr]) {
      console.log(
        `Ratio ${ratioStr} dönüştürüldü: ${validPixelRatios[ratioStr]}`
      );
      return validPixelRatios[ratioStr];
    }

    // Piksel değerlerini kontrol et - client'dan dönüştürülmüş olabilir
    const [width, height] = ratioStr.split(":").map(Number);

    // Geçerli piksel değerleri mi kontrol et
    if (!width || !height || isNaN(width) || isNaN(height)) {
      console.log(
        `Geçersiz ratio değerleri: ${ratioStr}, varsayılan değer kullanılıyor: 1080:1920`
      );
      return "1080:1920";
    }

    // Eğer özel bir oran ise, en yakın desteklenen oranı bul
    const aspectRatio = width / height;
    let closestRatio = "1080:1920"; // Varsayılan
    let minDifference = Number.MAX_VALUE;

    for (const validRatio of validPixelValues) {
      const [validWidth, validHeight] = validRatio.split(":").map(Number);
      const validAspectRatio = validWidth / validHeight;
      const difference = Math.abs(aspectRatio - validAspectRatio);

      if (difference < minDifference) {
        minDifference = difference;
        closestRatio = validRatio;
      }
    }

    console.log(
      `Özel ratio ${ratioStr} için en yakın desteklenen değer: ${closestRatio}`
    );
    return closestRatio;
  } catch (error) {
    console.error(
      `Ratio formatı işlenirken hata oluştu: ${error.message}`,
      error
    );
    return "1080:1920"; // Varsayılan değer
  }
}

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
      .filter(([key, value]) => value !== null && value !== undefined) // Null veya undefined değerleri filtrele
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
    2. Keep the prompt concise and to the point - maximum 2-3 sentences
    3. Keep any existing image references intact exactly as they appear in the original prompt
    4. If there are image names from the reference image tags list that are not already prefixed with @ in the prompt, add the @ symbol before them
    5. Only subtly incorporate the user settings without adding lengthy descriptions
    6. CRITICAL - ACCESSORY DETECTION: When analyzing reference images for clothing/styling prompts, you MUST identify and include ALL accessories visible in the images, such as:
       - Eyewear (glasses, sunglasses)
       - Jewelry (necklaces, bracelets, rings, earrings)
       - Scarves, shawls, ties
       - Hats, caps, headbands
       - Bags, purses, backpacks
       - Watches, belts, gloves
       - ANY other accessories visible in the images
    
    IMPORTANT: 
    - Your enhanced prompt should be SHORT (2-3 sentences maximum)
    - Be professional in your wording
    - The @ symbol indicates a reference image name
    - DO NOT add unnecessary descriptive details about lighting, mood, or style unless explicitly mentioned in the original prompt
    - DO ENUMERATE ALL visible clothing items AND accessories when the prompt is about dressing/wearing items - NEVER omit accessories
    - Pay extra attention to small items like jewelry, glasses, and other accessories - these are often overlooked but must be included
    
    Note: I am providing the reference images with their tag names at the bottom. For "dressing" or "wearing" prompts, you MUST carefully examine each image and list ALL clothing items and accessories visible. Missing any accessory is considered a critical error.
    
    Your output should ONLY be the enhanced prompt in English, without any explanations. Keep it professional and make sure to mention EVERY accessory visible in the reference images when the user is asking to dress someone or wear items.
    `;

    console.log("Gemini'ye gönderilen istek:", promptForGemini);

    // Resim verilerini içerecek parts dizisini hazırla
    const parts = [{ text: promptForGemini }];

    // Referans resimleri varsa, bu resimleri Gemini'ye gönder
    // Not: Burada maksimum 10 resim sınırlaması var, o yüzden ilk 10 resmi alıyoruz
    const maxImagesToSend = Math.min(referenceImages.length, 10);

    if (maxImagesToSend > 0) {
      console.log(
        `Gemini'ye ${maxImagesToSend} adet referans görsel gönderiliyor`
      );

      for (let i = 0; i < maxImagesToSend; i++) {
        try {
          const imageUrl = referenceImages[i].uri;
          console.log(`Görsel yükleniyor: ${imageUrl}`);

          // URL'den görüntüyü indir (Bu görüntüler zaten üzerinde metin eklenmiş haldedir)
          const imageResponse = await got(imageUrl, { responseType: "buffer" });
          const imageBuffer = imageResponse.body;

          // Base64'e çevir
          const base64Image = imageBuffer.toString("base64");

          // Görsel verilerini parts dizisine ekle
          parts.push({
            inlineData: {
              mimeType: "image/png",
              data: base64Image,
            },
          });

          console.log(`${i + 1}. görsel başarıyla yüklendi ve hazırlandı`);
        } catch (imageError) {
          console.error(`Görsel yüklenirken hata: ${imageError.message}`);
        }
      }
    }

    // Gemini'den cevap al - resimlerle birlikte
    const result = await model.generateContent({
      contents: [{ parts }],
    });

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
    const { ratio, promptText, referenceImages, settings, userId } = req.body;

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

    // Referans görsellerinin oran doğrulaması
    console.log(
      `${referenceImages.length} adet referans görsel alındı. Server tarafında normalize edilecek.`
    );

    // Tüm görselleri normalize et
    const normalizedImages = [];
    for (const img of referenceImages) {
      try {
        // Görseli normalize et
        const normalizedUrl = await normalizeImage(img.uri);

        // Normalize edilmiş görsele metin ekle (img.tag'i sağ alt köşeye yaz)
        const processedUrl = await addTextToImage(normalizedUrl, img.tag);

        // İşlenmiş görseli diziye ekle
        normalizedImages.push({
          uri: processedUrl,
          tag: img.tag,
        });

        console.log(`Görsel normalize edildi ve metin eklendi: ${img.tag}`);
      } catch (error) {
        console.error(`Görsel işlenemedi: ${img.tag}`, error);
        // Hata durumunda orijinal görseli kullan
        normalizedImages.push(img);
      }
    }

    console.log(`${normalizedImages.length} adet görsel normalize edildi.`);

    // Ratio'yu formatla
    const formattedRatio = formatRatio(ratio || "1080:1920");
    console.log(
      `İstenen ratio: ${ratio}, formatlanmış ratio: ${formattedRatio}`
    );

    // Kullanıcının prompt'unu Gemini ile iyileştir - settings parametresi de ekledik
    const enhancedPrompt = await enhancePromptWithGemini(
      promptText,
      normalizedImages, // Normalize edilmiş görselleri kullan
      settings || {} // settings yoksa boş obje gönder
    );

    // RunwayML client oluştur
    const client = new RunwayML({ apiKey: process.env.RUNWAY_API_KEY });

    // Özet bilgileri logla
    console.log("Resim oluşturma isteği başlatılıyor:", {
      model: "gen4_image",
      ratio: formattedRatio,
      promptText: enhancedPrompt, // İyileştirilmiş prompt'u kullan
      referenceImagesCount: normalizedImages.length,
    });

    // RunwayML'e gönderilen tam veri yapısını logla
    console.log("RunwayML'e gönderilen tam veri yapısı:", {
      model: "gen4_image",
      ratio: formattedRatio,
      promptText: enhancedPrompt,
      referenceImages: normalizedImages.map((img) => ({
        uri: img.uri,
        tag: img.tag,
      })),
    });

    // Resim oluşturma görevi oluştur
    let task = await client.textToImage.create({
      model: "gen4_image",
      ratio: formattedRatio,
      promptText: enhancedPrompt, // İyileştirilmiş prompt'u kullan
      referenceImages: normalizedImages, // Normalize edilmiş görselleri kullan
    });

    console.log("Görev başlatıldı, görev ID:", task.id);

    // İşlemin durumunu kontrol et (polling)
    let timeoutCount = 0;
    const maxTimeouts = 120; // 60 saniye maksimum bekleme süresi

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

      // Sonuç verisini hazırla
      const responseData = {
        success: true,
        result: {
          task,
          imageUrl: task.output[0],
          originalPrompt: promptText,
          enhancedPrompt: enhancedPrompt,
        },
      };

      // Sonucu veritabanına kaydet
      await saveGenerationToDatabase(
        userId,
        responseData,
        promptText,
        normalizedImages
      );

      return res.status(200).json(responseData);
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

    // Test için ratio formatla
    const testRatio = formatRatio("1080:1920");

    // Resim oluşturma görevi oluştur
    let task = await client.textToImage.create({
      model: "gen4_image",
      ratio: testRatio,
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
