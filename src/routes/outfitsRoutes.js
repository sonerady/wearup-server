const express = require("express");
const router = express.Router();
const supabase = require("../supabaseClient");

// Önce özel rotalar tanımlayalım
router.get("/outfits/saved_outfits", async (req, res) => {
  res.redirect("/api/outfits/saved");
});

// Tüm outfitleri getir
router.get("/outfits", async (req, res) => {
  try {
    const { userId } = req.query;

    // Outfits ve users tablolarını birleştirerek verileri getir
    const { data, error } = await supabase
      .from("outfits")
      .select(
        `
        *,
        users:user_id (
          username,
          avatar_url
        )
      `
      )
      .order("created_at", { ascending: false });

    if (error) {
      throw error;
    }

    // Kullanıcı ID'si varsa, beğeni durumlarını kontrol et
    if (userId) {
      // Kullanıcının tüm beğenilerini getir
      const { data: likedOutfits, error: likeError } = await supabase
        .from("outfit_likes")
        .select("outfit_id")
        .eq("user_id", userId);

      if (likeError) {
        console.error("Beğeni durumları getirilirken hata:", likeError);
      } else {
        // Beğenilen outfit ID'lerini bir diziye dönüştür
        const likedOutfitIds = likedOutfits.map((like) => like.outfit_id);

        // Outfits verisine beğeni durumunu ekle
        data.forEach((outfit) => {
          outfit.isLiked = likedOutfitIds.includes(outfit.id);
        });
      }
    }

    res.status(200).json({
      success: true,
      data: data,
    });
  } catch (error) {
    console.error("Outfitler getirme hatası:", error);
    res.status(500).json({
      success: false,
      message: "Outfitler getirilirken bir hata oluştu",
      error: error.message,
    });
  }
});

// ID'ye göre outfit getir
router.get("/outfits/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { userId } = req.query;

    const { data, error } = await supabase
      .from("outfits")
      .select(
        `
        *,
        users:user_id (
          username,
          avatar_url
        )
      `
      )
      .eq("id", id)
      .single();

    if (error) {
      throw error;
    }

    if (!data) {
      return res.status(404).json({
        success: false,
        message: "Outfit bulunamadı",
      });
    }

    // Kullanıcıya göre beğeni durumunu belirle
    let isLiked = false;
    if (userId) {
      const { data: likeData, error: likeError } = await supabase
        .from("outfit_likes")
        .select("*")
        .eq("user_id", userId)
        .eq("outfit_id", id)
        .single();

      if (!likeError && likeData) {
        isLiked = true;
      }
    }

    res.status(200).json({
      success: true,
      data: {
        ...data,
        isLiked,
      },
    });
  } catch (error) {
    console.error("Outfit getirme hatası:", error);
    res.status(500).json({
      success: false,
      message: "Outfit getirilirken bir hata oluştu",
      error: error.message,
    });
  }
});

// Yeni outfit ekle
router.post("/outfits", async (req, res) => {
  try {
    const { userId, name, items, visibility } = req.body;

    if (!userId || !name) {
      return res.status(400).json({
        success: false,
        message: "Kullanıcı ID ve outfit adı zorunludur",
      });
    }

    // Outfit oluştur
    const { data, error } = await supabase
      .from("outfits")
      .insert([
        {
          user_id: userId,
          name: name,
          items: items || [],
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

// Outfit güncelle
router.put("/outfits/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { name, items, visibility } = req.body;

    // Önce mevcut outfit'i kontrol et
    const { data: existingOutfit, error: fetchError } = await supabase
      .from("outfits")
      .select("*")
      .eq("id", id)
      .single();

    if (fetchError) {
      throw fetchError;
    }

    if (!existingOutfit) {
      return res.status(404).json({
        success: false,
        message: "Güncellenecek outfit bulunamadı",
      });
    }

    // Outfit'i güncelle
    const updateData = {
      ...(name && { name: name }),
      ...(items && { items: items }),
      ...(visibility && { visibility: visibility }),
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await supabase
      .from("outfits")
      .update(updateData)
      .eq("id", id)
      .select();

    if (error) {
      throw error;
    }

    res.status(200).json({
      success: true,
      message: "Outfit başarıyla güncellendi",
      data: data[0],
    });
  } catch (error) {
    console.error("Outfit güncelleme hatası:", error);
    res.status(500).json({
      success: false,
      message: "Outfit güncellenirken bir hata oluştu",
      error: error.message,
    });
  }
});

// Outfit sil
router.delete("/outfits/:id", async (req, res) => {
  try {
    const { id } = req.params;

    // Silinecek outfit'i bul
    const { data: existingOutfit, error: fetchError } = await supabase
      .from("outfits")
      .select("*")
      .eq("id", id)
      .single();

    if (fetchError) {
      throw fetchError;
    }

    if (!existingOutfit) {
      return res.status(404).json({
        success: false,
        message: "Silinecek outfit bulunamadı",
      });
    }

    // Outfit'i veritabanından sil
    const { error: deleteError } = await supabase
      .from("outfits")
      .delete()
      .eq("id", id);

    if (deleteError) {
      throw deleteError;
    }

    res.status(200).json({
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

// Outfit'i kaydet/kayıt kaldır (toggle)
router.post("/outfits/save", async (req, res) => {
  try {
    const { userId, outfitId } = req.body;

    if (!userId || !outfitId) {
      return res.status(400).json({
        success: false,
        message: "Kullanıcı ID ve Outfit ID zorunludur",
      });
    }

    // Önce kayıt durumunu kontrol et
    const { data: existingSave, error: checkError } = await supabase
      .from("outfit_saves")
      .select("*")
      .eq("user_id", userId)
      .eq("outfit_id", outfitId)
      .single();

    if (checkError && checkError.code !== "PGRST116") {
      // PGRST116: Tek sonuç beklenen sorguda sonuç bulunamadı
      throw checkError;
    }

    let result;
    let message;
    let isSaved;

    // Kayıt varsa sil, yoksa ekle
    if (existingSave) {
      const { error: deleteError } = await supabase
        .from("outfit_saves")
        .delete()
        .eq("id", existingSave.id);

      if (deleteError) throw deleteError;

      message = "Outfit kaydı kaldırıldı";
      isSaved = false;
      result = null;
    } else {
      const { data: insertData, error: insertError } = await supabase
        .from("outfit_saves")
        .insert([
          {
            user_id: userId,
            outfit_id: outfitId,
            created_at: new Date().toISOString(),
          },
        ])
        .select();

      if (insertError) throw insertError;

      message = "Outfit kaydedildi";
      isSaved = true;
      result = insertData[0];
    }

    // Kaydedilen toplam sayıyı getir
    const { count, error: countError } = await supabase
      .from("outfit_saves")
      .select("id", { count: "exact", head: true })
      .eq("outfit_id", outfitId);

    if (countError) throw countError;

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

// Outfit'in kayıtlı olup olmadığını kontrol et
router.get("/outfits/:outfitId/is-saved", async (req, res) => {
  try {
    const { outfitId } = req.params;
    const { userId } = req.query;

    if (!userId || !outfitId) {
      return res.status(400).json({
        success: false,
        message: "Kullanıcı ID ve Outfit ID zorunludur",
      });
    }

    // Kayıt durumunu kontrol et
    const { data, error } = await supabase
      .from("outfit_saves")
      .select("*")
      .eq("user_id", userId)
      .eq("outfit_id", outfitId)
      .single();

    if (error && error.code !== "PGRST116") {
      throw error;
    }

    // Kaydedilen toplam sayıyı getir
    const { count, error: countError } = await supabase
      .from("outfit_saves")
      .select("id", { count: "exact", head: true })
      .eq("outfit_id", outfitId);

    if (countError) throw countError;

    res.status(200).json({
      success: true,
      data: {
        isSaved: !!data,
        saveCount: count || 0,
      },
    });
  } catch (error) {
    console.error("Outfit kayıt durumu kontrolü hatası:", error);
    res.status(500).json({
      success: false,
      message: "Outfit kayıt durumu kontrol edilirken bir hata oluştu",
      error: error.message,
    });
  }
});

// Kullanıcının kaydettiği outfitleri getir
router.get("/outfits/saved", async (req, res) => {
  try {
    const { userId } = req.query;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "Kullanıcı ID'si gerekli",
      });
    }

    // Kullanıcının kaydettiği outfitleri getir
    const { data, error } = await supabase
      .from("outfit_saves")
      .select(
        `
        *,
        outfit:outfit_id (*)
      `
      )
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

    if (error) {
      throw error;
    }

    // Çıktıyı düzenle
    const formattedData = data.map((item) => ({
      id: item.id,
      saved_at: item.created_at,
      outfit: item.outfit,
    }));

    res.status(200).json({
      success: true,
      data: formattedData,
    });
  } catch (error) {
    console.error("Kaydedilen outfitleri getirme hatası:", error);
    res.status(500).json({
      success: false,
      message: "Kaydedilen outfitler getirilirken bir hata oluştu",
      error: error.message,
    });
  }
});

// Beğeni sayısını artır/azalt
router.post("/outfits/:id/toggle-like", async (req, res) => {
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
      .from("outfits")
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
      .from("outfits")
      .update({ likes_count: newLikeCount })
      .eq("id", id)
      .select("likes_count")
      .single();

    if (updateError) {
      throw updateError;
    }

    res.status(200).json({
      success: true,
      message:
        action === "like" ? "Outfit beğenildi" : "Outfit beğenisi kaldırıldı",
      data: {
        likeCount: updatedOutfit.likes_count,
        isLiked: action === "like",
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

// Outfit görüntülenme sayısını artır
router.post("/outfits/:id/increment-views", async (req, res) => {
  try {
    const { id } = req.params;

    // Önce outfit'i kontrol et
    const { data: outfit, error: outfitError } = await supabase
      .from("outfits")
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
      .from("outfits")
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

module.exports = router;
