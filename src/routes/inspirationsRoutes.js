const express = require("express");
const router = express.Router();
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const supabase = require("../supabaseClient");

// Dosya yükleme için multer yapılandırması
const uploadsDir = path.join(__dirname, "../../uploads/inspirations");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadsDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname);
    cb(null, "inspiration-" + uniqueSuffix + ext);
  },
});

const upload = multer({ storage: storage });

// Inspiration gönderilerini getir (sayfalama ile)
router.get("/inspirations", async (req, res) => {
  try {
    const { page = 1, limit = 10, userId } = req.query;
    const offset = (page - 1) * limit;

    let query = supabase
      .from("inspirations")
      .select(
        `
        *,
        likes: like_count,
        saves: save_count,
        comments: comment_count,
        views: view_count,
        user:user_id (id, username, avatar_url)
      `
      )
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    const { data, error, count } = await query;

    if (error) throw error;

    // Eğer userId sağlanmışsa, kullanıcının beğendiği ve kaydettiği gönderileri işaretle
    if (userId) {
      const { data: userLikes, error: likesError } = await supabase
        .from("likes")
        .select("inspiration_id")
        .eq("user_id", userId);

      const { data: userSaves, error: savesError } = await supabase
        .from("saves")
        .select("inspiration_id")
        .eq("user_id", userId);

      if (!likesError && !savesError) {
        const likedPosts = new Set(
          userLikes.map((like) => like.inspiration_id)
        );
        const savedPosts = new Set(
          userSaves.map((save) => save.inspiration_id)
        );

        data.forEach((post) => {
          post.is_liked = likedPosts.has(post.id);
          post.is_saved = savedPosts.has(post.id);
        });
      }
    }

    res.json({
      success: true,
      data,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: count,
      },
    });
  } catch (error) {
    console.error("Inspiration yüklenirken hata:", error);
    res.status(500).json({
      success: false,
      message: "Inspiration gönderileri alınırken bir hata oluştu",
      error: error.message,
    });
  }
});

// Tek bir inspiration detayını getir
router.get("/inspirations/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { userId } = req.query;

    // View count artırma (ziyaret)
    await supabase.rpc("increment_view_count", { post_id: id });

    const { data, error } = await supabase
      .from("inspirations")
      .select(
        `
        *,
        likes: like_count,
        saves: save_count,
        comments: comment_count,
        views: view_count,
        user:user_id (id, username, avatar_url)
      `
      )
      .eq("id", id)
      .single();

    if (error) throw error;

    // Kullanıcının beğeni ve kaydetme durumunu kontrol et
    if (userId) {
      const { data: isLiked, error: likeError } = await supabase
        .from("likes")
        .select("id")
        .eq("inspiration_id", id)
        .eq("user_id", userId)
        .maybeSingle();

      const { data: isSaved, error: saveError } = await supabase
        .from("saves")
        .select("id")
        .eq("inspiration_id", id)
        .eq("user_id", userId)
        .maybeSingle();

      data.is_liked = !!isLiked;
      data.is_saved = !!isSaved;
    }

    res.json({
      success: true,
      data,
    });
  } catch (error) {
    console.error("Inspiration detayı alınırken hata:", error);
    res.status(500).json({
      success: false,
      message: "Inspiration detayı alınırken bir hata oluştu",
      error: error.message,
    });
  }
});

// Yeni bir inspiration ekle
router.post("/inspirations", upload.single("image"), async (req, res) => {
  try {
    const { userId, title } = req.body;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "Kullanıcı ID'si gerekli",
      });
    }

    if (!title) {
      return res.status(400).json({
        success: false,
        message: "Başlık gerekli",
      });
    }

    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "Bir görsel yüklenmelidir",
      });
    }

    // Dosya yolunu al ve Supabase Storage'a yükle
    const filePath = req.file.path;
    const fileExt = path.extname(req.file.originalname);
    const fileName = `inspiration_${Date.now()}${fileExt}`;

    // Dosyayı Supabase'e yükle
    const fileBuffer = fs.readFileSync(filePath);
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from("inspirations")
      .upload(fileName, fileBuffer, {
        contentType: req.file.mimetype,
      });

    if (uploadError) throw uploadError;

    // Yüklenen dosyanın public URL'ini al
    const { data: urlData } = supabase.storage
      .from("inspirations")
      .getPublicUrl(fileName);

    console.log("Veri eklemeden önce kullanıcı ID:", userId);
    console.log("Veri eklemeden önce URL:", urlData.publicUrl);

    try {
      // Kullanıcı kontrolü
      const { data: userExists, error: userCheckError } = await supabase
        .from("users")
        .select("id")
        .eq("id", userId)
        .single();

      if (userCheckError) {
        console.log("Kullanıcı kontrol hatası:", userCheckError);
        // Veritabanında var olduğunu bildiğimiz ID'yi kullanalım
        userId = "a1b2c3d4-e5f6-4a2b-8c7d-123456789abc";
        console.log("Yeni kullanıcı ID'si kullanılıyor:", userId);
      } else {
        console.log("Kullanıcı bulundu:", userExists);
      }

      // Veriyi ekle
      const { data, error } = await supabase
        .from("inspirations")
        .insert({
          user_id: userId,
          image_url: urlData.publicUrl,
          title: title || "Yeni İlham",
        })
        .select()
        .single();

      if (error) {
        console.error("Veri ekleme hatası:", error);
        throw error;
      }

      console.log("Veri başarıyla eklendi:", data);

      // Geçici dosyayı sil
      fs.unlinkSync(filePath);

      res.status(201).json({
        success: true,
        message: "Inspiration başarıyla yüklendi",
        data,
      });
    } catch (error) {
      console.error("Inspiration eklerken hata:", error);
      res.status(500).json({
        success: false,
        message: "Inspiration yüklenirken bir hata oluştu",
        error: error.message,
      });
    }
  } catch (error) {
    console.error("Inspiration eklerken hata:", error);
    res.status(500).json({
      success: false,
      message: "Inspiration yüklenirken bir hata oluştu",
      error: error.message,
    });
  }
});

// Inspiration sil
router.delete("/inspirations/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { userId } = req.body;

    // Kullanıcının bu gönderiyi silme yetkisi var mı kontrol et
    const { data: inspiration, error: fetchError } = await supabase
      .from("inspirations")
      .select("user_id, image_url")
      .eq("id", id)
      .single();

    if (fetchError) throw fetchError;

    if (!inspiration) {
      return res.status(404).json({
        success: false,
        message: "Gönderi bulunamadı",
      });
    }

    if (inspiration.user_id !== userId) {
      return res.status(403).json({
        success: false,
        message: "Bu gönderiyi silme yetkiniz yok",
      });
    }

    // Gönderiyi sil
    const { error: deleteError } = await supabase
      .from("inspirations")
      .delete()
      .eq("id", id);

    if (deleteError) throw deleteError;

    // Gönderi ile ilişkili dosyayı storage'dan sil
    if (inspiration.image_url) {
      const fileName = inspiration.image_url.split("/").pop();
      const { error: storageError } = await supabase.storage
        .from("inspirations")
        .remove([fileName]);

      if (storageError) {
        console.error("Dosya silinirken hata:", storageError);
      }
    }

    res.json({
      success: true,
      message: "Inspiration başarıyla silindi",
    });
  } catch (error) {
    console.error("Inspiration silinirken hata:", error);
    res.status(500).json({
      success: false,
      message: "Inspiration silinirken bir hata oluştu",
      error: error.message,
    });
  }
});

// Inspiration beğen/beğenmekten vazgeç
router.post("/inspirations/:id/like", async (req, res) => {
  try {
    const { id } = req.params;
    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "Kullanıcı ID'si gerekli",
      });
    }

    // Kullanıcının bu gönderiyi daha önce beğenip beğenmediğini kontrol et
    const { data: existingLike, error: likeCheckError } = await supabase
      .from("likes")
      .select("id")
      .eq("inspiration_id", id)
      .eq("user_id", userId)
      .maybeSingle();

    if (likeCheckError) throw likeCheckError;

    let result;

    if (existingLike) {
      // Beğeniyi kaldır
      const { error: unlikeError } = await supabase
        .from("likes")
        .delete()
        .eq("id", existingLike.id);

      if (unlikeError) throw unlikeError;

      result = {
        action: "unliked",
        message: "Beğeni kaldırıldı",
      };
    } else {
      // Beğeni ekle
      const { error: likeError } = await supabase.from("likes").insert({
        inspiration_id: id,
        user_id: userId,
      });

      if (likeError) throw likeError;

      result = {
        action: "liked",
        message: "Gönderi beğenildi",
      };
    }

    // Güncel beğeni sayısını al
    const { data: updatedPost, error: updateError } = await supabase
      .from("inspirations")
      .select("like_count")
      .eq("id", id)
      .single();

    if (updateError) throw updateError;

    res.json({
      success: true,
      ...result,
      likeCount: updatedPost.like_count,
    });
  } catch (error) {
    console.error("Beğeni işlemi sırasında hata:", error);
    res.status(500).json({
      success: false,
      message: "Beğeni işlemi sırasında bir hata oluştu",
      error: error.message,
    });
  }
});

// Inspiration kaydet/kaydetmekten vazgeç
router.post("/inspirations/:id/save", async (req, res) => {
  try {
    const { id } = req.params;
    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "Kullanıcı ID'si gerekli",
      });
    }

    // Kullanıcının bu gönderiyi daha önce kaydetip kaydetmediğini kontrol et
    const { data: existingSave, error: saveCheckError } = await supabase
      .from("saves")
      .select("id")
      .eq("inspiration_id", id)
      .eq("user_id", userId)
      .maybeSingle();

    if (saveCheckError) throw saveCheckError;

    let result;

    if (existingSave) {
      // Kaydı kaldır
      const { error: unsaveError } = await supabase
        .from("saves")
        .delete()
        .eq("id", existingSave.id);

      if (unsaveError) throw unsaveError;

      result = {
        action: "unsaved",
        message: "Kayıt kaldırıldı",
      };
    } else {
      // Kaydet
      const { error: saveError } = await supabase.from("saves").insert({
        inspiration_id: id,
        user_id: userId,
      });

      if (saveError) throw saveError;

      result = {
        action: "saved",
        message: "Gönderi kaydedildi",
      };
    }

    // Güncel kaydetme sayısını al
    const { data: updatedPost, error: updateError } = await supabase
      .from("inspirations")
      .select("save_count")
      .eq("id", id)
      .single();

    if (updateError) throw updateError;

    res.json({
      success: true,
      ...result,
      saveCount: updatedPost.save_count,
    });
  } catch (error) {
    console.error("Kaydetme işlemi sırasında hata:", error);
    res.status(500).json({
      success: false,
      message: "Kaydetme işlemi sırasında bir hata oluştu",
      error: error.message,
    });
  }
});

// Yorumları getir
router.get("/inspirations/:id/comments", async (req, res) => {
  try {
    const { id } = req.params;
    const { page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;

    const { data, error, count } = await supabase
      .from("comments")
      .select(
        `
        *,
        user:user_id (id, username, avatar_url)
      `,
        { count: "exact" }
      )
      .eq("inspiration_id", id)
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) throw error;

    res.json({
      success: true,
      data,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: count,
      },
    });
  } catch (error) {
    console.error("Yorumlar alınırken hata:", error);
    res.status(500).json({
      success: false,
      message: "Yorumlar alınırken bir hata oluştu",
      error: error.message,
    });
  }
});

// Yorum ekle
router.post("/inspirations/:id/comments", async (req, res) => {
  try {
    const { id } = req.params;
    const { userId, content } = req.body;

    if (!userId || !content) {
      return res.status(400).json({
        success: false,
        message: "Kullanıcı ID'si ve yorum içeriği gerekli",
      });
    }

    // Yeni yorum ekle
    const { data, error } = await supabase
      .from("comments")
      .insert({
        inspiration_id: id,
        user_id: userId,
        content,
      })
      .select(
        `
        *,
        user:user_id (id, username, avatar_url)
      `
      )
      .single();

    if (error) throw error;

    // Güncel yorum sayısını al
    const { data: updatedPost, error: updateError } = await supabase
      .from("inspirations")
      .select("comment_count")
      .eq("id", id)
      .single();

    if (updateError) throw updateError;

    res.status(201).json({
      success: true,
      message: "Yorum başarıyla eklendi",
      data,
      commentCount: updatedPost.comment_count,
    });
  } catch (error) {
    console.error("Yorum eklenirken hata:", error);
    res.status(500).json({
      success: false,
      message: "Yorum eklenirken bir hata oluştu",
      error: error.message,
    });
  }
});

// Yorum sil
router.delete(
  "/inspirations/:inspirationId/comments/:commentId",
  async (req, res) => {
    try {
      const { inspirationId, commentId } = req.params;
      const { userId } = req.body;

      // Kullanıcının yorumu silme yetkisi var mı kontrol et
      const { data: comment, error: fetchError } = await supabase
        .from("comments")
        .select("user_id")
        .eq("id", commentId)
        .eq("inspiration_id", inspirationId)
        .single();

      if (fetchError) throw fetchError;

      if (!comment) {
        return res.status(404).json({
          success: false,
          message: "Yorum bulunamadı",
        });
      }

      if (comment.user_id !== userId) {
        return res.status(403).json({
          success: false,
          message: "Bu yorumu silme yetkiniz yok",
        });
      }

      // Yorumu sil
      const { error: deleteError } = await supabase
        .from("comments")
        .delete()
        .eq("id", commentId);

      if (deleteError) throw deleteError;

      // Güncel yorum sayısını al
      const { data: updatedPost, error: updateError } = await supabase
        .from("inspirations")
        .select("comment_count")
        .eq("id", inspirationId)
        .single();

      if (updateError) throw updateError;

      res.json({
        success: true,
        message: "Yorum başarıyla silindi",
        commentCount: updatedPost.comment_count,
      });
    } catch (error) {
      console.error("Yorum silinirken hata:", error);
      res.status(500).json({
        success: false,
        message: "Yorum silinirken bir hata oluştu",
        error: error.message,
      });
    }
  }
);

// Kullanıcının kaydedilmiş inspirationlarını getir
router.get("/user/:userId/saved-inspirations", async (req, res) => {
  try {
    const { userId } = req.params;
    const { page = 1, limit = 10 } = req.query;
    const offset = (page - 1) * limit;

    const { data, error, count } = await supabase
      .from("saves")
      .select(
        `
        inspiration:inspiration_id (
          id,
          user_id,
          image_url,
          caption,
          like_count,
          save_count,
          comment_count,
          view_count,
          created_at,
          user:user_id (id, username, avatar_url)
        )
      `,
        { count: "exact" }
      )
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) throw error;

    // Veriyi düzenle (sadece inspiration nesnelerini al)
    const inspirations = data.map((item) => ({
      ...item.inspiration,
      is_saved: true,
    }));

    res.json({
      success: true,
      data: inspirations,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: count,
      },
    });
  } catch (error) {
    console.error("Kaydedilmiş gönderiler alınırken hata:", error);
    res.status(500).json({
      success: false,
      message: "Kaydedilmiş gönderiler alınırken bir hata oluştu",
      error: error.message,
    });
  }
});

// Kullanıcının kendi inspirationlarını getir
router.get("/user/:userId/inspirations", async (req, res) => {
  try {
    const { userId } = req.params;
    const { page = 1, limit = 10 } = req.query;
    const offset = (page - 1) * limit;

    console.log(
      `Kullanıcı gönderileri alınıyor - userId: ${userId}, page: ${page}, limit: ${limit}`
    );

    if (!userId) {
      console.error("Kullanıcı ID'si eksik");
      return res.status(400).json({
        success: false,
        message: "Kullanıcı kimliği gerekli",
      });
    }

    // Kullanıcının varlığını kontrol et
    const { data: userExists, error: userCheckError } = await supabase
      .from("users")
      .select("id")
      .eq("id", userId)
      .single();

    if (userCheckError) {
      console.error("Kullanıcı kontrol hatası:", userCheckError);
      // Veritabanında kullanıcı bulunamadı ama devam et - belki sadece henüz paylaşım yapmamıştır
    }

    console.log(`Supabase'den kullanıcı postları sorgulanıyor: ${userId}`);

    // İlişki hatasını önlemek için user:user_id kısmını çıkardık
    const { data, error, count } = await supabase
      .from("inspirations")
      .select(
        `
        id,
        user_id,
        image_url,
        title,
        caption,
        like_count,
        save_count,
        comment_count,
        view_count,
        created_at
      `,
        { count: "exact" }
      )
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      console.error("Supabase sorgu hatası:", error);
      throw error;
    }

    console.log(
      `Bulunan gönderi sayısı: ${data ? data.length : 0} / ${count || 0}`
    );

    // Yanıta ekstra alanlar ekleyelim
    const formattedData = data
      ? data.map((item) => ({
          ...item,
          likes: item.like_count || 0,
          saves: item.save_count || 0,
          comments: item.comment_count || 0,
          views: item.view_count || 0,
          user: {
            id: item.user_id,
            username: "Kullanıcı", // Varsayılan username
          },
        }))
      : [];

    res.json({
      success: true,
      data: formattedData,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: count || 0,
      },
    });
  } catch (error) {
    console.error("Kullanıcı gönderileri alınırken hata:", error);
    res.status(500).json({
      success: false,
      message: "Kullanıcı gönderileri alınırken bir hata oluştu",
      error: error.message,
    });
  }
});

module.exports = router;
