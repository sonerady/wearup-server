const express = require("express");
const router = express.Router();
const supabase = require("../supabaseClient");
const multer = require("multer");
const upload = multer();
const axios = require("axios");
const dotenv = require("dotenv");
const path = require("path");
const fs = require("fs");
const FormData = require("form-data");

// .env dosyasını yükle
dotenv.config();

// PhotoRoom API anahtarını al
const PHOTOROOM_API_KEY = process.env.PHOTOROOM_API_KEY;

// Replicate URL'yi Supabase'e yükleyip yeni URL döndüren yardımcı fonksiyon
const uploadReplicateUrlToSupabase = async (replicateUrl) => {
  try {
    if (!replicateUrl) {
      console.log("Resim URL'si boş veya tanımsız!");
      return null;
    }

    console.log("======= REPLICATE URL İŞLEME BAŞLADI =======");
    console.log("Gelen URL:", replicateUrl);
    console.log("URL tipi:", typeof replicateUrl);

    // URL formatını doğrula
    if (!replicateUrl.startsWith("http")) {
      console.error("Geçersiz URL formatı! HTTP ile başlamıyor:", replicateUrl);
      return null;
    }

    console.log(
      "Replicate URL'yi Supabase'e yükleme başlatılıyor:",
      replicateUrl
    );

    // Önce URL'nin daha önce işlenip işlenmediğini kontrol et
    if (
      replicateUrl.includes("wardrobes") &&
      replicateUrl.includes("supabase")
    ) {
      console.log(
        "Bu URL zaten Supabase'e yüklenmiş, doğrudan kullanılıyor:",
        replicateUrl
      );
      return replicateUrl;
    }

    // Replicate URL'den resmi fetch et
    console.log("Resim indirme işlemi başlatılıyor...");
    const response = await fetch(replicateUrl, {
      method: "GET",
      headers: {
        Accept: "image/*",
      },
      timeout: 10000, // 10 saniye timeout
    });

    if (!response.ok) {
      console.error(
        `Resim indirme başarısız! HTTP ${response.status}: ${response.statusText}`
      );
      return replicateUrl; // Hata durumunda orijinal URL'yi döndür
    }

    console.log("Resim başarıyla indirildi, buffer'a dönüştürülüyor...");

    // Resmi buffer olarak al
    const imageBuffer = await response.arrayBuffer();
    console.log("Buffer boyutu:", imageBuffer.byteLength, "bytes");

    if (imageBuffer.byteLength === 0) {
      console.error("İndirilen resim boş (0 byte)!");
      return replicateUrl;
    }

    // Dosya adı oluştur
    const fileExt = "png"; // Replicate genellikle PNG döndürür
    const fileName = `wardrobe_replicate_${Date.now()}_${Math.random()
      .toString(36)
      .substring(2, 15)}.${fileExt}`;

    console.log("Oluşturulan dosya adı:", fileName);
    console.log("Supabase storage yükleme işlemi başlatılıyor...");

    // Resmi wardrobes bucket'ına yükle
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from("wardrobes")
      .upload(fileName, imageBuffer, {
        contentType: "image/png",
        cacheControl: "3600",
      });

    if (uploadError) {
      console.error("Supabase'e replicate resmi yükleme hatası:", uploadError);
      console.error("Hata detayları:", JSON.stringify(uploadError));
      return replicateUrl; // Hata durumunda orijinal URL'yi döndür
    }

    console.log("Supabase'e yükleme başarılı, public URL alınıyor...");

    // Yüklenen resmin public URL'ini al
    const { data: publicUrlData } = supabase.storage
      .from("wardrobes")
      .getPublicUrl(fileName);

    if (!publicUrlData || !publicUrlData.publicUrl) {
      console.error("Public URL alınamadı:", publicUrlData);
      return replicateUrl; // URL alınamazsa orijinal URL'yi döndür
    }

    const supabaseImageUrl = publicUrlData.publicUrl;
    console.log(
      "Replicate resmi Supabase'e yüklendi, yeni URL:",
      supabaseImageUrl
    );
    console.log("======= REPLICATE URL İŞLEME TAMAMLANDI =======");

    return supabaseImageUrl;
  } catch (error) {
    console.error("====== REPLICATE RESMİ YÜKLEME HATASI ======");
    console.error("Hata:", error);
    console.error("Hata mesajı:", error.message);
    console.error("Hata stack:", error.stack);
    console.error("Orijinal URL:", replicateUrl);
    return replicateUrl; // Hata durumunda orijinal URL'yi döndür
  }
};

// Tüm wardrobe öğelerini getir
router.get("/wardrobe", async (req, res) => {
  try {
    const userId = req.query.userId;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "Kullanıcı ID'si gerekli",
      });
    }

    // Supabase'den verileri çek
    const { data, error } = await supabase
      .from("wardrobe_items")
      .select("*")
      .eq("user_id", userId);

    if (error) {
      throw error;
    }

    res.status(200).json({
      success: true,
      data: data,
    });
  } catch (error) {
    console.error("Wardrobe öğeleri getirme hatası:", error);
    res.status(500).json({
      success: false,
      message: "Wardrobe öğeleri getirilirken bir hata oluştu",
      error: error.message,
    });
  }
});

// Tüm wardrobe öğelerini getir (en yenisi en üstte)
router.get("/wardrobe/latest", async (req, res) => {
  try {
    const userId = req.query.userId;

    // Yeni: pagination parametreleri (varsayılan 6'şar)
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 6;
    const offset = (page - 1) * limit;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "Kullanıcı ID'si gerekli",
      });
    }

    // En yeni öğeler en üstte olacak şekilde Supabase'den verileri çek
    const { data, error, count } = await supabase
      .from("wardrobe_items")
      .select("*", { count: "exact" })
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      throw error;
    }

    res.status(200).json({
      success: true,
      data: data,
      pagination: {
        page,
        limit,
        total: count,
      },
    });
  } catch (error) {
    console.error("Wardrobe öğeleri getirme hatası:", error);
    res.status(500).json({
      success: false,
      message: "Wardrobe öğeleri getirilirken bir hata oluştu",
      error: error.message,
    });
  }
});

// Kullanıcının outfitlerini getirme endpoint'i
router.get("/wardrobe/outfits", async (req, res) => {
  try {
    const userId = req.query.userId;
    // Pagination parametreleri
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 6;
    const offset = (page - 1) * limit;
    console.log("userIdddd", userId);

    // userId parametresi verilmediyse tüm public outfitleri getir
    const fetchAllPublic = !userId;
    if (fetchAllPublic) {
      console.log("Tüm public outfitler getiriliyor...");
    } else {
      console.log(`Kullanıcı ${userId} için outfitler getiriliyor...`);
    }

    try {
      // Önce tablo varlığını kontrol et
      const { data: tables, error: tableError } = await supabase
        .from("wardrobe_outfits")
        .select("*")
        .eq(
          fetchAllPublic ? "visibility" : "user_id",
          fetchAllPublic ? "public" : userId
        )
        .limit(1);

      console.log("tablessss", tables);

      if (tableError) {
        console.error("Tablo varlığı kontrolünde hata:", tableError);
        // Boş veri dön ama success=true
        return res.status(200).json({
          success: true,
          data: [],
          debug: {
            error: tableError.message,
          },
        });
      }

      // Tablo var mı kontrol et
      if (!tables || tables.length === 0) {
        console.log("wardrobe_outfits tablosu bulunamadı!");
        // Boş veri dön ama success=true
        return res.status(200).json({
          success: true,
          data: [],
          debug: {
            error: "wardrobe_outfits tablosu bulunamadı",
          },
        });
      }

      // Foreign key ilişkisini kullanarak wardrobe_outfits ve users tablolarını birleştir
      // users tablosundan username ve avatar_url bilgilerini de getir
      let query = supabase.from("wardrobe_outfits").select(
        `
          *,
          users:user_id (
            id,
            username,
            avatar_url
          )
        `,
        { count: "exact" }
      );

      // Eğer userId verilmişse, kullanıcının kendi outfitlerini getir
      // Aksi halde tüm public outfitleri getir
      if (!fetchAllPublic) {
        query = query.eq("user_id", userId);
      } else {
        // Public outfitleri getir
        query = query.eq("visibility", "public");
      }

      const {
        data: outfits,
        error: outfitsError,
        count,
      } = await query
        .order("created_at", { ascending: false })
        .range(offset, offset + limit - 1);

      if (outfitsError) {
        console.error("Outfitler getirilirken hata:", outfitsError);

        // RLS veya yetki hatası olabilir, daha basit bir sorgu deneyelim
        if (
          outfitsError.code === "42501" ||
          outfitsError.message.includes("permission denied")
        ) {
          console.log("Yetki hatası, daha basit bir sorgu deneniyor...");

          try {
            // RPC fonksiyonu üzerinden deneyelim
            const { data: rpcOutfits, error: rpcError } = await supabase.rpc(
              "get_user_outfits",
              { p_user_id: userId }
            );

            if (rpcError) {
              console.error("RPC sorgusu da başarısız:", rpcError);

              // RPC fonksiyonu da yoksa veya başarısızsa boş liste dön
              return res.status(200).json({
                success: true,
                data: [],
                debug: {
                  error: "Hem doğrudan sorgu hem RPC sorgusu başarısız oldu",
                  originalError: outfitsError.message,
                  rpcError: rpcError.message,
                },
              });
            }

            return res.status(200).json({
              success: true,
              data: rpcOutfits || [],
            });
          } catch (rpcCatchError) {
            console.error("RPC fonksiyonu çağırma hatası:", rpcCatchError);

            // Hata durumunda boş liste dön
            return res.status(200).json({
              success: true,
              data: [],
              debug: {
                error: "RPC fonksiyonu çağrılırken hata oluştu",
                originalError: outfitsError.message,
                rpcError: rpcCatchError.message,
              },
            });
          }
        }

        // Diğer hatalar için boş liste dön
        return res.status(200).json({
          success: true,
          data: [],
          debug: {
            error: outfitsError.message,
          },
        });
      }

      console.log(`${outfits ? outfits.length : 0} adet outfit bulundu`);

      // Kullanıcı bilgilerini kontrol et
      if (outfits && outfits.length > 0) {
        console.log("İlk outfit'in users bilgisi:", outfits[0].users);
      }

      // Kullanıcının beğendiği outfitleri kontrol et
      // wardrobe_outfit_likes tablosundan kullanıcının beğenilerini getir
      const { data: userLikes, error: likesError } = await supabase
        .from("wardrobe_outfit_likes")
        .select("outfit_id")
        .eq("user_id", userId);

      if (likesError) {
        console.error("Beğeni bilgileri alınırken hata:", likesError);
      }

      // Beğenilen outfit ID'lerini bir diziye dönüştür
      const likedOutfitIds = (userLikes || []).map((like) => like.outfit_id);
      console.log(
        `Kullanıcının beğendiği ${likedOutfitIds.length} adet outfit bulundu`
      );

      // Her outfit için isLiked alanını ekle
      const outfitsWithLikeInfo = outfits
        ? outfits.map((outfit) => ({
            ...outfit,
            isLiked: likedOutfitIds.includes(outfit.id),
          }))
        : [];

      // Boş dizi dönme durumunda bile başarılı yanıt gönder
      return res.status(200).json({
        success: true,
        data: outfitsWithLikeInfo,
        pagination: {
          page,
          limit,
          total: count,
        },
      });
    } catch (dbError) {
      console.error("Veritabanı sorgusu sırasında hata:", dbError);

      // Boş dizi döndür, ama hatayı detaylı bildir
      return res.status(200).json({
        success: true,
        data: [],
        debug: {
          error: dbError.message,
          code: dbError.code,
          hint: dbError.hint,
        },
      });
    }
  } catch (error) {
    console.error("Outfitler getirilirken hata:", error);

    // Kritik bir hata varsa bile, frontend için success=true ve boş liste dön
    res.status(200).json({
      success: true,
      data: [],
      debug: {
        error: error.message,
      },
    });
  }
});

// Outfit için öğeleri getiren endpoint
router.get("/wardrobe/outfit-items", async (req, res) => {
  try {
    const outfitId = req.query.outfitId;

    if (!outfitId) {
      return res.status(400).json({
        success: false,
        message: "Outfit ID gerekli",
      });
    }

    console.log(`Outfit ID: ${outfitId} için öğeler getiriliyor`);

    try {
      // Önce tablo varlığını kontrol et
      const { data: tables, error: tableError } = await supabase
        .from("wardrobe_outfit_items")
        .select("*")
        .eq("outfit_id", outfitId);

      if (tableError) {
        console.error("Tablo varlığı kontrolünde hata:", tableError);
        return res.status(200).json({
          success: true, // Frontend'de hata vermemesi için success=true dönüyoruz
          data: [],
          debug: {
            error: "Tablo kontrolünde hata: " + tableError.message,
          },
        });
      }

      // Tablo var mı kontrol et
      if (!tables || tables.length === 0) {
        console.log("wardrobe_outfit_items tablosu bulunamadı!");
        return res.status(200).json({
          success: true,
          data: [],
          debug: {
            error: "wardrobe_outfit_items tablosu bulunamadı",
          },
        });
      }

      // wardrobe_outfit_items tablosundan outfit'in öğelerini getir
      // Şimdi pozisyon alanlarını da seçiyoruz
      const { data: outfitItems, error: outfitItemsError } = await supabase
        .from("wardrobe_outfit_items")
        .select(
          "*, item_id, position_x, position_y, scale, rotation, z_index, processed_image_url"
        )
        .eq("outfit_id", outfitId);

      if (outfitItemsError) {
        console.error("Outfit öğeleri getirilirken hata:", outfitItemsError);

        // Basit bir sorgu ile denemeyi deneyelim
        const { data: fallbackData, error: fallbackError } = await supabase.rpc(
          "get_outfit_items",
          { p_outfit_id: outfitId }
        );

        if (fallbackError) {
          console.error("Fallback sorgusu da başarısız:", fallbackError);

          // Hata durumunda bile boş bir dizi döndür
          return res.status(200).json({
            success: true,
            data: [],
            debug: {
              error: outfitItemsError.message,
              fallbackError: fallbackError.message,
            },
          });
        }

        return res.status(200).json({
          success: true,
          data: fallbackData || [],
        });
      }

      console.log(
        `${outfitItems ? outfitItems.length : 0} adet outfit öğesi bulundu`
      );

      // Konsola bulunan öğelerin pozisyon bilgilerini yazdır
      if (outfitItems && outfitItems.length > 0) {
        console.log("İlk öğenin pozisyon bilgileri:");
        const firstItem = outfitItems[0];
        console.log({
          item_id: firstItem.item_id,
          position_x: firstItem.position_x,
          position_y: firstItem.position_y,
          scale: firstItem.scale,
          rotation: firstItem.rotation,
          z_index: firstItem.z_index,
        });
      }

      return res.status(200).json({
        success: true,
        data: outfitItems || [],
      });
    } catch (dbError) {
      console.error("Veritabanı sorgusu sırasında hata:", dbError);

      // Hata durumunda frontend'e boş dizi döndür
      return res.status(200).json({
        success: true,
        data: [],
        debug: {
          error: dbError.message,
          code: dbError.code,
          hint: dbError.hint,
        },
      });
    }
  } catch (error) {
    console.error("Outfit öğeleri getirilirken hata:", error);

    // Kritik bir hata durumunda frontend'e boş dizi döndür
    res.status(200).json({
      success: true,
      data: [],
      debug: {
        error: error.message,
      },
    });
  }
});

// ID'ye göre wardrobe öğesi getir
router.get("/wardrobe/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const { data, error } = await supabase
      .from("wardrobe_items")
      .select("*")
      .eq("id", id)
      .single();

    if (error) {
      throw error;
    }

    if (!data) {
      return res.status(404).json({
        success: false,
        message: "Öğe bulunamadı",
      });
    }

    res.status(200).json({
      success: true,
      data: data,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Wardrobe öğesi getirilirken bir hata oluştu",
      error: error.message,
    });
  }
});

// Yeni bir wardrobe öğesi ekle (resimle birlikte)
router.post("/wardrobe", upload.single("image"), async (req, res) => {
  try {
    // Debug için tüm request body'yi logla
    console.log(
      "POST /api/wardrobe - Gelen tüm veri:",
      JSON.stringify(req.body, null, 2)
    );
    console.log("POST /api/wardrobe - Dosya var mı:", !!req.file);

    // Form verilerini al
    const {
      userId,
      itemName,
      category,
      seasons,
      color,
      notes,
      linkAddress,
      itemSize,
      purchasePrice,
      purchaseDate,
      tags,
      visibility,
      currency, // Para birimi değerini dahil et
    } = req.body;

    if (!userId || !itemName || !category) {
      return res.status(400).json({
        success: false,
        message: "Kullanıcı ID, ürün adı ve kategori zorunludur",
      });
    }

    console.log("Alınan veriler:", {
      userId,
      itemName,
      category,
      purchaseDate,
      purchasePrice,
      seasons: typeof seasons === "string" ? JSON.parse(seasons) : seasons,
    });

    let imageUrl = null;

    // Eğer resim yüklendiyse Supabase'e yükle
    if (req.file) {
      try {
        const fileExt = req.file.originalname.split(".").pop();
        const fileName = `${Date.now()}_${Math.random()
          .toString(36)
          .substring(2, 15)}.${fileExt}`;

        // Resmi wardrobes bucket'ına yükle
        const { data: uploadData, error: uploadError } = await supabase.storage
          .from("wardrobes")
          .upload(fileName, req.file.buffer, {
            contentType: req.file.mimetype,
            cacheControl: "3600",
          });

        if (uploadError) {
          console.error("Dosya yükleme hatası:", uploadError);
          throw uploadError;
        }

        // Yüklenen resmin public URL'ini al
        const { data: publicUrlData } = supabase.storage
          .from("wardrobes")
          .getPublicUrl(fileName);

        imageUrl = publicUrlData.publicUrl;
        console.log("Resim dosyası başarıyla yüklendi, URL:", imageUrl);
      } catch (uploadError) {
        console.error("Dosya yükleme hatası:", uploadError);
        // Hata olsa bile devam ediyoruz, resim olmadan da ürün eklenebilir
      }
    }

    // Eğer replicate URL'si geldiyse (arkaplanı kaldırılmış resim) Supabase'e yükle
    let supabaseImageUrl = null;
    try {
      const replicateUrl = req.body.image_url || req.body.imageUrl;

      if (replicateUrl) {
        console.log(
          "Gelen resim URL'si:",
          replicateUrl.substring(0, 50) + "..."
        );
        // Replicate URL'si olup olmadığını kontrol et
        if (replicateUrl.includes("replicate")) {
          try {
            console.log("Replicate URL tespit edildi, Supabase'e yükleniyor");
            // Bu adımı tekrar aktif hale getiriyoruz
            supabaseImageUrl = await uploadReplicateUrlToSupabase(replicateUrl);
            console.log(
              "Supabase'e yükleme sonucu:",
              supabaseImageUrl
                ? supabaseImageUrl.includes("supabase")
                  ? "BAŞARILI"
                  : "URL DEĞİŞMEDİ"
                : "BAŞARISIZ"
            );
          } catch (replicateError) {
            console.error("Replicate URL işleme hatası:", replicateError);
            supabaseImageUrl = replicateUrl; // Hata durumunda orijinal URL'yi kullan
          }
        } else {
          console.log("Normal URL tespit edildi, doğrudan kullanılıyor");
          supabaseImageUrl = replicateUrl;
        }
      } else if (imageUrl) {
        console.log(
          "Resim URL'si bulunamadı, yüklenen dosya URL'si kullanılacak"
        );
        supabaseImageUrl = imageUrl;
      } else {
        console.log("Hiç resim URL'si bulunamadı");
      }
    } catch (urlProcessError) {
      console.error("URL işleme hatası:", urlProcessError);
      // URL işleme hatası olsa bile devam ediyoruz
      // Resim olmadan da ürün eklenebilir
    }

    // Son durumda kullanılacak resim URL'sini belirle
    const finalImageUrl =
      supabaseImageUrl ||
      imageUrl ||
      req.body.image_url ||
      req.body.imageUrl ||
      null;
    console.log(
      "Final resim URL'si:",
      finalImageUrl ? finalImageUrl.substring(0, 30) + "..." : "NULL"
    );

    // Seasons ve tags verilerini kontrol et ve dönüştür
    let parsedSeasons = [];
    if (seasons) {
      try {
        parsedSeasons =
          typeof seasons === "string" ? JSON.parse(seasons) : seasons;
      } catch (error) {
        console.error("Mevsim verisi ayrıştırma hatası:", error);
        parsedSeasons = [];
      }
    }

    let parsedTags = [];
    if (tags) {
      try {
        parsedTags = typeof tags === "string" ? JSON.parse(tags) : tags;
      } catch (error) {
        console.error("Etiket verisi ayrıştırma hatası:", error);
        parsedTags = [];
      }
    }

    // Boş string olan sayısal değerleri null'a çevir
    const processedPurchasePrice =
      purchasePrice === "" || purchasePrice === undefined
        ? null
        : purchasePrice;
    const processedPurchaseDate =
      purchaseDate === "" || purchaseDate === undefined ? null : purchaseDate;

    console.log("İşlenmiş fiyat ve tarih değerleri:", {
      originalPrice: purchasePrice,
      processedPrice: processedPurchasePrice,
      originalDate: purchaseDate,
      processedDate: processedPurchaseDate,
    });

    // Direkt insert sorgusu kullanarak ürünü ekleyelim (RPC çağrısını atlayalım)
    console.log("Direkt insert sorgusu kullanılıyor...");

    const { data: sqlData, error: sqlError } = await supabase
      .from("wardrobe_items")
      .insert({
        user_id: userId,
        item_name: itemName,
        brand: req.body.brand || null, // Marka bilgisini ekle
        category: category,
        seasons: parsedSeasons,
        color: color,
        notes: notes,
        link_address: linkAddress,
        item_size: itemSize,
        purchase_price: processedPurchasePrice,
        purchase_date: processedPurchaseDate,
        tags: parsedTags,
        visibility: visibility,
        image_url: finalImageUrl,
        material: req.body.material || null,
        style: req.body.style || null,
        product_gender:
          req.body.productGender || req.body.product_gender || null,
        currency: req.body.currency || "TRY", // Frontend'den gelen currency'yi kullan, yoksa TRY
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .select("*");

    if (sqlError) {
      console.error("SQL sorgusu başarısız oldu:", sqlError);
      throw sqlError;
    }

    res.status(201).json({
      success: true,
      message: "Ürün başarıyla eklendi",
      data: sqlData[0],
    });
  } catch (error) {
    console.error("Wardrobe öğesi ekleme hatası:", error);
    res.status(500).json({
      success: false,
      message: "Wardrobe öğesi eklenirken bir hata oluştu",
      error: error.message,
    });
  }
});

// Wardrobe öğesini güncelle
router.put("/wardrobe/:id", upload.single("image"), async (req, res) => {
  try {
    const { id } = req.params;
    const {
      itemName,
      category,
      seasons,
      color,
      notes,
      linkAddress,
      itemSize,
      purchasePrice,
      purchaseDate,
      tags,
      visibility,
      lastWorn,
    } = req.body;

    // Önce mevcut öğeyi kontrol et
    const { data: existingItem, error: fetchError } = await supabase
      .from("wardrobe_items")
      .select("*")
      .eq("id", id)
      .single();

    if (fetchError) {
      throw fetchError;
    }

    if (!existingItem) {
      return res.status(404).json({
        success: false,
        message: "Güncellenecek öğe bulunamadı",
      });
    }

    let imageUrl = existingItem.image_url;

    // Eğer yeni bir resim yüklendiyse
    if (req.file) {
      const fileExt = req.file.originalname.split(".").pop();
      const fileName = `${Date.now()}_${Math.random()
        .toString(36)
        .substring(2, 15)}.${fileExt}`;

      // Yeni resmi yükle
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from("wardrobes")
        .upload(fileName, req.file.buffer, {
          contentType: req.file.mimetype,
          cacheControl: "3600",
        });

      if (uploadError) {
        throw uploadError;
      }

      // Yeni resmin public URL'ini al
      const { data: publicUrlData } = supabase.storage
        .from("wardrobes")
        .getPublicUrl(fileName);

      imageUrl = publicUrlData.publicUrl;

      // Eski resmi sil (eğer varsa)
      if (existingItem.image_url) {
        // URL'den dosya adını çıkar
        const oldFileName = existingItem.image_url.split("/").pop();

        // Eski dosyayı sil
        await supabase.storage.from("wardrobes").remove([oldFileName]);
      }
    }

    // Öğeyi güncelle
    const updateData = {
      ...(itemName && { item_name: itemName }),
      ...(req.body.brand !== undefined && { brand: req.body.brand }), // Marka bilgisini ekle
      ...(category && { category: category }),
      ...(seasons && { seasons: JSON.parse(seasons) }),
      ...(color && { color: color }),
      ...(notes !== undefined && { notes: notes }),
      ...(linkAddress !== undefined && { link_address: linkAddress }),
      ...(itemSize !== undefined && { item_size: itemSize }),
      ...(purchasePrice !== undefined && { purchase_price: purchasePrice }),
      ...(purchaseDate !== undefined && { purchase_date: purchaseDate }),
      ...(tags && { tags: JSON.parse(tags) }),
      ...(visibility && { visibility: visibility }),
      ...(lastWorn && { last_worn: lastWorn }),
      ...(imageUrl && { image_url: imageUrl }),
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await supabase
      .from("wardrobe_items")
      .update(updateData)
      .eq("id", id)
      .select();

    if (error) {
      throw error;
    }

    res.status(200).json({
      success: true,
      message: "Ürün başarıyla güncellendi",
      data: data[0],
    });
  } catch (error) {
    console.error("Wardrobe öğesi güncelleme hatası:", error);
    res.status(500).json({
      success: false,
      message: "Wardrobe öğesi güncellenirken bir hata oluştu",
      error: error.message,
    });
  }
});

// Wardrobe öğesini sil
router.delete("/wardrobe/:id", async (req, res) => {
  try {
    const { id } = req.params;

    console.log(`Wardrobe item silme işlemi başlatılıyor. Item ID: ${id}`);

    // Silinecek öğeyi bul
    const { data: existingItem, error: fetchError } = await supabase
      .from("wardrobe_items")
      .select("*")
      .eq("id", id)
      .single();

    if (fetchError) {
      console.error("Item bulunamadı:", fetchError);
      throw fetchError;
    }

    if (!existingItem) {
      return res.status(404).json({
        success: false,
        message: "Silinecek öğe bulunamadı",
      });
    }

    console.log(
      `Silinecek item bulundu: ${existingItem.item_name || existingItem.id}`
    );

    // 1. Önce item_favorites tablosundaki ilişkili kayıtları sil
    console.log("İlişkili favorites kayıtları siliniyor...");
    const { error: favoritesDeleteError } = await supabase
      .from("item_favorites")
      .delete()
      .eq("item_id", id);

    if (favoritesDeleteError) {
      console.error("Favorites silme hatası:", favoritesDeleteError);
      // Favorites silme hatası kritik değil, devam edebiliriz
    } else {
      console.log("Favorites kayıtları başarıyla silindi");
    }

    // 2. wardrobe_outfit_items tablosundaki ilişkili kayıtları sil
    console.log("İlişkili outfit items kayıtları siliniyor...");
    const { error: outfitItemsDeleteError } = await supabase
      .from("wardrobe_outfit_items")
      .delete()
      .eq("item_id", id);

    if (outfitItemsDeleteError) {
      console.error("Outfit items silme hatası:", outfitItemsDeleteError);
      // Bu da kritik değil, devam edebiliriz
    } else {
      console.log("Outfit items kayıtları başarıyla silindi");
    }

    // 3. Ana wardrobe_items tablosundan öğeyi sil
    console.log("Ana item kaydı siliniyor...");
    const { error: deleteError } = await supabase
      .from("wardrobe_items")
      .delete()
      .eq("id", id);

    if (deleteError) {
      console.error("Ana item silme hatası:", deleteError);
      throw deleteError;
    }

    console.log("Ana item kaydı başarıyla silindi");

    // 4. Eğer öğenin bir resmi varsa, resmi de sil
    if (existingItem.image_url) {
      console.log("Item resmi siliniyor...");
      try {
        const fileName = existingItem.image_url.split("/").pop();
        await supabase.storage.from("wardrobes").remove([fileName]);
        console.log("Item resmi başarıyla silindi");
      } catch (imageError) {
        console.error("Resim silme hatası:", imageError);
        // Resim silme hatası kritik değil
      }
    }

    console.log(`Item silme işlemi tamamlandı. ID: ${id}`);

    res.status(200).json({
      success: true,
      message: "Ürün başarıyla silindi",
    });
  } catch (error) {
    console.error("Wardrobe öğesi silme hatası:", error);
    res.status(500).json({
      success: false,
      message: "Wardrobe öğesi silinirken bir hata oluştu",
      error: error.message,
    });
  }
});

// Outfit oluşturma
router.post("/outfit", async (req, res) => {
  try {
    const { userId, name, items, visibility } = req.body;

    if (!userId || !items || !Array.isArray(items) || items.length < 2) {
      return res.status(400).json({
        success: false,
        message: "Kullanıcı ID ve en az 2 öğe ID'si gerekli",
      });
    }

    // Outfit oluştur
    const { data, error } = await supabase
      .from("wardrobe_outfits")
      .insert([
        {
          user_id: userId,
          name: name || `Outfit ${new Date().toLocaleDateString()}`,
          item_ids: items,
          created_at: new Date().toISOString(),
        },
      ])
      .select();

    if (error) {
      throw error;
    }

    res.status(201).json({
      success: true,
      message: "Outfit başarıyla oluşturuldu",
      data: data[0],
    });
  } catch (error) {
    console.error("Outfit oluşturma hatası:", error);
    res.status(500).json({
      success: false,
      message: "Outfit oluşturulurken bir hata oluştu",
      error: error.message,
    });
  }
});

router.post("/wardrobe/outfits", async (req, res) => {
  try {
    const { userId, name, itemIds, visibility } = req.body;

    if (
      !userId ||
      !name ||
      !itemIds ||
      !Array.isArray(itemIds) ||
      itemIds.length < 2
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Geçersiz veriler. Kullanıcı ID, isim ve en az 2 ürün ID'si gerekli.",
      });
    }

    console.log(
      `Yeni kombin oluşturuluyor. Kullanıcı: ${userId}, İsim: ${name}, Ürünler: ${itemIds.join(
        ", "
      )}`
    );

    // Önce outfit ana tablosuna kaydet
    const { data: outfit, error: outfitError } = await supabase
      .from("wardrobe_outfits")
      .insert([
        {
          user_id: userId,
          name: name,
          visibility: visibility || "private",
          created_at: new Date().toISOString(),
        },
      ])
      .select("id")
      .single();

    if (outfitError) {
      console.error("Outfit kaydı hatası:", outfitError);
      throw outfitError;
    }

    const outfitId = outfit.id;
    console.log(`Kombin kaydedildi, ID: ${outfitId}`);

    // Ardından outfit_items ara tablosuna ürünleri ekle
    const outfitItemsData = itemIds.map((itemId) => ({
      outfit_id: outfitId,
      item_id: itemId,
    }));

    // Her bir ürünü tek tek eklemeyi dene, hata olursa atlayarak devam et
    let successfulItems = [];
    let failedItems = [];

    // İteratif olarak her ürünü eklemeyi dene
    for (const item of outfitItemsData) {
      try {
        const { data: insertedItem, error: insertError } = await supabase
          .from("wardrobe_outfit_items")
          .insert([item])
          .select();

        if (insertError) {
          console.log(`Ürün eklenirken hata: ${item.item_id}`, insertError);
          failedItems.push(item.item_id);
        } else {
          successfulItems.push(item.item_id);
        }
      } catch (err) {
        console.log(`Ürün eklenirken istisna: ${item.item_id}`, err);
        failedItems.push(item.item_id);
      }
    }

    // Başarılı yanıt gönder - en az bir ürün ekleyebilmişsek başarılı sayalım
    res.status(201).json({
      success: true,
      message:
        successfulItems.length > 0
          ? "Kombin başarıyla oluşturuldu"
          : "Kombin oluşturuldu fakat ürünler eklenirken sorun oluştu",
      data: {
        id: outfitId,
        name: name,
        userId: userId,
        itemIds: successfulItems,
        failedItemIds: failedItems,
        visibility: visibility || "private",
      },
    });
  } catch (error) {
    console.error("Kombin oluşturma hatası:", error);
    res.status(500).json({
      success: false,
      message: "Kombin oluşturulurken bir hata oluştu",
      error: error.message,
    });
  }
});

// Outfit resimlerinin arkaplanını kaldırma endpointi
router.post("/wardrobe/outfits/remove-background", async (req, res) => {
  try {
    const { outfitId, imageUrls } = req.body;

    if (!imageUrls || !Array.isArray(imageUrls) || imageUrls.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Geçersiz veriler. En az bir görsel URL'si gerekli.",
      });
    }

    console.log(
      `Arkaplan kaldırma işlemi başlatılıyor. ${
        outfitId === "temp" ? "Ürün ekleme" : `Outfit ID: ${outfitId}`
      }, Görsel Sayısı: ${imageUrls.length}`
    );

    // İşlenmiş resimlerin sonuçlarını saklamak için dizi
    const processedImages = [];
    const failedImages = [];

    // Her bir görsel için arkaplan kaldırma işlemi yap
    for (const imageUrl of imageUrls) {
      try {
        // URL kontrolü yap - sadece http veya https ile başlayan URL'leri kabul et
        if (
          !imageUrl.startsWith("http://") &&
          !imageUrl.startsWith("https://")
        ) {
          console.log(`Geçersiz URL formatı: ${imageUrl.substring(0, 50)}...`);
          failedImages.push({
            originalUrl: imageUrl,
            error:
              "Geçersiz URL formatı. Sadece HTTP veya HTTPS URL'leri desteklenir.",
          });
          continue;
        }

        console.log(
          `Arkaplan kaldırma işlemi başlıyor: ${imageUrl.substring(0, 50)}...`
        );

        // Görüntüyü indir
        const imageResponse = await axios.get(imageUrl, {
          responseType: "arraybuffer",
        });

        // FormData oluştur
        const formData = new FormData();
        const buffer = Buffer.from(imageResponse.data);

        // FormData'ya imageFile ekle
        formData.append("image_file", buffer, {
          filename: "image.jpg",
          contentType: imageResponse.headers["content-type"] || "image/jpeg",
        });

        // Parametreleri ekle
        formData.append("crop", "true");
        formData.append("format", "png");
        formData.append("size", "hd");

        // PhotoRoom API'ye istek at
        console.log(`PhotoRoom API'ye istek atılıyor...`);
        const photoRoomResponse = await axios.post(
          "https://sdk.photoroom.com/v1/segment",
          formData,
          {
            headers: {
              "x-api-key": PHOTOROOM_API_KEY,
              ...formData.getHeaders(),
            },
            responseType: "arraybuffer",
          }
        );

        console.log(`PhotoRoom API yanıtı alındı: ${photoRoomResponse.status}`);

        if (photoRoomResponse.status !== 200) {
          throw new Error(`PhotoRoom API hatası: ${photoRoomResponse.status}`);
        }

        // İşlenen resmi geçici olarak kaydet
        const fileName = `temp_${Date.now()}_${Math.random()
          .toString(36)
          .substring(2, 10)}.png`;
        const filePath = path.join(__dirname, "../../temp", fileName);

        // Temp klasörünün varlığını kontrol et ve yoksa oluştur
        const tempDir = path.join(__dirname, "../../temp");
        if (!fs.existsSync(tempDir)) {
          fs.mkdirSync(tempDir, { recursive: true });
        }

        // Dosyayı kaydet
        fs.writeFileSync(filePath, photoRoomResponse.data);

        // Dosyayı Supabase'e yükle
        const { data: uploadData, error: uploadError } = await supabase.storage
          .from("wardrobes")
          .upload(`photoroom_${fileName}`, fs.createReadStream(filePath), {
            contentType: "image/png",
            cacheControl: "3600",
          });

        if (uploadError) {
          throw new Error(`Supabase yükleme hatası: ${uploadError.message}`);
        }

        // Public URL al
        const { data: publicUrlData } = await supabase.storage
          .from("wardrobes")
          .getPublicUrl(`photoroom_${fileName}`);

        if (!publicUrlData || !publicUrlData.publicUrl) {
          throw new Error("Public URL alınamadı");
        }

        // Geçici dosyayı temizle
        fs.unlinkSync(filePath);

        // İşlenmiş görsel URL'sini kaydet
        processedImages.push({
          originalUrl: imageUrl,
          processedUrl: publicUrlData.publicUrl,
          success: true,
        });

        console.log(
          `İşlenen resim Supabase'e yüklendi: ${publicUrlData.publicUrl}`
        );
      } catch (error) {
        console.error(
          `Görsel işleme hatası (${imageUrl.substring(0, 30)}...):`,
          error
        );
        failedImages.push({
          originalUrl: imageUrl,
          error: error.message || "API hatası",
        });
      }
    }

    // Yanıtı gönder
    res.status(200).json({
      success: true,
      message: `Arkaplan kaldırma işlemi tamamlandı. ${processedImages.length} başarılı, ${failedImages.length} başarısız.`,
      data: {
        outfitId,
        processedImages,
        failedImages,
      },
    });
  } catch (error) {
    console.error("Arkaplan kaldırma hatası:", error);
    res.status(500).json({
      success: false,
      message: "Arkaplan kaldırma işlemi sırasında bir hata oluştu",
      error: error.message,
    });
  }
});

// İşlenmiş resim URL'lerini kaydetme endpointi
router.post("/wardrobe/outfits/save-processed-images", async (req, res) => {
  try {
    const { outfitId, processedImages } = req.body;

    if (!outfitId || !processedImages || !Array.isArray(processedImages)) {
      return res.status(400).json({
        success: false,
        message:
          "Geçersiz veriler. Outfit ID ve işlenmiş görsel bilgileri gerekli.",
      });
    }

    console.log(
      `İşlenmiş resim URL'leri kaydediliyor. Outfit ID: ${outfitId}, Resim Sayısı: ${processedImages.length}`
    );

    // Her bir işlenmiş resim için original ve processed URL ilişkisini kaydet
    let updatedCount = 0;
    const errors = [];

    for (const processedImage of processedImages) {
      const { originalUrl, processedUrl } = processedImage;

      if (!originalUrl || !processedUrl) {
        errors.push(`Eksik URL bilgisi: ${JSON.stringify(processedImage)}`);
        continue;
      }

      try {
        // Item'ı orijinal URL'ye göre bul
        const { data: items, error: itemsError } = await supabase
          .from("wardrobe_items")
          .select("id")
          .eq("image_url", originalUrl);

        if (itemsError) {
          errors.push(`Item bulunurken hata: ${itemsError.message}`);
          continue;
        }

        // Eğer ilgili item bulunduysa
        if (items && items.length > 0) {
          const itemId = items[0].id;

          // wardrobe_outfit_items tablosunda bu outfit ve item kombinasyonunu bul ve güncelle
          const { data: updatedData, error: updateError } = await supabase
            .from("wardrobe_outfit_items")
            .update({ processed_image_url: processedUrl })
            .eq("outfit_id", outfitId)
            .eq("item_id", itemId);

          if (updateError) {
            errors.push(
              `Item güncellenirken hata (${itemId}): ${updateError.message}`
            );
          } else {
            updatedCount++;
          }
        } else {
          errors.push(`Item bulunamadı (URL: ${originalUrl})`);
        }
      } catch (itemError) {
        errors.push(`İşlem hatası: ${itemError.message}`);
      }
    }

    // Outfitin işlenme durumunu güncelle
    const { error: outfitUpdateError } = await supabase
      .from("wardrobe_outfits")
      .update({
        processing_completed: true,
        processed_at: new Date().toISOString(),
      })
      .eq("id", outfitId);

    if (outfitUpdateError) {
      errors.push(`Outfit güncelleme hatası: ${outfitUpdateError.message}`);
    }

    res.status(200).json({
      success: true,
      message: `İşlenmiş resimler kaydedildi. Başarılı: ${updatedCount}, Başarısız: ${errors.length}`,
      data: {
        outfitId,
        updatedCount,
        errors: errors.length > 0 ? errors : null,
      },
    });
  } catch (error) {
    console.error("İşlenmiş resim kaydetme hatası:", error);
    res.status(500).json({
      success: false,
      message: "İşlenmiş resimleri kaydederken bir hata oluştu",
      error: error.message,
    });
  }
});

// Outfitin işlenmiş resimlerini getirme endpointi
router.get("/wardrobe/outfits/:outfitId/processed-images", async (req, res) => {
  try {
    const { outfitId } = req.params;

    if (!outfitId) {
      return res.status(400).json({
        success: false,
        message: "Outfit ID gerekli",
      });
    }

    console.log(`İşlenmiş resim bilgisi isteniyor. Outfit ID: ${outfitId}`);

    // İlk önce outfit'in işlenip işlenmediğini kontrol et
    const { data: outfit, error: outfitError } = await supabase
      .from("wardrobe_outfits")
      .select("processing_completed, processed_at")
      .eq("id", outfitId)
      .single();

    if (outfitError) {
      console.error("Outfit bilgisi getirme hatası:", outfitError);
      throw outfitError;
    }

    // Daha güvenli bir yaklaşım - doğrudan wardrobe_outfit_items tablosundaki verileri getir
    const { data: outfitItems, error: itemsError } = await supabase
      .from("wardrobe_outfit_items")
      .select("item_id, processed_image_url")
      .eq("outfit_id", outfitId);

    if (itemsError) {
      console.error("Outfit item bilgisi getirme hatası:", itemsError);
      throw itemsError;
    }

    // İşlenmiş ve işlenmemiş item'ları ayır
    const processedItems = outfitItems.filter(
      (item) => item.processed_image_url
    );
    const unprocessedItems = outfitItems.filter(
      (item) => !item.processed_image_url
    );

    console.log(
      `İşlenmiş resim sayısı: ${processedItems.length}, İşlenmemiş: ${unprocessedItems.length}`
    );

    res.status(200).json({
      success: true,
      data: {
        outfitId,
        isProcessed: outfit?.processing_completed || false,
        processedAt: outfit?.processed_at || null,
        processedItems: processedItems || [],
        unprocessedItems: unprocessedItems || [],
        processedCount: processedItems.length,
        unprocessedCount: unprocessedItems.length,
      },
    });
  } catch (error) {
    console.error("İşlenmiş resim bilgisi getirme hatası:", error);
    res.status(500).json({
      success: false,
      message: "İşlenmiş resim bilgilerini getirirken bir hata oluştu",
      error: error.message,
    });
  }
});

// Outfit'ten belirli bir öğeyi silme endpoint'i
router.delete("/wardrobe/outfit-item", async (req, res) => {
  try {
    // URL parametrelerini al ve doğru tipte olduklarından emin ol
    const outfitId = req.query.outfitId;
    const itemId = req.query.itemId;

    console.log("===== DETAYLI OUTFIT ITEM SİLME İSTEĞİ =====");
    console.log(`Alınan outfitId: "${outfitId}", Tipi: ${typeof outfitId}`);
    console.log(`Alınan itemId: "${itemId}", Tipi: ${typeof itemId}`);

    // Gelen parametreleri detaylı logla
    console.log("===== OUTFIT ITEM SİLME İSTEĞİ =====");
    console.log(`outfitId (ham değer): "${outfitId}"`);
    console.log(`itemId (ham değer): "${itemId}"`);
    console.log("Tüm sorgu parametreleri:", JSON.stringify(req.query));
    console.log("URL:", req.originalUrl);

    if (!outfitId || !itemId) {
      console.log("Eksik parametreler! outfitId veya itemId yok");
      return res.status(400).json({
        success: false,
        message: "Outfit ID ve Item ID gerekli",
        receivedParams: req.query,
      });
    }

    // UUID formatı kontrolü
    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(outfitId) || !uuidRegex.test(itemId)) {
      console.log("Geçersiz UUID formatı!");
      console.log(
        `outfitId: "${outfitId}" - UUID formatına uygun mu: ${uuidRegex.test(
          outfitId
        )}`
      );
      console.log(
        `itemId: "${itemId}" - UUID formatına uygun mu: ${uuidRegex.test(
          itemId
        )}`
      );

      return res.status(400).json({
        success: false,
        message: "Geçersiz ID formatı. UUID formatında olmalı.",
        details: {
          outfitId: outfitId,
          itemId: itemId,
          outfitIdValid: uuidRegex.test(outfitId),
          itemIdValid: uuidRegex.test(itemId),
          receivedQuery: req.query,
          url: req.originalUrl,
        },
      });
    }

    console.log(
      `Veritabanında sorgu: outfit_id="${outfitId}", item_id="${itemId}"`
    );

    try {
      // Önce veritabanında bu kombinasyonda kayıt var mı kontrol et
      const { data: checkData, error: checkError } = await supabase
        .from("wardrobe_outfit_items")
        .select("id")
        .eq("outfit_id", outfitId)
        .eq("item_id", itemId);

      if (checkError) {
        console.error("Outfit-item kontrol hatası:", checkError);
        return res.status(200).json({
          success: false,
          message: "Veritabanı kontrol hatası",
          error: checkError.message,
        });
      }

      if (!checkData || checkData.length === 0) {
        console.log(
          `Bu kombinasyon bulunamadı: outfit_id="${outfitId}", item_id="${itemId}"`
        );
        return res.status(200).json({
          success: false,
          message: "Bu kombinasyon için veritabanında kayıt bulunamadı",
          debug: { outfitId, itemId },
        });
      }

      console.log(`Kayıt bulundu: ${checkData.length} adet. Siliniyor...`);

      // wardrobe_outfit_items tablosundan ilgili kaydı sil
      const { data, error } = await supabase
        .from("wardrobe_outfit_items")
        .delete()
        .eq("outfit_id", outfitId)
        .eq("item_id", itemId);

      if (error) {
        console.error("Outfit item silinirken hata:", error);

        return res.status(200).json({
          success: false,
          message: "Outfit item silinirken bir hata oluştu",
          error: error.message,
        });
      }

      console.log(`${outfitId} outfit'inden ${itemId} öğesi başarıyla silindi`);

      return res.status(200).json({
        success: true,
        message: "Öğe kombinden başarıyla silindi",
      });
    } catch (dbError) {
      console.error("Veritabanı sorgusu sırasında hata:", dbError);
      console.error("Hata detayları:", {
        message: dbError.message,
        code: dbError.code,
        hint: dbError.hint,
        details: dbError.details,
      });

      return res.status(200).json({
        success: false,
        message: "Veritabanı hatası",
        debug: {
          error: dbError.message,
          code: dbError.code,
          hint: dbError.hint,
        },
      });
    }
  } catch (error) {
    console.error("Genel hata:", error);
    console.error("Genel hata türü:", typeof error);
    if (error.stack) console.error("Stack trace:", error.stack);

    res.status(200).json({
      success: false,
      message: "Öğe silinirken bir hata oluştu",
      error: error.message,
    });
  }
});

// Outfit'ten belirli bir öğeyi silme endpoint'i (alternatif - body içinden ID'leri alır)
router.delete("/wardrobe/outfit-item-alt", async (req, res) => {
  try {
    // Body'den parametreleri al
    const { outfitId, itemId } = req.body;

    console.log("===== OUTFIT ITEM SİLME İSTEĞİ (ALTERNATİF) =====");
    console.log(`outfitId (body): "${outfitId}"`);
    console.log(`itemId (body): "${itemId}"`);
    console.log("Body içeriği:", JSON.stringify(req.body));

    if (!outfitId || !itemId) {
      console.log("Eksik parametreler! outfitId veya itemId yok");
      return res.status(400).json({
        success: false,
        message: "Outfit ID ve Item ID gerekli",
        receivedBody: req.body,
      });
    }

    // UUID formatı kontrolü
    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(outfitId) || !uuidRegex.test(itemId)) {
      console.log("Geçersiz UUID formatı!");
      console.log(
        `outfitId: "${outfitId}" - UUID formatına uygun mu: ${uuidRegex.test(
          outfitId
        )}`
      );
      console.log(
        `itemId: "${itemId}" - UUID formatına uygun mu: ${uuidRegex.test(
          itemId
        )}`
      );

      return res.status(400).json({
        success: false,
        message: "Geçersiz ID formatı. UUID formatında olmalı.",
        details: {
          outfitId: outfitId,
          itemId: itemId,
          outfitIdValid: uuidRegex.test(outfitId),
          itemIdValid: uuidRegex.test(itemId),
        },
      });
    }

    // Silme işlemine devam et
    try {
      // wardrobe_outfit_items tablosundan ilgili kaydı sil
      const { data, error } = await supabase
        .from("wardrobe_outfit_items")
        .delete()
        .eq("outfit_id", outfitId)
        .eq("item_id", itemId);

      if (error) {
        console.error("Outfit item silinirken hata (ALT):", error);
        return res.status(200).json({
          success: false,
          message: "Outfit item silinirken bir hata oluştu",
          error: error.message,
        });
      }

      console.log(
        `${outfitId} outfit'inden ${itemId} öğesi başarıyla silindi (ALT)`
      );
      return res.status(200).json({
        success: true,
        message: "Öğe kombinden başarıyla silindi",
      });
    } catch (dbError) {
      console.error("Veritabanı sorgusu sırasında hata (ALT):", dbError);
      return res.status(200).json({
        success: false,
        message: "Veritabanı hatası",
        debug: {
          error: dbError.message,
          code: dbError.code,
          hint: dbError.hint,
        },
      });
    }
  } catch (error) {
    console.error("Genel hata (ALT):", error);
    res.status(200).json({
      success: false,
      message: "Öğe silinirken bir hata oluştu",
      error: error.message,
    });
  }
});

// Outfit silme endpoint'i
router.delete("/wardrobe/outfits/:id", async (req, res) => {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({
        success: false,
        message: "Outfit ID gerekli",
      });
    }

    console.log(`Outfit silme isteği. Outfit ID: ${id}`);

    // UUID formatı kontrolü
    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(id)) {
      console.log("Geçersiz UUID formatı!");
      return res.status(400).json({
        success: false,
        message: "Geçersiz Outfit ID formatı",
      });
    }

    // Önce silinecek outfitin var olduğunu kontrol et
    const { data: existingOutfit, error: checkError } = await supabase
      .from("wardrobe_outfits")
      .select("id")
      .eq("id", id)
      .single();

    if (checkError) {
      console.error("Outfit kontrol hatası:", checkError);
      return res.status(404).json({
        success: false,
        message: "Outfit bulunamadı veya erişim hatası",
        error: checkError.message,
      });
    }

    // 1. Önce tüm ilişkili outfit_items kayıtlarını sil
    console.log(`İlişkili outfit_items kayıtları siliniyor...`);
    const { error: itemsDeleteError } = await supabase
      .from("wardrobe_outfit_items")
      .delete()
      .eq("outfit_id", id);

    if (itemsDeleteError) {
      console.error("İlişkili öğeler silinirken hata:", itemsDeleteError);
      throw new Error(
        `İlişkili öğeler silinirken hata: ${itemsDeleteError.message}`
      );
    }

    // 2. Outfit'i sil
    console.log(`Outfit siliniyor...`);
    const { error: outfitDeleteError } = await supabase
      .from("wardrobe_outfits")
      .delete()
      .eq("id", id);

    if (outfitDeleteError) {
      console.error("Outfit silinirken hata:", outfitDeleteError);
      throw new Error(`Outfit silinirken hata: ${outfitDeleteError.message}`);
    }

    console.log(`Outfit başarıyla silindi. ID: ${id}`);
    return res.status(200).json({
      success: true,
      message: "Outfit başarıyla silindi",
    });
  } catch (error) {
    console.error("Outfit silme hatası:", error);
    res.status(500).json({
      success: false,
      message: "Outfit silinirken bir hata oluştu",
      error: error.message,
    });
  }
});

// Outfit yeniden adlandırma endpoint'i
router.put("/wardrobe/outfits/:id/rename", async (req, res) => {
  try {
    const { id } = req.params;
    const { name } = req.body;

    if (!id || !name) {
      return res.status(400).json({
        success: false,
        message: "Outfit ID ve yeni isim gerekli",
      });
    }

    console.log(
      `Outfit yeniden adlandırma isteği. Outfit ID: ${id}, Yeni isim: ${name}`
    );

    // UUID formatı kontrolü
    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(id)) {
      console.log("Geçersiz UUID formatı!");
      return res.status(400).json({
        success: false,
        message: "Geçersiz Outfit ID formatı",
      });
    }

    // Outfit'i güncelle
    const { data, error } = await supabase
      .from("wardrobe_outfits")
      .update({ name: name, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select();

    if (error) {
      console.error("Outfit yeniden adlandırma hatası:", error);
      return res.status(400).json({
        success: false,
        message: "Outfit yeniden adlandırılırken bir hata oluştu",
        error: error.message,
      });
    }

    if (!data || data.length === 0) {
      console.log(`Outfit bulunamadı. ID: ${id}`);
      return res.status(404).json({
        success: false,
        message: "Belirtilen ID'ye sahip outfit bulunamadı",
      });
    }

    console.log(`Outfit başarıyla yeniden adlandırıldı. ID: ${id}`);
    return res.status(200).json({
      success: true,
      message: "Outfit başarıyla yeniden adlandırıldı",
      data: data[0],
    });
  } catch (error) {
    console.error("Outfit yeniden adlandırma hatası:", error);
    res.status(500).json({
      success: false,
      message: "Outfit yeniden adlandırılırken bir hata oluştu",
      error: error.message,
    });
  }
});

// Outfit'e yeni item ekleme endpoint'i
router.post("/wardrobe/outfit-items", async (req, res) => {
  try {
    const { outfitId, itemId, positionX, positionY, scale, rotation, zIndex } =
      req.body;

    if (!outfitId || !itemId) {
      return res.status(400).json({
        success: false,
        message: "Outfit ID ve Item ID gerekli",
      });
    }

    console.log(`Outfit ID ${outfitId}'ye yeni item ekleniyor: ${itemId}`);
    if (positionX !== undefined || positionY !== undefined) {
      console.log(`Pozisyon bilgileri ile: X=${positionX}, Y=${positionY}`);
    }

    // Önce bu kombinasyonun daha önce eklenip eklenmediğini kontrol et
    const { data: existingItems, error: checkError } = await supabase
      .from("wardrobe_outfit_items")
      .select("*")
      .eq("outfit_id", outfitId)
      .eq("item_id", itemId);

    if (checkError) {
      throw checkError;
    }

    // Eğer bu item daha önce eklenmişse, hata döndür
    if (existingItems && existingItems.length > 0) {
      console.log(
        `Item zaten mevcut: outfit_id=${outfitId}, item_id=${itemId}`
      );
      return res.status(400).json({
        success: false,
        message: "Bu öğe zaten kombinde mevcut",
        data: {
          outfitId,
          itemId,
          existingRecord: existingItems[0],
        },
      });
    }

    // Yeni outfit_item kaydı oluştur
    const insertData = {
      outfit_id: outfitId,
      item_id: itemId,
    };

    // Eğer pozisyon bilgileri verilmişse ekle
    if (positionX !== undefined) insertData.position_x = positionX;
    if (positionY !== undefined) insertData.position_y = positionY;
    if (scale !== undefined) insertData.scale = scale;
    if (rotation !== undefined) insertData.rotation = rotation;
    if (zIndex !== undefined) insertData.z_index = zIndex;

    const { data, error } = await supabase
      .from("wardrobe_outfit_items")
      .insert([insertData])
      .select();

    if (error) {
      throw error;
    }

    // Outfit'in son güncelleme zamanını güncelle
    try {
      await supabase
        .from("wardrobe_outfits")
        .update({ updated_at: new Date().toISOString() })
        .eq("id", outfitId);
    } catch (outfitUpdateError) {
      console.error(
        "Outfit son güncelleme zamanı güncellenemedi:",
        outfitUpdateError
      );
    }

    res.status(201).json({
      success: true,
      message: "Item outfit'e başarıyla eklendi",
      data: data[0],
    });
  } catch (error) {
    console.error("Item outfit'e eklenirken hata:", error);
    res.status(500).json({
      success: false,
      message: "Item outfit'e eklenirken bir hata oluştu",
      error: error.message,
    });
  }
});

// Outfit arkaplan ayarlarını güncelleme endpoint'i
router.put("/wardrobe/outfits/:id/background", async (req, res) => {
  try {
    const { id } = req.params;
    const { backgroundColor, backgroundImageUrl, backgroundOpacity } = req.body;

    if (!id) {
      return res.status(400).json({
        success: false,
        message: "Outfit ID gerekli",
      });
    }

    console.log(`Outfit ID: ${id} için arkaplan ayarları güncelleniyor`);
    console.log("Gelen veriler:", {
      backgroundColor,
      backgroundImageUrl,
      backgroundOpacity,
    });

    // UUID formatı kontrolü
    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(id)) {
      console.log("Geçersiz UUID formatı!");
      return res.status(400).json({
        success: false,
        message: "Geçersiz Outfit ID formatı",
      });
    }

    // Güncellenecek veriler için obje oluştur
    const updateData = {
      updated_at: new Date().toISOString(),
    };

    // Sadece gönderilen alanları güncelle
    if (backgroundColor !== undefined) {
      updateData.background_color = backgroundColor;
    }
    if (backgroundImageUrl !== undefined) {
      updateData.background_image_url = backgroundImageUrl;
    }
    if (backgroundOpacity !== undefined) {
      // Opacity 0.0-1.0 arasında olmalı
      const validOpacity = Math.max(
        0.0,
        Math.min(1.0, parseFloat(backgroundOpacity))
      );
      updateData.background_opacity = validOpacity;
    }

    console.log("Güncelleme verileri:", updateData);

    // Outfit'i güncelle
    const { data, error } = await supabase
      .from("wardrobe_outfits")
      .update(updateData)
      .eq("id", id)
      .select("id, background_color, background_image_url, background_opacity");

    if (error) {
      console.error("Arkaplan ayarları güncellenirken hata:", error);
      return res.status(400).json({
        success: false,
        message: "Arkaplan ayarları güncellenirken bir hata oluştu",
        error: error.message,
      });
    }

    if (!data || data.length === 0) {
      console.log(`Outfit bulunamadı. ID: ${id}`);
      return res.status(404).json({
        success: false,
        message: "Belirtilen ID'ye sahip outfit bulunamadı",
      });
    }

    console.log(`Outfit arkaplan ayarları başarıyla güncellendi. ID: ${id}`);
    return res.status(200).json({
      success: true,
      message: "Arkaplan ayarları başarıyla güncellendi",
      data: data[0],
    });
  } catch (error) {
    console.error("Arkaplan ayarları güncelleme hatası:", error);
    res.status(500).json({
      success: false,
      message: "Arkaplan ayarları güncellenirken bir hata oluştu",
      error: error.message,
    });
  }
});

// Outfit item'larının pozisyonlarını güncelleme endpoint'i
router.put("/wardrobe/outfit-items/position", async (req, res) => {
  try {
    const { outfitId, itemPositions } = req.body;

    if (!outfitId || !itemPositions || !Array.isArray(itemPositions)) {
      return res.status(400).json({
        success: false,
        message: "Outfit ID ve item pozisyonları gerekli",
        receivedData: { outfitId, itemPositionsType: typeof itemPositions },
      });
    }

    console.log(`Outfit ID: ${outfitId} için pozisyon güncellemesi yapılıyor`);
    console.log(
      `Toplam ${itemPositions.length} adet item pozisyonu güncelleniyor`
    );

    // Başarıyla güncellenen itemların listesi
    const updatedItems = [];
    const failedItems = [];

    // Her bir item pozisyonunu güncelle
    for (const positionData of itemPositions) {
      const { itemId, x, y, scale, rotation, zIndex } = positionData;

      if (!itemId) {
        console.log("itemId olmadan güncelleme atlandı");
        continue;
      }

      try {
        // Önce bu item'ın outfit'te olup olmadığını kontrol et
        const { data: existingItems, error: checkError } = await supabase
          .from("wardrobe_outfit_items")
          .select("*")
          .eq("outfit_id", outfitId)
          .eq("item_id", itemId);

        if (checkError) {
          console.error(`Item ${itemId} kontrol hatası:`, checkError);
          failedItems.push({ itemId, error: checkError.message });
          continue;
        }

        if (!existingItems || existingItems.length === 0) {
          console.log(
            `Item ${itemId} outfit'te bulunamadı, güncelleme yapılmayacak`
          );
          failedItems.push({
            itemId,
            error: "Item outfit'te bulunamadı",
          });
          continue;
        }

        // Konum bilgilerini güncelle
        const updateData = {};
        if (x !== undefined) updateData.position_x = x;
        if (y !== undefined) updateData.position_y = y;
        if (scale !== undefined) updateData.scale = scale;
        if (rotation !== undefined) updateData.rotation = rotation;
        if (zIndex !== undefined) updateData.z_index = zIndex;

        // Boş update isteği kontrol et
        if (Object.keys(updateData).length === 0) {
          console.log(`Item ${itemId} için güncellenecek veri yok`);
          continue;
        }

        // Güncelleme işlemini yap
        const { data: updatedData, error: updateError } = await supabase
          .from("wardrobe_outfit_items")
          .update(updateData)
          .eq("outfit_id", outfitId)
          .eq("item_id", itemId);

        if (updateError) {
          console.error(
            `Item ${itemId} pozisyon güncelleme hatası:`,
            updateError
          );
          failedItems.push({ itemId, error: updateError.message });
        } else {
          console.log(`Item ${itemId} pozisyonu başarıyla güncellendi`);
          updatedItems.push({
            itemId,
            updated: true,
            values: updateData,
          });
        }
      } catch (itemError) {
        console.error(`Item ${itemId} işleme hatası:`, itemError);
        failedItems.push({ itemId, error: itemError.message });
      }
    }

    // Outfit'in son güncelleme zamanını güncelle
    try {
      await supabase
        .from("wardrobe_outfits")
        .update({ updated_at: new Date().toISOString() })
        .eq("id", outfitId);
    } catch (outfitUpdateError) {
      console.error(
        "Outfit son güncelleme zamanı güncellenemedi:",
        outfitUpdateError
      );
    }

    res.status(200).json({
      success: true,
      message: `${updatedItems.length} adet item pozisyonu güncellendi, ${failedItems.length} adet başarısız`,
      updatedItems,
      failedItems: failedItems.length > 0 ? failedItems : undefined,
    });
  } catch (error) {
    console.error("Item pozisyonları güncellenirken hata:", error);
    res.status(500).json({
      success: false,
      message: "Item pozisyonları güncellenirken bir hata oluştu",
      error: error.message,
    });
  }
});

// Geçici resim yükleme endpoint'i
router.post(
  "/wardrobe/upload-temp-image",
  upload.single("image"),
  async (req, res) => {
    try {
      // Yüklenen dosya kontrolü
      if (!req.file) {
        return res.status(400).json({
          success: false,
          message: "Yüklenecek resim gerekli",
        });
      }

      console.log(
        "Geçici resim yükleme isteği geldi, dosya boyutu:",
        req.file.size
      );

      // Benzersiz bir dosya adı oluştur
      const fileExt = req.file.originalname.split(".").pop();
      const fileName = `temp_${Date.now()}_${Math.random()
        .toString(36)
        .substring(2, 15)}.${fileExt}`;

      // Resmi wardrobes bucket'ına yükle
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from("wardrobes")
        .upload(fileName, req.file.buffer, {
          contentType: req.file.mimetype,
          cacheControl: "3600",
        });

      if (uploadError) {
        console.error("Supabase'e resim yükleme hatası:", uploadError);
        throw uploadError;
      }

      // Yüklenen resmin public URL'ini al
      const { data: publicUrlData } = supabase.storage
        .from("wardrobes")
        .getPublicUrl(fileName);

      const imageUrl = publicUrlData.publicUrl;
      console.log("Resim başarıyla yüklendi, URL:", imageUrl);

      // Başarılı yanıt dön
      res.status(200).json({
        success: true,
        message: "Resim başarıyla yüklendi",
        imageUrl: imageUrl,
      });
    } catch (error) {
      console.error("Geçici resim yükleme hatası:", error);
      res.status(500).json({
        success: false,
        message: "Resim yüklenirken bir hata oluştu",
        error: error.message,
      });
    }
  }
);

// Wardrobe öğesinin ismini güncelle endpoint'i
router.put("/wardrobe/:id/rename", async (req, res) => {
  try {
    const { id } = req.params;
    const { itemName } = req.body;

    if (!id || !itemName) {
      return res.status(400).json({
        success: false,
        message: "Ürün ID ve yeni isim gerekli",
      });
    }

    console.log(
      `Ürün yeniden adlandırma isteği. Ürün ID: ${id}, Yeni isim: ${itemName}`
    );

    // Önce mevcut öğeyi kontrol et
    const { data: existingItem, error: fetchError } = await supabase
      .from("wardrobe_items")
      .select("*")
      .eq("id", id)
      .single();

    if (fetchError) {
      throw fetchError;
    }

    if (!existingItem) {
      return res.status(404).json({
        success: false,
        message: "Güncellenecek ürün bulunamadı",
      });
    }

    // Öğeyi güncelle
    const { data, error } = await supabase
      .from("wardrobe_items")
      .update({
        item_name: itemName,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select();

    if (error) {
      throw error;
    }

    res.status(200).json({
      success: true,
      message: "Ürün ismi başarıyla güncellendi",
      data: data[0],
    });
  } catch (error) {
    console.error("Wardrobe öğesi isim güncelleme hatası:", error);
    res.status(500).json({
      success: false,
      message: "Ürün ismi güncellenirken bir hata oluştu",
      error: error.message,
    });
  }
});

// Outfit cover görselini yükleyen endpoint
router.post(
  "/wardrobe/outfits/:id/cover",
  upload.single("image"),
  async (req, res) => {
    try {
      const { id } = req.params;

      if (!id) {
        return res.status(400).json({
          success: false,
          message: "Outfit ID gerekli",
        });
      }

      // Yüklenen dosya kontrolü
      if (!req.file) {
        return res.status(400).json({
          success: false,
          message: "Yüklenecek kapak görseli gerekli",
        });
      }

      console.log(`Outfit ID: ${id} için kapak görseli yükleniyor...`);
      console.log("Dosya boyutu:", req.file.size);

      // Outfit'in var olduğunu kontrol et
      const { data: existingOutfit, error: checkError } = await supabase
        .from("wardrobe_outfits")
        .select("id, outfit_cover_url")
        .eq("id", id)
        .single();

      if (checkError) {
        console.error("Outfit kontrol hatası:", checkError);
        return res.status(404).json({
          success: false,
          message: "Outfit bulunamadı veya erişim hatası",
          error: checkError.message,
        });
      }

      // Benzersiz bir dosya adı oluştur
      const fileExt = req.file.originalname.split(".").pop();
      const fileName = `outfit_cover_url_${id}_${Date.now()}.${fileExt}`;

      // Eğer daha önce bir cover görsel varsa, onu silmek için işaretleyelim
      let oldFileName = null;
      if (existingOutfit.outfit_cover_url) {
        oldFileName = existingOutfit.outfit_cover_url.split("/").pop();
        console.log(`Eski kapak görseli bulundu: ${oldFileName}`);
      }

      // Resmi covers bucket'ına yükle
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from("covers")
        .upload(fileName, req.file.buffer, {
          contentType: req.file.mimetype,
          cacheControl: "3600",
        });

      if (uploadError) {
        console.error("Supabase'e kapak görseli yükleme hatası:", uploadError);
        throw uploadError;
      }

      // Yüklenen resmin public URL'ini al
      const { data: publicUrlData } = supabase.storage
        .from("covers")
        .getPublicUrl(fileName);

      const imageUrl = publicUrlData.publicUrl;
      console.log("Kapak görseli başarıyla yüklendi, URL:", imageUrl);

      // Outfit'i güncelle - outfit_cover_url alanına yeni URL'i kaydet
      const { data: updatedOutfit, error: updateError } = await supabase
        .from("wardrobe_outfits")
        .update({
          outfit_cover_url: imageUrl,
          updated_at: new Date().toISOString(),
        })
        .eq("id", id)
        .select();

      if (updateError) {
        console.error("Outfit güncelleme hatası:", updateError);
        throw updateError;
      }

      // Eğer eski bir kapak görseli varsa ve başarıyla güncellemişsek, eski görseli sil
      if (oldFileName) {
        try {
          await supabase.storage.from("covers").remove([oldFileName]);
          console.log(`Eski kapak görseli silindi: ${oldFileName}`);
        } catch (deleteError) {
          console.error("Eski kapak görseli silinirken hata:", deleteError);
          // Bu hata kritik değil, işleme devam edebiliriz
        }
      }

      // Başarılı yanıt dön
      res.status(200).json({
        success: true,
        message: "Outfit kapak görseli başarıyla güncellendi",
        data: {
          id: id,
          coverUrl: imageUrl,
        },
      });
    } catch (error) {
      console.error("Outfit kapak görseli güncelleme hatası:", error);
      res.status(500).json({
        success: false,
        message: "Outfit kapak görseli güncellenirken bir hata oluştu",
        error: error.message,
      });
    }
  }
);

// Çoklu ürün ekleme endpoint'i
router.post(
  "/wardrobe/add-multiple",
  upload.array("images"),
  async (req, res) => {
    try {
      console.log("========== ÇOKLU ÜRÜN EKLEME İSTEĞİ ALINDI ==========");
      const { items } = req.body;
      let parsedItems = [];

      // items string olarak geldiyse parse et
      if (typeof items === "string") {
        try {
          parsedItems = JSON.parse(items);
          console.log("JSON string olarak gelen items parse edildi.");
        } catch (e) {
          console.error("JSON parse hatası:", e);
          return res.status(400).json({
            success: false,
            message: "Geçersiz JSON formatı",
            error: e.message,
          });
        }
      } else {
        parsedItems = items;
        console.log("JSON object olarak gelen items direkt kullanıldı.");
      }

      console.log("Gelen veriler:", JSON.stringify(req.body, null, 2));
      console.log("Items türü:", typeof items);
      console.log(
        "Ayrıştırılmış öğeler:",
        parsedItems ? parsedItems.length : 0
      );

      // İlk öğenin processedImageUri veya image_url alanı var mı kontrol et
      if (parsedItems && parsedItems.length > 0) {
        console.log(
          "İlk öğenin içeriği:",
          JSON.stringify(parsedItems[0], null, 2)
        );
        console.log("İlk öğenin resim alanları:");
        console.log("- processedImageUri:", parsedItems[0].processedImageUri);
        console.log("- image_url:", parsedItems[0].image_url);
      }

      if (
        !parsedItems ||
        !Array.isArray(parsedItems) ||
        parsedItems.length === 0
      ) {
        return res.status(400).json({
          success: false,
          message: "Eklenecek ürünler gerekli",
          receivedBody: req.body,
        });
      }

      const results = [];
      const errors = [];

      // Her bir ürün için ayrı işlem yap
      for (let i = 0; i < parsedItems.length; i++) {
        try {
          const item = parsedItems[i];

          const {
            userId,
            itemName,
            category,
            seasons,
            color,
            notes,
            linkAddress,
            itemSize,
            purchasePrice,
            purchaseDate,
            tags,
            visibility,
            processedImageUri, // İşlenmiş resim URL'si
            image_url, // Alternatif alan adı
            currency, // Para birimi
          } = item;

          console.log(`Ürün ${i + 1} işleniyor:`, {
            userId,
            itemName,
            category,
            purchasePrice,
            purchaseDate,
          });

          if (!userId || !itemName || !category) {
            errors.push({
              index: i,
              error: "Kullanıcı ID, ürün adı ve kategori zorunludur",
              data: { userId, itemName, category },
            });
            continue;
          }

          console.log(`Ürün ${i + 1} kaydediliyor:`, itemName);

          // İşlenmiş resim URL'si varsa Supabase'e yükle
          const imageUrlToUse = processedImageUri || image_url;
          console.log(`Ürün ${i + 1} için resim durumu:
            - processedImageUri: ${
              processedImageUri
                ? processedImageUri.substring(0, 30) + "..."
                : "YOK"
            }
            - image_url: ${
              image_url ? image_url.substring(0, 30) + "..." : "YOK"
            }
            - Kullanılacak URL: ${
              imageUrlToUse ? imageUrlToUse.substring(0, 30) + "..." : "YOK"
            }
          `);

          // URL var mı kontrol et
          let supabaseImageUrl = null;

          if (imageUrlToUse) {
            // Eğer URL replicate içeriyorsa yükle
            if (imageUrlToUse.includes("replicate")) {
              try {
                console.log(
                  `Ürün ${i + 1} için Replicate URL Supabase'e yükleniyor...`
                );
                supabaseImageUrl = await uploadReplicateUrlToSupabase(
                  imageUrlToUse
                );
                // Sonucu kontrol et - eğer URL değişmişse başarılı
                const isSuccess =
                  supabaseImageUrl && supabaseImageUrl.includes("supabase");
                console.log(
                  `Ürün ${i + 1} için Supabase'e resim yükleme sonucu: ${
                    isSuccess ? "BAŞARILI" : "URL DEĞİŞMEDİ"
                  }`
                );
              } catch (uploadError) {
                console.error(
                  `Ürün ${i + 1} için Supabase yükleme hatası:`,
                  uploadError
                );
                supabaseImageUrl = imageUrlToUse; // Hata durumunda original URL'yi kullan
              }
            } else {
              // Replicate URL değilse doğrudan kullan
              supabaseImageUrl = imageUrlToUse;
              console.log(
                `Ürün ${
                  i + 1
                } için replicate URL olmadığından direkt kullanılıyor.`
              );
            }
          } else {
            console.log(
              `Ürün ${i + 1} için yüklenecek resim URL'si bulunamadı.`
            );
          }

          // Boş stringler için null kontrolleri - Kesin olarak null'a çevir
          const processedPurchasePrice =
            purchasePrice === "" ||
            purchasePrice === undefined ||
            purchasePrice === null
              ? null
              : purchasePrice;
          const processedPurchaseDate =
            purchaseDate === "" ||
            purchaseDate === undefined ||
            purchaseDate === null
              ? null
              : purchaseDate;

          console.log(`Ürün ${i + 1} işlenmiş değerleri:`, {
            originalPrice: purchasePrice,
            processedPrice: processedPurchasePrice,
            originalDate: purchaseDate,
            processedDate: processedPurchaseDate,
            imageUrl: supabaseImageUrl,
          });

          // Seasons ve tags verilerini kontrol et
          let parsedSeasons = [];
          if (seasons) {
            try {
              parsedSeasons = Array.isArray(seasons)
                ? seasons
                : JSON.parse(seasons);
            } catch (error) {
              console.error("Mevsim verisi ayrıştırma hatası:", error);
              parsedSeasons = [];
            }
          }

          let parsedTags = [];
          if (tags) {
            try {
              parsedTags = Array.isArray(tags) ? tags : JSON.parse(tags);
            } catch (error) {
              console.error("Etiket verisi ayrıştırma hatası:", error);
              parsedTags = [];
            }
          }

          // Veritabanı parametre nesnesi - Yazılması daha kolay olsun diye
          const dbParams = {
            user_id: userId,
            item_name: itemName,
            category: category,
            seasons: parsedSeasons,
            color: color || null,
            notes: notes || null,
            link_address: linkAddress || null,
            item_size: itemSize || null,
            purchase_price: processedPurchasePrice, // Düzeltilmiş fiyat
            purchase_date: processedPurchaseDate, // Düzeltilmiş tarih
            tags: parsedTags,
            visibility: visibility || "private",
            image_url: supabaseImageUrl, // Supabase'e yüklenmiş resim URL'sini kullan
            material: item.material || null, // Materyal bilgisini ekle
            style: item.style || null, // Stil bilgisini ekle
            product_gender: item.productGender || item.product_gender || null, // Ürün cinsiyet bilgisini ekle
            currency: item.currency || "TRY", // Para birimi bilgisini ekle, yoksa varsayılan TRY
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          };

          console.log(`Ürün ${i + 1} için DB parametreleri:`, dbParams);

          // Direkt INSERT sorgusu ile ürünü ekle (RPC çağrısını atlayalım)
          const { data: sqlData, error: sqlError } = await supabase
            .from("wardrobe_items")
            .insert(dbParams)
            .select("*");

          if (sqlError) {
            console.error(`Ürün ${i + 1} kaydedilirken hata:`, sqlError);
            errors.push({
              index: i,
              error: sqlError.message,
              code: sqlError.code,
              details: sqlError.details,
            });
            continue;
          }

          console.log(`Ürün ${i + 1} başarıyla kaydedildi`);
          results.push({
            index: i,
            success: true,
            method: "direct-insert",
            data: sqlData[0],
          });
        } catch (itemError) {
          console.error(`Ürün ${i + 1} kaydedilirken genel hata:`, itemError);
          errors.push({
            index: i,
            error: itemError.message,
            stack: itemError.stack,
          });
        }
      }

      // Sonuçları gönder
      res.status(200).json({
        success: errors.length === 0 || results.length > 0,
        message: `${results.length} ürün başarıyla eklendi, ${errors.length} ürün eklenirken hata oluştu`,
        results,
        errors: errors.length > 0 ? errors : undefined,
      });
    } catch (error) {
      console.error("Çoklu ürün ekleme hatası:", error);
      console.error("Hata yığını:", error.stack);
      console.error("Request body:", req.body);

      res.status(500).json({
        success: false,
        message: "Ürünler eklenirken bir hata oluştu",
        error: error.message,
        stack: error.stack,
      });
    }
  }
);

// Replicate URL'yi Supabase'e yüklemek için endpoint
router.post("/wardrobe/process-replicate-url", async (req, res) => {
  try {
    const { replicateUrl } = req.body;

    if (!replicateUrl) {
      return res.status(400).json({
        success: false,
        message: "Replicate URL'si gerekli",
      });
    }

    console.log(
      "İstek alındı. Replicate URL'si işleniyor:",
      replicateUrl.substring(0, 50) + "..."
    );

    // Önce URL'yi Supabase'e yükle
    const supabaseImageUrl = await uploadReplicateUrlToSupabase(replicateUrl);

    if (!supabaseImageUrl || supabaseImageUrl === replicateUrl) {
      return res.status(500).json({
        success: false,
        message: "Replicate URL'si Supabase'e yüklenemedi",
        originalUrl: replicateUrl,
      });
    }

    // Başarılı yanıt döndür
    res.status(200).json({
      success: true,
      message: "Replicate URL'si başarıyla Supabase'e yüklendi",
      imageUrl: supabaseImageUrl,
      originalUrl: replicateUrl,
    });
  } catch (error) {
    console.error("Replicate URL işleme hatası:", error);
    res.status(500).json({
      success: false,
      message: "Replicate URL'si işlenirken bir hata oluştu",
      error: error.message,
    });
  }
});

// Outfit görüntülenme sayısını artır
router.post("/wardrobe/outfits/:id/increment-views", async (req, res) => {
  try {
    const { id } = req.params;

    // Önce outfit'i kontrol et
    const { data: outfit, error: outfitError } = await supabase
      .from("wardrobe_outfits")
      .select("views_count")
      .eq("id", id)
      .single();

    if (outfitError) {
      throw outfitError;
    }

    if (!outfit) {
      return res.status(404).json({
        success: false,
        message: "Outfit bulunamadı",
      });
    }

    // Görüntülenme sayısını artır
    const newViewCount = (outfit.views_count || 0) + 1;

    // Veritabanını güncelle
    const { data: updatedOutfit, error: updateError } = await supabase
      .from("wardrobe_outfits")
      .update({ views_count: newViewCount })
      .eq("id", id)
      .select("views_count")
      .single();

    if (updateError) {
      throw updateError;
    }

    res.status(200).json({
      success: true,
      data: {
        viewCount: updatedOutfit.views_count,
      },
    });
  } catch (error) {
    console.error("Görüntülenme sayısı artırma hatası:", error);
    res.status(500).json({
      success: false,
      message: "Görüntülenme sayısı artırılırken bir hata oluştu",
      error: error.message,
    });
  }
});

// Beğeni sayısını artır/azalt
router.post("/wardrobe/outfits/:id/toggle-like", async (req, res) => {
  try {
    const { id } = req.params;
    const { userId, action } = req.body;

    if (!userId || !action || !["like", "unlike"].includes(action)) {
      return res.status(400).json({
        success: false,
        message:
          "Kullanıcı ID ve geçerli bir işlem (like veya unlike) zorunludur",
      });
    }

    // Önce outfit'i kontrol et
    const { data: outfit, error: outfitError } = await supabase
      .from("wardrobe_outfits")
      .select("likes_count")
      .eq("id", id)
      .single();

    if (outfitError) {
      throw outfitError;
    }

    if (!outfit) {
      return res.status(404).json({
        success: false,
        message: "Outfit bulunamadı",
      });
    }

    // Beğeni sayısını artır veya azalt
    const newLikeCount =
      action === "like"
        ? Math.max(0, (outfit.likes_count || 0) + 1)
        : Math.max(0, (outfit.likes_count || 0) - 1);

    // Veritabanını güncelle
    const { data: updatedOutfit, error: updateError } = await supabase
      .from("wardrobe_outfits")
      .update({ likes_count: newLikeCount })
      .eq("id", id)
      .select("likes_count")
      .single();

    if (updateError) {
      throw updateError;
    }
    // İsteğe bağlı: outfit_likes tablosunu güncelle (ilişkisel takip için)
    let likeResult;
    if (action === "like") {
      // Beğeni kaydını ekle
      console.log(`Beğeni kaydı ekleniyor: user=${userId}, outfit=${id}`);

      try {
        // Doğrudan wardrobe_outfit_likes tablosunu kullan - foreign key sorunu yaşamayacak
        const { data: likeData, error: likeError } = await supabase
          .from("wardrobe_outfit_likes") // Foreign key kısıtlaması olmayan tablo
          .upsert([
            {
              user_id: userId,
              outfit_id: id,
              created_at: new Date().toISOString(),
            },
          ]);

        if (likeError) {
          console.error("Beğeni kaydı hatası:", likeError);
          console.log(
            "Sadece beğeni sayısı güncellendi, ilişkisel kayıt yapılamadı"
          );

          // Hata detayları logla
          if (likeError.code) {
            console.error("Hata kodu:", likeError.code);
          }
          if (likeError.message) {
            console.error("Hata mesajı:", likeError.message);
          }
          if (likeError.details) {
            console.error("Hata detayları:", likeError.details);
          }

          likeResult = {
            success: false,
            action: "like",
            error: likeError.message || "Bilinmeyen hata",
          };
        } else {
          console.log("Beğeni kaydı başarıyla eklendi");
          likeResult = { success: true, action: "like", data: likeData };
        }
      } catch (likeError) {
        console.error(
          "Beğeni kaydı işlemi sırasında beklenmeyen hata:",
          likeError
        );
        likeResult = {
          success: false,
          action: "like",
          error: likeError.message || "Bilinmeyen hata",
        };
        // Hata olsa bile işlemi başarılı sayalım, çünkü ana tabloda likes_count artık güncellendi
      }
    } else {
      // Beğeni kaydını kaldır
      console.log(`Beğeni kaydı kaldırılıyor: user=${userId}, outfit=${id}`);

      try {
        // Doğrudan wardrobe_outfit_likes tablosundan sil
        const { data: deleteData, error: deleteError } = await supabase
          .from("wardrobe_outfit_likes")
          .delete()
          .eq("user_id", userId)
          .eq("outfit_id", id)
          .select();

        if (deleteError) {
          console.error("Beğeni kaydı silme hatası:", deleteError);
          likeResult = {
            success: false,
            action: "unlike",
            error: deleteError.message || "Bilinmeyen hata",
          };
        } else {
          console.log("Beğeni kaydı başarıyla silindi");
          likeResult = { success: true, action: "unlike", data: deleteData };
        }
      } catch (deleteError) {
        console.error(
          "Beğeni silme işlemi sırasında beklenmeyen hata:",
          deleteError
        );
        likeResult = {
          success: false,
          action: "unlike",
          error: deleteError.message || "Bilinmeyen hata",
        };
        // Hata olsa bile işlemi başarılı sayalım
      }
    }

    res.status(200).json({
      success: true,
      message:
        action === "like" ? "Outfit beğenildi" : "Outfit beğenisi kaldırıldı",
      data: {
        likeCount: updatedOutfit.likes_count,
        isLiked: action === "like",
        likeResult,
      },
    });
  } catch (error) {
    console.error("Beğeni işlemi hatası:", error);
    res.status(500).json({
      success: false,
      message: "Beğeni işlemi sırasında bir hata oluştu",
      error: error.message,
    });
  }
});

// YORUM İŞLEMLERİ İÇİN YENİ API ENDPOINT'LERİ

// Yorum ekle
router.post("/wardrobe/outfits/comment", async (req, res) => {
  try {
    const { userId, outfitId, comment, parent_id } = req.body;

    if (!userId || !outfitId || !comment) {
      return res.status(400).json({
        success: false,
        message: "Kullanıcı ID, Outfit ID ve yorum içeriği zorunludur",
      });
    }

    // Eğer parent_id varsa, bu ID'ye sahip bir yorum olduğundan emin ol
    if (parent_id) {
      const { data: parentComment, error: parentError } = await supabase
        .from("wardrobe_outfit_comments") // Yeni tablo
        .select("id")
        .eq("id", parent_id)
        .single();

      if (parentError || !parentComment) {
        console.log("Ebeveyn yorum kontrol hatası:", parentError);
        return res.status(400).json({
          success: false,
          message: "Yanıt verilmek istenen yorum bulunamadı",
        });
      }
    }

    console.log(`Yorum ekleniyor: user=${userId}, outfit=${outfitId}`);

    // Yorumu ekle - foreign key kısıtlaması olmayan tabloyu kullan
    const { data, error } = await supabase
      .from("wardrobe_outfit_comments") // Yeni tablo
      .insert([
        {
          user_id: userId,
          outfit_id: outfitId,
          comment: comment,
          parent_id: parent_id || null,
          created_at: new Date().toISOString(),
        },
      ])
      .select();

    if (error) {
      console.error("Yorum ekleme hatası:", error);

      // Hata detaylarını logla
      if (error.code) console.error("Hata kodu:", error.code);
      if (error.message) console.error("Hata mesajı:", error.message);
      if (error.details) console.error("Hata detayları:", error.details);

      throw error;
    }

    console.log("Yorum başarıyla eklendi:", data[0].id);

    // Yorum sayısını getir
    const { count, error: countError } = await supabase
      .from("wardrobe_outfit_comments") // Yeni tablo
      .select("id", { count: "exact", head: true })
      .eq("outfit_id", outfitId);

    if (countError) {
      console.error("Yorum sayısı sayma hatası:", countError);
      throw countError;
    }

    console.log(`Toplam yorum sayısı: ${count}`);

    // wardrobe_outfits tablosundaki comments_count alanını güncelle
    const { error: updateError } = await supabase
      .from("wardrobe_outfits")
      .update({ comments_count: count || 0 })
      .eq("id", outfitId);

    if (updateError) {
      console.error("Yorum sayısı güncellenirken hata:", updateError);
    }

    res.status(201).json({
      success: true,
      message: "Yorum başarıyla eklendi",
      data: {
        comment: data[0],
        commentCount: count || 0,
      },
    });
  } catch (error) {
    console.error("Yorum ekleme hatası:", error);
    res.status(500).json({
      success: false,
      message: "Yorum eklenirken bir hata oluştu",
      error: error.message,
    });
  }
});

// Outfit yorumlarını getir
router.get("/wardrobe/outfits/:outfitId/comments", async (req, res) => {
  try {
    const { outfitId } = req.params;
    const limit = parseInt(req.query.limit) || 50;
    const offset = parseInt(req.query.offset) || 0;

    if (!outfitId) {
      return res.status(400).json({
        success: false,
        message: "Outfit ID zorunludur",
      });
    }

    console.log(
      `Yorumlar getiriliyor, outfit=${outfitId}, limit=${limit}, offset=${offset}`
    );

    // Yorumları users tablosu ile join yaparak getir
    const {
      data: comments,
      error: commentsError,
      count,
    } = await supabase
      .from("wardrobe_outfit_comments")
      .select(
        `
        *,
        users:user_id (
          id,
          username,
          avatar_url
        )
      `,
        { count: "exact" }
      )
      .eq("outfit_id", outfitId)
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (commentsError) {
      console.error("Yorum getirme hatası:", commentsError);
      throw commentsError;
    }

    // Eğer yorum yoksa boş array dön
    if (!comments || comments.length === 0) {
      console.log("Hiç yorum bulunamadı");
      return res.status(200).json({
        success: true,
        data: [],
        pagination: {
          total: 0,
          limit,
          offset,
        },
      });
    }

    console.log(`${comments.length} adet yorum bulundu`);

    // Kullanıcı bilgisi ile birlikte gelen yorumları formatla
    const commentsWithUserInfo = comments.map((comment) => {
      return {
        ...comment,
        user: comment.users || {
          id: comment.user_id,
          username: "Bilinmeyen Kullanıcı",
          avatar_url: null,
        },
      };
    });

    res.status(200).json({
      success: true,
      data: commentsWithUserInfo,
      pagination: {
        total: count || 0,
        limit,
        offset,
      },
    });
  } catch (error) {
    console.error("Yorumları getirme hatası:", error);
    res.status(500).json({
      success: false,
      message: "Yorumlar getirilirken bir hata oluştu",
      error: error.message,
    });
  }
});

// Wardrobe outfit'lerini kaydet/kayıt kaldır (toggle)
router.post("/wardrobe/outfits/save", async (req, res) => {
  try {
    const { userId, outfitId } = req.body;

    if (!userId || !outfitId) {
      return res.status(400).json({
        success: false,
        message: "Kullanıcı ID ve Outfit ID zorunludur",
      });
    }

    console.log(`Kaydetme işlemi, user=${userId}, outfit=${outfitId}`);

    // Önce kayıt durumunu kontrol et
    const { data: existingSave, error: checkError } = await supabase
      .from("wardrobe_outfit_saves") // Yeni tablo
      .select("*")
      .eq("user_id", userId)
      .eq("outfit_id", outfitId)
      .single();

    if (checkError && checkError.code !== "PGRST116") {
      // PGRST116: Tek sonuç beklenen sorguda sonuç bulunamadı
      console.error("Kayıt durumu kontrol hatası:", checkError);
      throw checkError;
    }

    let result;
    let message;
    let isSaved;

    // Kayıt varsa sil, yoksa ekle
    if (existingSave) {
      console.log("Önceki kayıt bulundu, siliniyor:", existingSave.id);

      const { error: deleteError } = await supabase
        .from("wardrobe_outfit_saves") // Yeni tablo
        .delete()
        .eq("id", existingSave.id);

      if (deleteError) {
        console.error("Kayıt silme hatası:", deleteError);
        throw deleteError;
      }

      message = "Outfit kaydı kaldırıldı";
      isSaved = false;
      result = null;
      console.log("Kayıt başarıyla silindi");
    } else {
      console.log("Yeni kayıt oluşturuluyor");

      const { data: insertData, error: insertError } = await supabase
        .from("wardrobe_outfit_saves") // Yeni tablo
        .insert([
          {
            user_id: userId,
            outfit_id: outfitId,
            created_at: new Date().toISOString(),
          },
        ])
        .select();

      if (insertError) {
        console.error("Kayıt ekleme hatası:", insertError);
        throw insertError;
      }

      message = "Outfit kaydedildi";
      isSaved = true;
      result = insertData[0];
      console.log("Outfit başarıyla kaydedildi:", result?.id);
    }

    // Kaydedilen toplam sayıyı getir
    const { count, error: countError } = await supabase
      .from("wardrobe_outfit_saves") // Yeni tablo
      .select("id", { count: "exact", head: true })
      .eq("outfit_id", outfitId);

    if (countError) {
      console.error("Kayıt sayısı sayma hatası:", countError);
      throw countError;
    }

    console.log(`Toplam kayıt sayısı: ${count}`);

    // wardrobe_outfits tablosunda saves_count güncelle
    const { error: updateError } = await supabase
      .from("wardrobe_outfits")
      .update({ saves_count: count || 0 })
      .eq("id", outfitId);

    if (updateError) {
      console.error("Kaydetme sayısı güncellenirken hata:", updateError);
    }

    res.status(200).json({
      success: true,
      message: message,
      data: {
        isSaved: isSaved,
        saveCount: count || 0,
        save: result,
      },
    });
  } catch (error) {
    console.error("Outfit kaydetme hatası:", error);
    res.status(500).json({
      success: false,
      message: "Outfit kaydedilirken bir hata oluştu",
      error: error.message,
    });
  }
});

// Tek bir outfit detayı getir
router.get("/wardrobe/outfits/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.query.userId; // Kullanıcı ID'si de gerekli

    if (!id) {
      return res.status(400).json({
        success: false,
        message: "Outfit ID gerekli",
      });
    }

    console.log(
      `Outfit detayı getiriliyor. ID: ${id}, UserId: ${
        userId || "belirtilmedi"
      }`
    );

    // Outfit detayını getir - users tablosu ile join yaparak kullanıcı bilgilerini de al
    const { data: outfit, error: outfitError } = await supabase
      .from("wardrobe_outfits")
      .select(
        `
        *,
        users:user_id (
          id,
          username,
          avatar_url
        )
      `
      )
      .eq("id", id)
      .single();

    if (outfitError) {
      console.error("Outfit detayı getirme hatası:", outfitError);
      return res.status(404).json({
        success: false,
        message: "Outfit bulunamadı",
        error: outfitError.message,
      });
    }

    if (!outfit) {
      return res.status(404).json({
        success: false,
        message: "Outfit bulunamadı",
      });
    }

    // Kullanıcı bilgilerini kontrol et
    console.log("Outfit'in users bilgisi:", outfit.users);

    // Eğer kullanıcı ID'si verilmişse, beğeni durumunu kontrol et
    let isLiked = false;

    if (userId) {
      // Kullanıcının bu outfit'i beğenip beğenmediğini kontrol et
      const { data: likeRecord, error: likeError } = await supabase
        .from("wardrobe_outfit_likes")
        .select("id")
        .eq("user_id", userId)
        .eq("outfit_id", id)
        .maybeSingle();

      if (!likeError && likeRecord) {
        isLiked = true;
      }

      if (likeError && likeError.code !== "PGRST116") {
        // PGRST116: Tek sonuç beklenen sorguda sonuç bulunamadı
        console.error("Beğeni durumu kontrol hatası:", likeError);
      }
    }

    // Outfit bilgisine beğeni durumunu ekle
    const outfitWithLikeInfo = {
      ...outfit,
      isLiked,
    };

    console.log(
      `Outfit detayı başarıyla getirildi. Beğeni durumu: ${
        isLiked ? "Beğenilmiş" : "Beğenilmemiş"
      }`
    );

    return res.status(200).json({
      success: true,
      data: outfitWithLikeInfo,
    });
  } catch (error) {
    console.error("Outfit detayı getirme hatası:", error);
    res.status(500).json({
      success: false,
      message: "Outfit detayı getirilirken bir hata oluştu",
      error: error.message,
    });
  }
});

module.exports = router;
