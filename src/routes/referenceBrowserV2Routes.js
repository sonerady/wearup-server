const express = require("express");
const router = express.Router();
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { createClient } = require("@supabase/supabase-js");
const axios = require("axios");
const sharp = require("sharp");
const fs = require("fs");
const path = require("path");
const { v4: uuidv4 } = require("uuid");
const { createCanvas, loadImage } = require("canvas");

// Supabase istemci oluştur
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey =
  process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;

console.log(
  "🔑 Supabase Key Type:",
  process.env.SUPABASE_SERVICE_KEY ? "SERVICE_KEY" : "ANON_KEY"
);
console.log("🔑 Key starts with:", supabaseKey?.substring(0, 20) + "...");

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

// Görüntülerin geçici olarak saklanacağı klasörü oluştur
const tempDir = path.join(__dirname, "../../temp");
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true });
}

// Referans resmini Supabase'e yükleyip URL alan fonksiyon
async function uploadReferenceImageToSupabase(imageUri, userId) {
  try {
    console.log("Referans resmi Supabase'e yükleniyor:", imageUri);

    let imageBuffer;

    // HTTP URL ise indir, değilse base64 olarak kabul et
    if (imageUri.startsWith("http://") || imageUri.startsWith("https://")) {
      // HTTP URL - normal indirme
      const imageResponse = await axios.get(imageUri, {
        responseType: "arraybuffer",
      });
      imageBuffer = Buffer.from(imageResponse.data);
    } else if (imageUri.startsWith("data:image/")) {
      // Base64 data URL
      const base64Data = imageUri.split(",")[1];
      imageBuffer = Buffer.from(base64Data, "base64");
    } else {
      // file:// protokolü - Bu durumda frontend'den base64 data gönderilmeli
      throw new Error(
        "Yerel dosya path'i desteklenmemektedir. Lütfen resmin base64 data'sını gönderin."
      );
    }

    // Dosya adı oluştur
    const timestamp = Date.now();
    const randomId = uuidv4().substring(0, 8);
    const fileName = `reference_${
      userId || "anonymous"
    }_${timestamp}_${randomId}.jpg`;

    console.log("Supabase'e yüklenecek dosya adı:", fileName);

    // Supabase'e yükle
    const { data, error } = await supabase.storage
      .from("reference")
      .upload(fileName, imageBuffer, {
        contentType: "image/jpeg",
        cacheControl: "3600",
        upsert: false,
      });

    if (error) {
      console.error("Supabase yükleme hatası:", error);
      throw new Error(`Supabase upload error: ${error.message}`);
    }

    console.log("Supabase yükleme başarılı:", data);

    // Public URL al
    const { data: urlData } = supabase.storage
      .from("reference")
      .getPublicUrl(fileName);

    console.log("Supabase public URL:", urlData.publicUrl);

    return urlData.publicUrl;
  } catch (error) {
    console.error("Referans resmi Supabase'e yüklenirken hata:", error);
    throw error;
  }
}

// Görsel oluşturma sonuçlarını veritabanına kaydetme fonksiyonu
async function saveGenerationToDatabase(
  userId,
  data,
  originalPrompt,
  referenceImages,
  settings = {},
  locationImage = null,
  poseImage = null,
  hairStyleImage = null,
  aspectRatio = "9:16",
  replicatePredictionId = null,
  processingTimeSeconds = null,
  isMultipleImages = false,
  isMultipleProducts = false
) {
  try {
    // User ID yoksa veya UUID formatında değilse, UUID oluştur
    let userIdentifier = userId;

    if (!userIdentifier || userIdentifier === "anonymous_user") {
      userIdentifier = uuidv4(); // UUID formatında anonymous user oluştur
      console.log("Yeni anonymous UUID oluşturuldu:", userIdentifier);
    } else if (
      !userIdentifier.match(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      )
    ) {
      // Eğer gelen ID UUID formatında değilse, UUID'ye çevir veya yeni UUID oluştur
      console.log(
        "User ID UUID formatında değil, yeni UUID oluşturuluyor:",
        userIdentifier
      );
      userIdentifier = uuidv4();
    }

    const { data: insertData, error } = await supabase
      .from("reference_results")
      .insert([
        {
          user_id: userIdentifier,
          original_prompt: originalPrompt,
          enhanced_prompt: data.result.enhancedPrompt,
          result_image_url: data.result.imageUrl,
          reference_images: referenceImages,
          settings: settings,
          location_image: locationImage,
          pose_image: poseImage,
          hair_style_image: hairStyleImage,
          aspect_ratio: aspectRatio,
          replicate_prediction_id: replicatePredictionId,
          processing_time_seconds: processingTimeSeconds,
          is_multiple_images: isMultipleImages,
          is_multiple_products: isMultipleProducts,
          created_at: new Date().toISOString(),
        },
      ]);

    if (error) {
      console.error("Veritabanına kaydetme hatası:", error);
      return false;
    }

    console.log("Görsel başarıyla reference_results tablosuna kaydedildi");
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
  imageUrl,
  settings = {},
  locationImage,
  poseImage,
  hairStyleImage,
  isMultipleProducts = false
) {
  try {
    console.log("Gemini ile prompt iyileştirme başlatılıyor (tek resim için)");
    console.log("🏞️ [GEMINI] Location image parametresi:", locationImage);
    console.log("🤸 [GEMINI] Pose image parametresi:", poseImage);
    console.log("💇 [GEMINI] Hair style image parametresi:", hairStyleImage);
    console.log("🛍️ [GEMINI] Multiple products mode:", isMultipleProducts);

    // V1 formatını algılama - URL'de "combined_3images" varsa V1 formatı
    const isV1Format = imageUrl && imageUrl.includes("combined_3images");
    console.log("🔍 [GEMINI] V1 formatı tespit edildi:", isV1Format);

    // Gemini modeli
    const model = genAI.getGenerativeModel({
      model: "gemini-1.5-flash",
    });

    // Settings'in var olup olmadığını kontrol et
    const hasValidSettings =
      settings &&
      Object.entries(settings).some(
        ([key, value]) => value !== null && value !== undefined && value !== ""
      );

    console.log("🎛️ [BACKEND GEMINI] Settings kontrolü:", hasValidSettings);

    // Cinsiyet belirleme - varsayılan olarak kadın
    const gender = settings?.gender || "female";
    const age = settings?.age || "";

    // Gender mapping'ini düzelt - hem man/woman hem de male/female değerlerini handle et
    let modelGenderText;
    const genderLower = gender.toLowerCase();

    if (genderLower === "male" || genderLower === "man") {
      modelGenderText = "male model";
    } else if (genderLower === "female" || genderLower === "woman") {
      modelGenderText = "female model";
    } else {
      modelGenderText = "female model"; // varsayılan
    }

    // Yaş aralığına göre model türünü belirle
    if (age) {
      const ageLower = age.toLowerCase();
      if (ageLower.includes("baby") || ageLower.includes("bebek")) {
        modelGenderText =
          genderLower === "male" || genderLower === "man"
            ? "baby male model"
            : "baby female model";
      } else if (
        ageLower.includes("child") ||
        ageLower.includes("çocuk") ||
        ageLower.includes("kid")
      ) {
        modelGenderText =
          genderLower === "male" || genderLower === "man"
            ? "young male model"
            : "young female model"; // AI content policy için "child" yerine "young" kullan
      } else if (
        ageLower.includes("young") ||
        ageLower.includes("genç") ||
        ageLower.includes("teen")
      ) {
        modelGenderText =
          genderLower === "male" || genderLower === "man"
            ? "teenage male model"
            : "teenage female model";
      } else if (ageLower.includes("adult") || ageLower.includes("yetişkin")) {
        modelGenderText =
          genderLower === "male" || genderLower === "man"
            ? "adult male model"
            : "adult female model";
      } else if (ageLower.includes("years old") || /\d+/.test(age)) {
        // Özel girilen yaş (örn: "25 years old" veya sayı içeren)
        const ageNumber = parseInt(age.match(/\d+/)?.[0]);
        let ageCategory = "adult";

        if (ageNumber && ageNumber < 3) {
          ageCategory = "baby";
        } else if (ageNumber && ageNumber < 13) {
          ageCategory = "young";
        } else if (ageNumber && ageNumber < 18) {
          ageCategory = "teenage";
        } else if (ageNumber && ageNumber >= 18) {
          ageCategory = "adult";
        }

        modelGenderText =
          genderLower === "male" || genderLower === "man"
            ? `${ageCategory} male model`
            : `${ageCategory} female model`;
      }
    }

    console.log("👤 [GEMINI] Gelen gender ayarı:", gender);
    console.log("👶 [GEMINI] Gelen age ayarı:", age);
    console.log("👤 [GEMINI] Final model türü:", modelGenderText);

    let settingsPromptSection = "";

    if (hasValidSettings) {
      console.log(
        "🎛️ [BACKEND GEMINI] Gelen settings detaylı:",
        JSON.stringify(settings, null, 2)
      );

      // Spesifik ayarları kontrol et
      const hasLocation =
        settings && settings.location && settings.location.trim() !== "";
      const hasWeather =
        settings &&
        (settings.season || settings.weather) &&
        (settings.season || settings.weather).trim() !== "";
      const hasProductColor =
        settings &&
        settings.productColor &&
        settings.productColor !== "original" &&
        settings.productColor.trim() !== "";
      const hasAge = settings && settings.age && settings.age.trim() !== "";
      const hasGender =
        settings && settings.gender && settings.gender.trim() !== "";
      const hasMood = settings && settings.mood && settings.mood.trim() !== "";
      const hasPerspective =
        settings && settings.perspective && settings.perspective.trim() !== "";
      const hasAccessories =
        settings && settings.accessories && settings.accessories.trim() !== "";
      const hasSkinTone =
        settings && settings.skinTone && settings.skinTone.trim() !== "";
      const hasHairStyle =
        settings && settings.hairStyle && settings.hairStyle.trim() !== "";
      const hasHairColor =
        settings && settings.hairColor && settings.hairColor.trim() !== "";
      const hasBodyShape =
        settings && settings.bodyShape && settings.bodyShape.trim() !== "";
      const hasPose = settings && settings.pose && settings.pose.trim() !== "";
      const hasEthnicity =
        settings && settings.ethnicity && settings.ethnicity.trim() !== "";
      const hasDetails =
        settings && settings.details && settings.details.trim() !== "";

      console.log("🎛️ [BACKEND GEMINI] Settings kontrolü:");
      console.log(
        "   - hasLocation:",
        hasLocation,
        "value:",
        settings?.location
      );
      console.log(
        "   - hasWeather:",
        hasWeather,
        "value:",
        settings?.season || settings?.weather
      );
      console.log(
        "   - hasProductColor:",
        hasProductColor,
        "value:",
        settings?.productColor
      );
      console.log("   - hasAge:", hasAge, "value:", settings?.age);
      console.log("   - hasGender:", hasGender, "value:", settings?.gender);
      console.log("   - hasMood:", hasMood, "value:", settings?.mood);
      console.log(
        "   - hasPerspective:",
        hasPerspective,
        "value:",
        settings?.perspective
      );
      console.log(
        "   - hasAccessories:",
        hasAccessories,
        "value:",
        settings?.accessories
      );
      console.log(
        "   - hasSkinTone:",
        hasSkinTone,
        "value:",
        settings?.skinTone
      );
      console.log(
        "   - hasHairStyle:",
        hasHairStyle,
        "value:",
        settings?.hairStyle
      );
      console.log(
        "   - hasHairColor:",
        hasHairColor,
        "value:",
        settings?.hairColor
      );
      console.log(
        "   - hasBodyShape:",
        hasBodyShape,
        "value:",
        settings?.bodyShape
      );
      console.log("   - hasPose:", hasPose, "value:", settings?.pose);
      console.log(
        "   - hasEthnicity:",
        hasEthnicity,
        "value:",
        settings?.ethnicity
      );
      console.log("   - hasDetails:", hasDetails, "value:", settings?.details);

      const settingsDescriptions = [];

      // Location/Environment
      if (hasLocation) {
        settingsDescriptions.push(`LOCATION/ENVIRONMENT: ${settings.location}`);
        console.log("   ✅ Location eklendi:", settings.location);
      }

      // Weather/Season
      if (hasWeather) {
        const weatherValue = settings.season || settings.weather;
        settingsDescriptions.push(`WEATHER/SEASON: ${weatherValue}`);
        console.log("   ✅ Weather/Season eklendi:", weatherValue);
      }

      // Product Color
      if (hasProductColor) {
        settingsDescriptions.push(`PRODUCT COLOR: ${settings.productColor}`);
        console.log("   ✅ Product Color eklendi:", settings.productColor);
      }

      // Demographics
      if (hasAge) {
        settingsDescriptions.push(`AGE: ${settings.age}`);
        console.log("   ✅ Age eklendi:", settings.age);
      }

      if (hasGender) {
        settingsDescriptions.push(`GENDER: ${settings.gender}`);
        console.log("   ✅ Gender eklendi:", settings.gender);
      }

      if (hasEthnicity) {
        settingsDescriptions.push(`ETHNICITY: ${settings.ethnicity}`);
        console.log("   ✅ Ethnicity eklendi:", settings.ethnicity);
      }

      // Physical Attributes
      if (hasSkinTone) {
        settingsDescriptions.push(`SKIN TONE: ${settings.skinTone}`);
        console.log("   ✅ Skin Tone eklendi:", settings.skinTone);
      }

      if (hasBodyShape) {
        settingsDescriptions.push(`BODY SHAPE: ${settings.bodyShape}`);
        console.log("   ✅ Body Shape eklendi:", settings.bodyShape);
      }

      // Hair
      if (hasHairStyle) {
        settingsDescriptions.push(`HAIR STYLE: ${settings.hairStyle}`);
        console.log("   ✅ Hair Style eklendi:", settings.hairStyle);
      }

      if (hasHairColor) {
        settingsDescriptions.push(`HAIR COLOR: ${settings.hairColor}`);
        console.log("   ✅ Hair Color eklendi:", settings.hairColor);
      }

      // Style & Mood
      if (hasMood) {
        settingsDescriptions.push(`MOOD/EXPRESSION: ${settings.mood}`);
        console.log("   ✅ Mood eklendi:", settings.mood);
      }

      if (hasPerspective) {
        settingsDescriptions.push(
          `CAMERA PERSPECTIVE: ${settings.perspective}`
        );
        console.log("   ✅ Perspective eklendi:", settings.perspective);
      }

      if (hasPose) {
        settingsDescriptions.push(`POSE: ${settings.pose}`);
        console.log("   ✅ Pose eklendi:", settings.pose);
      }

      // Accessories
      if (hasAccessories) {
        settingsDescriptions.push(`ACCESSORIES: ${settings.accessories}`);
        console.log("   ✅ Accessories eklendi:", settings.accessories);
      }

      // Custom Details
      if (hasDetails) {
        settingsDescriptions.push(`ADDITIONAL DETAILS: ${settings.details}`);
        console.log("   ✅ Custom Details eklendi:", settings.details);
      }

      if (settingsDescriptions.length > 0) {
        settingsPromptSection = `
    USER SELECTED DETAILED SETTINGS:
    ${settingsDescriptions.join("\n    ")}
    
    SETTINGS INTEGRATION REQUIREMENTS:
    - MANDATORY: Incorporate ALL the above user settings into the final description
    - Apply location/environment settings for background and lighting
    - Apply weather/season settings for appropriate atmosphere and clothing interaction
    - Apply physical characteristics (age, gender, ethnicity, skin tone, body shape) accurately
    - Apply hair settings (style and color) precisely
    - Apply mood and pose settings for expression and posture
    - Apply camera perspective settings for the photography angle
    - Apply accessories settings as additional items worn by the model
    - Apply product color settings to modify the garment colors as specified
    - Apply additional details for extra customization
    - Ensure all settings work harmoniously together for a cohesive look

    ${
      hasProductColor
        ? `
    ⚠️ CRITICAL PRODUCT COLOR INSTRUCTION:
    - The user wants to change the color of the ${
      isV1Format ? "RIGHT SIDE PRODUCT" : "REFERENCE PRODUCT"
    } to: "${settings.productColor}"
    - ONLY change the color of the garment/product visible in the ${
      isV1Format ? "RIGHT side of the image" : "reference image"
    }
    - ${
      isV1Format
        ? "DO NOT change any colors of clothing the MIDDLE model is currently wearing"
        : "Focus exclusively on the main product/garment being showcased"
    }
    - ${
      isV1Format
        ? "IGNORE all existing clothing colors on the MIDDLE model completely"
        : ""
    }
    - APPLY the color "${settings.productColor}" ONLY to the ${
            isV1Format ? "RIGHT side product" : "main product"
          } when describing it being worn
    - Example: If ${
      isV1Format ? "RIGHT side" : "reference image"
    } shows a hat and user wants "red", make the HAT red${
            isV1Format ? ", not the model's existing clothes" : ""
          }
    - Example: If ${
      isV1Format ? "RIGHT side" : "reference image"
    } shows a jacket and user wants "blue", make the JACKET blue${
            isV1Format ? ", not any other clothing" : ""
          }
    - The color change applies EXCLUSIVELY to the ${
      isV1Format
        ? "RIGHT side product being virtually tried on"
        : "main product being analyzed"
    }
    ${
      settings?.productColor && settings.productColor !== "original"
        ? `- When applying color "${settings.productColor}", apply it ONLY to the RIGHT side product, never to MIDDLE model's existing clothing`
        : ""
    }
    `
        : ""
    }`;

        console.log(
          "📝 [BACKEND GEMINI] Settings descriptions hazırlandı:",
          settingsDescriptions
        );
      } else {
        console.log("⚠️ [BACKEND GEMINI] Hiçbir geçerli setting bulunamadı");
      }

      const settingsText = Object.entries(settings)
        .filter(
          ([key, value]) =>
            value !== null && value !== undefined && value !== ""
        )
        .map(([key, value]) => `${key}: ${value}`)
        .join(", ");

      console.log("🎛️ [BACKEND GEMINI] Settings için prompt oluşturuluyor...");
      console.log("📝 [BACKEND GEMINI] Settings text:", settingsText);
    }

    // Pose ve perspective için akıllı öneri sistemi
    let posePromptSection = "";
    let perspectivePromptSection = "";

    // Eğer pose seçilmemişse, Gemini'ye kıyafete uygun poz önerisi yap
    if (!settings?.pose && !poseImage) {
      const garmentText = isMultipleProducts
        ? "multiple garments/products ensemble"
        : "garment/product";
      posePromptSection = `
    
    INTELLIGENT POSE SELECTION: Since no specific pose was selected by the user, please analyze the ${garmentText} in the reference image and intelligently select the MOST APPROPRIATE pose for the ${modelGenderText} that will:
    - Best showcase ${
      isMultipleProducts
        ? "all products in the ensemble and their coordination"
        : "the garment's design, cut, and construction details"
    }
    - Highlight ${
      isMultipleProducts
        ? "how the products work together and each product's unique selling points"
        : "the product's unique features and selling points"
    }
    - Demonstrate how ${
      isMultipleProducts
        ? "the fabrics of different products drape and interact naturally"
        : "the fabric drapes and moves naturally"
    }
    - Show ${
      isMultipleProducts
        ? "how all products fit together and create an appealing silhouette"
        : "the garment's fit and silhouette most effectively"
    }
    - Match the style and aesthetic of ${
      isMultipleProducts
        ? "the coordinated ensemble (formal, casual, sporty, elegant, etc.)"
        : "the garment (formal, casual, sporty, elegant, etc.)"
    }
    - Allow clear visibility of important design elements ${
      isMultipleProducts
        ? "across all products"
        : "like necklines, sleeves, hems, and patterns"
    }
    - Create an appealing and natural presentation that would be suitable for commercial photography
    ${
      isMultipleProducts
        ? "- Ensure each product in the ensemble is visible and well-positioned\n    - Demonstrate the styling versatility of combining these products"
        : ""
    }`;

      console.log(
        `🤸 [GEMINI] Akıllı poz seçimi aktif - ${
          isMultipleProducts ? "çoklu ürün ensembline" : "kıyafete"
        } uygun poz önerilecek`
      );
    } else if (poseImage) {
      posePromptSection = `
    
    POSE REFERENCE: A pose reference image has been provided to show the desired body position and posture for the ${modelGenderText}. Please analyze this pose image carefully and incorporate the exact body positioning, hand placement, stance, facial expression, and overall posture into your enhanced prompt. The ${modelGenderText} should adopt this specific pose naturally and convincingly${
        isMultipleProducts
          ? ", ensuring all products in the ensemble remain clearly visible and well-positioned"
          : ""
      }.`;

      console.log("🤸 [GEMINI] Pose prompt section eklendi");
    } else if (settings?.pose) {
      posePromptSection = `
    
    SPECIFIC POSE REQUIREMENT: The user has selected a specific pose: "${
      settings.pose
    }". Please ensure the ${modelGenderText} adopts this pose while maintaining natural movement and ensuring the pose complements ${
        isMultipleProducts
          ? "all products in the ensemble being showcased"
          : "the garment being showcased"
      }.`;

      console.log(
        "🤸 [GEMINI] Kullanıcı tarafından seçilen poz:",
        settings.pose
      );
    }

    // Eğer perspective seçilmemişse, Gemini'ye kıyafete uygun perspektif önerisi yap
    if (!settings?.perspective) {
      const garmentText = isMultipleProducts
        ? "multiple products ensemble"
        : "garment/product";
      perspectivePromptSection = `
    
    INTELLIGENT CAMERA PERSPECTIVE SELECTION: Since no specific camera perspective was selected by the user, please analyze the ${garmentText} and intelligently choose the MOST APPROPRIATE camera angle and perspective that will:
    - Best capture ${
      isMultipleProducts
        ? "all products' most important design features and their coordination"
        : "the garment's most important design features"
    }
    - Show ${
      isMultipleProducts
        ? "the construction quality and craftsmanship details of each product"
        : "the product's construction quality and craftsmanship details"
    }
    - Highlight ${
      isMultipleProducts
        ? "how all products fit together and the overall ensemble silhouette"
        : "the fit and silhouette most effectively"
    }
    - Create the most appealing and commercial-quality presentation ${
      isMultipleProducts ? "for the multi-product styling" : ""
    }
    - Match ${
      isMultipleProducts
        ? "the ensemble's style and intended market positioning"
        : "the garment's style and intended market positioning"
    }
    ${
      isMultipleProducts
        ? "- Ensure all products are visible and well-framed within the composition"
        : ""
    }`;

      console.log(
        `📸 [GEMINI] Akıllı perspektif seçimi aktif - ${
          isMultipleProducts ? "çoklu ürün ensembline" : "kıyafete"
        } uygun kamera açısı önerilecek`
      );
    } else {
      perspectivePromptSection = `
    
    SPECIFIC CAMERA PERSPECTIVE: The user has selected a specific camera perspective: "${
      settings.perspective
    }". Please ensure the photography follows this perspective while maintaining professional composition and optimal ${
        isMultipleProducts ? "multi-product ensemble" : "garment"
      } presentation.`;

      console.log(
        "📸 [GEMINI] Kullanıcı tarafından seçilen perspektif:",
        settings.perspective
      );
    }

    // Location bilgisi için ek prompt section
    let locationPromptSection = "";
    if (locationImage) {
      locationPromptSection = `
    
    LOCATION REFERENCE: A location reference image has been provided to help you understand the desired environment/background setting. Please analyze this location image carefully and incorporate its environmental characteristics, lighting style, architecture, mood, and atmosphere into your enhanced prompt. This location should influence the background, lighting conditions, and overall scene composition in your description.`;

      console.log("🏞️ [GEMINI] Location prompt section eklendi");
    }

    // Hair style bilgisi için ek prompt section
    let hairStylePromptSection = "";
    if (hairStyleImage) {
      hairStylePromptSection = `
    
    HAIR STYLE REFERENCE: A hair style reference image has been provided to show the desired hairstyle for the ${modelGenderText}. Please analyze this hair style image carefully and incorporate the exact hair length, texture, cut, styling, and overall hair appearance into your enhanced prompt. The ${modelGenderText} should have this specific hairstyle that complements ${
        isMultipleProducts ? "the multi-product ensemble" : "the garment"
      } and overall aesthetic.`;

      console.log("💇 [GEMINI] Hair style prompt section eklendi");
    }

    // Gemini'ye gönderilecek metin
    let promptForGemini = `
    IMPORTANT INSTRUCTION: Please generate ONLY the requested prompt without any introduction, explanation, or commentary. Do not start with phrases like "Here's a detailed prompt" or "Editorial Photography Prompt" or any descriptive text. Return ONLY the direct prompt content that will be used for image generation.

    PROMPT LENGTH REQUIREMENT: Generate a comprehensive, detailed prompt that is AT LEAST 500 words long. Include extensive descriptions of fabric details, lighting conditions, environmental elements, model positioning, garment construction, textures, colors, styling elements, and photographic composition. The prompt should be richly detailed and descriptive to ensure high-quality image generation.

    ${
      isV1Format
        ? `
    V1 FORMAT - COMBINED IMAGE ANALYSIS:
    This is for a virtual try-on application. The combined image shows THREE parts side by side:
    - LEFT: Face photograph that will be used in face-swap process
    - MIDDLE: Full body model photo showing pose, body structure, and physique (IGNORE any clothing the model is currently wearing)
    - RIGHT: Clothing/product that should be virtually tried on

    CRITICAL: IGNORE ALL CLOTHING that the MIDDLE model is currently wearing. Do NOT describe the model's existing clothing.

    CRITICAL V1 VIRTUAL TRY-ON REQUIREMENTS:
    1. Use the BODY/POSE from the MIDDLE section of the image (IGNORE the clothing the model is wearing)
    2. Show ONLY the PRODUCTS from the RIGHT section being worn by the model body
    3. The face will be added later through face-swap, so focus on BODY + CLOTHING combination
    4. DO NOT mention or describe any clothing the MIDDLE model is currently wearing
    5. Describe ONLY the clothing items from the RIGHT side product image in EXTREME DETAIL:
       - Exact colors, patterns, textures, fabrics
       - Specific design elements, cuts, silhouettes  
       - Any unique features, embellishments, or details
       - How the garment fits and drapes on the body
       - Material appearance (matte, shiny, textured, smooth)
    6. Create a seamless virtual try-on where the model from the MIDDLE is wearing ONLY the products from the RIGHT
    7. Describe how RIGHT side products look when worn by MIDDLE side body

    IGNORE INSTRUCTIONS FOR V1 - VERY IMPORTANT:
    - COMPLETELY IGNORE any clothing, accessories, or garments that the MIDDLE model is currently wearing
    - DO NOT describe what the model is wearing in the MIDDLE image
    - ONLY focus on the RIGHT side product image for clothing descriptions
    - The MIDDLE side is ONLY for body reference (pose, build, physique)
    - Replace ALL existing clothing with the RIGHT side products
    ${
      settings?.productColor && settings.productColor !== "original"
        ? `- When applying color "${settings.productColor}", apply it ONLY to the RIGHT side product, never to MIDDLE model's existing clothing`
        : ""
    }
    
    CRITICAL VIRTUAL TRY-ON REQUIREMENTS (V1 ENHANCED):
    1. Use the BODY/POSE from the MIDDLE side of the image  
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
    5. Create a seamless virtual try-on where the model from the MIDDLE is wearing the products from the RIGHT
    
    CRITICAL REQUIREMENTS:
    1. The output prompt must be PURE ENGLISH - no foreign language words whatsoever
    2. Combine the body from MIDDLE + products from RIGHT
    3. Describe the model wearing the clothing items from the product image with EXTREME DETAIL
    4. Include ALL types of clothing and accessories visible in the product image
    5. Make it sound like a professional fashion photography description
    6. Focus heavily on product details: fabric texture, color nuances, design elements, fit characteristics
    7. Describe how the clothing items from the RIGHT side look when worn by the body from MIDDLE side
    8. Create a seamless combination of the two elements: body + clothing
    9. MANDATORY: Always include detailed body type analysis (height, build, proportions) in the description
    10. Describe how the specific garments complement and fit the person's body type and height
    11. CRITICAL: Use only content-moderation-safe language and terminology
    12. AVOID any terms that could be flagged as sensitive or inappropriate
    13. Focus on professional fashion description, not physical attractiveness
    
    Your output should ONLY be the virtual try-on prompt in PURE ENGLISH that describes the complete fashion look with extensive product details, body type analysis, physical characteristics using SAFE, PROFESSIONAL terminology.
    `
        : `
    V2 FORMAT - SINGLE IMAGE ANALYSIS:
    This is a single reference image that may contain garments or products to be analyzed for virtual try-on.
    `
    }

    CRITICAL GARMENT ANALYSIS REQUIREMENT: You MUST conduct a thorough visual analysis of the reference garment image and describe EVERY visible construction detail, fit characteristic, and structural element. This is essential for accurate representation:

    MANDATORY GARMENT INSPECTION CHECKLIST:
    1. FIT ANALYSIS: Analyze how the garment fits on the body - is it loose/relaxed, fitted/tailored, oversized, or form-fitting? Describe the silhouette shape and how much ease/room there is between fabric and body.
    
    2. CUT AND CONSTRUCTION: Examine the garment's cut style - A-line, straight cut, bias cut, princess seams, empire waist, wrap style, etc. Note any architectural shaping or construction techniques.
    
    3. DRAPE AND FABRIC BEHAVIOR: Observe how the fabric drapes and flows - does it hang straight, have natural gathers, create pleats or folds? Is the fabric stiff and structured or soft and flowing?
    
    4. PROPORTIONS AND MEASUREMENTS: Note the garment's proportions - sleeve length, hemline placement, neckline depth, overall garment length, and how these relate to the model's body.
    
    5. STRUCTURAL DETAILS: Identify all visible construction elements - seam placement, dart positioning, panel divisions, gathering, pleating, tucking, or any shaping techniques.
    
    6. EDGE TREATMENTS: Examine all edges - hemlines, necklines, armholes, cuffs - noting their finishing style, width, and how they behave (curved, straight, flared, gathered).
    
    7. VOLUME AND FULLNESS: Assess where the garment has volume or fullness - sleeves, skirt, bodice areas - and describe how this fullness is created and distributed.
    
    8. FABRIC WEIGHT AND TEXTURE: Determine the apparent fabric weight (lightweight/flowing vs heavyweight/structured) and surface texture that affects how the garment behaves.

    CRITICAL ACCURACY REQUIREMENT: Carefully analyze the reference image and describe ONLY the features that actually exist in the garment. Do NOT assume or invent details that are not visible. Pay special attention to:
    - Only mention pockets if they are clearly visible in the reference image
    - Only describe buttons, zippers, or closures that actually exist
    - Only reference specific design elements that are actually present
    - If a garment has no pockets, do NOT suggest poses involving hands in pockets
    - If there are no visible buttons, do NOT mention buttoning or unbuttoning
    - Base all styling and posing suggestions on the actual garment construction shown
    - Ensure model poses are appropriate for the specific garment features that exist
    
    GARMENT LENGTH AND BODY COVERAGE ANALYSIS: Carefully analyze where the garment falls on the body and specify the exact body areas it covers. For each garment type, describe precisely:
    - For tops/shirts/blouses: Does it reach the waist, hip bone, mid-torso, or is it cropped above the waist?
    - For dresses: Does it reach knee-length, midi (mid-calf), ankle-length, or floor-length?
    - For pants/trousers: Are they full-length, ankle-length, capri (mid-calf), or shorts?
    - For skirts: Do they reach mini (upper thigh), knee-length, midi, or maxi length?
    - For jackets/coats: Do they end at the waist, hip, mid-thigh, or longer?
    - For sleeves: Are they sleeveless, short-sleeve, three-quarter, or full-length?
    - For necklines: Specify if it's crew neck, V-neck, scoop neck, high neck, off-shoulder, etc.
    This length and coverage information is crucial for accurate garment representation and appropriate styling suggestions.

    DETAILED CONSTRUCTION TERMINOLOGY: Use professional fashion construction terms when describing garment details:
    - Seaming techniques: French seams, flat-fell seams, serged edges, bound seams
    - Shaping methods: Darts, princess seams, side panels, waist seaming, bust darts
    - Closures: Invisible zippers, exposed zippers, snap closures, hook-and-eye, ties
    - Hemming: Blind hem, rolled hem, raw edge, bias binding, faced hem
    - Neckline finishes: Bias binding, facing, self-fabric binding, contrast piping
    - Sleeve attachments: Set-in sleeves, raglan sleeves, dolman sleeves, cap sleeves

    Create a detailed English prompt for high-fashion editorial photography featuring the main product/garment from the provided reference image worn by a ${modelGenderText}. Absolutely avoid terms like transparent, see-through, sheer, revealing, exposed, decolletage, cleavage, low-cut, plunging, bare skin, provocative, sensual, sexy, seductive, tight-fitting for sensitive areas, body-hugging, form-fitting, or fabric opacity levels. Use safe alternatives like lightweight, delicate, fine-weave, airy, modern cut, contemporary style, elegant neckline, refined cut instead. Never mention brand names, designer names, or commercial labels like Nike, Adidas, Zara, H&M, Louis Vuitton etc. Describe items as premium garment, high-quality piece, professional design instead. Ignore all background elements, supporting materials, fabric cloths, or photography aids and focus only on the actual product meant to be showcased.

    ${
      isMultipleProducts
        ? `
    MULTIPLE PRODUCTS VIRTUAL TRY-ON REQUIREMENTS:
    This image contains MULTIPLE garments/products that should be worn together as a coordinated ensemble. You must:
    1. Identify ALL products visible in the reference image
    2. Describe how EACH product looks when worn by the ${modelGenderText}
    3. Show how all products work together as a complete outfit
    4. Describe the coordination between different pieces
    5. Ensure all products are visible and well-positioned in the final image
    6. Create a cohesive styling that demonstrates the versatility of combining these products
    `
        : `
    SINGLE PRODUCT VIRTUAL TRY-ON REQUIREMENTS:
    Focus on the main garment/product in the reference image. The ${modelGenderText} must be wearing this specific product.
    `
    }

    CRITICAL VIRTUAL TRY-ON INSTRUCTIONS (V1 ENHANCED):
    1. ANALYZE the reference garment image in EXTREME DETAIL - every seam, every design element, every fabric characteristic
    2. The ${modelGenderText} must always be wearing the product from the reference image - this is NON-NEGOTIABLE
    3. Describe the exact fabric type, weave pattern, weight, texture, finish, stretch properties, and coverage in natural flowing sentences
    4. Detail every visible seam type, stitching patterns, thread visibility, seam finishing quality, hemming techniques, edge treatments, topstitching, and construction methods as part of the description
    5. Analyze all design elements including prints, patterns, embroidery, color techniques, decorative elements like buttons, zippers, trim details, and hardware
    6. Specify exact fit type, how the garment drapes, silhouette shape, proportions, length, sleeve style, and neckline construction
    7. Include surface treatments, finishes, pleating, gathering, wash effects, coatings, embellishments, and quality indicators
    8. The photography should be hyper-realistic with perfect studio lighting showcasing fabric texture and construction details, professional camera angles highlighting craftsmanship, and composition emphasizing garment excellence

    ESSENTIAL GARMENT BEHAVIOR DESCRIPTION: You must describe how this specific garment behaves when worn:
    - How the fabric moves and flows with body movement
    - Where the garment creates volume, structure, or close fit
    - How the weight and drape of the fabric affects the overall silhouette
    - The way seams, darts, and construction elements shape the garment
    - How the garment's proportions relate to the human form
    - The visual impact of the garment's cut and construction choices

    BODY TYPE INTEGRATION: Describe the person's BODY TYPE and PHYSICAL CHARACTERISTICS in safe, professional terms:
    - Height (tall, medium, short) and build (slim, athletic, balanced proportions, etc.)
    - Body proportions and overall physique
    - How the specific garment complements and fits this body type
    - How the construction and cut work with the model's natural silhouette

    ${
      originalPrompt
        ? `Incorporate these specific requirements: ${originalPrompt}.`
        : ""
    } ${
      hasValidSettings
        ? `Integrate these user settings naturally: ${Object.entries(settings)
            .filter(
              ([key, value]) =>
                value !== null && value !== undefined && value !== ""
            )
            .map(([key, value]) => `${key} is ${value}`)
            .join(", ")}.`
        : ""
    }
    
    ${settingsPromptSection}
    ${locationPromptSection}
    ${posePromptSection}
    ${perspectivePromptSection}
    ${hairStylePromptSection}
    
    Generate a single, flowing description that reads like a master craftsperson's analysis of premium garment construction, emphasizing professional quality, material excellence, and attention to detail throughout. The ${modelGenderText} should demonstrate natural movement showcasing how the fabric behaves when worn, with poses appropriate for the garment category and facial expressions matching the intended style and quality level. Ensure no suggestive words, focus only on fashion and craftsmanship, use professional technical terminology, maintain editorial magazine tone, avoid content moderation triggers, emphasize construction over body descriptions, and use no brand names whatsoever.
    
    ${
      isV1Format
        ? `
    V1 SPECIFIC INSTRUCTIONS - Create a detailed fashion description prompt that describes:
    1. The person with the body from the MIDDLE image wearing the clothing items from the RIGHT side of the image
    2. DETAILED BODY TYPE DESCRIPTION: Analyze and describe the person's height, build, proportions, and physique (using safe terminology)
    3. Include specific details about the clothing items, colors, styles, and textures from the RIGHT side
    4. Include details about the setting, pose, and overall aesthetic
    5. VERY IMPORTANT: Describe the products from the RIGHT side in extensive detail as if they are being worn by the person from MIDDLE
    6. CRITICAL: Include how the clothing fits and looks on this specific body type and height (using professional language)
    7. Create a seamless virtual try-on where the MIDDLE body is wearing the RIGHT products
    8. Focus heavily on how the RIGHT side clothing items look when worn by the MIDDLE side body
    
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
    `
        : ""
    }
    `;

    // Eğer originalPrompt'ta "Model's pose" ibaresi yoksa ek cümle ekleyelim:
    if (!originalPrompt || !originalPrompt.includes("Model's pose")) {
      // Eğer poz seçilmemişse akıllı poz seçimi, seçilmişse belirtilen poz
      if (!settings?.pose && !poseImage) {
        promptForGemini += `Since no specific pose was provided, intelligently select the most suitable pose and camera angle for the ${modelGenderText} that showcases the garment's design features, fit, and construction quality. Choose poses appropriate for the garment category with body language that complements the style and allows clear visibility of craftsmanship details. Select camera perspectives that create appealing commercial presentations highlighting the garment's key selling points.`;
      } else {
        promptForGemini += `The ${modelGenderText} must adopt a pose that showcases the garment's construction details, fabric drape, and design elements while maintaining natural movement that demonstrates how the fabric behaves when worn. Ensure poses emphasize the garment's silhouette and proportions with facial expressions matching the intended style.`;
      }
    }

    console.log("Gemini'ye gönderilen istek:", promptForGemini);

    // Resim verilerini içerecek parts dizisini hazırla
    const parts = [{ text: promptForGemini }];

    // Referans görseli Gemini'ye gönder
    try {
      console.log(`Referans görsel Gemini'ye gönderiliyor: ${imageUrl}`);

      const imageResponse = await axios.get(imageUrl, {
        responseType: "arraybuffer",
      });
      const imageBuffer = imageResponse.data;

      // Base64'e çevir
      const base64Image = Buffer.from(imageBuffer).toString("base64");

      parts.push({
        inlineData: {
          mimeType: "image/jpeg",
          data: base64Image,
        },
      });

      console.log("Referans görsel başarıyla Gemini'ye yüklendi");
    } catch (imageError) {
      console.error(`Görsel yüklenirken hata: ${imageError.message}`);
    }

    // Location image'ını da Gemini'ye gönder
    if (locationImage) {
      try {
        // URL'den query parametrelerini temizle
        const cleanLocationImageUrl = locationImage.split("?")[0];
        console.log(
          `🏞️ Location görsel base64'e çeviriliyor: ${cleanLocationImageUrl}`
        );

        const locationImageResponse = await axios.get(cleanLocationImageUrl, {
          responseType: "arraybuffer",
        });
        const locationImageBuffer = locationImageResponse.data;

        // Base64'e çevir
        const base64LocationImage =
          Buffer.from(locationImageBuffer).toString("base64");

        parts.push({
          inlineData: {
            mimeType: "image/jpeg",
            data: base64LocationImage,
          },
        });

        console.log("🏞️ Location görsel başarıyla Gemini'ye eklendi");
      } catch (locationImageError) {
        console.error(
          `🏞️ Location görseli eklenirken hata: ${locationImageError.message}`
        );
      }
    }

    // Pose image'ını da Gemini'ye gönder
    if (poseImage) {
      try {
        // URL'den query parametrelerini temizle
        const cleanPoseImageUrl = poseImage.split("?")[0];
        console.log(
          `🤸 Pose görsel base64'e çeviriliyor: ${cleanPoseImageUrl}`
        );

        const poseImageResponse = await axios.get(cleanPoseImageUrl, {
          responseType: "arraybuffer",
        });
        const poseImageBuffer = poseImageResponse.data;

        // Base64'e çevir
        const base64PoseImage = Buffer.from(poseImageBuffer).toString("base64");

        parts.push({
          inlineData: {
            mimeType: "image/jpeg",
            data: base64PoseImage,
          },
        });

        console.log("🤸 Pose görsel başarıyla Gemini'ye eklendi");
      } catch (poseImageError) {
        console.error(
          `🤸 Pose görseli eklenirken hata: ${poseImageError.message}`
        );
      }
    }

    // Hair style image'ını da Gemini'ye gönder
    if (hairStyleImage) {
      try {
        // URL'den query parametrelerini temizle
        const cleanHairStyleImageUrl = hairStyleImage.split("?")[0];
        console.log(
          `💇 Hair style görsel base64'e çeviriliyor: ${cleanHairStyleImageUrl}`
        );

        const hairStyleImageResponse = await axios.get(cleanHairStyleImageUrl, {
          responseType: "arraybuffer",
        });
        const hairStyleImageBuffer = hairStyleImageResponse.data;

        // Base64'e çevir
        const base64HairStyleImage =
          Buffer.from(hairStyleImageBuffer).toString("base64");

        parts.push({
          inlineData: {
            mimeType: "image/jpeg",
            data: base64HairStyleImage,
          },
        });

        console.log("💇 Hair style görsel başarıyla Gemini'ye eklendi");
      } catch (hairStyleImageError) {
        console.error(
          `💇 Hair style görseli eklenirken hata: ${hairStyleImageError.message}`
        );
      }
    }

    // Gemini'den cevap al (retry mekanizması ile)
    let enhancedPrompt;
    const maxRetries = 3;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const result = await model.generateContent({
          contents: [{ parts }],
        });

        enhancedPrompt = result.response.text().trim();
        console.log(
          "🤖 [BACKEND GEMINI] Gemini'nin ürettiği prompt:",
          enhancedPrompt
        );
        break; // Başarılı olursa loop'tan çık
      } catch (geminiError) {
        console.error(
          `Gemini API attempt ${attempt} failed:`,
          geminiError.message
        );

        if (attempt === maxRetries) {
          console.error(
            "Gemini API all attempts failed, using original prompt"
          );
          enhancedPrompt = originalPrompt;
          break;
        }

        // Exponential backoff: 1s, 2s, 4s
        const waitTime = Math.pow(2, attempt - 1) * 1000;
        console.log(`Waiting ${waitTime}ms before retry...`);
        await new Promise((resolve) => setTimeout(resolve, waitTime));
      }
    }

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
      const response = await axios.get(
        `https://api.replicate.com/v1/predictions/${predictionId}`,
        {
          headers: {
            Authorization: `Bearer ${process.env.REPLICATE_API_TOKEN}`,
            "Content-Type": "application/json",
          },
          responseType: "json",
        }
      );

      const result = response.data;
      console.log(`Polling attempt ${attempt + 1}: status = ${result.status}`);

      if (result.status === "succeeded") {
        console.log("Replicate işlemi başarıyla tamamlandı");
        return result;
      } else if (result.status === "failed") {
        console.error("Replicate işlemi başarısız:", result.error);

        // Sensitive content hatasını kontrol et
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
          throw new Error(
            "SENSITIVE_CONTENT: Your content has been flagged as inappropriate. Please try again with a different image or settings."
          );
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
      console.error(`Polling attempt ${attempt + 1} hatası:`, error.message);

      // Sensitive content hatasını özel olarak handle et
      if (error.message.startsWith("SENSITIVE_CONTENT:")) {
        console.error("❌ Sensitive content hatası, polling durduruluyor");
        throw error; // Hata mesajını olduğu gibi fırlat
      }

      // Eğer hata "failed" status'dan kaynaklanıyorsa derhal durdur
      if (
        error.message.includes("Replicate processing failed") ||
        error.message.includes("processing was canceled")
      ) {
        console.error(
          "❌ Replicate işlemi başarısız/iptal, polling durduruluyor"
        );
        throw error; // Hata mesajını olduğu gibi fırlat
      }

      // Sadece network/connection hatalarında retry yap
      if (attempt === maxAttempts - 1) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }

  throw new Error("Replicate işlemi zaman aşımına uğradı");
}

// Çoklu resimleri canvas ile birleştiren fonksiyon
async function combineImagesOnCanvas(
  images,
  userId,
  isMultipleProducts = false
) {
  try {
    console.log(
      "🎨 Canvas ile resim birleştirme başlatılıyor...",
      images.length,
      "resim"
    );
    console.log("🛍️ Çoklu ürün modu:", isMultipleProducts);

    // Canvas boyutları
    let canvasWidth = 0;
    let canvasHeight = 0;
    const loadedImages = [];

    // Tüm resimleri yükle ve boyutları hesapla
    for (let i = 0; i < images.length; i++) {
      const imgData = images[i];
      let imageBuffer;

      try {
        // Base64 veya HTTP URL'den resmi yükle
        if (imgData.base64) {
          console.log(`📐 Resim ${i + 1}: Base64 formatından yükleniyor`);
          imageBuffer = Buffer.from(imgData.base64, "base64");
        } else if (
          imgData.uri.startsWith("http://") ||
          imgData.uri.startsWith("https://")
        ) {
          console.log(
            `📐 Resim ${i + 1}: HTTP URL'den yükleniyor: ${imgData.uri}`
          );
          const response = await axios.get(imgData.uri, {
            responseType: "arraybuffer",
            timeout: 10000, // 10 saniye timeout
          });
          imageBuffer = Buffer.from(response.data);
        } else if (imgData.uri.startsWith("file://")) {
          throw new Error("Yerel dosya için base64 data gönderilmelidir.");
        } else {
          throw new Error(`Desteklenmeyen URI formatı: ${imgData.uri}`);
        }

        // Sharp ile resmi önce işle (format uyumluluk için)
        console.log(`🔄 Resim ${i + 1}: Sharp ile preprocessing yapılıyor...`);
        const processedBuffer = await sharp(imageBuffer)
          .jpeg({ quality: 90 }) // JPEG formatına çevir
          .toBuffer();

        // Metadata'yı al
        const metadata = await sharp(processedBuffer).metadata();
        console.log(
          `📐 Resim ${i + 1}: ${metadata.width}x${metadata.height} (${
            metadata.format
          })`
        );

        // Canvas için loadImage kullan
        const img = await loadImage(processedBuffer);
        loadedImages.push(img);

        console.log(
          `✅ Resim ${i + 1} başarıyla yüklendi: ${img.width}x${img.height}`
        );
      } catch (imageError) {
        console.error(
          `❌ Resim ${i + 1} yüklenirken hata:`,
          imageError.message
        );

        // Fallback: Resmi atla ve devam et
        console.log(
          `⏭️ Resim ${i + 1} atlanıyor, diğer resimlerle devam ediliyor...`
        );
        continue;
      }
    }

    // Eğer hiç resim yüklenemezse hata fırlat
    if (loadedImages.length === 0) {
      throw new Error(
        "Hiçbir resim başarıyla yüklenemedi. Lütfen farklı resimler deneyin."
      );
    }

    console.log(`✅ Toplam ${loadedImages.length} resim başarıyla yüklendi`);

    // Canvas değişkenini tanımla
    let canvas;

    if (isMultipleProducts) {
      // Çoklu ürün modu: Yan yana birleştir
      console.log("🛍️ Çoklu ürün modu: Resimler yan yana birleştirilecek");

      // Her resmi aynı yüksekliğe getir
      const targetHeight = Math.min(...loadedImages.map((img) => img.height));

      // Toplam genişlik ve sabit yükseklik hesapla
      canvasWidth = loadedImages.reduce((total, img) => {
        const scaledWidth = (img.width * targetHeight) / img.height;
        return total + scaledWidth;
      }, 0);
      canvasHeight = targetHeight;

      console.log(
        `📏 Çoklu ürün canvas boyutu: ${canvasWidth}x${canvasHeight}`
      );

      // Canvas oluştur
      canvas = createCanvas(canvasWidth, canvasHeight);
      const ctx = canvas.getContext("2d");

      // Beyaz arka plan
      ctx.fillStyle = "white";
      ctx.fillRect(0, 0, canvasWidth, canvasHeight);

      // Resimleri yan yana yerleştir
      let currentX = 0;
      for (let i = 0; i < loadedImages.length; i++) {
        const img = loadedImages[i];
        const scaledWidth = (img.width * targetHeight) / img.height;

        ctx.drawImage(img, currentX, 0, scaledWidth, targetHeight);
        currentX += scaledWidth;

        console.log(
          `🖼️ Ürün ${i + 1} yerleştirildi: (${
            currentX - scaledWidth
          }, 0) - ${scaledWidth}x${targetHeight}`
        );
      }
    } else {
      // Normal mod: Alt alta birleştir (mevcut mantık)
      console.log("📚 Normal mod: Resimler alt alta birleştirilecek");

      canvasWidth = Math.max(...loadedImages.map((img) => img.width));
      canvasHeight = loadedImages.reduce((total, img) => total + img.height, 0);

      console.log(`📏 Normal canvas boyutu: ${canvasWidth}x${canvasHeight}`);

      // Canvas oluştur
      canvas = createCanvas(canvasWidth, canvasHeight);
      const ctx = canvas.getContext("2d");

      // Beyaz arka plan
      ctx.fillStyle = "white";
      ctx.fillRect(0, 0, canvasWidth, canvasHeight);

      // Resimleri dikey olarak sırala
      let currentY = 0;
      for (let i = 0; i < loadedImages.length; i++) {
        const img = loadedImages[i];
        const x = (canvasWidth - img.width) / 2; // Ortala

        ctx.drawImage(img, x, currentY);
        currentY += img.height;

        console.log(
          `🖼️ Resim ${i + 1} yerleştirildi: (${x}, ${currentY - img.height})`
        );
      }
    }

    // Canvas'ı buffer'a çevir
    const buffer = canvas.toBuffer("image/jpeg", { quality: 0.8 });
    console.log("📊 Birleştirilmiş resim boyutu:", buffer.length, "bytes");

    // Supabase'e yükle
    const timestamp = Date.now();
    const randomId = uuidv4().substring(0, 8);
    const fileName = `combined_${isMultipleProducts ? "products" : "images"}_${
      userId || "anonymous"
    }_${timestamp}_${randomId}.jpg`;

    const { data, error } = await supabase.storage
      .from("reference")
      .upload(fileName, buffer, {
        contentType: "image/jpeg",
        cacheControl: "3600",
        upsert: false,
      });

    if (error) {
      console.error("❌ Birleştirilmiş resim Supabase'e yüklenemedi:", error);
      throw new Error(`Supabase upload error: ${error.message}`);
    }

    // Public URL al
    const { data: urlData } = supabase.storage
      .from("reference")
      .getPublicUrl(fileName);

    console.log("✅ Birleştirilmiş resim Supabase URL'si:", urlData.publicUrl);
    return urlData.publicUrl;
  } catch (error) {
    console.error("❌ Canvas birleştirme hatası:", error);
    throw error;
  }
}

// V1'den eklenen: Üç görseli yan yana birleştiren fonksiyon (Face + Model + Product)
async function combineThreeImagesHorizontally(
  image1Url,
  image2Url,
  image3Url,
  userId
) {
  try {
    console.log(
      `🎨 3 görsel yan yana birleştiriliyor: ${image1Url} + ${image2Url} + ${image3Url}`
    );

    // Üç görüntüyü de indir
    const [buffer1, buffer2, buffer3] = await Promise.all([
      axios
        .get(image1Url, { responseType: "arraybuffer" })
        .then((res) => Buffer.from(res.data)),
      axios
        .get(image2Url, { responseType: "arraybuffer" })
        .then((res) => Buffer.from(res.data)),
      axios
        .get(image3Url, { responseType: "arraybuffer" })
        .then((res) => Buffer.from(res.data)),
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

    console.log(
      `🎨 Birleştirilmiş görüntü boyutu: ${totalWidth}x${targetHeight}`
    );
    console.log(`📐 Görsel genişlikleri: ${width1}, ${width2}, ${width3}`);

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
    const fileName = `combined_3images_${
      userId || "anonymous"
    }_${Date.now()}_${uuidv4().substring(0, 8)}.jpg`;
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
      console.error("❌ Birleştirilmiş görüntü yükleme hatası:", error);
      throw error;
    }

    // Public URL al
    const { data: publicUrlData } = supabase.storage
      .from("reference")
      .getPublicUrl(remotePath);

    // Geçici dosyayı sil
    fs.promises
      .unlink(filePath)
      .catch((err) => console.warn("⚠️ Geçici dosya silinemedi:", err));

    console.log(
      "✅ 3 görüntü başarıyla birleştirildi:",
      publicUrlData.publicUrl
    );
    return publicUrlData.publicUrl;
  } catch (error) {
    console.error("❌ 3 görüntü birleştirme hatası:", error);
    throw error;
  }
}

// V1'den eklenen: İki görseli (model + product) yan yana birleştiren fonksiyon
async function combineModelAndProduct(modelImageUrl, productImageUrl, userId) {
  try {
    console.log(
      `🎨 Model ve product görseli birleştiriliyor: ${modelImageUrl} + ${productImageUrl}`
    );

    // İki görüntüyü de indir
    const [modelBuffer, productBuffer] = await Promise.all([
      axios
        .get(modelImageUrl, { responseType: "arraybuffer" })
        .then((res) => Buffer.from(res.data)),
      axios
        .get(productImageUrl, { responseType: "arraybuffer" })
        .then((res) => Buffer.from(res.data)),
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

    console.log(
      `🎨 Birleştirilmiş görüntü boyutu: ${totalWidth}x${targetHeight}`
    );
    console.log(
      `📐 Görsel genişlikleri: model=${modelWidth}, product=${productWidth}`
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
    const fileName = `combined_model_product_${
      userId || "anonymous"
    }_${Date.now()}_${uuidv4().substring(0, 8)}.jpg`;
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
      console.error("❌ Model+Product görüntü yükleme hatası:", error);
      throw error;
    }

    // Public URL al
    const { data: publicUrlData } = supabase.storage
      .from("reference")
      .getPublicUrl(remotePath);

    // Geçici dosyayı sil
    fs.promises
      .unlink(filePath)
      .catch((err) => console.warn("⚠️ Geçici dosya silinemedi:", err));

    console.log(
      "✅ Model + Product görüntüleri başarıyla birleştirildi:",
      publicUrlData.publicUrl
    );
    return publicUrlData.publicUrl;
  } catch (error) {
    console.error("❌ Model + Product birleştirme hatası:", error);
    throw error;
  }
}

// V1'den eklenen: Face-swap işlemini retry mekanizması ile yapan fonksiyon
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
      const faceSwapResponse = await axios.post(
        "https://api.replicate.com/v1/predictions",
        {
          version:
            "cdingram/face-swap:d1d6ea8c8be89d664a07a457526f7128109dee7030fdac424788d762c71ed111",
          input: {
            swap_image: faceImageUrl, // Face fotoğrafı
            input_image: fluxOutputUrl, // Flux-kontext sonucu
          },
        },
        {
          headers: {
            Authorization: `Bearer ${process.env.REPLICATE_API_TOKEN}`,
            "Content-Type": "application/json",
          },
        }
      );

      const faceSwapInitial = faceSwapResponse.data;
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

// Ana generate endpoint'i - Tek resim için
router.post("/generate", async (req, res) => {
  // Kredi kontrolü ve düşme
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
      locationImage,
      poseImage,
      hairStyleImage,
      isMultipleImages,
      isMultipleProducts,
    } = req.body;

    // userId'yi scope için ata
    userId = requestUserId;

    console.log("🖼️ [BACKEND V2] isMultipleImages:", isMultipleImages);
    console.log("🛍️ [BACKEND V2] isMultipleProducts:", isMultipleProducts);
    console.log(
      "📤 [BACKEND V2] Gelen referenceImages:",
      referenceImages?.length || 0,
      "adet"
    );

    // V1 formatını kontrol et - 3 ayrı resim var mı?
    const isV1Format =
      referenceImages &&
      Array.isArray(referenceImages) &&
      referenceImages.length >= 3 &&
      referenceImages.some((img) => img.tag === "image_1") &&
      referenceImages.some((img) => img.tag === "image_2") &&
      referenceImages.some((img) => img.tag === "image_3");

    console.log("🔍 [BACKEND V2] V1 formatı tespit edildi:", isV1Format);

    if (isV1Format) {
      console.log("🚀 [BACKEND V2] V1 formatı kullanılarak işlem yapılıyor...");

      // V1 formatı: Face + Model + Product ayrı ayrı
      const faceImage = referenceImages.find((img) => img.tag === "image_1");
      const modelImage = referenceImages.find((img) => img.tag === "image_2");
      const productImage = referenceImages.find((img) => img.tag === "image_3");

      if (!faceImage || !modelImage || !productImage) {
        return res.status(400).json({
          success: false,
          result: {
            message:
              "V1 formatı için Face görseli (image_1), model görseli (image_2) ve ürün görseli (image_3) gereklidir.",
          },
        });
      }

      console.log("👤 Face görseli:", faceImage.uri);
      console.log("🧍 Model görseli:", modelImage.uri);
      console.log("👕 Ürün görseli:", productImage.uri);

      // Kredi kontrolü
      if (userId && userId !== "anonymous_user") {
        try {
          console.log(
            `💳 Kullanıcı ${userId} için kredi kontrolü yapılıyor...`
          );

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

      // 3 görseli birleştir (Gemini analizi için)
      const combinedImageUrlForGemini = await combineThreeImagesHorizontally(
        faceImage.uri,
        modelImage.uri,
        productImage.uri,
        userId
      );

      // Model + Product birleştir (Flux API için)
      const combinedImageUrlForFlux = await combineModelAndProduct(
        modelImage.uri,
        productImage.uri,
        userId
      );

      console.log(
        "🎨 Gemini için birleştirilmiş görsel URL'si:",
        combinedImageUrlForGemini
      );
      console.log(
        "🎨 Flux için birleştirilmiş görsel URL'si:",
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
        settings || {},
        locationImage,
        poseImage,
        hairStyleImage,
        isMultipleProducts
      );

      console.log("📝 [BACKEND V2 V1-Format] Original prompt:", promptText);
      console.log("✨ [BACKEND V2 V1-Format] Enhanced prompt:", enhancedPrompt);

      // Replicate API'ye istek gönder - sadece model + product görseli kullan
      const replicateResponse = await axios.post(
        "https://api.replicate.com/v1/models/black-forest-labs/flux-kontext-max/predictions",
        {
          input: {
            prompt: enhancedPrompt,
            input_image: combinedImageUrlForFlux, // Face olmadan sadece model + product
            aspect_ratio: formattedRatio,
          },
        },
        {
          headers: {
            Authorization: `Bearer ${process.env.REPLICATE_API_TOKEN}`,
            "Content-Type": "application/json",
          },
        }
      );

      const initialResult = replicateResponse.data;
      console.log("Replicate API başlangıç yanıtı:", initialResult);

      if (!initialResult.id) {
        console.error("Replicate prediction ID alınamadı:", initialResult);

        // Kredi iade et
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
      const startTime = Date.now();
      const finalResult = await pollReplicateResult(initialResult.id);
      const processingTime = Math.round((Date.now() - startTime) / 1000);

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
          // Face-swap işlemi için retry mekanizmasını kullan
          const faceSwapResult = await performFaceSwapWithRetry(
            faceImageUrl,
            fluxOutputUrl
          );

          if (faceSwapResult.success) {
            console.log("✅ Face-swap API işlemi başarılı");

            // 💳 API başarılı olduktan sonra güncel kredi bilgisini al
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
              referenceImages,
              settings,
              locationImage,
              poseImage,
              hairStyleImage,
              formattedRatio,
              initialResult.id,
              processingTime,
              isMultipleImages,
              isMultipleProducts
            );

            return res.status(200).json(responseData);
          } else {
            console.error("Face-swap API başarısız:", faceSwapResult.result);

            // 💳 API başarılı olduktan sonra güncel kredi bilgisini al
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
            const responseData = {
              success: true,
              result: {
                imageUrl: fluxOutputUrl,
                originalPrompt: promptText,
                enhancedPrompt: enhancedPrompt,
                replicateData: finalResult,
                faceSwapError:
                  faceSwapResult.result.error ||
                  "Face-swap işlemi başarısız, orijinal sonuç döndürülüyor",
                currentCredit: currentCredit, // 💳 Güncel kredi bilgisini response'a ekle
              },
            };

            await saveGenerationToDatabase(
              userId,
              responseData,
              promptText,
              referenceImages,
              settings,
              locationImage,
              poseImage,
              hairStyleImage,
              formattedRatio,
              initialResult.id,
              processingTime,
              isMultipleImages,
              isMultipleProducts
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

          // 💳 API başarılı olduktan sonra güncel kredi bilgisini al
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
            referenceImages,
            settings,
            locationImage,
            poseImage,
            hairStyleImage,
            formattedRatio,
            initialResult.id,
            processingTime,
            isMultipleImages,
            isMultipleProducts
          );

          return res.status(200).json(responseData);
        }
      } else {
        console.error("Replicate API başarısız:", finalResult);

        // Kredi iade et
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
              `💰 ${CREDIT_COST} kredi iade edildi (Replicate hatası)`
            );
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
    }

    // Orijinal V2 formatı - tek resim işlemi
    if (
      !promptText ||
      !referenceImages ||
      !Array.isArray(referenceImages) ||
      referenceImages.length < 1
    ) {
      return res.status(400).json({
        success: false,
        result: {
          message:
            "Geçerli bir promptText ve en az 1 referenceImage sağlanmalıdır.",
        },
      });
    }

    console.log(
      "🚀 [BACKEND V2] Orijinal V2 formatı kullanılarak işlem yapılıyor..."
    );

    // V2 formatı için kredi kontrolü
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

    console.log("🎛️ [BACKEND V2] Gelen settings parametresi:", settings);
    console.log("📝 [BACKEND V2] Gelen promptText:", promptText);
    console.log("🏞️ [BACKEND V2] Gelen locationImage:", locationImage);
    console.log("🤸 [BACKEND V2] Gelen poseImage:", poseImage);
    console.log("💇 [BACKEND V2] Gelen hairStyleImage:", hairStyleImage);

    let finalImage;

    // Çoklu resim varsa birleştir, yoksa tek resmi kullan
    if (isMultipleImages && referenceImages.length > 1) {
      console.log(
        "🖼️ [BACKEND V2] Çoklu resim birleştirme işlemi başlatılıyor..."
      );
      finalImage = await combineImagesOnCanvas(
        referenceImages,
        userId,
        isMultipleProducts
      );
    } else {
      // Tek resim için normal işlem
      const referenceImage = referenceImages[0];

      if (!referenceImage) {
        return res.status(400).json({
          success: false,
          result: {
            message: "Referans görseli gereklidir.",
          },
        });
      }

      console.log("Referans görseli:", referenceImage.uri);
      console.log(
        "🔍 [DEBUG] Reference Image Object:",
        JSON.stringify(referenceImage, null, 2)
      );
      console.log("🔍 [DEBUG] Base64 data var mı?", !!referenceImage.base64);
      console.log(
        "🔍 [DEBUG] Base64 data uzunluğu:",
        referenceImage.base64 ? referenceImage.base64.length : "yok"
      );

      // Referans resmini önce Supabase'e yükle ve URL al
      let imageSourceForUpload;

      // Eğer base64 data varsa onu kullan, yoksa URI'yi kullan
      if (referenceImage.base64) {
        imageSourceForUpload = `data:image/jpeg;base64,${referenceImage.base64}`;
        console.log("Base64 data kullanılıyor Supabase upload için");
      } else if (
        referenceImage.uri.startsWith("http://") ||
        referenceImage.uri.startsWith("https://")
      ) {
        imageSourceForUpload = referenceImage.uri;
        console.log(
          "HTTP URI kullanılıyor Supabase upload için:",
          imageSourceForUpload
        );
      } else {
        // file:// protokolü için frontend'de base64 dönüştürme zorunlu
        return res.status(400).json({
          success: false,
          result: {
            message: "Yerel dosya için base64 data gönderilmelidir.",
          },
        });
      }

      finalImage = await uploadReferenceImageToSupabase(
        imageSourceForUpload,
        userId
      );
    }

    console.log("Supabase'den alınan final resim URL'si:", finalImage);

    // Aspect ratio'yu formatla
    const formattedRatio = formatAspectRatio(ratio || "9:16");
    console.log(
      `İstenen ratio: ${ratio}, formatlanmış ratio: ${formattedRatio}`
    );

    // Kullanıcının prompt'unu Gemini ile iyileştir
    const enhancedPrompt = await enhancePromptWithGemini(
      promptText,
      finalImage,
      settings || {},
      locationImage,
      poseImage,
      hairStyleImage,
      isMultipleProducts
    );

    console.log("📝 [BACKEND V2] Original prompt:", promptText);
    console.log("✨ [BACKEND V2] Enhanced prompt:", enhancedPrompt);

    // Replicate API'ye istek gönder
    const replicateResponse = await axios.post(
      "https://api.replicate.com/v1/models/black-forest-labs/flux-kontext-pro/predictions",
      {
        input: {
          prompt: enhancedPrompt,
          input_image: finalImage,
          aspect_ratio: formattedRatio,
        },
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.REPLICATE_API_TOKEN}`,
          "Content-Type": "application/json",
        },
      }
    );

    const initialResult = replicateResponse.data;
    console.log("Replicate API başlangıç yanıtı:", initialResult);

    if (!initialResult.id) {
      console.error("Replicate prediction ID alınamadı:", initialResult);

      // Kredi iade et
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
    const startTime = Date.now();
    const finalResult = await pollReplicateResult(initialResult.id);
    const processingTime = Math.round((Date.now() - startTime) / 1000);

    console.log("Replicate final result:", finalResult);

    if (finalResult.status === "succeeded" && finalResult.output) {
      console.log("Replicate API işlemi başarılı");

      // 💳 API başarılı olduktan sonra güncel kredi bilgisini al
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

      const responseData = {
        success: true,
        result: {
          imageUrl: finalResult.output,
          originalPrompt: promptText,
          enhancedPrompt: enhancedPrompt,
          replicateData: finalResult,
          currentCredit: currentCredit, // 💳 Güncel kredi bilgisini response'a ekle
        },
      };

      await saveGenerationToDatabase(
        userId,
        responseData,
        promptText,
        referenceImages,
        settings,
        locationImage,
        poseImage,
        hairStyleImage,
        formattedRatio,
        initialResult.id,
        processingTime,
        isMultipleImages,
        isMultipleProducts
      );

      return res.status(200).json(responseData);
    } else {
      console.error("Replicate API başarısız:", finalResult);

      // Kredi iade et
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

    // Kredi iade et
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

    // Sensitive content hatasını özel olarak handle et
    if (error.message && error.message.startsWith("SENSITIVE_CONTENT:")) {
      const cleanMessage = error.message.replace("SENSITIVE_CONTENT: ", "");
      return res.status(400).json({
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

// Kullanıcının reference browser sonuçlarını getiren endpoint
router.get("/results/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    const { page = 1, limit = 20 } = req.query;

    if (!userId) {
      return res.status(400).json({
        success: false,
        result: {
          message: "User ID gereklidir",
        },
      });
    }

    const offset = (page - 1) * limit;

    // Kullanıcının sonuçlarını getir (en yeni önce)
    const { data: results, error } = await supabase
      .from("reference_results")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      console.error("❌ Sonuçları getirme hatası:", error);
      return res.status(500).json({
        success: false,
        result: {
          message: "Sonuçları getirirken hata oluştu",
          error: error.message,
        },
      });
    }

    // Toplam sayıyı getir
    const { count, error: countError } = await supabase
      .from("reference_results")
      .select("*", { count: "exact", head: true })
      .eq("user_id", userId);

    if (countError) {
      console.error("❌ Toplam sayı getirme hatası:", countError);
    }

    return res.status(200).json({
      success: true,
      result: {
        data: results || [],
        total: count || 0,
        page: parseInt(page),
        limit: parseInt(limit),
        hasMore: offset + limit < (count || 0),
      },
    });
  } catch (error) {
    console.error("❌ Reference browser results endpoint hatası:", error);
    return res.status(500).json({
      success: false,
      result: {
        message: "Sonuçları getirirken hata oluştu",
        error: error.message,
      },
    });
  }
});

// Tüm reference browser sonuçlarını getiren endpoint (admin için)
router.get("/results", async (req, res) => {
  try {
    const { page = 1, limit = 50, userId } = req.query;

    const offset = (page - 1) * limit;

    let query = supabase
      .from("reference_results")
      .select("*")
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    // Eğer userId filter'ı varsa ekle
    if (userId) {
      query = query.eq("user_id", userId);
    }

    const { data: results, error } = await query;

    if (error) {
      console.error("❌ Tüm sonuçları getirme hatası:", error);
      return res.status(500).json({
        success: false,
        result: {
          message: "Sonuçları getirirken hata oluştu",
          error: error.message,
        },
      });
    }

    // Toplam sayıyı getir
    let countQuery = supabase
      .from("reference_results")
      .select("*", { count: "exact", head: true });

    if (userId) {
      countQuery = countQuery.eq("user_id", userId);
    }

    const { count, error: countError } = await countQuery;

    if (countError) {
      console.error("❌ Toplam sayı getirme hatası:", countError);
    }

    return res.status(200).json({
      success: true,
      result: {
        data: results || [],
        total: count || 0,
        page: parseInt(page),
        limit: parseInt(limit),
        hasMore: offset + limit < (count || 0),
      },
    });
  } catch (error) {
    console.error("❌ All reference browser results endpoint hatası:", error);
    return res.status(500).json({
      success: false,
      result: {
        message: "Sonuçları getirirken hata oluştu",
        error: error.message,
      },
    });
  }
});

// Kullanıcının mevcut kredisini getiren endpoint
router.get("/credit/:userId", async (req, res) => {
  try {
    const { userId } = req.params;

    // Anonim kullanıcı kontrolü (hem "anonymous_user" hem de "anon_" ile başlayanlar)
    if (!userId || userId === "anonymous_user" || userId.startsWith("anon_")) {
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
