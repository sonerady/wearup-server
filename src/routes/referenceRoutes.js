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
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

    // Settings'in var olup olmadığını kontrol et
    const hasValidSettings =
      settings &&
      Object.entries(settings).some(
        ([key, value]) => value !== null && value !== undefined && value !== ""
      );

    console.log("🎛️ [BACKEND GEMINI] Settings kontrolü:", hasValidSettings);

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

    // Gemini'ye gönderilecek metin
    let promptForGemini = `
    The following is an original prompt from a user: "${originalPrompt}"
    
    ${settingsPromptSection}
    
    This is for a virtual try-on application. The combined image shows two parts:
    - LEFT: Full body model photo showing pose and body structure
    - RIGHT: Clothing/product that should be virtually tried on
    
    NOTE: The face will be added later through a separate face-swap process, so focus on body and clothing details.
    
    CRITICAL VIRTUAL TRY-ON REQUIREMENTS:
    1. Use the BODY/POSE from the LEFT side of the image  
    2. Show the PRODUCTS from the RIGHT side being worn by the model body
    3. Describe the clothing items from the product image in EXTREME DETAIL:
       - Exact colors, patterns, textures, fabrics
       - Specific design elements, cuts, silhouettes
       - Any unique features, embellishments, or details
       - How the garment fits and drapes on the body
       - Material appearance (matte, shiny, textured, smooth)
    4. IMPORTANT: Describe the person's BODY TYPE and PHYSICAL CHARACTERISTICS:
       - Height (tall, medium, short)
       - Body build (slim, athletic, curvy, plus-size, etc.)
       - Body proportions and shape
       - Overall physique and body structure
       - How the clothing should fit this specific body type
    5. Create a seamless virtual try-on where the model from the left is wearing the products from the right
    
    CRITICAL CONTENT MODERATION GUIDELINES - AVOID THESE:
    1. DO NOT mention age descriptors (young, old, teen, etc.)
    2. DO NOT use detailed body part descriptions (chest, bust, hips, waist details)
    3. DO NOT use intimate/underwear terminology (bra, panties, lingerie, etc.)
    4. DO NOT use suggestive clothing descriptions (tight, snug, revealing, etc.)
    5. DO NOT mention brand names or copyrighted content
    6. DO NOT use terms that could be sexually suggestive
    7. AVOID detailed physical attraction descriptions
    8. Use neutral, professional fashion terminology only
    9. Focus on clothing style, not body curves or intimate fits
    10. Keep descriptions professional and suitable for all audiences
    
    SAFE ALTERNATIVE TERMS:
    - Instead of "young woman" → "person" or "model"
    - Instead of "sports bra" → "athletic top" or "fitted top"
    - Instead of "tight/snug" → "well-fitted" or "tailored"
    - Instead of "accentuating curves" → "flattering silhouette"
    - Instead of body parts → "overall appearance" or "silhouette"
    - Instead of "toned" → "fit" or "healthy"
    
    Create a detailed fashion description prompt that describes:
    1. The person with the face from the LEFT image and body pose from the MIDDLE image
    2. DETAILED BODY TYPE DESCRIPTION: Analyze and describe the person's height, build, proportions, and physique (using safe terminology)
    3. This person wearing the clothing items from the RIGHT side of the image
    4. Include specific details about the clothing items, colors, styles, and textures
    5. Include details about the setting, pose, and overall aesthetic
    6. VERY IMPORTANT: Describe the products from the right side in extensive detail as if they are being worn by the combined person (face + body)
    7. CRITICAL: Include how the clothing fits and looks on this specific body type and height (using professional language)
    
    STRICT LANGUAGE REQUIREMENTS: 
    - The final prompt must be 100% ENGLISH ONLY - ZERO foreign words allowed
    - ALL non-English words must be translated to English
    - Make locations sound natural, not like filenames
    - Use ONLY professional, family-friendly fashion terminology
    - AVOID any content that could trigger content moderation systems
    
    CRITICAL REQUIREMENTS:
    1. The output prompt must be PURE ENGLISH - no foreign language words whatsoever
    2. Combine the face from LEFT + body from MIDDLE + products from RIGHT
    3. Describe the model wearing the clothing items from the product image with EXTREME DETAIL
    4. Include ALL types of clothing and accessories visible in the product image
    5. Make it sound like a professional fashion photography description
    6. Convert locations from filename format to natural descriptive text
    7. ABSOLUTELY NO foreign language words - translate everything to English
    8. Focus heavily on product details: fabric texture, color nuances, design elements, fit characteristics
    9. Describe how the clothing items from the right side look when worn by the person (face from left + body from middle)
    10. Create a seamless combination of the three elements: face + body + clothing
    11. MANDATORY: Always include detailed body type analysis (height, build, proportions) in the description
    12. Describe how the specific garments complement and fit the person's body type and height
    13. CRITICAL: Use only content-moderation-safe language and terminology
    14. AVOID any terms that could be flagged as sensitive or inappropriate
    15. Focus on professional fashion description, not physical attractiveness
    
    Your output should ONLY be the virtual try-on prompt in PURE ENGLISH that describes the complete fashion look with extensive product details, body type analysis, and physical characteristics using SAFE, PROFESSIONAL terminology${
      hasValidSettings
        ? " and incorporates relevant user settings (converted to natural English descriptions)"
        : ""
    }.
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
      console.error(`Polling attempt ${attempt + 1} hatası:`, error.message);
      if (attempt === maxAttempts - 1) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }

  throw new Error("Replicate işlemi zaman aşımına uğradı");
}

// Ana generate endpoint'i
router.post("/generate", async (req, res) => {
  try {
    const { ratio, promptText, referenceImages, settings, userId } = req.body;

    if (
      !promptText ||
      !referenceImages ||
      !Array.isArray(referenceImages) ||
      referenceImages.length < 3
    ) {
      return res.status(400).json({
        success: false,
        result: {
          message:
            "Geçerli bir promptText ve en az 3 referenceImage (face + model + product) sağlanmalıdır.",
        },
      });
    }

    console.log("🎛️ [BACKEND] Gelen settings parametresi:", settings);
    console.log("📝 [BACKEND] Gelen promptText:", promptText);

    // İlk üç görseli al (face + model + product)
    const faceImage = referenceImages.find((img) => img.tag === "image_1");
    const modelImage = referenceImages.find((img) => img.tag === "image_2");
    const productImage = referenceImages.find((img) => img.tag === "image_3");

    if (!faceImage || !modelImage || !productImage) {
      return res.status(400).json({
        success: false,
        result: {
          message:
            "Face görseli (image_1), model görseli (image_2) ve ürün görseli (image_3) gereklidir.",
        },
      });
    }

    console.log("Face görseli:", faceImage.uri);
    console.log("Model görseli:", modelImage.uri);
    console.log("Ürün görseli:", productImage.uri);

    // 3 görseli birleştir (Gemini analizi için)
    const combinedImageUrlForGemini = await combineImagesHorizontally(
      faceImage.uri,
      modelImage.uri,
      productImage.uri
    );

    // Sadece model + product birleştir (Flux API için)
    const combinedImageUrlForFlux = await combineModelAndProduct(
      modelImage.uri,
      productImage.uri
    );

    console.log(
      "Gemini için birleştirilmiş görsel URL'si:",
      combinedImageUrlForGemini
    );
    console.log(
      "Flux için birleştirilmiş görsel URL'si:",
      combinedImageUrlForFlux
    );

    // Aspect ratio'yu formatla
    const formattedRatio = formatAspectRatio(ratio || "9:16");
    console.log(
      `İstenen ratio: ${ratio}, formatlanmış ratio: ${formattedRatio}`
    );

    // Kullanıcının prompt'unu Gemini ile iyileştir (3 görsel birleşimini kullan)
    const enhancedPrompt = await enhancePromptWithGemini(
      promptText,
      combinedImageUrlForGemini,
      settings || {}
    );

    console.log("📝 [BACKEND MAIN] Original prompt:", promptText);
    console.log("✨ [BACKEND MAIN] Enhanced prompt:", enhancedPrompt);

    // Replicate API'ye istek gönder - sadece model + product görseli kullan
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
            input_image: combinedImageUrlForFlux, // Face olmadan sadece model + product
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

      // Face-swap işlemi için face fotoğrafını al
      const faceImageUrl = faceImage.uri;
      const fluxOutputUrl = finalResult.output;

      console.log("🔄 Face-swap işlemi başlatılıyor...");
      console.log("👤 Face image:", faceImageUrl);
      console.log("🎨 Flux output:", fluxOutputUrl);

      try {
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
        console.log("Face-swap API başlangıç yanıtı:", faceSwapInitial);

        if (!faceSwapInitial.id) {
          console.error("Face-swap prediction ID alınamadı:", faceSwapInitial);
          // Face-swap başarısız olursa orijinal flux sonucunu döndür
          const responseData = {
            success: true,
            result: {
              imageUrl: fluxOutputUrl,
              originalPrompt: promptText,
              enhancedPrompt: enhancedPrompt,
              replicateData: finalResult,
              faceSwapError:
                "Face-swap başlatılamadı, orijinal sonuç döndürülüyor",
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

        // Face-swap prediction durumunu polling ile takip et
        console.log(`🔄 Face-swap polling başlatılıyor: ${faceSwapInitial.id}`);
        const faceSwapResult = await pollReplicateResult(faceSwapInitial.id);

        console.log("Face-swap final result:", faceSwapResult);

        if (faceSwapResult.status === "succeeded" && faceSwapResult.output) {
          console.log("✅ Face-swap API işlemi başarılı");

          // Face-swap sonucunu client'e gönder
          const responseData = {
            success: true,
            result: {
              imageUrl: faceSwapResult.output, // Face-swap sonucu
              originalPrompt: promptText,
              enhancedPrompt: enhancedPrompt,
              replicateData: finalResult,
              faceSwapData: faceSwapResult,
              originalFluxOutput: fluxOutputUrl, // Orijinal flux sonucunu da sakla
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
          console.error("Face-swap API başarısız:", faceSwapResult);
          // Face-swap başarısız olursa orijinal flux sonucunu döndür
          const responseData = {
            success: true,
            result: {
              imageUrl: fluxOutputUrl,
              originalPrompt: promptText,
              enhancedPrompt: enhancedPrompt,
              replicateData: finalResult,
              faceSwapError:
                faceSwapResult.error ||
                "Face-swap işlemi başarısız, orijinal sonuç döndürülüyor",
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
        // Face-swap hatası olursa orijinal flux sonucunu döndür
      const responseData = {
        success: true,
        result: {
            imageUrl: fluxOutputUrl,
          originalPrompt: promptText,
          enhancedPrompt: enhancedPrompt,
            replicateData: finalResult,
            faceSwapError: `Face-swap hatası: ${faceSwapError.message}, orijinal sonuç döndürülüyor`,
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
    return res.status(500).json({
      success: false,
      result: {
        message: "Resim oluşturma sırasında bir hata oluştu",
        error: error.message,
      },
    });
  }
});

module.exports = router;
