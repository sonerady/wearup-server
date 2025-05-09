const express = require("express");
const router = express.Router();
const supabase = require("../supabaseClient");

// Kullanıcı profil bilgilerini getirme
router.get("/profile/:userId", async (req, res) => {
  try {
    const { userId } = req.params;

    const { data: profile, error } = await supabase
      .from("users")
      .select("*")
      .eq("id", userId)
      .single();

    if (error) {
      return res.status(404).json({
        message: "Kullanıcı bulunamadı",
        error: error.message,
      });
    }

    return res.status(200).json({ profile });
  } catch (error) {
    return res.status(500).json({
      message: "Sunucu hatası",
      error: error.message,
    });
  }
});

// Profil düzenleme
router.put("/profile/update", async (req, res) => {
  try {
    const { userId, username, avatar_url, bio, website } = req.body;

    if (!userId) {
      return res.status(400).json({
        message: "Kullanıcı ID'si gereklidir",
      });
    }

    // Önce kullanıcının var olup olmadığını kontrol et
    const { data: existingUser, error: checkError } = await supabase
      .from("users")
      .select("id")
      .eq("id", userId)
      .single();

    if (checkError || !existingUser) {
      return res.status(404).json({
        message: "Güncellenecek kullanıcı bulunamadı",
      });
    }

    // Güncellenecek alanları içeren nesne
    const updates = {};
    if (username !== undefined) updates.username = username;
    if (avatar_url !== undefined) updates.avatar_url = avatar_url;
    if (bio !== undefined) updates.bio = bio;
    if (website !== undefined) updates.website = website;

    // Kullanıcı profil bilgilerini güncelle
    const { data, error } = await supabase
      .from("users")
      .update(updates)
      .eq("id", userId)
      .select();

    if (error) {
      return res.status(500).json({
        message: "Profil güncellenemedi",
        error: error.message,
      });
    }

    return res.status(200).json({
      message: "Profil başarıyla güncellendi",
      profile: data[0],
    });
  } catch (error) {
    return res.status(500).json({
      message: "Sunucu hatası",
      error: error.message,
    });
  }
});

// Profil resmi yükleme (avatar güncelleme)
router.post("/profile/upload-avatar", async (req, res) => {
  try {
    const { userId, file, filename } = req.body;

    if (!userId || !file) {
      return res.status(400).json({
        message: "Kullanıcı ID'si ve dosya gereklidir",
      });
    }

    const fileExt = filename.split(".").pop();
    const filePath = `avatars/${userId}-${Date.now()}.${fileExt}`;

    // Profil resmini Storage'a yükle
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from("profiles")
      .upload(filePath, Buffer.from(file, "base64"), {
        contentType: `image/${fileExt}`,
        upsert: true,
      });

    if (uploadError) {
      return res.status(500).json({
        message: "Profil resmi yüklenemedi",
        error: uploadError.message,
      });
    }

    // Yüklenen resmin public URL'ini al
    const { data: urlData } = supabase.storage
      .from("profiles")
      .getPublicUrl(filePath);

    const publicUrl = urlData.publicUrl;

    // Kullanıcının avatar_url bilgisini güncelle
    const { data: updateData, error: updateError } = await supabase
      .from("users")
      .update({ avatar_url: publicUrl })
      .eq("id", userId)
      .select();

    if (updateError) {
      return res.status(500).json({
        message: "Profil resmi bilgisi güncellenemedi",
        error: updateError.message,
      });
    }

    return res.status(200).json({
      message: "Profil resmi başarıyla güncellendi",
      avatar_url: publicUrl,
    });
  } catch (error) {
    return res.status(500).json({
      message: "Sunucu hatası",
      error: error.message,
    });
  }
});

// Kullanıcı sayaçlarını güncelleme (wardrobe_item_count ve wardrobe_outfit_count)
router.post("/update-counters", async (req, res) => {
  try {
    const { userId, wardrobe_item_count, wardrobe_outfit_count } = req.body;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "Kullanıcı ID'si gereklidir",
      });
    }

    // Güncellenecek alanları içeren nesne
    const updates = {};
    if (wardrobe_item_count !== undefined)
      updates.wardrobe_item_count = wardrobe_item_count;
    if (wardrobe_outfit_count !== undefined)
      updates.wardrobe_outfit_count = wardrobe_outfit_count;

    // Güncelleme yapılacak veri yoksa
    if (Object.keys(updates).length === 0) {
      return res.status(400).json({
        success: false,
        message: "Güncellenecek veri bulunamadı",
      });
    }

    // Kullanıcı istatistik bilgilerini güncelle
    const { data, error } = await supabase
      .from("users")
      .update(updates)
      .eq("id", userId)
      .select();

    if (error) {
      return res.status(500).json({
        success: false,
        message: "Kullanıcı sayaçları güncellenemedi",
        error: error.message,
      });
    }

    return res.status(200).json({
      success: true,
      message: "Kullanıcı sayaçları başarıyla güncellendi",
      data: data[0],
    });
  } catch (error) {
    console.error("Kullanıcı sayaçları güncellenirken hata:", error);
    return res.status(500).json({
      success: false,
      message: "Sunucu hatası",
      error: error.message,
    });
  }
});

module.exports = router;
