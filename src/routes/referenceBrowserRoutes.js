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
  faceImageUrl,
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
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

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

    let settingsPromptSection = "";

    if (hasValidSettings) {
      console.log(
        "🎛️ [BACKEND GEMINI] Detaylı settings prompt oluşturuluyor..."
      );

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

        console.log(
          "📝 [BACKEND GEMINI] Settings descriptions hazırlandı:",
          settingsDescriptions
        );
      } else {
        console.log("⚠️ [BACKEND GEMINI] Hiçbir geçerli setting bulunamadı");
      }
    }

    // Background/location prompt section - sadece location settings yoksa ekle
    let backgroundPromptSection = "";

    if (!hasLocation) {
      backgroundPromptSection = `
    
    CREATIVE BACKGROUND REQUIREMENTS (No location specified by user):
    6. CREATE a beautiful, creative background that perfectly complements the clothing style and fashion aesthetic
    7. CHOOSE between indoor or outdoor settings based on what works best with the outfit:
       - For casual/sporty outfits: outdoor settings like parks, streets, beaches, cafes
       - For formal/elegant outfits: indoor settings like studios, galleries, upscale interiors
       - For trendy/fashion outfits: modern urban settings, stylish interiors, artistic spaces
    8. FOCUS on perfect lighting that enhances both the clothing and the model:
       - Natural daylight for outdoor scenes
       - Professional studio lighting for indoor scenes
       - Golden hour lighting for romantic/elegant looks
       - Modern architectural lighting for contemporary styles
    9. MAKE the background atmospheric and mood-appropriate:
       - Colors should complement the clothing colors
       - The setting should enhance the overall fashion narrative
       - Avoid distracting elements that take focus away from the outfit
    10. BE CREATIVE - choose unique, visually striking backgrounds that make the photo editorial-quality
    11. ENSURE the lighting, atmosphere, and setting create a cohesive, professional fashion photography look`;
    } else {
      backgroundPromptSection = `
    
    BACKGROUND NOTE (User specified location settings):
    6. USER HAS SPECIFIED LOCATION: "${settings.location}" - Use this location for the background
    7. Focus on making the specified location look professional and photogenic
    8. Ensure lighting and atmosphere match the location and complement the overall look`;
    }

    // Gemini'ye gönderilecek metin (Gen4 Image formatında)
    let promptForGemini = `
    Create a detailed Gen4 Image model prompt based on this original user input: "${originalPrompt}"
    
    ${settingsPromptSection}
    
    ${backgroundPromptSection}
    
    🎯 GEN4 IMAGE MODEL REQUIREMENTS:
    You will create a prompt for the Gen4 Image model that uses reference tags and images.
    
    REFERENCE SYSTEM:
    - @TUK = The face/head (from the first reference image)
    - @TAK = The model/body (from the second reference image)
    - @TOK = The clothing/product (from the third reference image)
    
    🚨 CRITICAL INSTRUCTIONS FOR GEN4 IMAGE 🚨:
    - Use @TUK to reference the face/head features
    - Use @TAK to reference the person's body type, pose, and physical characteristics
    - Use @TOK to reference the clothing/product that will be worn
    - Create a prompt that shows @TUK's face on @TAK's body wearing @TOK
    - NEVER describe the original clothing on @TAK
    - Focus on combining @TUK face + @TAK body + @TOK clothing
    
    🎯 PROMPT STRUCTURE: Create a detailed sentence using @TUK, @TAK and @TOK tags with clothing descriptions.
    
    CORE REQUIREMENTS FOR GEN4 IMAGE:
    1. USE @TUK for the face/head
    2. USE @TAK for the body/pose
    3. USE @TOK for the clothing with detailed descriptions
    4. Include clothing details, colors, textures, style
    5. Maximum 1000 characters
    
    EXAMPLE FORMAT:
    "@TUK face on @TAK body wearing @TOK (detailed clothing description with colors, style, materials), portrait style with natural lighting in appropriate setting"
    
    DETAILED GUIDELINES:
    - Keep it under 1000 characters
    - Use @TUK, @TAK and @TOK tags
    - Describe the clothing in detail (colors, style, material, cut)
    - Include scene, lighting, and mood details
    - Make it fashion-focused and descriptive
    
            DETAILED CLOTHING ANALYSIS REQUIRED:
    - Analyze and describe the clothing from @TOK in detail
    - Include colors, patterns, textures, fabric types
    - Mention design elements: buttons, zippers, cuts, silhouettes
    - Describe style category (casual, formal, trendy, etc.)
    - Note any unique features or embellishments
    
    ADDITIONAL SCENE DETAILS FOR GEN4 IMAGE:
    - Include specific lighting descriptions (natural, studio, golden hour, etc.)
    - Add camera angle/perspective details (close-up, full body, portrait, etc.)
    - Mention background/setting that complements the style
    - Include mood and atmosphere descriptions
    - Add any relevant props or environmental elements
    
    SETTINGS INTEGRATION:
    - Incorporate user settings naturally into the prompt
    - Use location settings for background details
    - Use mood settings for expression and atmosphere
    - Use color settings for styling choices
    
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
    Create a single, detailed sentence that uses @TUK, @TAK and @TOK tags to describe the scene. Write it as if you're describing a professional photo shoot${
      !hasLocation ? ", including the beautiful setting and lighting" : ""
    }${
      hasValidSettings
        ? ". Naturally incorporate the user's style preferences"
        : ""
    }.
    
    🚨 CRITICAL REQUIREMENT: The prompt MUST be under 1000 characters total. Include detailed clothing descriptions.
    
    🚨 FINAL REMINDER: Output should be a single, DETAILED Gen4 Image prompt sentence using @TUK (face), @TAK (body) and @TOK (clothing with details) tags. Maximum 1000 characters!
    `;

    console.log("Gemini'ye gönderilen istek:", promptForGemini);

    // Resim verilerini içerecek parts dizisini hazırla
    const parts = [{ text: promptForGemini }];

    // Face, Model ve Product görsellerini ayrı ayrı Gemini'ye gönder
    try {
      console.log(`Face görseli (TUK) Gemini'ye gönderiliyor: ${faceImageUrl}`);
      console.log(
        `Model görseli (TAK) Gemini'ye gönderiliyor: ${modelImageUrl}`
      );
      console.log(
        `Product görseli (TOK) Gemini'ye gönderiliyor: ${productImageUrl}`
      );

      // Face görselini indir ve ekle
      const faceResponse = await got(faceImageUrl, {
        responseType: "buffer",
      });
      const faceBuffer = faceResponse.body;
      const base64FaceImage = faceBuffer.toString("base64");

      parts.push({
        inlineData: {
          mimeType: "image/jpeg",
          data: base64FaceImage,
        },
      });

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

      console.log(
        "Face, Model ve Product görselleri başarıyla Gemini'ye yüklendi"
      );
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

    if (enhancedPrompt.length > 1000) {
      console.warn(
        "⚠️ [BACKEND GEMINI] PROMPT 1000 KARAKTERİ AŞIYOR! Kısaltılması gerekiyor."
      );
      // Prompt'u kısalt
      const shortPrompt = enhancedPrompt.substring(0, 997) + "...";
      console.log("✂️ [BACKEND GEMINI] Kısaltılmış prompt:", shortPrompt);
      return shortPrompt;
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

    // Resimleri birleştirmek yerine ayrı ayrı kullan
    console.log("Face görseli (TUK):", faceImage.uri);
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
      faceImage.uri,
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
      reference_tags: ["TUK", "TAK", "TOK"],
      reference_images: [faceImage.uri, modelImage.uri, productImage.uri],
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
              reference_tags: ["TUK", "TAK", "TOK"],
              reference_images: [
                faceImage.uri,
                modelImage.uri,
                productImage.uri,
              ],
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
