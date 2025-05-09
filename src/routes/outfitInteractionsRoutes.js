const express = require("express");
const router = express.Router();
const supabase = require("../supabaseClient");

// Kullanıcının kaydettiği outfitleri getir - ÖNEMLİ: Bu route, parametre alan route'lardan ÖNCE tanımlanmalı!
router.get("/outfits/saved", async (req, res) => {
  try {
    console.log("Kaydedilen outfitler için istek geldi:", req.query);
    const { userId } = req.query;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "Kullanıcı ID'si gerekli",
      });
    }

    // Sadece kayıtları getir, hiçbir join yapmadan
    console.log("Kayıtları getiriyorum, userId:", userId);
    const { data: saves, error: savesError } = await supabase
      .from("outfit_saves")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

    if (savesError) {
      console.error("Kaydedilen outfitler sorgu hatası:", savesError);
      return res.status(500).json({
        success: false,
        message: "Kaydedilen outfit kayıtları alınırken hata oluştu",
        error: savesError.message,
      });
    }

    if (!saves || saves.length === 0) {
      console.log("Kaydedilen outfit bulunamadı");
      return res.status(200).json({
        success: true,
        data: [],
      });
    }

    console.log(`${saves.length} adet kayıt bulundu`);
    const outfitIds = saves.map((save) => save.outfit_id);
    console.log("Outfit ID'leri:", outfitIds);

    // Basit bir response döndür
    res.status(200).json({
      success: true,
      data: saves,
    });
  } catch (error) {
    console.error("Kaydedilen outfitleri getirme genel hatası:", error);
    res.status(500).json({
      success: false,
      message: "Kaydedilen outfitler getirilirken bir hata oluştu",
      error: error.message,
    });
  }
});

// 1. OUTFIT LIKE İŞLEMLERİ

// Like ekle/kaldır (toggle)
router.post("/outfits/like", async (req, res) => {
  try {
    const { userId, outfitId } = req.body;

    if (!userId || !outfitId) {
      return res.status(400).json({
        success: false,
        message: "Kullanıcı ID ve Outfit ID zorunludur",
      });
    }

    // Önce like durumunu kontrol et
    const { data: existingLike, error: checkError } = await supabase
      .from("outfit_likes")
      .select("*")
      .eq("user_id", userId)
      .eq("outfit_id", outfitId)
      .single();

    if (checkError && checkError.code !== "PGRST116") {
      throw checkError;
    }

    let result;
    let message;
    let isLiked;

    // Like varsa kaldır, yoksa ekle
    if (existingLike) {
      const { error: deleteError } = await supabase
        .from("outfit_likes")
        .delete()
        .eq("id", existingLike.id);

      if (deleteError) throw deleteError;

      message = "Like kaldırıldı";
      isLiked = false;
      result = null;
    } else {
      const { data: insertData, error: insertError } = await supabase
        .from("outfit_likes")
        .insert([
          {
            user_id: userId,
            outfit_id: outfitId,
            created_at: new Date().toISOString(),
          },
        ])
        .select();

      if (insertError) throw insertError;

      message = "Like eklendi";
      isLiked = true;
      result = insertData[0];
    }

    // Like sayısını getir
    const { count, error: countError } = await supabase
      .from("outfit_likes")
      .select("id", { count: "exact", head: true })
      .eq("outfit_id", outfitId);

    if (countError) throw countError;

    // Outfits tablosundaki likes_count alanını güncelle
    const { error: updateError } = await supabase
      .from("outfits")
      .update({ likes_count: count || 0 })
      .eq("id", outfitId);

    if (updateError) {
      console.error("Beğeni sayısı güncellenirken hata:", updateError);
    }

    res.status(200).json({
      success: true,
      message: message,
      data: {
        isLiked: isLiked,
        likeCount: count || 0,
        like: result,
      },
    });
  } catch (error) {
    console.error("Like işlemi hatası:", error);
    res.status(500).json({
      success: false,
      message: "Like işlemi sırasında bir hata oluştu",
      error: error.message,
    });
  }
});

// Like durumunu kontrol et
router.get("/outfits/:outfitId/is-liked", async (req, res) => {
  try {
    const { outfitId } = req.params;
    const { userId } = req.query;

    if (!userId || !outfitId) {
      return res.status(400).json({
        success: false,
        message: "Kullanıcı ID ve Outfit ID zorunludur",
      });
    }

    // Like durumunu kontrol et
    const { data, error } = await supabase
      .from("outfit_likes")
      .select("*")
      .eq("user_id", userId)
      .eq("outfit_id", outfitId)
      .single();

    if (error && error.code !== "PGRST116") {
      throw error;
    }

    // Like sayısını getir
    const { count, error: countError } = await supabase
      .from("outfit_likes")
      .select("id", { count: "exact", head: true })
      .eq("outfit_id", outfitId);

    if (countError) throw countError;

    res.status(200).json({
      success: true,
      data: {
        isLiked: !!data,
        likeCount: count || 0,
      },
    });
  } catch (error) {
    console.error("Like durumu kontrolü hatası:", error);
    res.status(500).json({
      success: false,
      message: "Like durumu kontrol edilirken bir hata oluştu",
      error: error.message,
    });
  }
});

// 2. OUTFIT YORUM İŞLEMLERİ

// Yorum ekle
router.post("/outfits/comment", async (req, res) => {
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
        .from("outfit_comments")
        .select("id")
        .eq("id", parent_id)
        .single();

      if (parentError || !parentComment) {
        return res.status(400).json({
          success: false,
          message: "Yanıt verilmek istenen yorum bulunamadı",
        });
      }
    }

    // Yorumu ekle
    const { data, error } = await supabase
      .from("outfit_comments")
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
      throw error;
    }

    // Yorum sayısını getir
    const { count, error: countError } = await supabase
      .from("outfit_comments")
      .select("id", { count: "exact", head: true })
      .eq("outfit_id", outfitId);

    if (countError) throw countError;

    // Outfits tablosundaki comments_count alanını güncelle
    const { error: updateError } = await supabase
      .from("outfits")
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
router.get("/outfits/:outfitId/comments", async (req, res) => {
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

    // Tüm yorumları getir (ana yorumlar ve yanıtlar)
    const { data, error, count } = await supabase
      .from("outfit_comments")
      .select(
        `
        *,
        users:user_id (username, avatar_url)
      `,
        { count: "exact" }
      )
      .eq("outfit_id", outfitId)
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      throw error;
    }

    res.status(200).json({
      success: true,
      data: data,
      pagination: {
        total: count,
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

// 3. OUTFIT KAYDETME İŞLEMLERİ

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

module.exports = router;
