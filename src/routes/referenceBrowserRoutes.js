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

     GOOGLE NANO BANANA DETAILED PROMPT CREATION:
    
    You are generating a detailed, comprehensive prompt for Google Nano Banana image generation model. NO TOKEN LIMITS - be as detailed as possible!
    
    🎯 PROMPT STRUCTURE (NATURAL DESCRIPTIVE LANGUAGE):
    - Write a flowing, natural description in conversational English
    - NO special syntax, tags, or rigid structures required
    - Focus on rich, detailed descriptions of clothing and styling
    - Include comprehensive details about ALL products visible in the product image
    
    📝 DETAILED PRODUCT DESCRIPTION REQUIREMENTS:
    - MANDATORY: Describe EVERY SINGLE ITEM visible in the product image
    - If multiple products shown: Detail each item individually AND how they work together
    - Include specific details: colors, patterns, textures, fabric types, cuts, fits, styling elements
    - Mention construction details: buttons, zippers, seams, hemlines, necklines, sleeves
    - Describe how fabrics drape, move, catch light, and their visual/tactile qualities
    - Include styling context: occasion appropriateness, seasonal suitability, fashion category
    
    🎨 COMPREHENSIVE STYLING INTEGRATION:
    - MANDATORY: Incorporate ALL user settings into detailed descriptions
    - Expand location/environment settings into atmospheric scene descriptions
    - Apply weather/season settings for appropriate styling and ambiance
    - Include detailed physical characteristics (age, gender, ethnicity, skin tone, body shape)
    - Specify hair settings (style and color) with detailed descriptions
    - Apply mood and pose settings for expression and body language
    - Integrate camera perspective and lighting preferences
    - Include accessories as complementary styling elements
    - Apply product color modifications with detailed color descriptions
    - Weave in additional custom details naturally throughout the description

    LANGUAGE AND STYLE REQUIREMENTS:
    - Write in sophisticated, editorial fashion language
    - Use rich, descriptive vocabulary that paints a vivid picture
    - Translate any non-English terms to English
    - Focus on craftsmanship, quality, and styling excellence
    - Create a cohesive narrative that flows naturally
    - NO length restrictions - be comprehensively detailed`;

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
    - ANALYZE the clothing/products from the second image and SELECT an appropriate, beautiful location that complements the style
    - CHOOSE a background setting that enhances and showcases the clothing perfectly
    - CONSIDER the style, formality, and occasion of the clothing when selecting the location
    - CREATE a cinematic, professional background that makes the outfit look stunning
    - Examples: 
      * Casual outfit → Modern urban street, cozy café, park setting
      * Formal wear → Elegant hotel lobby, sophisticated restaurant, upscale venue
      * Sporty clothes → Modern gym, outdoor athletic setting, contemporary fitness space
      * Evening wear → Luxury lounge, elegant ballroom, sophisticated nighttime setting
    - DESCRIBE the chosen location in rich, atmospheric detail with professional lighting
    - ENSURE the background complements rather than competes with the clothing`;
    } else {
      backgroundPromptSection = `
    
    BACKGROUND NOTE (User specified location settings):
    - USER HAS SPECIFIED LOCATION: "${settings.location}" - EXPAND this into a detailed, atmospheric description
    - DON'T just write "${settings.location}" - describe the environment in cinematic detail
    - Example: "desert_sunset" → "breathtaking desert landscape during golden sunset hour with warm orange and pink hues painting the sky, sand dunes creating dramatic shadows, and soft golden light"
    - Focus on making the specified location look professional, photogenic, and visually rich
    - Ensure lighting and atmosphere match the location and complement the overall look
    - Use descriptive, evocative language to bring the location to life`;
    }

    // Gemini'ye gönderilecek metin (Google Nano Banana formatında)
    let promptForGemini = `
    🚨🚨 CRITICAL WARNING: THE MODEL IS WEARING CLOTHING BUT YOU MUST IGNORE IT COMPLETELY! 🚨🚨
    
    Create a detailed Google Nano Banana model prompt based on this original user input: "${originalPrompt}"
    
    ⚠️ IMPORTANT: You will see two images:
    1. A MODEL image wearing some outfit - COMPLETELY IGNORE what they're wearing
    2. A PRODUCT image - This is the NEW clothing you must describe in detail
    
    🚫 FORBIDDEN: Describing ANY clothing visible on the model
    ✅ REQUIRED: Describing ONLY the product clothing
    
    ${settingsPromptSection}
    
    ${backgroundPromptSection}
    
    🎯 GOOGLE NANO BANANA MODEL REQUIREMENTS:
    You will create a comprehensive, detailed prompt for the Google Nano Banana model using reference images.
    
                REFERENCE SYSTEM:
      - FIRST IMAGE = The model/person - PERSON/POSE REFERENCE ONLY - IGNORE ALL CLOTHING ON THIS MODEL
      - SECOND IMAGE = The clothing/product - THIS IS THE NEW CLOTHING TO BE DESCRIBED IN DETAIL
      
      🚨🚨 CRITICAL INSTRUCTIONS FOR NANO BANANA 🚨🚨:
      
      ⚠️ EXTREMELY IMPORTANT: THE MODEL IS WEARING SOME CLOTHING BUT YOU MUST COMPLETELY IGNORE IT!
      
      - FIRST IMAGE: Shows a person - USE ONLY for body type, pose, and stance
      - SECOND IMAGE: Shows the NEW clothing/product that you MUST describe in comprehensive detail
      - The model's current outfit is IRRELEVANT and must NOT be mentioned
      - 🚫 NEVER describe any clothing visible on the model in the first image
      - 🚫 NEVER mention the model's existing outfit, regardless of what it looks like
      - ✅ ONLY describe the product clothing from the second image in extensive detail
      - ✅ Focus: person/pose from first image wearing new product(s) from second image
    
        🎯 PROMPT STRUCTURE: Create a COMPREHENSIVE, DETAILED natural description with NO length restrictions.
    
          CORE REQUIREMENTS FOR NANO BANANA:
      1. Use the FIRST image for the person/pose reference only
      2. Use the SECOND image for the NEW clothing to be described in full detail
      3. NO LENGTH LIMITS - be as detailed and comprehensive as possible!
      4. NEVER describe model's current clothing - only reference person/pose
      5. EXPAND ALL SETTINGS INTO DETAILED DESCRIPTIONS (don't just copy keywords)
      6. Write naturally flowing, editorial-style descriptions
      7. NO special tags - use natural, conversational language
    
          EXAMPLE FORMAT:
      "A [person description from first image] wearing [COMPREHENSIVE, DETAILED description of ALL new clothing from second image including specific colors, materials, textures, cuts, styles, design elements, and construction details], photographed in [detailed lighting and setting description]"
    
          COMPREHENSIVE EXAMPLE (NO LENGTH RESTRICTIONS):
      "A confident woman with elegant posture wearing a luxurious cream-colored cashmere blend sweater featuring an intricate diamond-pattern cable knit construction with subtle texture variations, showcasing an oversized relaxed fit with dramatically dropped shoulders, ribbed crew neckline with contrast edging detail, and three-quarter length sleeves with rolled cuffs, paired seamlessly with high-waisted navy blue tailored wool trousers featuring a sophisticated wide-leg silhouette with pressed creases, hidden side zip closure, and subtle pinstripe pattern woven throughout the fabric, complemented by a soft blush pink leather structured handbag with polished gold hardware and adjustable chain strap, delicate 14k gold geometric bracelet, and white canvas sneakers with premium leather trim and rubber soles, creating a perfectly balanced ensemble that combines casual comfort with refined urban sophistication, captured in soft natural lighting during golden hour with warm amber tones filtering through the scene, creating gentle shadows and highlighting the rich textures of each garment while maintaining a sophisticated editorial atmosphere"
    
          MULTIPLE PRODUCTS EXAMPLE (COMPREHENSIVE DETAIL):
      "A stylish model wearing a coordinated ensemble featuring a soft coral striped knit sweater with cream and vibrant orange horizontal stripes in varying widths, ribbed crew neckline with reinforced stitching, relaxed oversized fit construction in premium cotton blend with subtle stretch, paired with high-waisted navy blue and white vertical pinstripe wide-leg trousers featuring classic tailored silhouette with flowing drape and elegant movement, complemented by essential accessories including delicate 14k gold charm bracelet with intricate geometric detailing, classic tortoiseshell acetate sunglasses with gradient amber lenses, soft blush pink leather structured handbag with polished gold hardware, and white canvas sneakers with leather trim - each item working harmoniously to create a cohesive spring-summer look that perfectly balances casual comfort with refined sophistication"
    
          🚨 WRONG EXAMPLE (WHAT NOT TO DO):
      "A woman wearing leopard print midi dress..." ← THIS IS WRONG! This describes model's current outfit, not the product
      
      🚨 CORRECT MINDSET:
      - If first image shows a woman in a leopard dress, IGNORE the leopard dress completely
      - If second image shows a pink sweater, describe ONLY the pink sweater in detail
      - Think: "person from first image wearing new product from second image"
      - Natural language without special tags
    
    CRITICAL CLOTHING ANALYSIS RULES:
    🚫 DO NOT describe any clothing currently on the model in the first image
    🚫 DO NOT mention model's existing outfit, dress, shirt, pants, etc.
    ✅ MANDATORY: DESCRIBE EVERY SINGLE ITEM visible in the product image in comprehensive detail
    ✅ If multiple products shown: Detail each item individually AND explain how they work together as a complete outfit
    ✅ Include extensive details: specific colors, intricate patterns, fabric textures, material composition
    ✅ Mention construction elements: buttons, zippers, seams, hemlines, necklines, sleeve details, closures
    ✅ Describe fit and silhouette: how garments drape, move, and complement the body
    ✅ Note styling elements: occasion appropriateness, seasonal context, fashion category, styling versatility
    ✅ Include unique features: embellishments, decorative elements, brand characteristics, special finishes
    ✅ Describe fabric qualities: how materials catch light, their weight, texture, and visual appeal
    ✅ For complete outfits: Explain how each piece complements others, color coordination, style harmony
    ✅ CRITICAL: If the product image shows multiple clothing items or accessories, you MUST describe each one in detail and explain how they create a cohesive styled look together
    
    ADDITIONAL SCENE DETAILS FOR NANO BANANA:
    - Include specific lighting descriptions (natural, studio, golden hour, etc.)
    - Add camera angle/perspective details (close-up, full body, portrait, etc.)
    - Mention background/setting that complements the style
    - Include mood and atmosphere descriptions
    - Add any relevant props or environmental elements
    
    SETTINGS INTEGRATION - EXPAND KEYWORDS INTO DETAILED DESCRIPTIONS:
    - DON'T just copy settings keywords (e.g. "desert_sunset") 
    - EXPAND settings into detailed, descriptive language
    - Location "desert_sunset" → "photographed in a breathtaking desert landscape during golden sunset hour"
    - Weather "snowy" → "captured in a winter wonderland with gentle snowflakes falling"
    - Mood "confident" → "with a confident, empowered expression"
    - Use available characters (400-500) efficiently by expanding key details
    - Make the prompt cinematic and visually rich but concise
    
    ${
      hasProductColor
        ? `
    IMPORTANT COLOR CUSTOMIZATION:
    - The user wants to modify the clothing color to: "${settings.productColor}"
    - Apply this color ONLY to the main garment/product from the second image
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
    
    OUTPUT FORMAT FOR NANO BANANA:
    Create a comprehensive, detailed natural description that captures every aspect of the styled look. Write it as if you're describing a professional fashion photo shoot for a high-end editorial magazine${
      !hasLocation
        ? ", keeping the original background from the model image but describing it in cinematic detail"
        : ""
    }${
      hasValidSettings
        ? ". EXPAND all user style preferences into detailed, atmospheric descriptions (don't just copy keywords)"
        : ""
    }. NO LENGTH RESTRICTIONS - be as detailed and comprehensive as possible to create a visually rich, cinematic prompt.
    
          🚨 CRITICAL REQUIREMENTS:
      - NO LENGTH LIMITS - write comprehensive, detailed descriptions
      - Natural language without special tags - use editorial fashion writing style
      - NEVER mention model's current clothing - only reference person/pose from first image
      - MANDATORY: EXTENSIVELY describe ALL product clothing from second image - materials, colors, textures, construction, fit, style, every detail
      - CRITICAL: DESCRIBE EVERY SINGLE ITEM visible in product image (if multiple items present, detail each one)
      - EXPAND ALL USER SETTINGS into detailed, cinematic descriptions (don't just copy keywords)
      - Include professional photography elements: lighting, setting, mood, composition, camera work
      - ${
        !hasLocation
          ? "SELECT and describe a beautiful, appropriate background location that complements the clothing style"
          : "EXPAND the location setting into a detailed, atmospheric description"
      }
      - Write flowing, sophisticated descriptions that paint a complete picture
      - ENSURE COMPLETE SENTENCES - finish thoughts properly, don't cut off mid-description
    
          🚨 FINAL REMINDER: Create a COMPREHENSIVE, DETAILED natural description of the person from first image wearing ALL new clothing from second image. NO LENGTH RESTRICTIONS - be as detailed as possible and EXPAND all settings into rich, descriptive language!
      
      🚨 CRITICAL COMPLETION REQUIREMENT:
      - Write COMPLETE, flowing descriptions that capture every detail
      - Do NOT cut off mid-sentence or mid-thought
      - FINISH all descriptions properly with complete thoughts
      - Write comprehensive, editorial-quality descriptions
      - End with complete photography/lighting/atmosphere descriptions
      - Example endings: "...captured with professional fashion photography techniques highlighting every fabric detail" or "...photographed in soft natural lighting that enhances the rich textures and sophisticated styling"
    
          🚨🚨 LAST CRITICAL CHECK BEFORE WRITING:
      - Look at the first image - ignore ALL clothing on this model, use only person/pose reference
      - Look at the second image - describe EVERY SINGLE ITEM visible in comprehensive detail
      - The model's outfit is NOT what you should describe
      - The product(s) from second image are what you MUST describe in full detail (if multiple items, describe each one extensively)
      - Natural language without special tags - use sophisticated editorial writing
      - For background: ${
        !hasLocation
          ? "select and describe a beautiful, appropriate location that complements the clothing style"
          : "use the specified location with detailed atmospheric description"
      }
      - Think: "person from first image wearing ALL NEW product(s) from second image in detailed background setting"
      - CRITICAL: If multiple clothing items/accessories shown in product image, describe each one and how they work together
      - Write complete, comprehensive descriptions - no length limits
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

    // Prompt uzunluk kontrolü kaldırıldı - Google Nano Banana için serbest uzunluk
    console.log(
      "📏 [BACKEND GEMINI] Google Nano Banana prompt uzunluğu:",
      enhancedPrompt.length
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
  const CREDIT_COST = 10; // Her oluşturma 20 kredi
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

    // Replicate API'ye istek gönder - Google Nano Banana modeli kullan
    console.log("🔧 Google Nano Banana API parametreleri:", {
      prompt: enhancedPrompt,
      prompt_length: enhancedPrompt.length,
      image_input: [modelImage.uri, productImage.uri],
      output_format: "jpg",
    });

    const replicateResponse = await got
      .post(
        "https://api.replicate.com/v1/models/google/nano-banana/predictions",
        {
          headers: {
            Authorization: `Bearer ${process.env.REPLICATE_API_TOKEN}`,
            "Content-Type": "application/json",
            Prefer: "wait",
          },
          json: {
            input: {
              prompt: enhancedPrompt,
              image_input: [modelImage.uri, productImage.uri],
              output_format: "jpg",
            },
          },
          responseType: "json",
        }
      )
      .catch((error) => {
        console.error(
          "❌ Google Nano Banana API detaylı hatası:",
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
