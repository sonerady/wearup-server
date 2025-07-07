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

    // Gemini'ye gönderilecek metin
    let promptForGemini = `
    Create a detailed, professional fashion photography description based on this original user input: "${originalPrompt}"
    
    ${settingsPromptSection}
    
    ${backgroundPromptSection}
    
    You are looking at a combined image showing:
    - LEFT SIDE: A person with specific body type, pose, and physical characteristics
    - RIGHT SIDE: Fashion clothing/accessories/products that should be styled on the person
    
    🚨 CRITICAL REPLACEMENT INSTRUCTION 🚨:
    - COMPLETELY IGNORE AND DO NOT MENTION ANY CLOTHING that the LEFT person is currently wearing
    - The LEFT person's existing clothes/outfits MUST BE REPLACED with the RIGHT side products
    - ONLY describe the person's body, pose, facial features, and physical characteristics from the LEFT side
    - NEVER describe or reference the original clothing on the LEFT person
    - The RIGHT side products will REPLACE whatever the LEFT person is wearing
    
    🎯 REPLACEMENT TASK: Create a comprehensive fashion photography description where the person from the LEFT is wearing ONLY the clothing/products from the RIGHT side, completely replacing their original outfit.
    
    CORE REQUIREMENTS:
    1. PERSON CHARACTERISTICS: Describe the person from the LEFT side - their body type, height, build, posture, pose, and facial features (🚨 ABSOLUTELY IGNORE THEIR CURRENT CLOTHING 🚨)
    2. REPLACEMENT CLOTHING DETAILS: Describe in EXTREME DETAIL ONLY the clothing/products from the RIGHT side that will REPLACE the original outfit:
       - Exact colors, patterns, textures, fabrics, materials
       - Specific cuts, silhouettes, design elements
       - Unique features, embellishments, details, finishes
       - How each garment fits and drapes on this specific person's body
       - Material characteristics (matte, glossy, textured, smooth, etc.)
    3. REPLACEMENT STYLING: Show how the RIGHT side products look when they REPLACE the original outfit on the LEFT side person
    4. COMPLETE OUTFIT REPLACEMENT: Create a seamless look where all clothing items from the RIGHT side completely replace the original clothing and work together harmoniously
    
    DETAILED PRODUCT ANALYSIS REQUIRED (REPLACEMENT FOCUS):
    - Analyze EVERY visible clothing item and accessory from the RIGHT side ONLY - these will REPLACE the original outfit
    - 🚨 STRICTLY FORBIDDEN: DO NOT mention, describe, or reference ANY clothing visible on the LEFT side person 🚨
    - Describe fabric textures, weaves, finishes in detail for the REPLACEMENT clothing
    - Mention specific design elements of REPLACEMENT items: buttons, zippers, seams, cuts, patterns
    - Describe how each REPLACEMENT piece fits this particular body type and height
    - Include color descriptions with nuances and undertones for the NEW outfit
    - Mention any logos, prints, or decorative elements on the REPLACEMENT clothing (but avoid brand names)
    - Describe the overall style aesthetic and fashion category of the COMPLETE NEW OUTFIT
    
    BODY & STYLING INTEGRATION (REPLACEMENT OUTCOME):
    - How the RIGHT side REPLACEMENT clothing complements the person's body proportions
    - How the NEW outfit's fit enhances their natural silhouette
    - How the REPLACEMENT clothing colors work with their overall appearance
    - How the NEW style matches their pose and attitude
    - The transformation from original outfit to the NEW REPLACEMENT outfit
    
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
    
    OUTPUT FORMAT:
    Create a single, flowing fashion photography description that reads like a professional editorial caption. Describe the COMPLETE REPLACEMENT OUTFIT as if you're writing for a high-end fashion magazine${
      !hasLocation
        ? ", including the beautiful setting and lighting that creates the perfect fashion photography atmosphere"
        : ""
    }${
      hasValidSettings
        ? ". Naturally incorporate the user's style preferences into the description"
        : ""
    }.
    
    🚨 FINAL REMINDER: The description should show the person wearing ONLY the RIGHT side products, completely replacing their original clothing. This should read like a beautiful, detailed fashion photography description of the NEW OUTFIT, not the original clothing or a technical process explanation.
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

// Face-swap işlemini retry mekanizması ile yapan fonksiyon
async function performFaceSwapWithRetry(
  faceImageUrl,
  fluxOutputUrl,
  userId,
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

    // Sadece model + product birleştir (hem Gemini hem Flux için)
    const combinedImageUrl = await combineModelAndProduct(
      modelImage.uri,
      productImage.uri
    );

    console.log(
      "Model + Product birleştirilmiş görsel URL'si:",
      combinedImageUrl
    );

    // Aspect ratio'yu formatla
    const formattedRatio = formatAspectRatio(ratio || "9:16");
    console.log(
      `İstenen ratio: ${ratio}, formatlanmış ratio: ${formattedRatio}`
    );

    // Kullanıcının prompt'unu Gemini ile iyileştir (3 görsel birleşimini kullan)
    const enhancedPrompt = await enhancePromptWithGemini(
      promptText,
      combinedImageUrl,
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
            input_image: combinedImageUrl, // Face olmadan sadece model + product
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
          fluxOutputUrl,
          userId
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
