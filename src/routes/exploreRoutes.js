const express = require("express");
const router = express.Router();
const { createClient } = require("@supabase/supabase-js");

// Supabase istemci oluştur
const supabaseUrl =
  process.env.SUPABASE_URL || "https://halurilrsdzgnieeajxm.supabase.co";
const supabaseKey =
  process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

/**
 * @route GET /api/reference/explores
 * @desc reference_explores tablosundan görselleri getir (sayfalandırmalı)
 * @access Public
 */
router.get("/explores", async (req, res) => {
  try {
    // Sayfalandırma parametreleri
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 12;
    const offset = (page - 1) * limit;

    // Kullanıcı ID'si eğer varsa
    const userId = req.query.userId;

    // Query için temel değerler
    let query = supabase
      .from("reference_explores")
      .select("*", { count: "exact" });

    // Eğer belirli bir kullanıcının gönderileri isteniyorsa filtreleme yap
    if (userId) {
      query = query.eq("user_id", userId);
    }

    // Sayfalandırma parametrelerini ekle ve oluşturulma tarihine göre sırala
    const {
      data: explores,
      error,
      count,
    } = await query
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      console.error("Veri çekme hatası:", error);
      return res.status(500).json({
        success: false,
        message: "Veriler alınırken bir hata oluştu",
      });
    }

    // Kullanıcı adlarını almak için tüm user_id'leri bir diziye koyalım
    const userIds = explores.map((item) => item.user_id);

    // users tablosundan kullanıcı adlarını alalım
    const { data: users, error: usersError } = await supabase
      .from("users")
      .select("id, username, avatar_url")
      .in("id", userIds);

    if (usersError) {
      console.error("Kullanıcı verileri çekme hatası:", usersError);
      // Hata olsa bile devam edelim, sadece username bilgisi olmayacak
    }

    // Kullanıcı verilerini ID'ye göre hızlı erişim için map'leyelim
    const userMap = {};
    if (users) {
      users.forEach((user) => {
        userMap[user.id] = user;
      });
    }

    // Her bir explore öğesine kullanıcı bilgisini ekleyelim
    const results = explores.map((item) => {
      const user = userMap[item.user_id] || {
        username: "Misafir",
        avatar_url: null,
      };
      return {
        ...item,
        username: user.username || "Misafir",
        avatar_url: user.avatar_url,
      };
    });

    // API yanıtını hazırla
    return res.status(200).json({
      success: true,
      totalItems: count,
      page,
      limit,
      results,
      next:
        count > offset + limit
          ? `/api/reference/explores?page=${page + 1}&limit=${limit}`
          : null,
      prev:
        page > 1
          ? `/api/reference/explores?page=${page - 1}&limit=${limit}`
          : null,
    });
  } catch (error) {
    console.error("API hatası:", error);
    return res.status(500).json({
      success: false,
      message: "Sunucu hatası",
    });
  }
});

/**
 * @route GET /api/reference/explores/:id
 * @desc Belirli bir reference_explores kaydını getir
 * @access Public
 */
router.get("/explores/:id", async (req, res) => {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({
        success: false,
        message: "Geçerli bir ID sağlanmalıdır",
      });
    }

    const { data: explore, error } = await supabase
      .from("reference_explores")
      .select("*")
      .eq("id", id)
      .single();

    if (error) {
      console.error("Veri çekme hatası:", error);

      if (error.code === "PGRST116") {
        return res.status(404).json({
          success: false,
          message: "Kayıt bulunamadı",
        });
      }

      return res.status(500).json({
        success: false,
        message: "Veri alınırken bir hata oluştu",
      });
    }

    // Kullanıcı bilgisini alalım
    const { data: user, error: userError } = await supabase
      .from("users")
      .select("username, avatar_url")
      .eq("id", explore.user_id)
      .single();

    if (userError && userError.code !== "PGRST116") {
      console.error("Kullanıcı verisi çekme hatası:", userError);
    }

    // Kullanıcı bilgisini ekleyelim
    const result = {
      ...explore,
      username: user ? user.username : "Misafir",
      avatar_url: user ? user.avatar_url : null,
    };

    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error("API hatası:", error);
    return res.status(500).json({
      success: false,
      message: "Sunucu hatası",
    });
  }
});

module.exports = router;
