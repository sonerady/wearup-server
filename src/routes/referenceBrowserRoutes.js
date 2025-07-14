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

// Prompt'u iyileştirmek için Gemini'yi kullan (Gen4 Image formatında)
async function enhancePromptWithGemini(
  originalPrompt,
  modelImageUrl,
  productImageUrl,
  settings = {}
) {
  try {
    console.log("Gemini ile prompt iyileştirme başlatılıyor");
    console.log(
      "🎛️ [BACKEND GEMINI] Gelen settings detaylı:",
      JSON.stringify(settings, null, 2)
    );

    // Gemini modeli
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

    // Settings'in var olup olmadığını kontrol et
    const hasValidSettings =
      settings &&
      Object.entries(settings).some(
        ([key, value]) => value !== null && value !== undefined && value !== ""
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
    console.log("   - hasValidSettings:", hasValidSettings);
    console.log("   - hasLocation:", hasLocation, "value:", settings?.location);
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
    console.log("   - hasSkinTone:", hasSkinTone, "value:", settings?.skinTone);
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

    // String konversiyon fonksiyonu
    const convertToString = (value) => {
      if (value === null || value === undefined) return null;
      if (typeof value === "string") return value;
      if (typeof value === "object" && value.name) return value.name;
      if (typeof value === "object" && value.label) return value.label;
      if (typeof value === "object" && value.title) return value.title;
      if (typeof value === "object") return JSON.stringify(value);
      return String(value);
    };

    // Detay temizleme fonksiyonu - tekrarları kaldır
    const cleanDetails = (details) => {
      if (!details) return null;

      // String'e çevir
      let cleanedDetails =
        typeof details === "string" ? details : String(details);

      // Tekrarları kaldır (aynı cümle birden fazla kez yazılmışsa)
      const sentences = cleanedDetails
        .split(/[.\n]+/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      const uniqueSentences = [...new Set(sentences)];

      return uniqueSentences.join(". ");
    };

    let settingsPromptSection = "";

    if (hasValidSettings) {
      console.log(
        "🎛️ [BACKEND GEMINI] Detaylı settings prompt oluşturuluyor..."
      );

      const settingsDescriptions = [];

      // Location/Environment - object'i string'e çevir
      if (hasLocation) {
        const locationString = convertToString(settings.location);
        settingsDescriptions.push(`LOCATION/ENVIRONMENT: ${locationString}`);
        console.log("   ✅ Location eklendi (string):", locationString);
      }

      // Weather/Season - object'i string'e çevir
      if (hasWeather) {
        const weatherValue = convertToString(
          settings.season || settings.weather
        );
        settingsDescriptions.push(`WEATHER/SEASON: ${weatherValue}`);
        console.log("   ✅ Weather/Season eklendi (string):", weatherValue);
      }

      // Product Color - object'i string'e çevir
      if (hasProductColor) {
        const productColorString = convertToString(settings.productColor);
        settingsDescriptions.push(`PRODUCT COLOR: ${productColorString}`);
        console.log(
          "   ✅ Product Color eklendi (string):",
          productColorString
        );
      }

      // Demographics - object'leri string'e çevir
      if (hasAge) {
        const ageString = convertToString(settings.age);
        settingsDescriptions.push(`AGE: ${ageString}`);
        console.log("   ✅ Age eklendi (string):", ageString);
      }

      if (hasGender) {
        const genderString = convertToString(settings.gender);
        settingsDescriptions.push(`GENDER: ${genderString}`);
        console.log("   ✅ Gender eklendi (string):", genderString);
      }

      if (hasEthnicity) {
        const ethnicityString = convertToString(settings.ethnicity);
        settingsDescriptions.push(`ETHNICITY: ${ethnicityString}`);
        console.log("   ✅ Ethnicity eklendi (string):", ethnicityString);
      }

      // Physical Attributes - object'leri string'e çevir
      if (hasSkinTone) {
        const skinToneString = convertToString(settings.skinTone);
        settingsDescriptions.push(`SKIN TONE: ${skinToneString}`);
        console.log("   ✅ Skin Tone eklendi (string):", skinToneString);
      }

      if (hasBodyShape) {
        const bodyShapeString = convertToString(settings.bodyShape);
        settingsDescriptions.push(`BODY SHAPE: ${bodyShapeString}`);
        console.log("   ✅ Body Shape eklendi (string):", bodyShapeString);
      }

      // Hair - object'leri string'e çevir
      if (hasHairStyle) {
        const hairStyleString = convertToString(settings.hairStyle);
        settingsDescriptions.push(`HAIR STYLE: ${hairStyleString}`);
        console.log("   ✅ Hair Style eklendi (string):", hairStyleString);
      }

      if (hasHairColor) {
        const hairColorString = convertToString(settings.hairColor);
        settingsDescriptions.push(`HAIR COLOR: ${hairColorString}`);
        console.log("   ✅ Hair Color eklendi (string):", hairColorString);
      }

      // Style & Mood - object'i string'e çevir
      if (hasMood) {
        const moodString = convertToString(settings.mood);
        settingsDescriptions.push(`MOOD/EXPRESSION: ${moodString}`);
        console.log("   ✅ Mood eklendi (string):", moodString);
      }

      if (hasPerspective) {
        const perspectiveString = convertToString(settings.perspective);
        settingsDescriptions.push(`CAMERA PERSPECTIVE: ${perspectiveString}`);
        console.log("   ✅ Perspective eklendi (string):", perspectiveString);
      }

      if (hasPose) {
        const poseString = convertToString(settings.pose);
        settingsDescriptions.push(`POSE: ${poseString}`);
        console.log("   ✅ Pose eklendi (string):", poseString);
      }

      // Accessories - object'i string'e çevir
      if (hasAccessories) {
        const accessoriesString = convertToString(settings.accessories);
        settingsDescriptions.push(`ACCESSORIES: ${accessoriesString}`);
        console.log("   ✅ Accessories eklendi (string):", accessoriesString);
      }

      // Custom Details - tekrarları temizle
      if (hasDetails) {
        const cleanedDetailsText = cleanDetails(settings.details);
        if (cleanedDetailsText && cleanedDetailsText.trim() !== "") {
          settingsDescriptions.push(
            `ADDITIONAL DETAILS: ${cleanedDetailsText}`
          );
          console.log(
            "   ✅ Custom Details eklendi (temizlenmiş):",
            cleanedDetailsText
          );
        } else {
          console.log("   ⚠️ Custom Details boş veya geçersiz, atlanıyor");
        }
      }

      if (settingsDescriptions.length > 0) {
        settingsPromptSection = `
    USER SELECTED DETAILED SETTINGS:
    ${settingsDescriptions.join("\n    ")}

     FLUX KONTEXT PROMPT OPTIMIZATION (CRITICAL FOR BEST RESULTS):
    
    You are generating a prompt for FLUX Kontext, a surgical image editing model. Follow these MANDATORY guidelines:
    
    🔧 PROMPT STRUCTURE (EXACTLY 3 CLAUSES):
    1) [MAIN_ACTION] - Start with precise action verb (Replace) + specific target
    2) [PRESERVE] - "while keeping" + ALL elements that must remain unchanged
    3) [DETAILS] - Camera, lighting, style refinements, scene context
    
    📏 CRITICAL LIMITS:
    - MAXIMUM 512 tokens (Kontext will cut off longer prompts)
    - ONE flowing sentence with semicolons separating the 3 clauses
    - NO line breaks or multiple sentences
    
    🎯 ACTION VERBS (Use these proven high-impact verbs):
    - Change (for color, material, style modifications)
    - Transform (for style transfers)
    - Replace (for object substitution)
    - Add (for new elements)
    - Remove (for deletions)
    
    🛡️ PRESERVE CLAUSE (NEVER OMIT):
    Essential to prevent unwanted artifacts. Always include "while keeping" + specify:
    - Pose and body positioning
    - Facial features and expression
    - Background elements
    - Lighting conditions
    - All original garment details not being changed
    - Construction, fit, and proportions
    
    IMPORTANT INSTRUCTION: Generate ONLY a single, flowing FLUX Kontext prompt following the 3-clause structure. Do not include explanations, introductions, or commentary. The prompt should be surgical and specific, not descriptive scene creation.

    LANGUAGE NORMALIZATION RULES:
    - Translate every word and phrase that is not in English (e.g., colors, locations, garment descriptors) into English in the generated prompt. Example: convert "beyaz studio" to "white studio". The final prompt MUST be entirely in English.
    
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
    - Ensure all settings work harmoniously together for a cohesive look`;

        console.log("📝 [BACKEND GEMINI] Settings descriptions hazırlandı:");
        settingsDescriptions.forEach((desc, index) => {
          console.log(`   ${index + 1}. ${desc}`);
        });
        console.log(
          "📝 [BACKEND GEMINI] Toplam settings count:",
          settingsDescriptions.length
        );
      } else {
        console.log("⚠️ [BACKEND GEMINI] Hiçbir geçerli setting bulunamadı");
      }
    }

    // Background/location prompt section - sadece location settings yoksa ekle
    let backgroundPromptSection = "";

    if (!hasLocation) {
      backgroundPromptSection = `
    
    BACKGROUND REQUIREMENTS (No location specified by user):
    6. KEEP the original background from @TAK model image (preserve the existing setting)
    7. MAINTAIN the original lighting and atmosphere from @TAK model's environment
    8. DO NOT change the background setting, location, or environment
    9. FOCUS on preserving the original backdrop while enhancing the overall look
    10. The background should remain exactly as it appears in the @TAK reference image
    11. Only the clothing should change - background stays the same`;
    } else {
      backgroundPromptSection = `
    
    BACKGROUND NOTE (User specified location settings):
    6. USER HAS SPECIFIED LOCATION: "${settings.location}" - EXPAND this into a detailed, atmospheric description
    7. DON'T just write "${settings.location}" - describe the environment in cinematic detail
    8. Example: "desert_sunset" → "breathtaking desert landscape during golden sunset hour with warm orange and pink hues painting the sky, sand dunes creating dramatic shadows, and soft golden light"
    9. Focus on making the specified location look professional, photogenic, and visually rich
    10. Ensure lighting and atmosphere match the location and complement the overall look
    11. Use descriptive, evocative language to bring the location to life`;
    }

    // Gemini'ye gönderilecek metin (Gen4 Image formatında)
    let promptForGemini = `
    🚨🚨 CRITICAL WARNING: THE MODEL IS WEARING CLOTHING BUT YOU MUST IGNORE IT COMPLETELY! 🚨🚨
    
    Create a detailed Gen4 Image model prompt based on this original user input: "${originalPrompt}"
    
    ⚠️ IMPORTANT: You will see two images:
    1. A MODEL (@TAK) wearing some outfit - COMPLETELY IGNORE what they're wearing
    2. A PRODUCT (@TOK) - This is the NEW clothing you must describe in detail
    
    🚫 FORBIDDEN: Describing ANY clothing visible on the model
    ✅ REQUIRED: Describing ONLY the product clothing
    
    ${settingsPromptSection}
    
    ${backgroundPromptSection}
    
    🎯 GEN4 IMAGE MODEL REQUIREMENTS:
    You will create a prompt for the Gen4 Image model that uses reference tags and images.
    
                REFERENCE SYSTEM:
      - @TAK = The model/person (from the second reference image) - PERSON/POSE REFERENCE ONLY - IGNORE ALL CLOTHING ON THIS MODEL
      - @TOK = The clothing/product (from the third reference image) - THIS IS THE NEW CLOTHING TO BE DESCRIBED
      
      🚨🚨 CRITICAL INSTRUCTIONS FOR GEN4 IMAGE 🚨🚨:
      
      ⚠️ EXTREMELY IMPORTANT: THE @TAK MODEL IS WEARING SOME CLOTHING BUT YOU MUST COMPLETELY IGNORE IT!
      
      - @TAK IMAGE: Shows a person - USE ONLY for body type, pose, and stance
      - @TOK IMAGE: Shows the NEW clothing/product that you MUST describe in detail
      - The @TAK model's current outfit is IRRELEVANT and must NOT be mentioned
      - 🚫 NEVER describe leopard print, dresses, or any clothing visible on @TAK model
      - 🚫 NEVER mention the model's existing outfit, regardless of what it looks like
      - ✅ ONLY describe the @TOK product/clothing in extreme detail
      - ✅ The @TOK clothing is completely different from what @TAK is wearing
      - Focus: @TAK person/pose wearing @TOK new product (not current outfit)
    
        🎯 PROMPT STRUCTURE: Create a VERY detailed 950-1000 character sentence using @TAK and @TOK tags.
    
          CORE REQUIREMENTS FOR GEN4 IMAGE:
      1. USE @TAK for the person/pose reference (NOT "@TAK body" - just "@TAK")
      2. USE @TOK for the NEW clothing to be worn
      3. TARGET LENGTH: 950-1000 characters (MAXIMIZE the character limit!)
      4. NEVER describe @TAK's current clothing - only reference person/pose
      5. EXPAND ALL SETTINGS INTO DETAILED DESCRIPTIONS (don't just copy keywords)
      6. COMPLETE the sentence properly - don't cut off in the middle
    
          EXAMPLE FORMAT:
      "@TAK wearing @TOK [extensive detailed description of the new clothing including colors, materials, textures, cut, style, design elements, fit, silhouette, fabric details, construction, seasonal appropriateness, styling elements], photographed in [detailed lighting and setting description with mood, atmosphere, and professional photography style]"
    
          DETAILED EXAMPLE (Single Item - 950+ characters):
      "@TAK wearing @TOK luxurious cashmere blend sweater in soft dusty rose color with intricate cable-knit pattern featuring diamond-shaped motifs, showcasing a relaxed oversized fit with dramatically dropped shoulders, ribbed crew neckline with subtle contrast edging, and subtly textured knit construction that catches light beautifully with a lustrous sheen, paired with the sweater's premium wool blend offering exceptional drape and fluid movement, complemented by delicate mother-of-pearl buttons along the side seam with matching interior grosgrain tape, fine merino wool blend that provides both exceptional warmth and breathability with temperature-regulating properties, perfectly suited for transitional seasons with versatile styling options, photographed in a breathtaking golden hour outdoor setting with warm amber light filtering through towering trees, creating soft romantic shadows and depth, captured with professional fashion photography techniques using shallow depth of field and cinematic composition that emphasizes both the garment's luxurious texture and the model's natural elegance"
    
          DETAILED EXAMPLE (Multiple Items - 950+ characters):
      "@TAK wearing @TOK coordinated outfit ensemble featuring a soft coral striped knit sweater with cream and vibrant orange horizontal stripes in varying widths, ribbed crew neckline with reinforced stitching and relaxed oversized fit construction in premium cotton blend with subtle stretch, paired with high-waisted navy blue and white vertical pinstripe wide-leg trousers featuring classic tailored silhouette with flowing drape and elegant movement, complemented by delicate 14k gold charm bracelet with intricate geometric detailing and vintage-inspired elements, classic tortoiseshell acetate sunglasses with gradient amber lenses offering UV protection, soft blush pink leather structured handbag with polished gold hardware and adjustable chain strap, white canvas sneakers with leather trim and rubber soles, creating a cohesive spring-summer look that perfectly balances casual comfort with refined urban sophistication, photographed in a breathtaking desert landscape during golden sunset hour with warm orange and pink hues painting the dramatic sky, sand dunes creating elegant shadows, soft golden light illuminating the entire scene with cinematic warmth and natural beauty"
    
          🚨 WRONG EXAMPLE (WHAT NOT TO DO):
      "@TAK wearing @TOK leopard print midi dress..." ← THIS IS WRONG! This describes @TAK's current outfit, not @TOK product
      
      🚨 CORRECT MINDSET:
      - If @TAK shows a woman in a leopard dress, IGNORE the leopard dress completely
      - If @TOK shows a pink sweater, describe ONLY the pink sweater in detail
      - Think: "@TAK wearing @TOK [new product details]"
      - Use "@TAK" not "@TAK body" - @TAK already represents the person
    
    CRITICAL CLOTHING ANALYSIS RULES:
    🚫 DO NOT describe any clothing currently on @TAK model
    🚫 DO NOT mention @TAK's existing outfit, dress, shirt, pants, etc.
    ✅ ONLY describe the @TOK clothing in extreme detail
    ✅ DESCRIBE EVERY SINGLE ITEM visible in @TOK image (multiple products if present)
    ✅ If @TOK shows multiple items: describe each one with specific details
    ✅ Include: colors, patterns, textures, fabric types, weave, finish
    ✅ Mention: design elements, buttons, zippers, cuts, silhouettes, fit
    ✅ Describe: style category, seasonal use, occasion appropriateness
    ✅ Note: unique features, embellishments, construction details, drape
    ✅ Include: how the fabric moves, catches light, styling versatility
    ✅ For outfit combinations: describe how items work together as a cohesive look
    
    ADDITIONAL SCENE DETAILS FOR GEN4 IMAGE:
    - Include specific lighting descriptions (natural, studio, golden hour, etc.)
    - Add camera angle/perspective details (close-up, full body, portrait, etc.)
    - Mention background/setting that complements the style
    - Include mood and atmosphere descriptions
    - Add any relevant props or environmental elements
    
    SETTINGS INTEGRATION - EXPAND KEYWORDS INTO DETAILED DESCRIPTIONS:
    - DON'T just copy settings keywords (e.g. "desert_sunset") 
    - EXPAND settings into detailed, descriptive language
    - Location "desert_sunset" → "photographed in a breathtaking desert landscape during golden sunset hour with warm orange and pink hues painting the sky, sand dunes creating dramatic shadows, and soft golden light illuminating the scene"
    - Weather "snowy" → "captured in a winter wonderland with gentle snowflakes falling, creating a pristine white landscape with soft, diffused lighting and a serene atmosphere"
    - Mood "confident" → "with a confident, empowered expression and strong, assured body language that radiates self-assurance"
    - Use ALL available characters (950-1000) by expanding every detail
    - Make the prompt cinematic and visually rich
    
    ${
      hasProductColor
        ? `
    IMPORTANT COLOR CUSTOMIZATION:
    - The user wants to modify the clothing color to: "${settings.productColor}"
    - Apply this color ONLY to the main garment/product from the RIGHT side
    - Describe how this new color looks on the person
    - Ensure the color suits their overall appearance and styling
    `
        : ""
    }
    
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
    
    OUTPUT FORMAT FOR GEN4 IMAGE:
    Create a single, EXTENSIVELY detailed sentence (950-1000 characters) that uses @TAK and @TOK tags to describe the scene. Write it as if you're describing a professional fashion photo shoot${
      !hasLocation
        ? ", keeping the original background from @TAK model but describing it in cinematic detail"
        : ""
    }${
      hasValidSettings
        ? ". EXPAND all user style preferences into detailed, atmospheric descriptions (don't just copy keywords)"
        : ""
    }. USE EVERY AVAILABLE CHARACTER to create a visually rich, cinematic prompt.
    
          🚨 CRITICAL REQUIREMENTS:
      - TARGET LENGTH: 950-1000 characters (MAXIMIZE the character limit!)
      - Use "@TAK wearing @TOK" format (NOT "@TAK body wearing @TOK")
      - NEVER mention @TAK's current clothing - only person/pose reference
      - EXTENSIVELY describe @TOK clothing: materials, colors, textures, construction, fit, style, details
      - DESCRIBE EVERY SINGLE ITEM visible in @TOK image (if multiple items present)
      - EXPAND ALL USER SETTINGS into detailed, cinematic descriptions (don't just copy keywords)
      - Include professional photography elements: lighting, setting, mood, composition
      - ${
        !hasLocation
          ? "KEEP the original background from @TAK model unchanged but describe it in detail"
          : "EXPAND the location setting into a detailed, atmospheric description"
      }
      - USE EVERY AVAILABLE CHARACTER (950-1000) to create a visually rich, detailed prompt
      - COMPLETE the sentence properly - don't cut off mid-word or mid-phrase
    
          🚨 FINAL REMINDER: Output should be a single, EXTENSIVELY DETAILED Gen4 Image prompt sentence using @TAK (person reference only) and @TOK (new clothing with complete details) tags. Target 950-1000 characters and EXPAND all settings into detailed descriptions!
      
      🚨 CRITICAL COMPLETION REQUIREMENT:
      - The prompt MUST be a COMPLETE sentence that ends naturally
      - Do NOT cut off in the middle like "captured with professional fash..."
      - FINISH the sentence properly even if it means slightly fewer characters
      - Better to have 900 complete characters than 1000 incomplete ones
      - End with proper photography/lighting/atmosphere description
      - Example endings: "...captured with professional fashion photography techniques" or "...in soft natural lighting that enhances every detail"
    
          🚨🚨 LAST CRITICAL CHECK BEFORE WRITING:
      - Look at the first image (@TAK) - ignore ALL clothing on this model, use only person/pose reference
      - Look at the second image (@TOK) - describe EVERY SINGLE ITEM visible in detail
      - The @TAK model's outfit is NOT what you should describe
      - The @TOK product(s) are what you MUST describe (if multiple items, describe each one)
      - Use "@TAK wearing @TOK" format (NOT "@TAK body wearing @TOK")
      - For background: ${
        !hasLocation
          ? "keep the original background from @TAK unchanged"
          : "use the specified location"
      }
      - Think: "@TAK wearing NEW @TOK product(s) (not current outfit) in original/specified background"
      - FINISH the prompt as a complete sentence - don't cut off mid-word
    `;

    console.log(
      "🚨 [BACKEND GEMINI] UYARI: Model üstündeki kıyafet görmezden gelinecek!"
    );
    console.log(
      "🚨 [BACKEND GEMINI] UYARI: Product görselindeki HER ÜRÜN detaylı tanımlanacak!"
    );
    console.log(
      "🚨 [BACKEND GEMINI] UYARI: Orijinal arkaplan korunacak (location yoksa)!"
    );
    console.log("Gemini'ye gönderilen istek:", promptForGemini);

    // Resim verilerini içerecek parts dizisini hazırla
    const parts = [{ text: promptForGemini }];

    // Model ve Product görsellerini ayrı ayrı Gemini'ye gönder
    try {
      console.log(
        `🚨 Model görseli (TAK) - SADECE VÜCİT/POZ REFERANSI: ${modelImageUrl}`
      );
      console.log(
        `✅ Product görseli (TOK) - HER ÜRÜN DETAYLI TANIM GEREKLİ: ${productImageUrl}`
      );

      // Model görselini indir ve ekle
      const modelResponse = await got(modelImageUrl, {
        responseType: "buffer",
      });
      const modelBuffer = modelResponse.body;
      const base64ModelImage = modelBuffer.toString("base64");

      parts.push({
        inlineData: {
          mimeType: "image/jpeg",
          data: base64ModelImage,
        },
      });

      // Product görselini indir ve ekle
      const productResponse = await got(productImageUrl, {
        responseType: "buffer",
      });
      const productBuffer = productResponse.body;
      const base64ProductImage = productBuffer.toString("base64");

      parts.push({
        inlineData: {
          mimeType: "image/jpeg",
          data: base64ProductImage,
        },
      });

      console.log("Model ve Product görselleri başarıyla Gemini'ye yüklendi");
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
    console.log(
      "📏 [BACKEND GEMINI] Prompt karakter sayısı:",
      enhancedPrompt.length
    );

    // Prompt içeriğini kontrol et - model kıyafetini tanımlamış mı?
    if (
      enhancedPrompt.includes("leopard") ||
      enhancedPrompt.includes("midi-dress") ||
      enhancedPrompt.includes("dress")
    ) {
      console.error(
        "❌ [BACKEND GEMINI] HATA: Gemini model üstündeki kıyafeti tanımlamış!"
      );
      console.error(
        "❌ [BACKEND GEMINI] Bu yanlış! Sadece product görselindeki ÜRÜNLER tanımlanmalı!"
      );
    } else {
      console.log(
        "✅ [BACKEND GEMINI] Gemini model kıyafetini tanımlamamış, doğru!"
      );
    }

    // Prompt uzunluğunu kontrol et ve optimize et
    if (enhancedPrompt.length > 1000) {
      console.warn(
        "⚠️ [BACKEND GEMINI] PROMPT 1000 KARAKTERİ AŞIYOR! Kısaltılması gerekiyor."
      );
      // Prompt'u kısalt
      const shortPrompt = enhancedPrompt.substring(0, 997) + "...";
      console.log("✂️ [BACKEND GEMINI] Kısaltılmış prompt:", shortPrompt);
      return shortPrompt;
    } else if (enhancedPrompt.length < 800) {
      console.warn(
        "⚠️ [BACKEND GEMINI] PROMPT 800 KARAKTERİN ALTINDA! Çok kısa, daha detaylı olmalı."
      );
      console.log(
        "📏 [BACKEND GEMINI] Kısa prompt uzunluğu:",
        enhancedPrompt.length
      );
    } else {
      console.log(
        "✅ [BACKEND GEMINI] Prompt uzunluğu ideal aralıkta (800-1000 karakter)"
      );
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
          throw new Error(
            "SENSITIVE_CONTENT: Your content has been flagged as inappropriate. Please try again with a different image or settings."
          );
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
          throw new Error(`Content Moderation Error: ${result.error}`);
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

    console.log("🎛️ [BACKEND] Gelen settings parametresi:", settings);
    console.log("📝 [BACKEND] Gelen promptText:", promptText);

    // Model ve product görsellerini al (face'i atlıyoruz)
    const modelImage = referenceImages.find((img) => img.tag === "image_2");
    const productImage = referenceImages.find((img) => img.tag === "image_3");

    if (!modelImage || !productImage) {
      return res.status(400).json({
        success: false,
        result: {
          message:
            "Model görseli (image_2) ve ürün görseli (image_3) gereklidir.",
        },
      });
    }

    console.log("Model görseli:", modelImage.uri);
    console.log("Ürün görseli:", productImage.uri);

    // Resimleri birleştirmek yerine ayrı ayrı kullan

    console.log("Model görseli (TAK):", modelImage.uri);
    console.log("Product görseli (TOK):", productImage.uri);

    // Aspect ratio'yu formatla
    const formattedRatio = formatAspectRatio(ratio || "9:16");
    console.log(
      `İstenen ratio: ${ratio}, formatlanmış ratio: ${formattedRatio}`
    );

    // Kullanıcının prompt'unu Gemini ile iyileştir (Gen4 image formatında)
    const enhancedPrompt = await enhancePromptWithGemini(
      promptText,
      modelImage.uri,
      productImage.uri,
      settings || {}
    );

    console.log("📝 [BACKEND MAIN] Original prompt:", promptText);
    console.log("✨ [BACKEND MAIN] Enhanced prompt:", enhancedPrompt);

    // Replicate API'ye istek gönder - Gen4 Image modeli kullan
    console.log("🔧 Gen4 Image API parametreleri:", {
      prompt: enhancedPrompt,
      prompt_length: enhancedPrompt.length,
      aspect_ratio: formattedRatio,
      reference_tags: ["TAK", "TOK"],
      reference_images: [modelImage.uri, productImage.uri],
    });

    const replicateResponse = await got
      .post(
        "https://api.replicate.com/v1/models/runwayml/gen4-image/predictions",
        {
          headers: {
            Authorization: `Bearer ${process.env.REPLICATE_API_TOKEN}`,
            "Content-Type": "application/json",
            Prefer: "wait",
          },
          json: {
            input: {
              prompt: enhancedPrompt,
              aspect_ratio: formattedRatio,
              reference_tags: ["TAK", "TOK"],
              reference_images: [modelImage.uri, productImage.uri],
            },
          },
          responseType: "json",
        }
      )
      .catch((error) => {
        console.error(
          "❌ Gen4 Image API detaylı hatası:",
          error.response?.body || error.message
        );
        console.error("❌ Error status:", error.response?.statusCode);
        console.error("❌ Error headers:", error.response?.headers);
        throw error;
      });

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

      // Direkt sonucu client'e gönder
      const responseData = {
        success: true,
        result: {
          imageUrl: finalResult.output,
          originalPrompt: promptText,
          enhancedPrompt: enhancedPrompt,
          replicateData: finalResult,
          currentCredit: currentCredit,
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
