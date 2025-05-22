const express = require("express");
const router = express.Router();
const supabase = require("../supabaseClient");
const { v4: uuidv4 } = require("uuid");

// Email/şifre ile kaydolma
router.post("/signup", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        message: "Email ve şifre gereklidir",
      });
    }

    // Supabase auth ile kullanıcı kaydı
    const { data: authData, error: authError } = await supabase.auth.signUp({
      email,
      password,
    });

    if (authError) {
      return res.status(400).json({
        message: "Kayıt oluşturulamadı",
        error: authError.message,
      });
    }

    // Kullanıcı tablosuna kayıt
    const userId = authData.user.id;
    const { data: userData, error: userError } = await supabase
      .from("users")
      .insert([
        {
          id: userId,
          email: email,
          credit_balance: 0,
        },
      ]);

    if (userError) {
      return res.status(500).json({
        message: "Kullanıcı kaydedilemedi",
        error: userError.message,
      });
    }

    return res.status(200).json({
      message: "Kayıt başarılı, doğrulama emaili gönderildi",
      userId,
    });
  } catch (error) {
    return res.status(500).json({
      message: "Sunucu hatası",
      error: error.message,
    });
  }
});

// Email/şifre ile giriş
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        message: "Email ve şifre gereklidir",
      });
    }

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      return res.status(401).json({
        message: "Giriş başarısız",
        error: error.message,
      });
    }

    return res.status(200).json({
      message: "Giriş başarılı",
      user: data.user,
      session: data.session,
    });
  } catch (error) {
    return res.status(500).json({
      message: "Sunucu hatası",
      error: error.message,
    });
  }
});

// Google ile giriş
router.post("/login/google", async (req, res) => {
  try {
    const { idToken } = req.body;

    if (!idToken) {
      return res.status(400).json({
        message: "Google ID token gereklidir",
      });
    }

    console.log("Alınan Google ID token:", idToken.substring(0, 30) + "...");

    // Google ID token ile Supabase auth'a giriş yap
    const { data, error } = await supabase.auth.signInWithIdToken({
      provider: "google",
      token: idToken,
    });

    if (error) {
      console.error("Supabase auth hatası:", error);
      return res.status(401).json({
        message: "Google ile giriş başarısız",
        error: error.message,
      });
    }

    console.log("Supabase auth başarılı:", data.user.id);

    // Kullanıcı henüz users tablosunda yoksa ekle
    const userId = data.user.id;
    const { data: existingUser, error: checkError } = await supabase
      .from("users")
      .select("id")
      .eq("id", userId)
      .single();

    if (checkError && checkError.code !== "PGRST116") {
      console.error("Kullanıcı kontrolü hatası:", checkError);
    }

    // Kullanıcı yoksa yeni kullanıcı ekle
    if (!existingUser) {
      console.log("Yeni kullanıcı oluşturuluyor...");

      const { data: userData, error: insertError } = await supabase
        .from("users")
        .insert([
          {
            id: userId,
            email: data.user.email,
            username:
              data.user.user_metadata?.name || data.user.email.split("@")[0],
            avatar_url: data.user.user_metadata?.avatar_url || null,
            is_pro: false,
            auth_provider: "google",
          },
        ])
        .select();

      if (insertError) {
        console.error("Kullanıcı oluşturma hatası:", insertError);
        // Hata olsa bile işleme devam ediyoruz
      } else {
        console.log("Yeni kullanıcı oluşturuldu:", userData);
      }
    } else {
      console.log("Kullanıcı zaten var:", existingUser.id);
    }

    // Kullanıcı bilgilerini döndür
    return res.status(200).json({
      success: true,
      user: {
        id: userId,
        email: data.user.email,
        name: data.user.user_metadata?.name,
        avatar_url: data.user.user_metadata?.avatar_url,
      },
      session: {
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
        expires_at: data.session.expires_at,
      },
    });
  } catch (error) {
    console.error("Google auth genel hata:", error);
    return res.status(500).json({
      message: "Sunucu hatası oluştu",
      error: error.message,
    });
  }
});

// Apple ile giriş
router.post("/login/apple", async (req, res) => {
  try {
    const { identityToken } = req.body;

    if (!identityToken) {
      return res.status(400).json({
        message: "Apple identity token gereklidir",
      });
    }

    const { data, error } = await supabase.auth.signInWithIdToken({
      provider: "apple",
      token: identityToken,
    });

    if (error) {
      return res.status(401).json({
        message: "Apple ile giriş başarısız",
        error: error.message,
      });
    }

    // Kullanıcı henüz users tablosunda yoksa ekle
    const userId = data.user.id;
    const { data: existingUser, error: checkError } = await supabase
      .from("users")
      .select("id")
      .eq("id", userId)
      .single();

    if (checkError || !existingUser) {
      const { data: newUser, error: insertError } = await supabase
        .from("users")
        .insert([
          {
            id: userId,
            email: data.user.email,
            username:
              data.user.user_metadata?.name || data.user.email.split("@")[0],
            credit_balance: 0,
          },
        ]);

      if (insertError) {
        console.error("Kullanıcı kaydı oluşturulamadı:", insertError);
      }
    }

    return res.status(200).json({
      message: "Apple ile giriş başarılı",
      user: data.user,
      session: data.session,
    });
  } catch (error) {
    return res.status(500).json({
      message: "Sunucu hatası",
      error: error.message,
    });
  }
});

// Çıkış yapma
router.post("/logout", async (req, res) => {
  try {
    const { error } = await supabase.auth.signOut();

    if (error) {
      return res.status(500).json({
        message: "Çıkış yapılamadı",
        error: error.message,
      });
    }

    return res.status(200).json({
      message: "Başarıyla çıkış yapıldı",
    });
  } catch (error) {
    return res.status(500).json({
      message: "Sunucu hatası",
      error: error.message,
    });
  }
});

// Anonim kullanıcı ile giriş
router.post("/anonymous", async (req, res) => {
  try {
    let { userId } = req.body;

    // Eğer userId yoksa, yeni bir anonim kullanıcı oluştur
    if (!userId) {
      userId = uuidv4();
      const { data, error } = await supabase
        .from("users")
        .insert([{ id: userId, credit_balance: 0 }]);

      if (error) {
        return res.status(500).json({
          message: "Anonim kullanıcı oluşturulamadı",
          error: error.message,
        });
      }
    } else {
      // Kullanıcının var olduğunu doğrula
      const { data, error } = await supabase
        .from("users")
        .select("*")
        .eq("id", userId)
        .single();

      if (error || !data) {
        // Kullanıcı yoksa yeni oluştur
        const { data: newUser, error: insertError } = await supabase
          .from("users")
          .insert([{ id: userId, credit_balance: 0 }]);

        if (insertError) {
          return res.status(500).json({
            message: "Anonim kullanıcı oluşturulamadı",
            error: insertError.message,
          });
        }
      }
    }

    return res.status(200).json({
      message: "Anonim kullanıcı başarıyla doğrulandı",
      userId,
    });
  } catch (error) {
    return res.status(500).json({
      message: "Sunucu hatası",
      error: error.message,
    });
  }
});

// Kullanıcı bilgilerini döndür (token ile)
router.get("/me", async (req, res) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        message: "Yetkilendirme başlığı gereklidir",
      });
    }

    // Bearer token'ı al
    const token = authHeader.split(" ")[1];

    // Supabase token ile kullanıcı bilgilerini kontrol et
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser(token);

    if (error) {
      console.error("Token doğrulama hatası:", error);
      return res.status(401).json({
        message: "Geçersiz veya süresi dolmuş token",
        error: error.message,
      });
    }

    if (!user) {
      return res.status(404).json({
        message: "Kullanıcı bulunamadı",
      });
    }

    // Kullanıcı bilgilerini döndür
    return res.status(200).json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.user_metadata?.name,
        avatar_url: user.user_metadata?.avatar_url,
      },
    });
  } catch (error) {
    console.error("Kullanıcı bilgileri alma hatası:", error);
    return res.status(500).json({
      message: "Sunucu hatası oluştu",
      error: error.message,
    });
  }
});

module.exports = router;
