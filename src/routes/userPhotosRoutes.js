const express = require("express");
const router = express.Router();
const supabase = require("../supabaseClient");

// Base64 decode için
const { decode } = require("base64-arraybuffer");

// Kullanıcı fotoğraflarını models bucket'ına kaydetme
router.post("/upload-photos", async (req, res) => {
  try {
    const { user_id, face_photo_base64, body_photo_base64, session_timestamp } =
      req.body;

    if (!user_id) {
      return res.status(400).json({
        success: false,
        message: "Kullanıcı ID'si gereklidir",
      });
    }

    // Session timestamp yoksa yeni bir tane oluştur
    const sessionId = session_timestamp || Date.now();

    const results = {
      face_photo: null,
      body_photo: null,
      session_id: sessionId, // Session ID'yi sonuçta geri gönder
    };

    let facePhotoUrl = null;
    let bodyPhotoUrl = null;

    // Yüz fotoğrafını upload et
    if (face_photo_base64) {
      try {
        // Base64'ten ArrayBuffer'a çevir
        const faceArrayBuffer = decode(face_photo_base64);

        const faceFileName = `face_${sessionId}.jpg`; // Session ID ile eşleşen isim
        const faceFilePath = `${user_id}/${faceFileName}`;

        // Supabase storage'a direkt resmi yükle (canvas işlemi kaldırıldı)
        const { data: faceData, error: faceError } = await supabase.storage
          .from("models")
          .upload(faceFilePath, faceArrayBuffer, {
            contentType: "image/jpeg",
            cacheControl: "3600",
            upsert: false,
          });

        if (faceError) {
          console.error("Yüz fotoğrafı yükleme hatası:", faceError);
        } else {
          // Public URL'i al
          const { data: faceUrlData } = supabase.storage
            .from("models")
            .getPublicUrl(faceFilePath);

          facePhotoUrl = faceUrlData.publicUrl;

          results.face_photo = {
            success: true,
            url: facePhotoUrl,
            path: faceFilePath,
            fileName: faceFileName,
            session_id: sessionId,
          };

          console.log(
            `Yüz fotoğrafı başarıyla yüklendi: ${faceFilePath} (Session: ${sessionId})`
          );
        }
      } catch (faceUploadError) {
        console.error("Yüz fotoğrafı işleme hatası:", faceUploadError);
        results.face_photo = {
          success: false,
          error: faceUploadError.message,
        };
      }
    }

    // Vücud fotoğrafını upload et
    if (body_photo_base64) {
      try {
        // Base64'ten ArrayBuffer'a çevir
        const bodyArrayBuffer = decode(body_photo_base64);

        const bodyFileName = `body_${sessionId}.jpg`; // Session ID ile eşleşen isim
        const bodyFilePath = `${user_id}/${bodyFileName}`;

        // Supabase storage'a direkt resmi yükle (canvas işlemi kaldırıldı)
        const { data: bodyData, error: bodyError } = await supabase.storage
          .from("models")
          .upload(bodyFilePath, bodyArrayBuffer, {
            contentType: "image/jpeg",
            cacheControl: "3600",
            upsert: false,
          });

        if (bodyError) {
          console.error("Vücud fotoğrafı yükleme hatası:", bodyError);
        } else {
          // Public URL'i al
          const { data: bodyUrlData } = supabase.storage
            .from("models")
            .getPublicUrl(bodyFilePath);

          bodyPhotoUrl = bodyUrlData.publicUrl;

          results.body_photo = {
            success: true,
            url: bodyPhotoUrl,
            path: bodyFilePath,
            fileName: bodyFileName,
            session_id: sessionId,
          };

          console.log(
            `Vücud fotoğrafı başarıyla yüklendi: ${bodyFilePath} (Session: ${sessionId})`
          );
        }
      } catch (bodyUploadError) {
        console.error("Vücud fotoğrafı işleme hatası:", bodyUploadError);
        results.body_photo = {
          success: false,
          error: bodyUploadError.message,
        };
      }
    }

    // Eğer her iki fotoğraf da başarıyla yüklendiyse user_photos tablosuna kaydet
    if (facePhotoUrl && bodyPhotoUrl) {
      try {
        // Önce kullanıcının tüm fotoğraflarını is_selected = false yap
        const { error: resetError } = await supabase
          .from("user_photos")
          .update({ is_selected: false })
          .eq("user_id", user_id);

        if (resetError) {
          console.error("Fotoğraf seçimlerini sıfırlama hatası:", resetError);
        }

        const photoData = {
          user_id: user_id,
          face_photo_url: facePhotoUrl,
          body_photo_url: bodyPhotoUrl,
          session_id: sessionId,
          is_selected: true, // Yeni yüklenen fotoğraf otomatik seçili
        };

        // Her zaman yeni kayıt oluştur
        const { data, error } = await supabase
          .from("user_photos")
          .insert(photoData)
          .select()
          .single();

        if (error) {
          console.error("user_photos tablosu kaydetme hatası:", error);
          results.database_record = {
            success: false,
            error: error.message,
          };
        } else {
          results.database_record = {
            success: true,
            data: data,
          };
          console.log(
            `user_photos tablosuna yeni kayıt eklendi ve seçili yapıldı (Session: ${sessionId})`
          );
        }
      } catch (dbError) {
        console.error("Veritabanı işlemi hatası:", dbError);
        results.database_record = {
          success: false,
          error: dbError.message,
        };
      }
    }

    // Sonuçları kontrol et
    const hasSuccess =
      results.face_photo?.success || results.body_photo?.success;
    const hasError = results.face_photo?.error || results.body_photo?.error;

    res.status(200).json({
      success: hasSuccess,
      message: hasSuccess
        ? "Fotoğraflar models bucket'ına başarıyla yüklendi"
        : "Fotoğraf yüklenemedi",
      data: results,
      hasError: hasError,
    });
  } catch (error) {
    console.error("Fotoğraf yükleme genel hatası:", error);
    res.status(500).json({
      success: false,
      message: "Sunucu hatası",
      error: error.message,
    });
  }
});

// Kullanıcının user_photos tablosundaki fotoğraflarını getirme
router.get("/user-photos/:user_id", async (req, res) => {
  try {
    const { user_id } = req.params;

    if (!user_id) {
      return res.status(400).json({
        success: false,
        message: "Kullanıcı ID'si gereklidir",
      });
    }

    // user_photos tablosundan kullanıcının fotoğraflarını getir
    const { data, error } = await supabase
      .from("user_photos")
      .select("*")
      .eq("user_id", user_id)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("user_photos listeleme hatası:", error);
      return res.status(500).json({
        success: false,
        message: "Fotoğraflar listelenemedi",
        error: error.message,
      });
    }

    console.log(
      `Kullanıcı ${user_id} için ${data?.length || 0} fotoğraf kaydı bulundu`
    );

    res.status(200).json({
      success: true,
      message: "Fotoğraflar başarıyla listelendi",
      data: data || [],
      total_count: data?.length || 0,
    });
  } catch (error) {
    console.error("user_photos listeleme genel hatası:", error);
    res.status(500).json({
      success: false,
      message: "Sunucu hatası",
      error: error.message,
    });
  }
});

// Kullanıcının seçili fotoğraf setini güncelleme
router.post("/select-photo-set", async (req, res) => {
  try {
    const { user_id, selected_photo_id } = req.body;

    if (!user_id || !selected_photo_id) {
      return res.status(400).json({
        success: false,
        message: "Kullanıcı ID'si ve seçili fotoğraf ID'si gereklidir",
      });
    }

    // Önce kullanıcının tüm fotoğraflarını is_selected = false yap
    const { error: resetError } = await supabase
      .from("user_photos")
      .update({ is_selected: false })
      .eq("user_id", user_id);

    if (resetError) {
      console.error("Fotoğraf seçimlerini sıfırlama hatası:", resetError);
      return res.status(500).json({
        success: false,
        message: "Fotoğraf seçimleri sıfırlanamadı",
        error: resetError.message,
      });
    }

    // Seçili fotoğrafı is_selected = true yap
    const { data, error } = await supabase
      .from("user_photos")
      .update({ is_selected: true })
      .eq("id", selected_photo_id)
      .eq("user_id", user_id)
      .select()
      .single();

    if (error) {
      console.error("Fotoğraf seçimi güncelleme hatası:", error);
      return res.status(500).json({
        success: false,
        message: "Fotoğraf seçimi güncellenemedi",
        error: error.message,
      });
    }

    console.log(
      `Kullanıcı ${user_id} için fotoğraf ${selected_photo_id} seçildi`
    );

    res.status(200).json({
      success: true,
      message: "Fotoğraf seçimi başarıyla güncellendi",
      data: data,
    });
  } catch (error) {
    console.error("Fotoğraf seçimi genel hatası:", error);
    res.status(500).json({
      success: false,
      message: "Sunucu hatası",
      error: error.message,
    });
  }
});

// Kullanıcının models bucket'ındaki fotoğraflarını listeleme
router.get("/list-photos/:user_id", async (req, res) => {
  try {
    const { user_id } = req.params;

    if (!user_id) {
      return res.status(400).json({
        success: false,
        message: "Kullanıcı ID'si gereklidir",
      });
    }

    // Models bucket'ından kullanıcının fotoğraflarını listele
    const { data, error } = await supabase.storage
      .from("models")
      .list(user_id + "/", {
        limit: 100,
        offset: 0,
        sortBy: { column: "created_at", order: "desc" },
      });

    if (error) {
      console.error("Fotoğraf listeleme hatası:", error);
      return res.status(500).json({
        success: false,
        message: "Fotoğraflar listelenemedi",
        error: error.message,
      });
    }

    if (!data || data.length === 0) {
      return res.status(200).json({
        success: true,
        message: "Kullanıcının fotoğrafı bulunamadı",
        data: {
          face_photos: [],
          body_photos: [],
          all_photos: [],
        },
      });
    }

    // Fotoğrafları kategorilere ayır ve URL'leri oluştur
    const facePhotos = [];
    const bodyPhotos = [];
    const allPhotos = [];

    data.forEach((file) => {
      if (file.name.startsWith(".")) return; // Gizli dosyaları atla

      const { data: urlData } = supabase.storage
        .from("models")
        .getPublicUrl(`${user_id}/${file.name}`);

      const photoData = {
        name: file.name,
        url: urlData.publicUrl,
        created_at: file.created_at,
        updated_at: file.updated_at,
        size: file.metadata?.size,
      };

      allPhotos.push(photoData);

      // Dosya adına göre kategorize et
      if (file.name.includes("face")) {
        facePhotos.push(photoData);
      } else if (file.name.includes("body")) {
        bodyPhotos.push(photoData);
      }
    });

    console.log(`Kullanıcı ${user_id} için ${data.length} fotoğraf listelendi`);

    res.status(200).json({
      success: true,
      message: "Fotoğraflar başarıyla listelendi",
      data: {
        face_photos: facePhotos,
        body_photos: bodyPhotos,
        all_photos: allPhotos,
        total_count: data.length,
      },
    });
  } catch (error) {
    console.error("Fotoğraf listeleme genel hatası:", error);
    res.status(500).json({
      success: false,
      message: "Sunucu hatası",
      error: error.message,
    });
  }
});

// Kullanıcının models bucket'ındaki belirli fotoğrafı silme
router.delete("/delete-photo/:user_id/:file_name", async (req, res) => {
  try {
    const { user_id, file_name } = req.params;

    if (!user_id || !file_name) {
      return res.status(400).json({
        success: false,
        message: "Kullanıcı ID'si ve dosya adı gereklidir",
      });
    }

    const filePath = `${user_id}/${file_name}`;

    // Models bucket'ından fotoğrafı sil
    const { data, error } = await supabase.storage
      .from("models")
      .remove([filePath]);

    if (error) {
      console.error("Fotoğraf silme hatası:", error);
      return res.status(500).json({
        success: false,
        message: "Fotoğraf silinemedi",
        error: error.message,
      });
    }

    console.log(`Fotoğraf silindi: ${filePath}`);

    res.status(200).json({
      success: true,
      message: "Fotoğraf başarıyla silindi",
      data: {
        deleted_file: filePath,
        result: data,
      },
    });
  } catch (error) {
    console.error("Fotoğraf silme genel hatası:", error);
    res.status(500).json({
      success: false,
      message: "Sunucu hatası",
      error: error.message,
    });
  }
});

// Kullanıcının models bucket'ındaki tüm fotoğrafları silme
router.delete("/delete-all-photos/:user_id", async (req, res) => {
  try {
    const { user_id } = req.params;

    if (!user_id) {
      return res.status(400).json({
        success: false,
        message: "Kullanıcı ID'si gereklidir",
      });
    }

    // Önce kullanıcının tüm fotoğraflarını listele
    const { data: fileList, error: listError } = await supabase.storage
      .from("models")
      .list(user_id + "/", {
        limit: 1000,
      });

    if (listError) {
      console.error("Dosya listeleme hatası:", listError);
      return res.status(500).json({
        success: false,
        message: "Dosyalar listelenemedi",
        error: listError.message,
      });
    }

    if (!fileList || fileList.length === 0) {
      return res.status(200).json({
        success: true,
        message: "Silinecek fotoğraf bulunamadı",
        data: {
          deleted_count: 0,
        },
      });
    }

    // Tüm dosya yollarını oluştur
    const filePaths = fileList
      .filter((file) => !file.name.startsWith(".")) // Gizli dosyaları atla
      .map((file) => `${user_id}/${file.name}`);

    if (filePaths.length === 0) {
      return res.status(200).json({
        success: true,
        message: "Silinecek geçerli fotoğraf bulunamadı",
        data: {
          deleted_count: 0,
        },
      });
    }

    // Tüm fotoğrafları sil
    const { data, error } = await supabase.storage
      .from("models")
      .remove(filePaths);

    if (error) {
      console.error("Toplu fotoğraf silme hatası:", error);
      return res.status(500).json({
        success: false,
        message: "Fotoğraflar silinemedi",
        error: error.message,
      });
    }

    console.log(
      `Kullanıcı ${user_id} için ${filePaths.length} fotoğraf silindi`
    );

    res.status(200).json({
      success: true,
      message: "Tüm fotoğraflar başarıyla silindi",
      data: {
        deleted_count: filePaths.length,
        deleted_files: filePaths,
        result: data,
      },
    });
  } catch (error) {
    console.error("Toplu fotoğraf silme genel hatası:", error);
    res.status(500).json({
      success: false,
      message: "Sunucu hatası",
      error: error.message,
    });
  }
});

// Fotoğraf setini silme (user_photos tablosundan ve storage'dan)
router.delete("/delete-photo-set", async (req, res) => {
  try {
    const { user_id, photo_set_id } = req.body;

    if (!user_id || !photo_set_id) {
      return res.status(400).json({
        success: false,
        message: "Kullanıcı ID'si ve fotoğraf set ID'si gereklidir",
      });
    }

    // Önce user_photos tablosundan kayıt bilgilerini al
    const { data: photoRecord, error: fetchError } = await supabase
      .from("user_photos")
      .select("*")
      .eq("id", photo_set_id)
      .eq("user_id", user_id)
      .single();

    if (fetchError || !photoRecord) {
      return res.status(404).json({
        success: false,
        message: "Fotoğraf seti bulunamadı",
        error: fetchError?.message,
      });
    }

    // Storage'dan fotoğrafları sil
    const session_id = photoRecord.session_id;
    const faceFileName = `face_${session_id}.jpg`;
    const bodyFileName = `body_${session_id}.jpg`;

    const filesToDelete = [
      `${user_id}/${faceFileName}`,
      `${user_id}/${bodyFileName}`,
    ];

    const { data: storageDeleteData, error: storageDeleteError } =
      await supabase.storage.from("models").remove(filesToDelete);

    if (storageDeleteError) {
      console.error("Storage silme hatası:", storageDeleteError);
      // Storage hatasında bile devam et, DB'den silmeyi dene
    } else {
      console.log(`Storage'dan silindi: ${filesToDelete.join(", ")}`);
    }

    // user_photos tablosundan kayıt sil
    const { error: dbDeleteError } = await supabase
      .from("user_photos")
      .delete()
      .eq("id", photo_set_id)
      .eq("user_id", user_id);

    if (dbDeleteError) {
      console.error("DB silme hatası:", dbDeleteError);
      return res.status(500).json({
        success: false,
        message: "Veritabanından fotoğraf seti silinemedi",
        error: dbDeleteError.message,
      });
    }

    console.log(
      `Fotoğraf seti silindi: ID ${photo_set_id}, Session ${session_id}`
    );

    res.status(200).json({
      success: true,
      message: "Fotoğraf seti başarıyla silindi",
      data: {
        deleted_photo_set_id: photo_set_id,
        deleted_session_id: session_id,
        deleted_files: filesToDelete,
        storage_result: storageDeleteData,
      },
    });
  } catch (error) {
    console.error("Fotoğraf seti silme genel hatası:", error);
    res.status(500).json({
      success: false,
      message: "Sunucu hatası",
      error: error.message,
    });
  }
});

module.exports = router;
