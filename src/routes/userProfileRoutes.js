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

// Profil görünürlüğünü güncelleme
router.put("/profile/update-visibility", async (req, res) => {
  try {
    const { userId, visibility } = req.body;
    console.log("Görünürlük güncelleme isteği:", req.body);

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "Kullanıcı ID'si gereklidir",
      });
    }

    if (!visibility || (visibility !== "public" && visibility !== "private")) {
      return res.status(400).json({
        success: false,
        message:
          "Geçerli bir görünürlük değeri gereklidir (public veya private)",
      });
    }

    // Önce kullanıcının var olup olmadığını kontrol et
    const { data: existingUser, error: checkError } = await supabase
      .from("users")
      .select("id")
      .eq("id", userId)
      .single();

    if (checkError) {
      console.error("Kullanıcı kontrolü hatası:", checkError);
      return res.status(404).json({
        success: false,
        message: "Kullanıcı bulunamadı",
        error: checkError.message,
      });
    }

    // Kullanıcının görünürlük ayarını güncelle
    const { data, error } = await supabase
      .from("users")
      .update({ visibility })
      .eq("id", userId)
      .select();

    if (error) {
      console.error("Görünürlük güncelleme DB hatası:", error);
      return res.status(500).json({
        success: false,
        message: "Görünürlük ayarı güncellenemedi",
        error: error.message,
        details: "Veritabanında 'visibility' alanının eklendiğinden emin olun",
      });
    }

    console.log("Görünürlük güncelleme başarılı:", data);
    return res.status(200).json({
      success: true,
      message: "Görünürlük ayarı başarıyla güncellendi",
      profile: data[0],
    });
  } catch (error) {
    console.error("Görünürlük güncelleme hatası (catch):", error);
    return res.status(500).json({
      success: false,
      message: "Sunucu hatası",
      error: error.message,
      stack: error.stack,
    });
  }
});

// Kapak resmi yükleme
router.post("/profile/upload-cover", async (req, res) => {
  try {
    const { userId, file, filename } = req.body;

    if (!userId || !file) {
      return res.status(400).json({
        success: false,
        message: "Kullanıcı ID'si ve dosya gereklidir",
      });
    }

    const fileExt = filename.split(".").pop();
    const filePath = `covers/${userId}-${Date.now()}.${fileExt}`;

    // Kapak resmini Storage'a yükle
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from("profiles")
      .upload(filePath, Buffer.from(file, "base64"), {
        contentType: `image/${fileExt}`,
        upsert: true,
      });

    if (uploadError) {
      return res.status(500).json({
        success: false,
        message: "Kapak resmi yüklenemedi",
        error: uploadError.message,
      });
    }

    // Yüklenen resmin public URL'ini al
    const { data: urlData } = supabase.storage
      .from("profiles")
      .getPublicUrl(filePath);

    const publicUrl = urlData.publicUrl;

    // Kullanıcının cover_image_url bilgisini güncelle
    const { data: updateData, error: updateError } = await supabase
      .from("users")
      .update({ cover_image_url: publicUrl })
      .eq("id", userId)
      .select();

    if (updateError) {
      return res.status(500).json({
        success: false,
        message: "Kapak resmi bilgisi güncellenemedi",
        error: updateError.message,
      });
    }

    return res.status(200).json({
      success: true,
      message: "Kapak resmi başarıyla güncellendi",
      cover_image_url: publicUrl,
    });
  } catch (error) {
    console.error("Kapak resmi yükleme hatası:", error);
    return res.status(500).json({
      success: false,
      message: "Sunucu hatası",
      error: error.message,
    });
  }
});

// Kullanıcı adı kullanılabilirliğini kontrol et
router.get("/check-username", async (req, res) => {
  try {
    const { username } = req.query;

    if (!username) {
      return res.status(400).json({
        success: false,
        message: "Kullanıcı adı parametresi gereklidir",
      });
    }

    // Kullanıcı adının minimum uzunluğu kontrolü
    if (username.length < 3) {
      return res.status(400).json({
        success: false,
        message: "Kullanıcı adı en az 3 karakter olmalıdır",
        exists: false,
        valid: false,
      });
    }

    // Kullanıcı adının veritabanında olup olmadığını kontrol et
    const { data, error } = await supabase
      .from("users")
      .select("username")
      .eq("username", username)
      .limit(1);

    if (error) {
      console.error("Kullanıcı adı kontrolü veritabanı hatası:", error);
      return res.status(500).json({
        success: false,
        message: "Veritabanı hatası",
        error: error.message,
      });
    }

    // Sonucu döndür
    return res.status(200).json({
      success: true,
      exists: data && data.length > 0,
      valid: true,
    });
  } catch (error) {
    console.error("Kullanıcı adı kontrolü hatası:", error);
    return res.status(500).json({
      success: false,
      message: "Sunucu hatası",
      error: error.message,
    });
  }
});

// Onboarding verilerini kaydetme
router.post("/profile/save-onboarding", async (req, res) => {
  try {
    const { userId, age, gender, style } = req.body;

    console.log("Onboarding verileri alındı:", req.body);

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "Kullanıcı ID'si gereklidir",
      });
    }

    // Veri validasyonu
    const validAgeRanges = ["18-24", "25-34", "35-44", "45+"];
    const validGenders = ["female", "male", "prefer_not_to_say"];

    if (age && !validAgeRanges.includes(age)) {
      return res.status(400).json({
        success: false,
        message: "Geçersiz yaş aralığı",
      });
    }

    if (gender && !validGenders.includes(gender)) {
      return res.status(400).json({
        success: false,
        message: "Geçersiz cinsiyet değeri",
      });
    }

    if (style && (!Array.isArray(style) || style.length > 3)) {
      return res.status(400).json({
        success: false,
        message: "Tarz seçimi en fazla 3 adet olmalıdır",
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
        success: false,
        message: "Kullanıcı bulunamadı",
      });
    }

    // Güncellenecek alanları hazırla
    const updates = {
      preferences_updated_at: new Date().toISOString(),
    };

    if (age) updates.age_range = age;
    if (gender) updates.user_gender = gender;
    if (style && style.length > 0)
      updates.preferred_styles = JSON.stringify(style);

    // Eğer tüm onboarding verileri varsa, onboarding'i tamamlandı olarak işaretle
    if (age && gender && style && style.length > 0) {
      updates.onboarding_completed = true;
      updates.onboarding_completed_at = new Date().toISOString();
    }

    // Kullanıcı onboarding verilerini güncelle
    const { data, error } = await supabase
      .from("users")
      .update(updates)
      .eq("id", userId)
      .select();

    if (error) {
      console.error("Onboarding verileri güncelleme hatası:", error);
      return res.status(500).json({
        success: false,
        message: "Onboarding verileri kaydedilemedi",
        error: error.message,
      });
    }

    console.log("Onboarding verileri başarıyla kaydedildi:", data[0]);

    return res.status(200).json({
      success: true,
      message: "Onboarding verileri başarıyla kaydedildi",
      data: data[0],
      onboarding_completed: updates.onboarding_completed || false,
    });
  } catch (error) {
    console.error("Onboarding kaydetme hatası:", error);
    return res.status(500).json({
      success: false,
      message: "Sunucu hatası",
      error: error.message,
    });
  }
});

// Onboarding durumunu kontrol etme
router.get("/profile/onboarding-status/:userId", async (req, res) => {
  try {
    const { userId } = req.params;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "Kullanıcı ID'si gereklidir",
      });
    }

    const { data: user, error } = await supabase
      .from("users")
      .select(
        "age_range, user_gender, preferred_styles, onboarding_completed, onboarding_completed_at"
      )
      .eq("id", userId)
      .single();

    if (error) {
      return res.status(404).json({
        success: false,
        message: "Kullanıcı bulunamadı",
        error: error.message,
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        age_range: user.age_range,
        user_gender: user.user_gender,
        preferred_styles: user.preferred_styles,
        onboarding_completed: user.onboarding_completed || false,
        onboarding_completed_at: user.onboarding_completed_at,
      },
    });
  } catch (error) {
    console.error("Onboarding durumu kontrol hatası:", error);
    return res.status(500).json({
      success: false,
      message: "Sunucu hatası",
      error: error.message,
    });
  }
});

// Kullanıcı hesabını devre dışı bırakma
router.delete("/profile/:userId", async (req, res) => {
  try {
    const { userId } = req.params;

    if (!userId) {
      return res.status(400).json({
        success: false,
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
        success: false,
        message: "Kullanıcı bulunamadı",
      });
    }

    // Kullanıcının active durumunu false yap
    const { error: updateError } = await supabase
      .from("users")
      .update({ active: false })
      .eq("id", userId);

    if (updateError) {
      throw updateError;
    }

    return res.status(200).json({
      success: true,
      message: "Kullanıcı hesabı başarıyla devre dışı bırakıldı",
    });
  } catch (error) {
    console.error("Kullanıcı devre dışı bırakma hatası:", error);
    return res.status(500).json({
      success: false,
      message: "Kullanıcı devre dışı bırakılırken bir hata oluştu",
      error: error.message,
    });
  }
});

module.exports = router;
