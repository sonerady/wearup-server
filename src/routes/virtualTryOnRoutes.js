const express = require("express");
const router = express.Router();
const supabase = require("../supabaseClient");

// Yeni bir Virtual Try On kaydı oluştur
router.post("/virtual-tryon", async (req, res) => {
  try {
    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "Kullanıcı ID'si zorunludur",
      });
    }

    // Önce Virtual Try On kaydını oluştur
    const { data: tryonData, error: tryonError } = await supabase
      .from("virtual_tryons")
      .insert([
        {
          user_id: userId,
          status: "pending",
          created_at: new Date().toISOString(),
        },
      ])
      .select();

    if (tryonError) {
      throw tryonError;
    }

    if (!tryonData || tryonData.length === 0) {
      throw new Error("Virtual Try On kaydı oluşturulamadı");
    }

    const tryonId = tryonData[0].id;

    res.status(201).json({
      success: true,
      message: "Virtual Try On kaydı başarıyla oluşturuldu",
      data: {
        id: tryonId,
        status: "pending",
      },
    });
  } catch (error) {
    console.error("Virtual Try On oluşturma hatası:", error);
    res.status(500).json({
      success: false,
      message: "Virtual Try On oluşturulurken bir hata oluştu",
      error: error.message,
    });
  }
});

// Bir kullanıcının tüm Virtual Try On kayıtlarını getir
router.get("/virtual-tryon/user/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    const { limit = 10, offset = 0 } = req.query;

    // Kullanıcının tüm Virtual Try On kayıtlarını getir
    const {
      data: tryonData,
      error: tryonError,
      count,
    } = await supabase
      .from("virtual_tryons")
      .select("*", { count: "exact" })
      .eq("user_id", userId)
      .eq("is_deleted", false)
      .order("created_at", { ascending: false })
      .range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1);

    if (tryonError) {
      throw tryonError;
    }

    // Her bir Try On için fotoğrafları getir
    const tryonWithPhotos = await Promise.all(
      tryonData.map(async (tryon) => {
        // Model fotoğraflarını getir
        const { data: modelPhotos, error: modelError } = await supabase
          .from("virtual_tryon_model_photos")
          .select("*")
          .eq("tryon_id", tryon.id)
          .order("created_at", { ascending: false });

        if (modelError) {
          console.error("Model fotoğrafları getirme hatası:", modelError);
          return { ...tryon, modelPhotos: [], productPhotos: [] };
        }

        // Ürün fotoğraflarını getir
        const { data: productPhotos, error: productError } = await supabase
          .from("virtual_tryon_product_photos")
          .select("*")
          .eq("tryon_id", tryon.id)
          .order("created_at", { ascending: false });

        if (productError) {
          console.error("Ürün fotoğrafları getirme hatası:", productError);
          return { ...tryon, modelPhotos, productPhotos: [] };
        }

        return {
          ...tryon,
          modelPhotos: modelPhotos || [],
          productPhotos: productPhotos || [],
        };
      })
    );

    res.status(200).json({
      success: true,
      data: tryonWithPhotos,
      pagination: {
        total: count,
        offset: parseInt(offset),
        limit: parseInt(limit),
      },
    });
  } catch (error) {
    console.error("Virtual Try On kayıtları getirme hatası:", error);
    res.status(500).json({
      success: false,
      message: "Virtual Try On kayıtları getirilirken bir hata oluştu",
      error: error.message,
    });
  }
});

// ID'ye göre Virtual Try On kaydını getir
router.get("/virtual-tryon/:id", async (req, res) => {
  try {
    const { id } = req.params;

    // Virtual Try On kaydını getir
    const { data: tryon, error: tryonError } = await supabase
      .from("virtual_tryons")
      .select("*")
      .eq("id", id)
      .eq("is_deleted", false)
      .single();

    if (tryonError) {
      if (tryonError.code === "PGRST116") {
        return res.status(404).json({
          success: false,
          message: "Virtual Try On kaydı bulunamadı",
        });
      }
      throw tryonError;
    }

    // Model fotoğraflarını getir
    const { data: modelPhotos, error: modelError } = await supabase
      .from("virtual_tryon_model_photos")
      .select("*")
      .eq("tryon_id", id)
      .order("created_at", { ascending: false });

    if (modelError) {
      throw modelError;
    }

    // Ürün fotoğraflarını getir
    const { data: productPhotos, error: productError } = await supabase
      .from("virtual_tryon_product_photos")
      .select("*")
      .eq("tryon_id", id)
      .order("created_at", { ascending: false });

    if (productError) {
      throw productError;
    }

    res.status(200).json({
      success: true,
      data: {
        ...tryon,
        modelPhotos: modelPhotos || [],
        productPhotos: productPhotos || [],
      },
    });
  } catch (error) {
    console.error("Virtual Try On kaydı getirme hatası:", error);
    res.status(500).json({
      success: false,
      message: "Virtual Try On kaydı getirilirken bir hata oluştu",
      error: error.message,
    });
  }
});

// Virtual Try On'a model fotoğrafı ekle
router.post("/virtual-tryon/:id/model-photo", async (req, res) => {
  try {
    const { id } = req.params;
    const { photoUrl, isSelected = false } = req.body;

    if (!photoUrl) {
      return res.status(400).json({
        success: false,
        message: "Fotoğraf URL'i zorunludur",
      });
    }

    // Try On kaydının var olduğunu kontrol et
    const { data: tryon, error: tryonError } = await supabase
      .from("virtual_tryons")
      .select("*")
      .eq("id", id)
      .single();

    if (tryonError) {
      if (tryonError.code === "PGRST116") {
        return res.status(404).json({
          success: false,
          message: "Virtual Try On kaydı bulunamadı",
        });
      }
      throw tryonError;
    }

    // Eğer yeni fotoğraf seçili olacaksa, diğer tüm fotoğrafların seçili özelliğini kaldır
    if (isSelected) {
      const { error: updateError } = await supabase
        .from("virtual_tryon_model_photos")
        .update({ is_selected: false })
        .eq("tryon_id", id);

      if (updateError) {
        throw updateError;
      }
    }

    // Fotoğrafı ekle
    const { data: photo, error: photoError } = await supabase
      .from("virtual_tryon_model_photos")
      .insert([
        {
          tryon_id: id,
          photo_url: photoUrl,
          is_selected: isSelected,
          created_at: new Date().toISOString(),
        },
      ])
      .select();

    if (photoError) {
      throw photoError;
    }

    res.status(201).json({
      success: true,
      message: "Model fotoğrafı başarıyla eklendi",
      data: photo[0],
    });
  } catch (error) {
    console.error("Model fotoğrafı ekleme hatası:", error);
    res.status(500).json({
      success: false,
      message: "Model fotoğrafı eklenirken bir hata oluştu",
      error: error.message,
    });
  }
});

// Virtual Try On'a ürün fotoğrafı ekle
router.post("/virtual-tryon/:id/product-photo", async (req, res) => {
  try {
    const { id } = req.params;
    const { photoUrl, isSelected = false } = req.body;

    if (!photoUrl) {
      return res.status(400).json({
        success: false,
        message: "Fotoğraf URL'i zorunludur",
      });
    }

    // Try On kaydının var olduğunu kontrol et
    const { data: tryon, error: tryonError } = await supabase
      .from("virtual_tryons")
      .select("*")
      .eq("id", id)
      .single();

    if (tryonError) {
      if (tryonError.code === "PGRST116") {
        return res.status(404).json({
          success: false,
          message: "Virtual Try On kaydı bulunamadı",
        });
      }
      throw tryonError;
    }

    // Eğer yeni fotoğraf seçili olacaksa, diğer tüm fotoğrafların seçili özelliğini kaldır
    if (isSelected) {
      const { error: updateError } = await supabase
        .from("virtual_tryon_product_photos")
        .update({ is_selected: false })
        .eq("tryon_id", id);

      if (updateError) {
        throw updateError;
      }
    }

    // Fotoğrafı ekle
    const { data: photo, error: photoError } = await supabase
      .from("virtual_tryon_product_photos")
      .insert([
        {
          tryon_id: id,
          photo_url: photoUrl,
          is_selected: isSelected,
          created_at: new Date().toISOString(),
        },
      ])
      .select();

    if (photoError) {
      throw photoError;
    }

    res.status(201).json({
      success: true,
      message: "Ürün fotoğrafı başarıyla eklendi",
      data: photo[0],
    });
  } catch (error) {
    console.error("Ürün fotoğrafı ekleme hatası:", error);
    res.status(500).json({
      success: false,
      message: "Ürün fotoğrafı eklenirken bir hata oluştu",
      error: error.message,
    });
  }
});

// Model fotoğrafını seçili yap
router.put("/virtual-tryon/model-photo/:photoId/select", async (req, res) => {
  try {
    const { photoId } = req.params;

    // Önce fotoğrafı bul ve try_on_id'yi al
    const { data: photo, error: photoError } = await supabase
      .from("virtual_tryon_model_photos")
      .select("*")
      .eq("id", photoId)
      .single();

    if (photoError) {
      if (photoError.code === "PGRST116") {
        return res.status(404).json({
          success: false,
          message: "Fotoğraf bulunamadı",
        });
      }
      throw photoError;
    }

    // Aynı try_on_id'ye sahip tüm model fotoğraflarını seçilmemiş yap
    const { error: updateAllError } = await supabase
      .from("virtual_tryon_model_photos")
      .update({ is_selected: false })
      .eq("tryon_id", photo.tryon_id);

    if (updateAllError) {
      throw updateAllError;
    }

    // Seçilen fotoğrafı seçili yap
    const { data: updatedPhoto, error: updateError } = await supabase
      .from("virtual_tryon_model_photos")
      .update({ is_selected: true })
      .eq("id", photoId)
      .select();

    if (updateError) {
      throw updateError;
    }

    res.status(200).json({
      success: true,
      message: "Model fotoğrafı seçildi",
      data: updatedPhoto[0],
    });
  } catch (error) {
    console.error("Model fotoğrafı seçme hatası:", error);
    res.status(500).json({
      success: false,
      message: "Model fotoğrafı seçilirken bir hata oluştu",
      error: error.message,
    });
  }
});

// Ürün fotoğrafını seçili yap
router.put("/virtual-tryon/product-photo/:photoId/select", async (req, res) => {
  try {
    const { photoId } = req.params;

    // Önce fotoğrafı bul ve try_on_id'yi al
    const { data: photo, error: photoError } = await supabase
      .from("virtual_tryon_product_photos")
      .select("*")
      .eq("id", photoId)
      .single();

    if (photoError) {
      if (photoError.code === "PGRST116") {
        return res.status(404).json({
          success: false,
          message: "Fotoğraf bulunamadı",
        });
      }
      throw photoError;
    }

    // Aynı try_on_id'ye sahip tüm ürün fotoğraflarını seçilmemiş yap
    const { error: updateAllError } = await supabase
      .from("virtual_tryon_product_photos")
      .update({ is_selected: false })
      .eq("tryon_id", photo.tryon_id);

    if (updateAllError) {
      throw updateAllError;
    }

    // Seçilen fotoğrafı seçili yap
    const { data: updatedPhoto, error: updateError } = await supabase
      .from("virtual_tryon_product_photos")
      .update({ is_selected: true })
      .eq("id", photoId)
      .select();

    if (updateError) {
      throw updateError;
    }

    res.status(200).json({
      success: true,
      message: "Ürün fotoğrafı seçildi",
      data: updatedPhoto[0],
    });
  } catch (error) {
    console.error("Ürün fotoğrafı seçme hatası:", error);
    res.status(500).json({
      success: false,
      message: "Ürün fotoğrafı seçilirken bir hata oluştu",
      error: error.message,
    });
  }
});

// Virtual Try On işlemini başlat
router.post("/virtual-tryon/:id/process", async (req, res) => {
  try {
    const { id } = req.params;

    // Try On kaydının var olduğunu kontrol et
    const { data: tryon, error: tryonError } = await supabase
      .from("virtual_tryons")
      .select("*")
      .eq("id", id)
      .single();

    if (tryonError) {
      if (tryonError.code === "PGRST116") {
        return res.status(404).json({
          success: false,
          message: "Virtual Try On kaydı bulunamadı",
        });
      }
      throw tryonError;
    }

    // Seçili model fotoğrafını kontrol et
    const { data: modelPhoto, error: modelError } = await supabase
      .from("virtual_tryon_model_photos")
      .select("*")
      .eq("tryon_id", id)
      .eq("is_selected", true)
      .single();

    if (modelError && modelError.code !== "PGRST116") {
      throw modelError;
    }

    if (!modelPhoto) {
      return res.status(400).json({
        success: false,
        message: "Seçili model fotoğrafı bulunamadı",
      });
    }

    // Seçili ürün fotoğrafını kontrol et
    const { data: productPhoto, error: productError } = await supabase
      .from("virtual_tryon_product_photos")
      .select("*")
      .eq("tryon_id", id)
      .eq("is_selected", true)
      .single();

    if (productError && productError.code !== "PGRST116") {
      throw productError;
    }

    if (!productPhoto) {
      return res.status(400).json({
        success: false,
        message: "Seçili ürün fotoğrafı bulunamadı",
      });
    }

    // İşlemi başlat ve durumu güncelle
    const { data: updatedTryon, error: updateError } = await supabase
      .from("virtual_tryons")
      .update({
        status: "processing",
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select();

    if (updateError) {
      throw updateError;
    }

    // Burada gerçek işlemi başlatma kodu olacak (örneğin, bir AI servisi çağrısı)
    // ...

    // Örnek için durumu tamamlandı olarak güncelliyoruz
    setTimeout(async () => {
      try {
        // İşlem tamamlandı olarak işaretle (gerçek uygulamada farklı bir yerden güncellenecek)
        const { error: completeError } = await supabase
          .from("virtual_tryons")
          .update({
            status: "completed",
            result_photo: "https://example.com/result.jpg", // Örnek - gerçek sonuç URL'i olacak
            process_time: 2.5, // Örnek işlem süresi
            updated_at: new Date().toISOString(),
          })
          .eq("id", id);

        if (completeError) {
          console.error("İşlem tamamlama hatası:", completeError);
        }
      } catch (error) {
        console.error("İşlem tamamlama hatası:", error);
      }
    }, 5000); // 5 saniye sonra tamamlandı olarak işaretle (gerçek bir servis daha uzun sürebilir)

    res.status(200).json({
      success: true,
      message: "Virtual Try On işlemi başlatıldı",
      data: {
        id: id,
        status: "processing",
        modelPhoto: modelPhoto.photo_url,
        productPhoto: productPhoto.photo_url,
      },
    });
  } catch (error) {
    console.error("Virtual Try On işlemi başlatma hatası:", error);
    res.status(500).json({
      success: false,
      message: "Virtual Try On işlemi başlatılırken bir hata oluştu",
      error: error.message,
    });
  }
});

// Virtual Try On'u sil (soft delete)
router.delete("/virtual-tryon/:id", async (req, res) => {
  try {
    const { id } = req.params;

    // Try On kaydının var olduğunu kontrol et
    const { data: tryon, error: tryonError } = await supabase
      .from("virtual_tryons")
      .select("*")
      .eq("id", id)
      .single();

    if (tryonError) {
      if (tryonError.code === "PGRST116") {
        return res.status(404).json({
          success: false,
          message: "Virtual Try On kaydı bulunamadı",
        });
      }
      throw tryonError;
    }

    // Soft delete yap
    const { error: updateError } = await supabase
      .from("virtual_tryons")
      .update({
        is_deleted: true,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);

    if (updateError) {
      throw updateError;
    }

    res.status(200).json({
      success: true,
      message: "Virtual Try On kaydı silindi",
    });
  } catch (error) {
    console.error("Virtual Try On silme hatası:", error);
    res.status(500).json({
      success: false,
      message: "Virtual Try On silinirken bir hata oluştu",
      error: error.message,
    });
  }
});

module.exports = router;
