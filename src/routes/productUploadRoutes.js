const express = require("express");
const router = express.Router();
const supabase = require("../supabaseClient");

// Base64 decode için
const { decode } = require("base64-arraybuffer");

// Ürün fotoğrafını products bucket'ına kaydetme
router.post("/upload-product", async (req, res) => {
  try {
    const { user_id, product_photo_base64, product_name, product_category } =
      req.body;

    if (!user_id) {
      return res.status(400).json({
        success: false,
        message: "Kullanıcı ID'si gereklidir",
      });
    }

    if (!product_photo_base64) {
      return res.status(400).json({
        success: false,
        message: "Ürün fotoğrafı gereklidir",
      });
    }

    // Timestamp ile benzersiz dosya adı oluştur
    const timestamp = Date.now();
    const productFileName = `product_${timestamp}.jpg`;
    const productFilePath = `${user_id}/${productFileName}`;

    let productPhotoUrl = null;

    try {
      // Base64'ten ArrayBuffer'a çevir
      const productArrayBuffer = decode(product_photo_base64);

      // Supabase storage'a ürün fotoğrafını yükle
      const { data: productData, error: productError } = await supabase.storage
        .from("products")
        .upload(productFilePath, productArrayBuffer, {
          contentType: "image/jpeg",
          cacheControl: "3600",
          upsert: false,
        });

      if (productError) {
        console.error("Ürün fotoğrafı yükleme hatası:", productError);
        return res.status(500).json({
          success: false,
          message: "Ürün fotoğrafı yüklenemedi",
          error: productError.message,
        });
      }

      // Public URL'i al
      const { data: productUrlData } = supabase.storage
        .from("products")
        .getPublicUrl(productFilePath);

      productPhotoUrl = productUrlData.publicUrl;

      console.log(`Ürün fotoğrafı başarıyla yüklendi: ${productFilePath}`);

      // Başarılı yanıt döndür
      res.status(200).json({
        success: true,
        message: "Ürün fotoğrafı başarıyla yüklendi",
        data: {
          product_photo: {
            success: true,
            url: productPhotoUrl,
            path: productFilePath,
            fileName: productFileName,
            timestamp: timestamp,
            product_name: product_name || null,
            product_category: product_category || null,
          },
        },
      });
    } catch (uploadError) {
      console.error("Ürün fotoğrafı işleme hatası:", uploadError);
      res.status(500).json({
        success: false,
        message: "Ürün fotoğrafı işlenirken hata oluştu",
        error: uploadError.message,
      });
    }
  } catch (error) {
    console.error("Ürün yükleme genel hatası:", error);
    res.status(500).json({
      success: false,
      message: "Sunucu hatası",
      error: error.message,
    });
  }
});

// Kullanıcının ürün fotoğraflarını getirme
router.get("/user-products/:user_id", async (req, res) => {
  try {
    const { user_id } = req.params;

    if (!user_id) {
      return res.status(400).json({
        success: false,
        message: "Kullanıcı ID'si gereklidir",
      });
    }

    console.log(
      `📋 Kullanıcı ${user_id} için ürün fotoğrafları getiriliyor...`
    );

    // Supabase'den kullanıcının products klasöründeki dosyaları listele
    const { data: files, error: listError } = await supabase.storage
      .from("products")
      .list(`${user_id}/`, {
        limit: 100,
        offset: 0,
        sortBy: { column: "created_at", order: "desc" },
      });

    if (listError) {
      console.error("Supabase listeleme hatası:", listError);
      return res.status(500).json({
        success: false,
        message: "Ürün fotoğrafları listelenemedi",
        error: listError.message,
      });
    }

    if (!files || files.length === 0) {
      console.log(`❌ Kullanıcı ${user_id} için ürün fotoğrafı bulunamadı`);
      return res.status(200).json({
        success: true,
        message: "Ürün fotoğrafı bulunamadı",
        data: [],
      });
    }

    // Dosyaları filtrele ve public URL'lerini oluştur
    const productPhotos = files
      .filter((file) => !file.name.startsWith(".") && file.name !== "")
      .map((file) => {
        const { data: publicUrlData } = supabase.storage
          .from("products")
          .getPublicUrl(`${user_id}/${file.name}`);

        return {
          id: file.id,
          name: file.name,
          url: publicUrlData.publicUrl,
          created_at: file.created_at,
          updated_at: file.updated_at,
          size: file.metadata?.size || 0,
        };
      });

    console.log(`✅ ${productPhotos.length} adet ürün fotoğrafı bulundu`);

    return res.status(200).json({
      success: true,
      message: "Ürün fotoğrafları başarıyla getirildi",
      data: productPhotos,
    });
  } catch (error) {
    console.error("Ürün fotoğrafları getirme genel hatası:", error);
    return res.status(500).json({
      success: false,
      message: "Sunucu hatası",
      error: error.message,
    });
  }
});

// Ürün silme
router.delete("/delete-product", async (req, res) => {
  try {
    const { user_id, file_path } = req.body;

    if (!user_id || !file_path) {
      return res.status(400).json({
        success: false,
        message: "Kullanıcı ID'si ve dosya yolu gereklidir",
      });
    }

    // Supabase storage'dan ürünü sil
    const { data, error } = await supabase.storage
      .from("products")
      .remove([file_path]);

    if (error) {
      console.error("Ürün silme hatası:", error);
      return res.status(500).json({
        success: false,
        message: "Ürün silinemedi",
        error: error.message,
      });
    }

    res.status(200).json({
      success: true,
      message: "Ürün başarıyla silindi",
      data: data,
    });
  } catch (error) {
    console.error("Ürün silme genel hatası:", error);
    res.status(500).json({
      success: false,
      message: "Sunucu hatası",
      error: error.message,
    });
  }
});

module.exports = router;
