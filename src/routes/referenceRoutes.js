const express = require("express");
const router = express.Router();
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

// Üç görseli yan yana birleştiren fonksiyon
async function combineImagesHorizontally(image1Url, image2Url, image3Url) {
  try {
    console.log(
      `3 görsel yan yana birleştiriliyor: ${image1Url} + ${image2Url} + ${image3Url}`
    );

    // Üç görüntüyü de indir
    const [buffer1, buffer2, buffer3] = await Promise.all([
      got(image1Url).buffer(),
      got(image2Url).buffer(),
      got(image3Url).buffer(),
    ]);

    // Görüntü bilgilerini al
    const [metadata1, metadata2, metadata3] = await Promise.all([
      sharp(buffer1).metadata(),
      sharp(buffer2).metadata(),
      sharp(buffer3).metadata(),
    ]);

    // Hedef boyutları hesapla - eşit yükseklik, yan yana
    const targetHeight = Math.max(
      metadata1.height,
      metadata2.height,
      metadata3.height
    );
    const aspect1 = metadata1.width / metadata1.height;
    const aspect2 = metadata2.width / metadata2.height;
    const aspect3 = metadata3.width / metadata3.height;

    const width1 = Math.round(targetHeight * aspect1);
    const width2 = Math.round(targetHeight * aspect2);
    const width3 = Math.round(targetHeight * aspect3);
    const totalWidth = width1 + width2 + width3;

    console.log(`Birleştirilmiş görüntü boyutu: ${totalWidth}x${targetHeight}`);
    console.log(`Görsel genişlikleri: ${width1}, ${width2}, ${width3}`);

    // Birinci görüntüyü yeniden boyutlandır (face)
    const resizedBuffer1 = await sharp(buffer1)
      .resize(width1, targetHeight, {
        fit: "cover",
        position: "center",
      })
      .toBuffer();

    // İkinci görüntüyü yeniden boyutlandır (model)
    const resizedBuffer2 = await sharp(buffer2)
      .resize(width2, targetHeight, {
        fit: "cover",
        position: "center",
      })
      .toBuffer();

    // Üçüncü görüntüyü yeniden boyutlandır (product)
    const resizedBuffer3 = await sharp(buffer3)
      .resize(width3, targetHeight, {
        fit: "cover",
        position: "center",
      })
      .toBuffer();

    // Görüntüleri yan yana birleştir
    const combinedBuffer = await sharp({
      create: {
        width: totalWidth,
        height: targetHeight,
        channels: 3,
        background: { r: 255, g: 255, b: 255 },
      },
    })
      .composite([
        { input: resizedBuffer1, left: 0, top: 0 },
        { input: resizedBuffer2, left: width1, top: 0 },
        { input: resizedBuffer3, left: width1 + width2, top: 0 },
      ])
      .jpeg({ quality: 90 })
      .toBuffer();

    // Birleştirilmiş görüntüyü geçici dosyaya kaydet
    const fileName = `combined_3images_${uuidv4()}.jpg`;
    const filePath = path.join(tempDir, fileName);

    await fs.promises.writeFile(filePath, combinedBuffer);

    // Supabase'e yükle
    const remotePath = `combined/${fileName}`;
    const { data, error } = await supabase.storage
      .from("reference")
      .upload(remotePath, combinedBuffer, {
        contentType: "image/jpeg",
        upsert: true,
      });

    if (error) {
      console.error("Birleştirilmiş görüntü yükleme hatası:", error);
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

    console.log("3 görüntü başarıyla birleştirildi:", publicUrlData.publicUrl);
    return publicUrlData.publicUrl;
  } catch (error) {
    console.error("Görüntüler birleştirilirken hata:", error);
    throw error;
  }
}

// İki görseli (model + product) yan yana birleştiren fonksiyon
async function combineModelAndProduct(modelImageUrl, productImageUrl) {
  try {
    console.log(
      `Model ve product görseli birleştiriliyor: ${modelImageUrl} + ${productImageUrl}`
    );

    // İki görüntüyü de indir
    const [modelBuffer, productBuffer] = await Promise.all([
      got(modelImageUrl).buffer(),
      got(productImageUrl).buffer(),
    ]);

    // Görüntü bilgilerini al
    const [modelMetadata, productMetadata] = await Promise.all([
      sharp(modelBuffer).metadata(),
      sharp(productBuffer).metadata(),
    ]);

    // Hedef boyutları hesapla - eşit yükseklik, yan yana
    const targetHeight = Math.max(modelMetadata.height, productMetadata.height);
    const modelAspect = modelMetadata.width / modelMetadata.height;
    const productAspect = productMetadata.width / productMetadata.height;

    const modelWidth = Math.round(targetHeight * modelAspect);
    const productWidth = Math.round(targetHeight * productAspect);
    const totalWidth = modelWidth + productWidth;

    console.log(`Birleştirilmiş görüntü boyutu: ${totalWidth}x${targetHeight}`);
    console.log(
      `Görsel genişlikleri: model=${modelWidth}, product=${productWidth}`
    );

    // Model görüntüsünü yeniden boyutlandır
    const resizedModelBuffer = await sharp(modelBuffer)
      .resize(modelWidth, targetHeight, {
        fit: "cover",
        position: "center",
      })
      .toBuffer();

    // Product görüntüsünü yeniden boyutlandır
    const resizedProductBuffer = await sharp(productBuffer)
      .resize(productWidth, targetHeight, {
        fit: "cover",
        position: "center",
      })
      .toBuffer();

    // Görüntüleri yan yana birleştir
    const combinedBuffer = await sharp({
      create: {
        width: totalWidth,
        height: targetHeight,
        channels: 3,
        background: { r: 255, g: 255, b: 255 },
      },
    })
      .composite([
        { input: resizedModelBuffer, left: 0, top: 0 },
        { input: resizedProductBuffer, left: modelWidth, top: 0 },
      ])
      .jpeg({ quality: 90 })
      .toBuffer();

    // Birleştirilmiş görüntüyü geçici dosyaya kaydet
    const fileName = `combined_model_product_${uuidv4()}.jpg`;
    const filePath = path.join(tempDir, fileName);

    await fs.promises.writeFile(filePath, combinedBuffer);

    // Supabase'e yükle
    const remotePath = `combined/${fileName}`;
    const { data, error } = await supabase.storage
      .from("reference")
      .upload(remotePath, combinedBuffer, {
        contentType: "image/jpeg",
        upsert: true,
      });

    if (error) {
      console.error("Model+Product görüntü yükleme hatası:", error);
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

    console.log(
      "Model + Product görüntüleri başarıyla birleştirildi:",
      publicUrlData.publicUrl
    );
    return publicUrlData.publicUrl;
  } catch (error) {
    console.error("Model + Product birleştirme hatası:", error);
    throw error;
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
          reference_images: referenceImages,
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

// Aspect ratio formatını düzelten yardımcı fonksiyon
function formatAspectRatio(ratioStr) {
  const validRatios = ["1:1", "4:3", "3:4", "16:9", "9:16", "21:9"];

  try {
    if (!ratioStr || !ratioStr.includes(":")) {
      console.log(
        `Geçersiz ratio formatı: ${ratioStr}, varsayılan değer kullanılıyor: 9:16`
      );
      return "9:16";
    }

    // Eğer gelen değer geçerli bir ratio ise kullan
    if (validRatios.includes(ratioStr)) {
      console.log(`Gelen ratio değeri geçerli: ${ratioStr}`);
      return ratioStr;
    }

    // Piksel değerlerini orana çevir
    const [width, height] = ratioStr.split(":").map(Number);

    if (!width || !height || isNaN(width) || isNaN(height)) {
      console.log(
        `Geçersiz ratio değerleri: ${ratioStr}, varsayılan değer kullanılıyor: 9:16`
      );
      return "9:16";
    }

    // En yakın standart oranı bul
    const aspectRatio = width / height;
    let closestRatio = "9:16";
    let minDifference = Number.MAX_VALUE;

    for (const validRatio of validRatios) {
      const [validWidth, validHeight] = validRatio.split(":").map(Number);
      const validAspectRatio = validWidth / validHeight;
      const difference = Math.abs(aspectRatio - validAspectRatio);

      if (difference < minDifference) {
        minDifference = difference;
        closestRatio = validRatio;
      }
    }

    console.log(
      `Ratio ${ratioStr} için en yakın desteklenen değer: ${closestRatio}`
    );
    return closestRatio;
  } catch (error) {
    console.error(
      `Ratio formatı işlenirken hata oluştu: ${error.message}`,
      error
    );
    return "9:16";
  }
}

// Prompt'u iyileştirmek için Gemini'yi kullan
async function enhancePromptWithGemini(
  originalPrompt,
  combinedImageUrl,
  settings = {}
) {
  try {
    console.log("Gemini ile prompt iyileştirme başlatılıyor");

    // Gemini modeli
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    // Settings'in var olup olmadığını kontrol et
    const hasValidSettings =
      settings &&
      Object.entries(settings).some(
        ([key, value]) => value !== null && value !== undefined && value !== ""
      );

    // Location related settings kontrolü
    const hasLocationSettings =
      settings &&
      Object.keys(settings).some(
        (key) =>
          key.toLowerCase().includes("location") ||
          key.toLowerCase().includes("background") ||
          key.toLowerCase().includes("setting") ||
          key.toLowerCase().includes("environment") ||
          key.toLowerCase().includes("place")
      );

    console.log("🎛️ [BACKEND GEMINI] Settings kontrolü:", hasValidSettings);
    console.log(
      "📍 [BACKEND GEMINI] Location settings var mı:",
      hasLocationSettings
    );

    let settingsPromptSection = "";

    if (hasValidSettings) {
      const settingsText = Object.entries(settings)
        .filter(
          ([key, value]) =>
            value !== null && value !== undefined && value !== ""
        )
        .map(([key, value]) => `${key}: ${value}`)
        .join(", ");

      console.log("🎛️ [BACKEND GEMINI] Settings için prompt oluşturuluyor...");
      console.log("📝 [BACKEND GEMINI] Settings text:", settingsText);

      settingsPromptSection = `
    User selected settings: ${settingsText}
    
    SETTINGS DETAIL FOR BETTER PROMPT CREATION:
    ${Object.entries(settings)
      .filter(
        ([key, value]) => value !== null && value !== undefined && value !== ""
      )
      .map(
        ([key, value]) =>
          `- ${key.charAt(0).toUpperCase() + key.slice(1)}: ${value}`
      )
      .join("\n    ")}
    
    IMPORTANT: Please incorporate the user settings above into your description when appropriate.`;
    }

    // Background/location prompt section - sadece location settings yoksa ekle
    let backgroundPromptSection = "";

    if (!hasLocationSettings) {
      backgroundPromptSection = `
    
    CREATIVE BACKGROUND REQUIREMENTS (No location specified by user):
    - CREATE a beautiful, creative background that perfectly complements the artistic style and mood
    - CHOOSE between indoor or outdoor settings based on what works best with the overall aesthetic:
      * For elegant/formal styles: luxurious interiors, galleries, upscale environments
      * For casual/natural styles: outdoor settings like gardens, streets, beaches, natural landscapes  
      * For artistic/creative styles: studios, artistic spaces, unique architectural settings
      * For dramatic styles: moody environments with strong visual impact
    - FOCUS on perfect lighting that enhances the artistic vision:
      * Natural daylight for fresh, vibrant looks
      * Professional studio lighting for polished, editorial feels
      * Golden hour lighting for warm, romantic atmospheres
      * Dramatic lighting for bold, artistic statements
    - MAKE the background atmospheric and mood-appropriate:
      * Colors should create harmony with the overall composition
      * The setting should enhance the artistic narrative
      * Avoid distracting elements that compete with the main subject
    - BE CREATIVE AND ARTISTIC - choose unique, visually striking backgrounds that elevate the image to gallery-quality
    - ENSURE the lighting, atmosphere, and setting create a cohesive, professional artistic photography look`;
    } else {
      backgroundPromptSection = `
    
    BACKGROUND NOTE (User specified location settings):
    - DO NOT add additional background descriptions - user has specified location preferences in settings
    - Focus only on the artistic composition, lighting, and main subject as per user's location settings`;
    }

    // Gemini'ye gönderilecek metin
    let promptForGemini = `
    Create a detailed, professional fashion photography description based on this original user input: "${
      originalPrompt || "Create an artistic image"
    }"
    
    ${settingsPromptSection}
    
    ${backgroundPromptSection}
    
    You are looking at a combined image that shows multiple photos with LABELS underneath each photo. Your task is to create a description for ONE SINGLE ARTISTIC IMAGE featuring the MAIN CHARACTER with all other elements applied to them.
    
    IMPORTANT UNDERSTANDING:
    - Photo labeled "MAIN CHARACTER" = This is the ONLY PERSON in the final image
    - Photos labeled "ITEM" = These should be applied to/used by the main character (clothing, accessories, backgrounds, objects, etc.)
    
    CRITICAL INSTRUCTION: IGNORE ALL CLOTHING that the MAIN CHARACTER is currently wearing. Do NOT describe the main character's existing clothing. Only focus on their body, pose, and physical characteristics.
    
    MAIN TASK:
    - Take the MAIN CHARACTER (first photo) as your only person (IGNORE their current clothing)
    - Apply all ITEMS to this character in appropriate ways:
      * Clothing items should be WORN by the character (REPLACE their existing clothing)
      * Background scenes should be the SETTING/ENVIRONMENT
      * Accessories/objects should be held, worn, or placed around the character
    - Create ONE FINAL ARTISTIC IMAGE with only ONE PERSON
    
    CORE REQUIREMENTS:
    1. FOCUS ON THE PERSON: Describe the main character - their body type, height, build, posture, and pose (BUT IGNORE THEIR CURRENT CLOTHING)
    2. CLOTHING DETAILS: Describe in EXTREME DETAIL ONLY the clothing/fashion items from the ITEM photos:
       - Exact colors, patterns, textures, fabrics, materials
       - Specific cuts, silhouettes, design elements
       - Unique features, embellishments, details, finishes
       - How each garment fits and drapes on this specific person's body
       - Material characteristics (matte, glossy, textured, smooth, etc.)
    3. STYLING: Show how the ITEM products look when styled on the MAIN CHARACTER
    4. FASHION INTEGRATION: Create a seamless look where all clothing items from the ITEM photos work together harmoniously
    
    DETAILED PRODUCT ANALYSIS REQUIRED:
    - Analyze EVERY visible clothing item and accessory from the ITEM photos ONLY
    - DO NOT mention any clothing visible on the MAIN CHARACTER
    - Describe fabric textures, weaves, finishes in detail
    - Mention specific design elements: buttons, zippers, seams, cuts, patterns
    - Describe how each piece fits this particular body type and height
    - Include color descriptions with nuances and undertones
    - Mention any logos, prints, or decorative elements (but avoid brand names)
    - Describe the overall style aesthetic and fashion category
    
    BODY & STYLING INTEGRATION:
    - How the ITEM clothing complements the person's body proportions
    - How the fit enhances their natural silhouette
    - How the colors work with their overall appearance
    - How the style matches their pose and attitude
    
    ARTISTIC PHOTOGRAPHY REQUIREMENTS:
    1. ARTISTIC COMPOSITION: Create visually stunning, magazine-quality imagery
    2. PROFESSIONAL LIGHTING: Describe sophisticated lighting setup (natural, studio, golden hour, etc.)
    3. AESTHETIC APPEAL: Focus on beauty, elegance, and visual impact
    4. CREATIVE ANGLES: Suggest interesting perspectives and compositions
    5. COLOR HARMONY: Describe cohesive color palettes and tones
    6. MOOD & ATMOSPHERE: Create emotional depth and artistic ambiance
    7. HIGH-END QUALITY: Think luxury fashion photography, art gallery pieces
    ${
      !hasLocationSettings
        ? "8. CREATIVE BACKGROUNDS: Include beautiful, artistic backgrounds that enhance the overall composition"
        : "8. RESPECT USER LOCATION SETTINGS: Focus on composition without adding background details"
    }
    
    CRITICAL GUIDELINES:
    1. ONLY ONE PERSON: The main character is the ONLY human in the image
    2. APPLY ALL ITEMS: Each ITEM should be integrated with the main character appropriately
    3. UNIFIED SCENE: Everything should look naturally integrated in one artistic photo
    4. NO SEPARATE PEOPLE: Don't describe multiple people - combine everything onto the main character
    5. ARTISTIC VISION: Think like a professional photographer creating a portfolio piece
    ${
      !hasLocationSettings
        ? "6. ENVIRONMENTAL STORYTELLING: Use backgrounds and lighting to enhance the artistic narrative"
        : "6. FOCUS ON SUBJECT: Concentrate on the main character and items without environmental additions"
    }
    
    EXAMPLE APPROACH:
    If you see: [Main Character] + [ITEM: Dress] + [ITEM: Desert Scene] + [ITEM: Jewelry]
    Create: "An artistic portrait of [describe main character] elegantly wearing [dress description] and [jewelry description] in a beautifully composed [desert scene], featuring professional lighting and sophisticated visual aesthetics"
    
    CONTENT GUIDELINES - KEEP IT SAFE & PROFESSIONAL:
    1. Use only professional fashion terminology
    2. Focus on clothing style, not intimate body details
    3. Avoid age descriptors or suggestive language
    4. Use terms like "model", "person" instead of age-specific words
    5. Keep descriptions editorial and sophisticated
    6. No brand names or copyrighted content
    7. Focus on craftsmanship and design quality
    8. Use professional photography language
    
    LANGUAGE REQUIREMENTS:
    - Output must be 100% ENGLISH only
    - Use sophisticated fashion vocabulary
    - Professional editorial tone
    - Detailed but appropriate descriptions
    - Focus on style and craftsmanship
    
    ENHANCED FASHION WRITING:
    - Avoid: transparent, see-through, sheer, revealing, tight-fitting, form-fitting
    - Use: tailored, well-fitted, contemporary cut, elegant silhouette, refined design
    - Focus on fabric quality, construction, and styling rather than body emphasis
    - Maintain editorial magazine sophistication
    
    OUTPUT FORMAT:
    Create a single, flowing fashion photography description that reads like a professional editorial caption. Describe the complete look as if you're writing for a high-end fashion magazine${
      !hasLocationSettings
        ? ", including the beautiful setting and lighting that creates the perfect fashion photography atmosphere"
        : ""
    }${
      hasValidSettings
        ? ". Naturally incorporate the user's style preferences into the description"
        : ""
    }.
    
    Remember: This should read like a beautiful, detailed fashion photography description, not a technical process explanation.
    `;

    console.log("Gemini'ye gönderilen istek:", promptForGemini);

    // Resim verilerini içerecek parts dizisini hazırla
    const parts = [{ text: promptForGemini }];

    // Birleştirilmiş görseli Gemini'ye gönder
    try {
      console.log(
        `Birleştirilmiş görsel Gemini'ye gönderiliyor: ${combinedImageUrl}`
      );

      const imageResponse = await got(combinedImageUrl, {
        responseType: "buffer",
      });
      const imageBuffer = imageResponse.body;

      // Base64'e çevir
      const base64Image = imageBuffer.toString("base64");

      parts.push({
        inlineData: {
          mimeType: "image/jpeg",
          data: base64Image,
        },
      });

      console.log("Birleştirilmiş görsel başarıyla Gemini'ye yüklendi");
    } catch (imageError) {
      console.error(`Görsel yüklenirken hata: ${imageError.message}`);
    }

    // Gemini'den cevap al
    const result = await model.generateContent({
      contents: [{ parts }],
    });

    let enhancedPrompt = result.response.text().trim();

    console.log(
      "🤖 [BACKEND GEMINI] Gemini'nin ürettiği prompt:",
      enhancedPrompt
    );

    return enhancedPrompt;
  } catch (error) {
    console.error("Prompt iyileştirme hatası:", error);
    return originalPrompt;
  }
}

// Replicate prediction durumunu kontrol eden fonksiyon
async function pollReplicateResult(predictionId, maxAttempts = 60) {
  console.log(`Replicate prediction polling başlatılıyor: ${predictionId}`);

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const response = await got.get(
        `https://api.replicate.com/v1/predictions/${predictionId}`,
        {
          headers: {
            Authorization: `Bearer ${process.env.REPLICATE_API_TOKEN}`,
            "Content-Type": "application/json",
          },
          responseType: "json",
        }
      );

      const result = response.body;
      console.log(`Polling attempt ${attempt + 1}: status = ${result.status}`);

      if (result.status === "succeeded") {
        console.log("Replicate işlemi başarıyla tamamlandı");
        return result;
      } else if (result.status === "failed") {
        console.error("Replicate işlemi başarısız:", result.error);

        // Sensitive content hatasını kontrol et (V2'den eklendi)
        if (
          result.error &&
          typeof result.error === "string" &&
          (result.error.includes("flagged as sensitive") ||
            result.error.includes("E005") ||
            result.error.includes("sensitive content"))
        ) {
          console.error(
            "❌ Sensitive content hatası tespit edildi, polling durduruluyor"
          );

          // Özel bir error object döndür ki frontend'de yakalayabilelim
          const sensitiveError = new Error(
            "Your content has been flagged as inappropriate. Please try again with a different image or settings."
          );
          sensitiveError.type = "sensitive_content";
          throw sensitiveError;
        }

        // Content moderation hatası kontrolü - E005 kodu veya sensitive content
        if (
          result.error &&
          (result.error.includes("E005") ||
            result.error.includes("flagged as sensitive") ||
            result.error.includes("content policy") ||
            result.error.includes("violates") ||
            result.error.includes("inappropriate"))
        ) {
          console.error(
            "🚫 Content moderation hatası tespit edildi, pooling hemen durduruluyor:",
            result.error
          );

          // Özel bir error object döndür ki frontend'de yakalayabilelim
          const sensitiveError = new Error(
            `Content Moderation Error: ${result.error}`
          );
          sensitiveError.type = "sensitive_content";
          throw sensitiveError;
        }
        throw new Error(result.error || "Replicate processing failed");
      } else if (result.status === "canceled") {
        console.error("Replicate işlemi iptal edildi");
        throw new Error("Replicate processing was canceled");
      }

      // Processing veya starting durumundaysa bekle
      if (result.status === "processing" || result.status === "starting") {
        await new Promise((resolve) => setTimeout(resolve, 2000)); // 2 saniye bekle
        continue;
      }
    } catch (error) {
      // Eğer hata "failed" status'undan geliyorsa, tekrar deneme
      if (
        error.message.includes("Replicate processing failed") ||
        error.message.includes("Replicate processing was canceled") ||
        error.message.includes("Content Moderation Error")
      ) {
        console.error(
          "Replicate işlemi kesin olarak başarısız, pooling durduruluyor:",
          error.message
        );
        throw error; // Hemen hata fırlat, tekrar deneme
      }

      console.error(`Polling attempt ${attempt + 1} hatası:`, error.message);
      if (attempt === maxAttempts - 1) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }

  throw new Error("Replicate işlemi zaman aşımına uğradı");
}

// Face-swap işlemini retry mekanizması ile yapan fonksiyon
async function performFaceSwapWithRetry(
  faceImageUrl,
  fluxOutputUrl,
  maxRetries = 3
) {
  console.log(`🔄 Face-swap işlemi başlatılıyor (max ${maxRetries} deneme)...`);
  console.log("👤 Face image:", faceImageUrl);
  console.log("🎨 Flux output:", fluxOutputUrl);

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`🔄 Face-swap deneme ${attempt}/${maxRetries}...`);

      // Face-swap API'sine istek gönder
      const faceSwapResponse = await got.post(
        "https://api.replicate.com/v1/predictions",
        {
          headers: {
            Authorization: `Bearer ${process.env.REPLICATE_API_TOKEN}`,
            "Content-Type": "application/json",
          },
          json: {
            version:
              "cdingram/face-swap:d1d6ea8c8be89d664a07a457526f7128109dee7030fdac424788d762c71ed111",
            input: {
              swap_image: faceImageUrl, // Face fotoğrafı
              input_image: fluxOutputUrl, // Flux-kontext sonucu
            },
          },
          responseType: "json",
        }
      );

      const faceSwapInitial = faceSwapResponse.body;
      console.log(
        `Face-swap API başlangıç yanıtı (deneme ${attempt}):`,
        faceSwapInitial
      );

      if (!faceSwapInitial.id) {
        console.error(
          `Face-swap prediction ID alınamadı (deneme ${attempt}):`,
          faceSwapInitial
        );

        if (attempt === maxRetries) {
          throw new Error("Face-swap başlatılamadı - tüm denemeler tükendi");
        }

        console.log(
          `⏳ 3 saniye bekleyip tekrar deneniyor (deneme ${attempt + 1})...`
        );
        await new Promise((resolve) => setTimeout(resolve, 3000));
        continue;
      }

      // Face-swap prediction durumunu polling ile takip et
      console.log(
        `🔄 Face-swap polling başlatılıyor (deneme ${attempt}): ${faceSwapInitial.id}`
      );
      const faceSwapResult = await pollReplicateResult(faceSwapInitial.id);

      console.log(
        `Face-swap final result (deneme ${attempt}):`,
        faceSwapResult
      );

      if (faceSwapResult.status === "succeeded" && faceSwapResult.output) {
        console.log(`✅ Face-swap API işlemi başarılı (deneme ${attempt})`);
        return {
          success: true,
          result: faceSwapResult,
        };
      } else {
        console.error(
          `Face-swap API başarısız (deneme ${attempt}):`,
          faceSwapResult
        );

        if (attempt === maxRetries) {
          throw new Error(
            faceSwapResult.error ||
              "Face-swap işlemi başarısız - tüm denemeler tükendi"
          );
        }

        console.log(
          `⏳ 3 saniye bekleyip tekrar deneniyor (deneme ${attempt + 1})...`
        );
        await new Promise((resolve) => setTimeout(resolve, 3000));
        continue;
      }
    } catch (error) {
      console.error(`❌ Face-swap deneme ${attempt} hatası:`, error.message);

      // Ağ bağlantısı hatalarını kontrol et
      const isNetworkError =
        error.message.includes("Network is unreachable") ||
        error.message.includes("HTTPSConnectionPool") ||
        error.message.includes("Max retries exceeded") ||
        error.message.includes("Connection") ||
        error.message.includes("ECONNRESET") ||
        error.message.includes("ENOTFOUND") ||
        error.message.includes("ETIMEDOUT");

      if (isNetworkError && attempt < maxRetries) {
        console.log(
          `🔄 Ağ hatası tespit edildi, ${3} saniye bekleyip tekrar deneniyor (deneme ${
            attempt + 1
          })...`
        );
        await new Promise((resolve) => setTimeout(resolve, 3000));
        continue;
      }

      // Son deneme veya ağ hatası değilse hata fırlat
      if (attempt === maxRetries) {
        console.error(
          `❌ Face-swap tüm denemeler başarısız oldu: ${error.message}`
        );
        throw error;
      }

      // Diğer hatalar için de tekrar dene
      console.log(
        `⏳ 3 saniye bekleyip tekrar deneniyor (deneme ${attempt + 1})...`
      );
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
  }

  throw new Error("Face-swap işlemi başarısız - tüm denemeler tükendi");
}

// Çoklu görseli yan yana birleştiren fonksiyon (dinamik sayıda)
async function combineMultipleImages(imageUrls) {
  try {
    if (!imageUrls || imageUrls.length === 0) {
      throw new Error("En az bir görsel URL'i gereklidir");
    }

    console.log(
      `${imageUrls.length} görsel yan yana birleştiriliyor:`,
      imageUrls
    );

    // Tüm görüntüleri indir
    const buffers = await Promise.all(
      imageUrls.map((url) => got(url).buffer())
    );

    // Görüntü bilgilerini al
    const metadatas = await Promise.all(
      buffers.map((buffer) => sharp(buffer).metadata())
    );

    // Hedef boyutları hesapla - eşit yükseklik, yan yana
    const targetHeight = Math.max(...metadatas.map((m) => m.height));
    const widths = metadatas.map((m, i) =>
      Math.round(targetHeight * (m.width / m.height))
    );
    const totalWidth = widths.reduce((sum, width) => sum + width, 0);

    console.log(`Birleştirilmiş görüntü boyutu: ${totalWidth}x${targetHeight}`);
    console.log(`Görsel genişlikleri:`, widths);

    // Tüm görüntüleri yeniden boyutlandır
    const resizedBuffers = await Promise.all(
      buffers.map((buffer, i) =>
        sharp(buffer)
          .resize(widths[i], targetHeight, {
            fit: "cover",
            position: "center",
          })
          .toBuffer()
      )
    );

    // Composite işlemi için pozisyonları hesapla
    const composites = [];
    let currentLeft = 0;

    resizedBuffers.forEach((buffer, i) => {
      composites.push({
        input: buffer,
        left: currentLeft,
        top: 0,
      });
      currentLeft += widths[i];
    });

    // Görüntüleri yan yana birleştir
    const combinedBuffer = await sharp({
      create: {
        width: totalWidth,
        height: targetHeight,
        channels: 3,
        background: { r: 255, g: 255, b: 255 },
      },
    })
      .composite(composites)
      .jpeg({ quality: 90 })
      .toBuffer();

    // Birleştirilmiş görüntüyü geçici dosyaya kaydet
    const fileName = `combined_${imageUrls.length}images_${uuidv4()}.jpg`;
    const filePath = path.join(tempDir, fileName);

    await fs.promises.writeFile(filePath, combinedBuffer);

    // Supabase'e yükle
    const remotePath = `combined/${fileName}`;
    const { data, error } = await supabase.storage
      .from("reference")
      .upload(remotePath, combinedBuffer, {
        contentType: "image/jpeg",
        upsert: true,
      });

    if (error) {
      console.error("Birleştirilmiş görüntü yükleme hatası:", error);
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

    console.log(
      `${imageUrls.length} görüntü başarıyla birleştirildi:`,
      publicUrlData.publicUrl
    );
    return publicUrlData.publicUrl;
  } catch (error) {
    console.error("Çoklu görüntü birleştirme hatası:", error);
    throw error;
  }
}

// Sadece canvas üzerine model body + ürünleri yerleştiren fonksiyon (9:16 format)
async function createProductCanvas(canvasItems) {
  try {
    console.log(`${canvasItems.length} öğeyi 9:16 canvas'ta birleştiriliyor`);
    console.log("Canvas öğeleri:", canvasItems);

    // Canvas öğelerini indir
    const canvasItemBuffers = await Promise.all(
      canvasItems.map((url) => got(url).buffer())
    );

    // 9:16 Canvas boyutları (standart boyut)
    const canvasWidth = 1080;
    const canvasHeight = 1920; // 9:16 ratio

    console.log(`Canvas boyutu: ${canvasWidth}x${canvasHeight}`);

    // Ana canvas'ı oluştur (beyaz background)
    let mainImageWithLabels = await sharp({
      create: {
        width: canvasWidth,
        height: canvasHeight,
        channels: 3,
        background: { r: 255, g: 255, b: 255 }, // Beyaz background
      },
    });

    // Temiz canvas (etiket olmayan) oluştur
    let mainImageClean = await sharp({
      create: {
        width: canvasWidth,
        height: canvasHeight,
        channels: 3,
        background: { r: 255, g: 255, b: 255 }, // Beyaz background
      },
    });

    // Canvas öğelerini yerleştir
    if (canvasItemBuffers.length > 0) {
      // Grid hesaplaması - ama çok daha büyük resimler
      const padding = 30; // Az padding
      const availableWidth = canvasWidth - padding * 2;
      const availableHeight = canvasHeight - padding * 2;

      // Grid boyutlarını belirle (öğe sayısına göre)
      let cols, rows;
      if (canvasItemBuffers.length === 1) {
        cols = 1;
        rows = 1;
      } else if (canvasItemBuffers.length === 2) {
        cols = 1;
        rows = 2;
      } else if (canvasItemBuffers.length <= 4) {
        cols = 2;
        rows = 2;
      } else if (canvasItemBuffers.length <= 6) {
        cols = 2;
        rows = 3;
      } else if (canvasItemBuffers.length <= 9) {
        cols = 3;
        rows = 3;
      } else {
        cols = 3;
        rows = 4; // Max 12 öğe
      }

      // Her öğe için slot boyutu
      const slotWidth = Math.floor(availableWidth / cols);
      const slotHeight = Math.floor(availableHeight / rows);

      // Öğe boyutu (slot'un %95'i - çok büyük!)
      const itemSize = Math.min(
        Math.floor(slotWidth * 0.95),
        Math.floor(slotHeight * 0.95)
      );

      console.log(
        `Grid: ${cols}x${rows}, Slot: ${slotWidth}x${slotHeight}, BÜYÜK öğe boyutu: ${itemSize}`
      );

      // Öğeleri boyutlandır ve yerleştir
      const itemComposites = [];
      const itemCompositesWithLabels = [];

      for (
        let i = 0;
        i < Math.min(canvasItemBuffers.length, cols * rows);
        i++
      ) {
        const row = Math.floor(i / cols);
        const col = i % cols;

        // Öğeyi boyutlandır (orijinal oran korunacak, kırpma yok)
        const resizedItemBuffer = await sharp(canvasItemBuffers[i])
          .resize(itemSize, itemSize, {
            fit: "inside", // Kırpma yapma, orijinal oranı koru
            background: { r: 255, g: 255, b: 255 }, // Beyaz background boş alanlara
          })
          .toBuffer();

        // Pozisyonu hesapla (ortala)
        const x =
          padding + col * slotWidth + Math.floor((slotWidth - itemSize) / 2);
        const y =
          padding + row * slotHeight + Math.floor((slotHeight - itemSize) / 2);

        // Temiz canvas için resmi ekle (etiket yok)
        itemComposites.push({
          input: resizedItemBuffer,
          left: x,
          top: y,
        });

        // Etiketli canvas için resmi ekle
        itemCompositesWithLabels.push({
          input: resizedItemBuffer,
          left: x,
          top: y,
        });

        // Her resmin altına etiket ekle (sadece etiketli canvas için)
        let labelText = "";
        if (i === 0) {
          labelText = "MAIN CHARACTER"; // Ana karakter
        } else {
          labelText = "ITEM"; // Diğer her şey sadece "ITEM"
        }

        // Etiket için SVG oluştur
        const labelSvg = `
          <svg width="${slotWidth}" height="40">
            <rect width="100%" height="100%" fill="rgba(0,0,0,0.7)" rx="5"/>
            <text x="50%" y="50%" text-anchor="middle" dominant-baseline="middle" 
                  fill="white" font-family="Arial, sans-serif" font-size="14" font-weight="bold">
              ${labelText}
            </text>
          </svg>
        `;

        // Etiket pozisyonu (resmin altında)
        const labelX = padding + col * slotWidth;
        const labelY = y + itemSize + 5; // Resmin 5px altında

        // Etiket composite'ini ekle (sadece etiketli canvas için)
        itemCompositesWithLabels.push({
          input: Buffer.from(labelSvg),
          left: labelX,
          top: labelY,
        });

        console.log(
          `BÜYÜK Öğe ${
            i + 1
          } (${labelText}): pozisyon (${x}, ${y}), boyut: ${itemSize}x${itemSize}`
        );
      }

      // Temiz canvas oluştur (etiket yok)
      if (itemComposites.length > 0) {
        mainImageClean = mainImageClean.composite(itemComposites);
      }

      // Etiketli canvas oluştur
      if (itemCompositesWithLabels.length > 0) {
        mainImageWithLabels = mainImageWithLabels.composite(
          itemCompositesWithLabels
        );
      }
    }

    // İki canvas buffer'ı oluştur
    const cleanCanvasBuffer = await mainImageClean
      .jpeg({ quality: 90 })
      .toBuffer();
    const labeledCanvasBuffer = await mainImageWithLabels
      .jpeg({ quality: 90 })
      .toBuffer();

    // Her iki canvas'ı da Supabase'e yükle
    const cleanFileName = `canvas_clean_${
      canvasItems.length
    }items_${uuidv4()}.jpg`;
    const labeledFileName = `canvas_labeled_${
      canvasItems.length
    }items_${uuidv4()}.jpg`;

    const cleanFilePath = path.join(tempDir, cleanFileName);
    const labeledFilePath = path.join(tempDir, labeledFileName);

    await fs.promises.writeFile(cleanFilePath, cleanCanvasBuffer);
    await fs.promises.writeFile(labeledFilePath, labeledCanvasBuffer);

    // Temiz canvas'ı Supabase'e yükle
    const cleanRemotePath = `combined/${cleanFileName}`;
    const { data: cleanData, error: cleanError } = await supabase.storage
      .from("reference")
      .upload(cleanRemotePath, cleanCanvasBuffer, {
        contentType: "image/jpeg",
        upsert: true,
      });

    if (cleanError) {
      console.error("Temiz canvas yükleme hatası:", cleanError);
      throw cleanError;
    }

    // Etiketli canvas'ı Supabase'e yükle
    const labeledRemotePath = `combined/${labeledFileName}`;
    const { data: labeledData, error: labeledError } = await supabase.storage
      .from("reference")
      .upload(labeledRemotePath, labeledCanvasBuffer, {
        contentType: "image/jpeg",
        upsert: true,
      });

    if (labeledError) {
      console.error("Etiketli canvas yükleme hatası:", labeledError);
      throw labeledError;
    }

    // Public URL'leri al
    const { data: cleanPublicUrlData } = supabase.storage
      .from("reference")
      .getPublicUrl(cleanRemotePath);

    const { data: labeledPublicUrlData } = supabase.storage
      .from("reference")
      .getPublicUrl(labeledRemotePath);

    // Geçici dosyaları sil
    fs.promises
      .unlink(cleanFilePath)
      .catch((err) => console.warn("Temiz canvas dosyası silinemedi:", err));
    fs.promises
      .unlink(labeledFilePath)
      .catch((err) => console.warn("Etiketli canvas dosyası silinemedi:", err));

    console.log("Temiz canvas oluşturuldu:", cleanPublicUrlData.publicUrl);
    console.log("Etiketli canvas oluşturuldu:", labeledPublicUrlData.publicUrl);

    return {
      cleanCanvas: cleanPublicUrlData.publicUrl,
      labeledCanvas: labeledPublicUrlData.publicUrl,
    };
  } catch (error) {
    console.error("Canvas oluşturma hatası:", error);
    throw error;
  }
}

// Ana generate endpoint'i
router.post("/generate", async (req, res) => {
  // Kredi kontrolü ve düşme (V2'den eklendi)
  const CREDIT_COST = 20; // Her oluşturma 20 kredi
  let creditDeducted = false;
  let userId; // Scope için önceden tanımla

  try {
    const {
      ratio,
      promptText,
      referenceImages,
      settings,
      userId: requestUserId,
    } = req.body;

    // userId'yi scope için ata
    userId = requestUserId;

    if (
      !referenceImages ||
      !Array.isArray(referenceImages) ||
      referenceImages.length < 2
    ) {
      return res.status(400).json({
        success: false,
        result: {
          message: "En az 2 referenceImage (model + product) sağlanmalıdır.",
        },
      });
    }

    // Kredi kontrolü (V2'den eklendi)
    if (userId && userId !== "anonymous_user") {
      try {
        console.log(`💳 Kullanıcı ${userId} için kredi kontrolü yapılıyor...`);

        const { data: updatedUsers, error: deductError } = await supabase
          .from("users")
          .select("credit_balance")
          .eq("id", userId)
          .single();

        if (deductError) {
          console.error("❌ Kredi sorgulama hatası:", deductError);
          return res.status(500).json({
            success: false,
            result: {
              message: "Kredi sorgulama sırasında hata oluştu",
              error: deductError.message,
            },
          });
        }

        const currentCreditCheck = updatedUsers?.credit_balance || 0;
        if (currentCreditCheck < CREDIT_COST) {
          return res.status(402).json({
            success: false,
            result: {
              message: "Yetersiz kredi. Lütfen kredi satın alın.",
              currentCredit: currentCreditCheck,
              requiredCredit: CREDIT_COST,
            },
          });
        }

        // Krediyi düş
        const { error: updateError } = await supabase
          .from("users")
          .update({ credit_balance: currentCreditCheck - CREDIT_COST })
          .eq("id", userId)
          .eq("credit_balance", currentCreditCheck); // Optimistic locking

        if (updateError) {
          console.error("❌ Kredi düşme hatası:", updateError);
          return res.status(500).json({
            success: false,
            result: {
              message:
                "Kredi düşme sırasında hata oluştu (başka bir işlem krediyi değiştirdi)",
              error: updateError.message,
            },
          });
        }

        creditDeducted = true;
        console.log(
          `✅ ${CREDIT_COST} kredi başarıyla düşüldü. Yeni bakiye: ${
            currentCreditCheck - CREDIT_COST
          }`
        );
      } catch (creditManagementError) {
        console.error("❌ Kredi yönetimi hatası:", creditManagementError);
        return res.status(500).json({
          success: false,
          result: {
            message: "Kredi yönetimi sırasında hata oluştu",
            error: creditManagementError.message,
          },
        });
      }
    }

    // Maksimum 5 görsel kontrolü (model face + model body + 3 ürün)
    if (referenceImages.length > 5) {
      return res.status(400).json({
        success: false,
        result: {
          message:
            "En fazla 5 görsel seçebilirsiniz (model fotoğrafları + maksimum 3 ürün görseli).",
        },
      });
    }

    console.log("🎛️ [BACKEND] Gelen settings parametresi:", settings);
    console.log("📝 [BACKEND] Gelen promptText:", promptText);
    console.log("🖼️ [BACKEND] Gelen referenceImages:", referenceImages);

    // Index-based sistem: [model_face, model_body, ...products]
    // İlk görsel: model face (sol tarafta gösterilecek)
    // İkinci görsel: model body (canvas'ta gösterilecek)
    const faceImageUrl = referenceImages[0];
    const modelBodyImageUrl = referenceImages[1];

    // Geri kalan tüm görseller: products
    const productImageUrls = referenceImages.slice(2);

    // En az model face + body olmalı
    if (referenceImages.length < 2) {
      return res.status(400).json({
        success: false,
        result: {
          message: "En az model face ve body fotoğrafı gereklidir.",
        },
      });
    }

    console.log("😊 Face görseli (canvas'ta):", faceImageUrl);
    console.log("👤 Model body görseli (face-swap için):", modelBodyImageUrl);
    console.log("👕 Ürün görselleri:", productImageUrls);

    // Canvas sistemi: Face + products hepsi 9:16 canvas'ta grid şeklinde
    // Model body fotoğrafı sadece face-swap için kullanılıyor
    const canvasResult = await createProductCanvas(
      [faceImageUrl, ...productImageUrls] // Face + products birlikte canvas'ta
    );

    const labeledCanvasUrl = canvasResult.labeledCanvas; // Gemini için etiketli
    const cleanCanvasUrl = canvasResult.cleanCanvas; // Replicate için temiz

    console.log("Etiketli canvas URL'si (Gemini için):", labeledCanvasUrl);
    console.log("Temiz canvas URL'si (Replicate için):", cleanCanvasUrl);

    // Aspect ratio'yu formatla
    const formattedRatio = formatAspectRatio(ratio || "9:16");
    console.log(
      `İstenen ratio: ${ratio}, formatlanmış ratio: ${formattedRatio}`
    );

    // Kullanıcının prompt'unu Gemini ile iyileştir (etiketli canvas kullan)
    const enhancedPrompt = await enhancePromptWithGemini(
      promptText || "", // Empty string fallback
      labeledCanvasUrl, // Etiketli canvas Gemini'ye gönderiliyor
      settings || {}
    );

    console.log("📝 [BACKEND MAIN] Original prompt:", promptText);
    console.log("✨ [BACKEND MAIN] Enhanced prompt:", enhancedPrompt);

    // Replicate API'ye istek gönder - Temiz canvas kullan
    const replicateResponse = await got.post(
      "https://api.replicate.com/v1/models/black-forest-labs/flux-kontext-max/predictions",
      {
        headers: {
          Authorization: `Bearer ${process.env.REPLICATE_API_TOKEN}`,
          "Content-Type": "application/json",
        },
        json: {
          input: {
            prompt: enhancedPrompt,
            input_image: cleanCanvasUrl, // Temiz canvas Replicate'e gönderiliyor
            aspect_ratio: formattedRatio,
          },
        },
        responseType: "json",
      }
    );

    const initialResult = replicateResponse.body;
    console.log("Replicate API başlangıç yanıtı:", initialResult);

    if (!initialResult.id) {
      console.error("Replicate prediction ID alınamadı:", initialResult);

      // Kredi iade et (V2'den eklendi)
      if (creditDeducted && userId && userId !== "anonymous_user") {
        try {
          const { data: currentUserCredit } = await supabase
            .from("users")
            .select("credit_balance")
            .eq("id", userId)
            .single();

          await supabase
            .from("users")
            .update({
              credit_balance:
                (currentUserCredit?.credit_balance || 0) + CREDIT_COST,
            })
            .eq("id", userId);

          console.log(
            `💰 ${CREDIT_COST} kredi iade edildi (Prediction ID hatası)`
          );
        } catch (refundError) {
          console.error("❌ Kredi iade hatası:", refundError);
        }
      }

      return res.status(500).json({
        success: false,
        result: {
          message: "Replicate prediction başlatılamadı",
          error: initialResult.error || "Prediction ID missing",
        },
      });
    }

    // Prediction durumunu polling ile takip et
    const finalResult = await pollReplicateResult(initialResult.id);

    console.log("Replicate final result:", finalResult);

    if (finalResult.status === "succeeded" && finalResult.output) {
      console.log("Replicate API işlemi başarılı");

      // Face-swap işlemi için model body fotoğrafını al
      const faceImageForSwap = modelBodyImageUrl; // Model body fotoğrafını face-swap için kullan
      const fluxOutputUrl = finalResult.output;

      console.log("🔄 Face-swap işlemi başlatılıyor...");
      console.log("👤 Face image:", faceImageForSwap);
      console.log("🎨 Flux output:", fluxOutputUrl);

      try {
        // Face-swap işlemi için retry mekanizması kullan
        const faceSwapResult = await performFaceSwapWithRetry(
          faceImageForSwap,
          fluxOutputUrl
        );

        if (faceSwapResult.success) {
          console.log("✅ Face-swap API işlemi başarılı");

          // 💳 API başarılı olduktan sonra güncel kredi bilgisini al (V2'den eklendi)
          let currentCredit = null;
          if (userId && userId !== "anonymous_user") {
            try {
              const { data: updatedUser } = await supabase
                .from("users")
                .select("credit_balance")
                .eq("id", userId)
                .single();

              currentCredit = updatedUser?.credit_balance || 0;
              console.log(`💳 Güncel kredi balance: ${currentCredit}`);
            } catch (creditError) {
              console.error("❌ Güncel kredi sorgu hatası:", creditError);
            }
          }

          // Face-swap sonucunu client'e gönder
          const responseData = {
            success: true,
            result: {
              imageUrl: faceSwapResult.result.output, // Face-swap sonucu
              originalPrompt: promptText,
              enhancedPrompt: enhancedPrompt,
              replicateData: finalResult,
              faceSwapData: faceSwapResult.result,
              originalFluxOutput: fluxOutputUrl, // Orijinal flux sonucunu da sakla
              currentCredit: currentCredit, // 💳 Güncel kredi bilgisini response'a ekle
            },
          };

          await saveGenerationToDatabase(
            userId,
            responseData,
            promptText,
            referenceImages
          );

          return res.status(200).json(responseData);
        } else {
          console.error("Face-swap API başarısız:", faceSwapResult.result);

          // 💳 API başarılı olduktan sonra güncel kredi bilgisini al (V2'den eklendi)
          let currentCredit = null;
          if (userId && userId !== "anonymous_user") {
            try {
              const { data: updatedUser } = await supabase
                .from("users")
                .select("credit_balance")
                .eq("id", userId)
                .single();

              currentCredit = updatedUser?.credit_balance || 0;
              console.log(`💳 Güncel kredi balance: ${currentCredit}`);
            } catch (creditError) {
              console.error("❌ Güncel kredi sorgu hatası:", creditError);
            }
          }

          // Face-swap başarısız olursa orijinal flux sonucunu döndür
          const errorMessage =
            faceSwapResult.result.error ||
            "Face-swap işlemi başarısız, orijinal sonuç döndürülüyor";
          const responseData = {
            success: true,
            result: {
              imageUrl: fluxOutputUrl,
              originalPrompt: promptText,
              enhancedPrompt: enhancedPrompt,
              replicateData: finalResult,
              faceSwapError: errorMessage,
              currentCredit: currentCredit, // 💳 Güncel kredi bilgisini response'a ekle
            },
          };

          await saveGenerationToDatabase(
            userId,
            responseData,
            promptText,
            referenceImages
          );

          return res.status(200).json(responseData);
        }
      } catch (faceSwapError) {
        console.error("Face-swap API hatası:", faceSwapError);

        // Ağ bağlantısı hatalarını kontrol et
        const isNetworkError =
          faceSwapError.message.includes("Network is unreachable") ||
          faceSwapError.message.includes("HTTPSConnectionPool") ||
          faceSwapError.message.includes("Max retries exceeded") ||
          faceSwapError.message.includes("Connection") ||
          faceSwapError.message.includes("ECONNRESET") ||
          faceSwapError.message.includes("ENOTFOUND") ||
          faceSwapError.message.includes("ETIMEDOUT");

        let errorMessage = `Face-swap hatası: ${faceSwapError.message}`;

        if (isNetworkError) {
          errorMessage =
            "Face-swap işlemi ağ bağlantısı sorunu nedeniyle 3 kez denendi ancak başarısız oldu. Orijinal sonuç döndürülüyor.";
        } else if (faceSwapError.message.includes("tüm denemeler tükendi")) {
          errorMessage =
            "Face-swap işlemi 3 kez denendi ancak başarısız oldu. Orijinal sonuç döndürülüyor.";
        }

        // 💳 API başarılı olduktan sonra güncel kredi bilgisini al (V2'den eklendi)
        let currentCredit = null;
        if (userId && userId !== "anonymous_user") {
          try {
            const { data: updatedUser } = await supabase
              .from("users")
              .select("credit_balance")
              .eq("id", userId)
              .single();

            currentCredit = updatedUser?.credit_balance || 0;
            console.log(`💳 Güncel kredi balance: ${currentCredit}`);
          } catch (creditError) {
            console.error("❌ Güncel kredi sorgu hatası:", creditError);
          }
        }

        // Face-swap hatası olursa orijinal flux sonucunu döndür
        const responseData = {
          success: true,
          result: {
            imageUrl: fluxOutputUrl,
            originalPrompt: promptText,
            enhancedPrompt: enhancedPrompt,
            replicateData: finalResult,
            faceSwapError: errorMessage,
            currentCredit: currentCredit, // 💳 Güncel kredi bilgisini response'a ekle
          },
        };

        await saveGenerationToDatabase(
          userId,
          responseData,
          promptText,
          referenceImages
        );

        return res.status(200).json(responseData);
      }
    } else {
      console.error("Replicate API başarısız:", finalResult);

      // Kredi iade et (V2'den eklendi)
      if (creditDeducted && userId && userId !== "anonymous_user") {
        try {
          const { data: currentUserCredit } = await supabase
            .from("users")
            .select("credit_balance")
            .eq("id", userId)
            .single();

          await supabase
            .from("users")
            .update({
              credit_balance:
                (currentUserCredit?.credit_balance || 0) + CREDIT_COST,
            })
            .eq("id", userId);

          console.log(`💰 ${CREDIT_COST} kredi iade edildi (Replicate hatası)`);
        } catch (refundError) {
          console.error("❌ Kredi iade hatası:", refundError);
        }
      }

      return res.status(500).json({
        success: false,
        result: {
          message: "Replicate API işlemi başarısız oldu",
          error: finalResult.error || "Bilinmeyen hata",
          status: finalResult.status,
        },
      });
    }
  } catch (error) {
    console.error("Resim oluşturma hatası:", error);

    // Kredi iade et (V2'den eklendi)
    if (creditDeducted && userId && userId !== "anonymous_user") {
      try {
        const { data: currentUserCredit } = await supabase
          .from("users")
          .select("credit_balance")
          .eq("id", userId)
          .single();

        await supabase
          .from("users")
          .update({
            credit_balance:
              (currentUserCredit?.credit_balance || 0) + CREDIT_COST,
          })
          .eq("id", userId);

        console.log(`💰 ${CREDIT_COST} kredi iade edildi (Genel hata)`);
      } catch (refundError) {
        console.error("❌ Kredi iade hatası:", refundError);
      }
    }

    // Sensitive content hatasını özel olarak handle et (V2'den eklendi)
    if (
      error.type === "sensitive_content" ||
      (error.message && error.message.startsWith("SENSITIVE_CONTENT:")) ||
      (error.message && error.message.includes("flagged as inappropriate")) ||
      (error.message && error.message.includes("flagged as sensitive")) ||
      (error.message && error.message.includes("E005")) ||
      (error.message && error.message.includes("Content Moderation Error"))
    ) {
      console.log(
        "🚨 Backend: Sensitive content hatası frontend'e gönderiliyor"
      );
      const cleanMessage = error.message
        .replace("SENSITIVE_CONTENT: ", "")
        .replace("Content Moderation Error: ", "");

      // Status 200 ile gönder ama success: false yap ki frontend yakalayabilsin
      return res.status(200).json({
        success: false,
        result: {
          message: cleanMessage,
          error_type: "sensitive_content",
          user_friendly: true,
        },
      });
    }

    return res.status(500).json({
      success: false,
      result: {
        message: "Resim oluşturma sırasında bir hata oluştu",
        error: error.message,
      },
    });
  }
});

// Kullanıcının mevcut kredisini getiren endpoint (V2'den eklendi)
router.get("/credit/:userId", async (req, res) => {
  try {
    const { userId } = req.params;

    if (!userId || userId === "anonymous_user") {
      return res.status(200).json({
        success: true,
        result: {
          credit: 0, // Anonymous kullanıcılar için sınırsız (veya 0 göster)
          isAnonymous: true,
        },
      });
    }

    const { data: userCredit, error } = await supabase
      .from("users")
      .select("credit_balance")
      .eq("id", userId)
      .single();

    if (error) {
      console.error("❌ Kredi sorgulama hatası:", error);
      return res.status(500).json({
        success: false,
        result: {
          message: "Kredi sorgulama sırasında hata oluştu",
          error: error.message,
        },
      });
    }

    return res.status(200).json({
      success: true,
      result: {
        credit: userCredit?.credit_balance || 0,
        isAnonymous: false,
      },
    });
  } catch (error) {
    console.error("❌ Kredi endpoint hatası:", error);
    return res.status(500).json({
      success: false,
      result: {
        message: "Kredi bilgisi alınırken hata oluştu",
        error: error.message,
      },
    });
  }
});

module.exports = router;
