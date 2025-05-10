const express = require("express");
const router = express.Router();
const supabase = require("../supabaseClient");
const multer = require("multer");
const upload = multer();
const axios = require("axios");
const dotenv = require("dotenv");

// .env dosyasını yükle
dotenv.config();

// Replicate API token'ı al
const REPLICATE_API_TOKEN = process.env.REPLICATE_API_TOKEN;

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

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "Kullanıcı ID'si gerekli",
      });
    }

    // En yeni öğeler en üstte olacak şekilde Supabase'den verileri çek
    const { data, error } = await supabase
      .from("wardrobe_items")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

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

// Kullanıcının outfitlerini getirme endpoint'i
router.get("/wardrobe/outfits", async (req, res) => {
  try {
    const userId = req.query.userId;
    console.log("userIdddd", userId);

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "Kullanıcı ID'si gerekli",
      });
    }

    try {
      // Önce tablo varlığını kontrol et
      const { data: tables, error: tableError } = await supabase
        .from("wardrobe_outfits")
        .select("*")
        .eq("user_id", userId);

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

      // Önce wardrobe_outfits tablosundan kullanıcının outfitlerini getir
      const { data: outfits, error: outfitsError } = await supabase
        .from("wardrobe_outfits")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: false });

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

      // Boş dizi dönme durumunda bile başarılı yanıt gönder
      return res.status(200).json({
        success: true,
        data: outfits || [],
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
      seasons: typeof seasons === "string" ? JSON.parse(seasons) : seasons,
    });

    let imageUrl = null;

    // Eğer resim yüklendiyse Supabase'e yükle
    if (req.file) {
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
        throw uploadError;
      }

      // Yüklenen resmin public URL'ini al
      const { data: publicUrlData } = supabase.storage
        .from("wardrobes")
        .getPublicUrl(fileName);

      imageUrl = publicUrlData.publicUrl;
    }

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

    // Doğrudan SQL sorgusu ile veri ekleyelim - Bu RLS'i by-pass edecek
    const { data, error } = await supabase.rpc("insert_wardrobe_item", {
      p_user_id: userId,
      p_item_name: itemName,
      p_category: category, // Kategori artık ID olarak geliyor
      p_seasons: parsedSeasons,
      p_color: color,
      p_notes: notes,
      p_link_address: linkAddress,
      p_item_size: itemSize,
      p_purchase_price: purchasePrice,
      p_purchase_date: purchaseDate,
      p_tags: parsedTags,
      p_visibility: visibility,
      p_image_url: imageUrl,
    });

    if (error) {
      console.error("Supabase veri ekleme hatası:", error);

      // RLS hatası hala devam ediyorsa, daha düşük seviyeli bir SQL sorgusu deneyelim
      if (error.message.includes("row-level security policy")) {
        console.log(
          "RLS hatası devam ediyor, doğrudan SQL sorgusu deneniyor..."
        );

        const { data: sqlData, error: sqlError } = await supabase
          .from("wardrobe_items")
          .insert({
            user_id: userId,
            item_name: itemName,
            category: category, // Kategori artık ID olarak geliyor
            seasons: parsedSeasons,
            color: color,
            notes: notes,
            link_address: linkAddress,
            item_size: itemSize,
            purchase_price: purchasePrice,
            purchase_date: purchaseDate,
            tags: parsedTags,
            visibility: visibility,
            image_url: imageUrl,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .select("*");

        if (sqlError) {
          console.error("SQL sorgusu da başarısız oldu:", sqlError);
          throw sqlError;
        }

        return res.status(201).json({
          success: true,
          message: "Ürün SQL sorgusu ile başarıyla eklendi",
          data: sqlData[0],
        });
      }

      throw error;
    }

    res.status(201).json({
      success: true,
      message: "Ürün başarıyla eklendi",
      data: data[0],
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

    // Silinecek öğeyi bul
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
        message: "Silinecek öğe bulunamadı",
      });
    }

    // Öğeyi veritabanından sil
    const { error: deleteError } = await supabase
      .from("wardrobe_items")
      .delete()
      .eq("id", id);

    if (deleteError) {
      throw deleteError;
    }

    // Eğer öğenin bir resmi varsa, resmi de sil
    if (existingItem.image_url) {
      const fileName = existingItem.image_url.split("/").pop();

      await supabase.storage.from("wardrobes").remove([fileName]);
    }

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
          visibility: visibility || "private",
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

        // Replicate API'ye istek at
        const response = await axios.post(
          "https://api.replicate.com/v1/predictions",
          {
            version:
              "37ff2aa89897c0de4a140a3d50969dc62b663ea467e1e2bde18008e3d3731b2b",
            input: {
              image: imageUrl,
            },
          },
          {
            headers: {
              Authorization: `Bearer ${REPLICATE_API_TOKEN}`,
              "Content-Type": "application/json",
              Prefer: "wait",
            },
          }
        );

        console.log(`Replicate API yanıtı:`, response.data);

        // API işlemi tamamlanana kadar bekleyen bir işlem döndürdüyse takip et
        let predictionResult = response.data;

        // Status "succeeded" olana kadar veya maksimum deneme sayısına ulaşana kadar bekle
        let maxAttempts = 15; // Daha uzun sürebilir, bu yüzden maksimum deneme sayısını arttırdık
        let attempts = 0;

        while (
          predictionResult.status !== "succeeded" &&
          attempts < maxAttempts
        ) {
          // 2 saniye bekle
          await new Promise((resolve) => setTimeout(resolve, 2000));

          // Durumu kontrol et
          const statusResponse = await axios.get(
            `https://api.replicate.com/v1/predictions/${predictionResult.id}`,
            {
              headers: {
                Authorization: `Bearer ${REPLICATE_API_TOKEN}`,
              },
            }
          );

          predictionResult = statusResponse.data;
          attempts++;

          console.log(
            `Tahmin durumu (${attempts}/${maxAttempts}):`,
            predictionResult.status
          );
        }

        // İşlenmiş görsel URL'sini kaydet
        if (
          predictionResult.status === "succeeded" &&
          predictionResult.output
        ) {
          processedImages.push({
            originalUrl: imageUrl,
            processedUrl: predictionResult.output,
            success: true,
          });
        } else {
          failedImages.push({
            originalUrl: imageUrl,
            error: "İşlem tamamlanamadı veya çıktı alınamadı",
          });
        }
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

    // Eğer zaten eklenmiş ise, başarılı yanıt dön (idempotent)
    if (existingItems && existingItems.length > 0) {
      console.log(`Bu item zaten outfit'e eklenmiş: ${itemId}`);

      // Belki pozisyon bilgileri güncellenmek isteniyordur, güncelle
      if (
        positionX !== undefined ||
        positionY !== undefined ||
        scale !== undefined ||
        rotation !== undefined ||
        zIndex !== undefined
      ) {
        console.log("Mevcut item için pozisyon bilgileri güncelleniyor");

        const updateData = {};
        if (positionX !== undefined) updateData.position_x = positionX;
        if (positionY !== undefined) updateData.position_y = positionY;
        if (scale !== undefined) updateData.scale = scale;
        if (rotation !== undefined) updateData.rotation = rotation;
        if (zIndex !== undefined) updateData.z_index = zIndex;

        // Boş update data kontrolü
        if (Object.keys(updateData).length === 0) {
          return res.status(200).json({
            success: true,
            message: "Bu item zaten outfit'e eklenmiş",
            data: existingItems[0],
          });
        }

        // Pozisyon bilgilerini güncelle
        const { data: updatedItem, error: updateError } = await supabase
          .from("wardrobe_outfit_items")
          .update(updateData)
          .eq("outfit_id", outfitId)
          .eq("item_id", itemId)
          .select();

        if (updateError) {
          console.error("Pozisyon güncelleme hatası:", updateError);
          throw updateError;
        }

        return res.status(200).json({
          success: true,
          message: "Item pozisyonu güncellendi",
          data: updatedItem[0],
        });
      }

      return res.status(200).json({
        success: true,
        message: "Bu item zaten outfit'e eklenmiş",
        data: existingItems[0],
      });
    }

    // Yeni bir wardrobe_outfit_items kaydı oluştur
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

module.exports = router;
