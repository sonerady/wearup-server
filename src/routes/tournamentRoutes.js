const express = require("express");
const router = express.Router();
const { createClient } = require("@supabase/supabase-js");

// Supabase client oluştur
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

// Kullanıcıyı turnuva sırasına ekle
router.post("/join", async (req, res) => {
  const { userId, itemId, itemType, imageUrl } = req.body;

  if (!userId || !imageUrl) {
    return res.status(400).json({
      success: false,
      message: "Missing required fields: userId and imageUrl",
    });
  }

  try {
    // Özel durum: test kullanıcısı kontrolü
    if (userId === "daf859e7-f3df-404b-bbbd-7fe9c60b40e4") {
      console.log("Özel kullanıcı turnuva isteği: ", userId);
    }

    // Kullanıcının zaten sırada olup olmadığını kontrol et
    const { data: existingQueue, error: queueCheckError } = await supabase
      .from("tournament_queue")
      .select("*")
      .eq("user_id", userId);

    if (queueCheckError) throw queueCheckError;

    if (existingQueue && existingQueue.length > 0) {
      // Zaten turnuvada olma durumunu detaylı açıkla
      const queueStatus = existingQueue[0].status;
      let statusMessage = "";

      switch (queueStatus) {
        case "waiting":
          statusMessage = "Şu anda turnuva sırasında beklemektesiniz.";
          break;
        case "matched":
          statusMessage = "Turnuva eşleşmesi bulundu, rakibiniz hazırlanıyor.";
          break;
        case "active":
          statusMessage = "Aktif bir turnuva savaşınız devam ediyor.";
          break;
        case "completed":
          statusMessage =
            "Son turnuvanız tamamlandı, yeni bir turnuvaya katılabilirsiniz.";
          break;
        default:
          statusMessage = "Zaten bir turnuvaya katıldınız.";
      }

      return res.status(409).json({
        success: false,
        code: "23505", // Duplicate key error kodu
        message: statusMessage,
        queueId: existingQueue[0].id,
        status: existingQueue[0].status,
      });
    }

    // Kullanıcının aktif eşleşmesi var mı kontrol et
    const { data: existingMatch, error: matchCheckError } = await supabase.rpc(
      "check_user_tournament_match",
      {
        user_id_param: userId,
      }
    );

    if (matchCheckError) throw matchCheckError;

    if (existingMatch && existingMatch.length > 0) {
      const matchStatus = existingMatch[0].status;
      let matchMessage = "";

      switch (matchStatus) {
        case "pending":
          matchMessage =
            "Turnuva eşleşmeniz onay bekliyor, lütfen rakibinizi onaylayın.";
          break;
        case "active":
          matchMessage = "Aktif bir turnuva savaşınız devam ediyor.";
          break;
        default:
          matchMessage = "Devam eden bir turnuva eşleşmeniz bulunmaktadır.";
      }

      return res.status(409).json({
        success: false,
        code: "23505",
        message: matchMessage,
        matchId: existingMatch[0].id,
        status: existingMatch[0].status,
      });
    }

    // Kullanıcıyı sıraya ekle - Bunu schema sorunlarına göre güncelle
    try {
      // Önce tablo yapısını kontrol et
      const { data: columnInfo, error: columnError } = await supabase
        .from("tournament_queue")
        .select()
        .limit(1);

      let insertData = {
        user_id: userId,
        outfit_image_url: imageUrl,
        status: "waiting",
      };

      // item_id ve item_type sütunları sadece varsa ekle
      if (!columnError && columnInfo) {
        try {
          // Şema doğrulaması için bir güvenli eklenecek alanlar listesi oluştur
          const { error: testError } = await supabase
            .from("tournament_queue")
            .insert([
              {
                ...insertData,
                item_id: itemId || null,
                item_type: itemType || "outfit",
              },
            ])
            .select();

          if (!testError) {
            // Başarılı olduysa, tam veri kümesini kullan
            insertData = {
              ...insertData,
              item_id: itemId || null,
              item_type: itemType || "outfit",
            };
          }
        } catch (schemaError) {
          console.log(
            "Şema sorunu, item sütunları atlanıyor:",
            schemaError.message
          );
          // Şema hatası nedeniyle item_id ve item_type alanlarını atla
        }
      }

      // Kullanıcıyı sıraya ekle - Sadece geçerli alanlarla
      const { data: queueData, error: queueError } = await supabase
        .from("tournament_queue")
        .insert([insertData])
        .select();

      if (queueError) {
        // Özgün key hatası durumunda daha kullanıcı dostu mesaj
        if (queueError.code === "23505") {
          return res.status(409).json({
            success: false,
            code: "23505",
            message:
              "Zaten turnuva sırasındasınız. Yeni bir turnuvaya katılmadan önce mevcut turnuvanızı tamamlamalısınız.",
            error: queueError.message,
          });
        }
        throw queueError;
      }

      return res.status(201).json({
        success: true,
        message: "Turnuva sırasına başarıyla katıldınız.",
        queueId: queueData[0].id,
      });
    } catch (insertError) {
      console.error("SQL insert hatası:", insertError);

      // Temel insert işlemi
      const { data: basicQueueData, error: basicQueueError } = await supabase
        .from("tournament_queue")
        .insert([
          {
            user_id: userId,
            outfit_image_url: imageUrl,
            status: "waiting",
          },
        ])
        .select();

      if (basicQueueError) throw basicQueueError;

      return res.status(201).json({
        success: true,
        message: "Turnuva sırasına başarıyla katıldınız (temel mod).",
        queueId: basicQueueData[0].id,
      });
    }
  } catch (error) {
    console.error("Error joining tournament queue:", error);
    return res.status(500).json({
      success: false,
      message: "Turnuva sırasına katılırken bir hata oluştu",
      code: error.code,
      detail: error.detail,
      error: error.message,
    });
  }
});

// Kullanıcının turnuva durumunu kontrol et
router.get("/status/:userId", async (req, res) => {
  const { userId } = req.params;

  if (!userId) {
    return res.status(400).json({
      success: false,
      message: "Missing required field: userId",
    });
  }

  try {
    // Kullanıcının sırada olup olmadığını kontrol et
    const { data: queue, error: queueError } = await supabase
      .from("tournament_queue")
      .select("*")
      .eq("user_id", userId)
      .order("joined_at", { ascending: false })
      .limit(1)
      .single();

    if (queueError && queueError.code !== "PGRST116") {
      // PGRST116: No rows returned (kullanıcı sırada değil)
      throw queueError;
    }

    // Kullanıcı sırada değilse
    if (!queue) {
      return res.status(200).json({
        success: true,
        inQueue: false,
        status: "not_in_queue",
      });
    }

    // Kullanıcının bir eşleşmesi var mı kontrol et
    const { data: match, error: matchError } = await supabase.rpc(
      "get_user_tournament_match",
      {
        queue_id_param: queue.id,
      }
    );

    if (matchError) throw matchError;

    if (!match || match.length === 0) {
      // Kullanıcı sırada ama henüz eşleşmemiş
      return res.status(200).json({
        success: true,
        inQueue: true,
        status: queue.status,
        queueInfo: queue,
        match: null,
      });
    }

    // Kullanıcının eşleşmesi var, detayları döndür
    return res.status(200).json({
      success: true,
      inQueue: true,
      status: queue.status,
      queueInfo: queue,
      matchInfo: match[0],
    });
  } catch (error) {
    console.error("Error checking tournament status:", error);
    return res.status(500).json({
      success: false,
      message: "Error checking tournament status",
      error: error.message,
    });
  }
});

// Turnuvayı başlat
router.post("/start", async (req, res) => {
  const { userId, matchId } = req.body;

  if (!userId || !matchId) {
    return res.status(400).json({
      success: false,
      message: "Missing required fields: userId, matchId",
    });
  }

  try {
    // Eşleşmeyi bul
    const { data: match, error: matchError } = await supabase
      .from("tournament_matches")
      .select("*, user1:user1_id(*), user2:user2_id(*)")
      .eq("id", matchId)
      .single();

    if (matchError) throw matchError;

    if (!match) {
      return res.status(404).json({
        success: false,
        message: "Tournament match not found",
      });
    }

    // Eşleşme durumunu kontrol et
    if (match.status !== "pending") {
      return res.status(400).json({
        success: false,
        message: `Cannot start match with status: ${match.status}`,
      });
    }

    // Bu kullanıcı bu eşleşmede var mı kontrol et
    if (match.user1.user_id !== userId && match.user2.user_id !== userId) {
      return res.status(403).json({
        success: false,
        message: "You are not part of this match",
      });
    }

    // Eşleşmeyi aktif olarak işaretle
    const { data: updatedMatch, error: updateError } = await supabase
      .from("tournament_matches")
      .update({
        status: "active",
        started_at: new Date(),
      })
      .eq("id", matchId)
      .select();

    if (updateError) throw updateError;

    // İlgili sıra kayıtlarını güncelle
    await supabase
      .from("tournament_queue")
      .update({ status: "active" })
      .in("id", [match.user1_id, match.user2_id]);

    // Style battle formatında eşleşme detaylarını döndür
    const battleFormatted = {
      id: match.id,
      title: "Tournament Battle",
      status: "active",
      user1: {
        id: match.user1_id,
        name: `Stylist ${match.user1.user_id.substring(0, 6)}`,
        image: match.user1.outfit_image_url,
        votes: 0,
      },
      user2: {
        id: match.user2_id,
        name: `Stylist ${match.user2.user_id.substring(0, 6)}`,
        image: match.user2.outfit_image_url,
        votes: 0,
      },
      totalVotes: 0,
      timeLeft: "1 hour", // Varsayılan süre
    };

    return res.status(200).json({
      success: true,
      message: "Tournament match started successfully",
      battle: battleFormatted,
    });
  } catch (error) {
    console.error("Error starting tournament match:", error);
    return res.status(500).json({
      success: false,
      message: "Error starting tournament match",
      error: error.message,
    });
  }
});

// Turnuvada oy ver
router.post("/vote", async (req, res) => {
  const { userId, matchId, participantId, voteCount = 1 } = req.body;

  console.log("Received tournament vote request:", {
    userId,
    matchId,
    participantId,
    voteCount,
  });

  if (!userId || !matchId || !participantId) {
    return res.status(400).json({
      success: false,
      message: "Missing required fields: userId, matchId, participantId",
    });
  }

  // Oy sayısını numeric olarak doğrula
  const votes = parseInt(voteCount) || 1;

  // Makul bir üst limit koy
  const maxVotesPerRequest = 100;
  const finalVoteCount = Math.min(votes, maxVotesPerRequest);

  try {
    // Eşleşmeyi bul
    const { data: match, error: matchError } = await supabase
      .from("tournament_matches")
      .select("*")
      .eq("id", matchId)
      .single();

    if (matchError) throw matchError;

    if (!match) {
      return res.status(404).json({
        success: false,
        message: "Tournament match not found",
      });
    }

    // Eşleşme durumunu kontrol et
    if (match.status !== "active") {
      return res.status(400).json({
        success: false,
        message: `Cannot vote on match with status: ${match.status}`,
      });
    }

    // Oyları güncelle
    let updateData = {};
    if (participantId === match.user1_id) {
      updateData = {
        user1_votes: match.user1_votes + finalVoteCount,
        total_votes: match.total_votes + finalVoteCount,
      };
    } else if (participantId === match.user2_id) {
      updateData = {
        user2_votes: match.user2_votes + finalVoteCount,
        total_votes: match.total_votes + finalVoteCount,
      };
    } else {
      return res.status(400).json({
        success: false,
        message: "Invalid participant ID",
      });
    }

    // Eşleşmeyi güncelle
    const { data: updatedMatch, error: updateError } = await supabase
      .from("tournament_matches")
      .update(updateData)
      .eq("id", matchId)
      .select();

    if (updateError) throw updateError;

    return res.status(200).json({
      success: true,
      message: `Successfully recorded ${finalVoteCount} votes`,
      votesRecorded: finalVoteCount,
      match: updatedMatch[0],
    });
  } catch (error) {
    console.error("Error voting in tournament match:", error);
    return res.status(500).json({
      success: false,
      message: "Error voting in tournament match",
      error: error.message,
    });
  }
});

// Turnuvada bekleyen kullanıcıları getir (uygulama için gerçek-zamanlı değil, sadece görsel)
router.get("/waiting-users", async (req, res) => {
  try {
    // Fake kullanıcı verileri oluştur
    const waitingUsers = [
      {
        id: "fake-user-1",
        username: "AyşeStyle",
        avatar: "https://randomuser.me/api/portraits/women/12.jpg",
        style_points: 3254,
        waiting_since: "2 dakika",
        outfit_image_url:
          "https://fashionjournal.com.au/wp-content/uploads/2023/04/FJ-Denim-Trend-April-DemnaGvasalia.jpg",
      },
      {
        id: "fake-user-2",
        username: "ModaCı93",
        avatar: "https://randomuser.me/api/portraits/men/22.jpg",
        style_points: 2876,
        waiting_since: "4 dakika",
        outfit_image_url:
          "https://assets.vogue.com/photos/5891f2bc186d7c1b6493c65a/master/w_2580%2Cc_limit/11-nigo-style.jpg",
      },
      {
        id: "fake-user-3",
        username: "StilKraliçesi",
        avatar: "https://randomuser.me/api/portraits/women/32.jpg",
        style_points: 4120,
        waiting_since: "1 dakika",
        outfit_image_url:
          "https://images.squarespace-cdn.com/content/v1/5bd53306840b16657de21e14/1612472431158-9ZCQFXHLWL40CSIKXE76/street-style-london-calling-36-5fb40b45e08cc.jpg",
      },
      {
        id: "fake-user-4",
        username: "FashionKing",
        avatar: "https://randomuser.me/api/portraits/men/45.jpg",
        style_points: 3754,
        waiting_since: "5 dakika",
        outfit_image_url:
          "https://s3-us-west-2.amazonaws.com/files.onset.freedom.co/joeybadass/uploads/2016/04/13193215/maxresdefault-1.jpg",
      },
      {
        id: "fake-user-5",
        username: "TrendSetter",
        avatar: "https://randomuser.me/api/portraits/women/58.jpg",
        style_points: 3985,
        waiting_since: "3 dakika",
        outfit_image_url:
          "https://i.pinimg.com/originals/5c/7a/43/5c7a4310fc1ecf1fdd7b48ed957f165f.jpg",
      },
      {
        id: "fake-user-6",
        username: "VogueMan",
        avatar: "https://randomuser.me/api/portraits/men/67.jpg",
        style_points: 3121,
        waiting_since: "7 dakika",
        outfit_image_url:
          "https://media.gq.com/photos/56bb54bba91b95ae55415aba/master/w_1600%2Cc_limit/Future.jpg",
      },
    ];

    // Rastgele sırayla döndür
    const shuffledUsers = [...waitingUsers].sort(() => 0.5 - Math.random());

    return res.status(200).json({
      success: true,
      message: "Turnuvada bekleyen kullanıcılar",
      waitingUsers: shuffledUsers.slice(0, 5), // Sadece 5 tanesini göster
    });
  } catch (error) {
    console.error("Error getting waiting users:", error);
    return res.status(500).json({
      success: false,
      message: "Error getting waiting users",
      error: error.message,
    });
  }
});

// Test kullanıcısı için turnuva verilerini temizle (SADECE GELİŞTİRME ORTAMINDA KULLANILMALI)
router.delete("/clear-test-user/:userId", async (req, res) => {
  const { userId } = req.params;

  // Sadece belirli test kullanıcıları için izin ver
  if (userId !== "daf859e7-f3df-404b-bbbd-7fe9c60b40e4") {
    return res.status(403).json({
      success: false,
      message: "Bu işlem sadece test kullanıcıları için geçerlidir",
    });
  }

  try {
    console.log(`Test kullanıcısı turnuva verilerini temizleme: ${userId}`);

    // İlk olarak, bu kullanıcının turnuva sırasında olup olmadığını kontrol et
    const { data: queueEntries, error: queueError } = await supabase
      .from("tournament_queue")
      .select("id")
      .eq("user_id", userId);

    if (queueError) throw queueError;

    // Kullanıcı hiç turnuvaya katılmadıysa
    if (!queueEntries || queueEntries.length === 0) {
      return res.status(200).json({
        success: true,
        message: "Kullanıcı için silinecek turnuva verisi bulunamadı",
      });
    }

    // Kullanıcının queue ID'lerini topla
    const queueIds = queueEntries.map((entry) => entry.id);

    // Önce ilişkili eşleşmeleri temizle
    const { error: matchDeleteError } = await supabase
      .from("tournament_matches")
      .delete()
      .or(
        `user1_id.in.(${queueIds.join(",")}),user2_id.in.(${queueIds.join(
          ","
        )})`
      );

    if (matchDeleteError) throw matchDeleteError;

    // Sonra queue kayıtlarını temizle
    const { error: queueDeleteError } = await supabase
      .from("tournament_queue")
      .delete()
      .eq("user_id", userId);

    if (queueDeleteError) throw queueDeleteError;

    return res.status(200).json({
      success: true,
      message: `${userId} kullanıcısı için turnuva verileri başarıyla temizlendi`,
      deletedEntries: queueEntries.length,
    });
  } catch (error) {
    console.error("Test kullanıcı verilerini temizlerken hata:", error);
    return res.status(500).json({
      success: false,
      message: "Turnuva verilerini temizlerken bir hata oluştu",
      error: error.message,
    });
  }
});

// Kullanıcıyı turnuva sırasından çıkar
router.post("/leave", async (req, res) => {
  const { userId } = req.body;

  if (!userId) {
    return res.status(400).json({
      success: false,
      message: "Missing required field: userId",
    });
  }

  try {
    // Kullanıcının sırada olup olmadığını kontrol et
    const { data: queueEntries, error: queueError } = await supabase
      .from("tournament_queue")
      .select("id, status") // status bilgisini de alalım
      .eq("user_id", userId);

    if (queueError) throw queueError;

    // Kullanıcı sırada değilse veya hiç kayıt yoksa
    if (!queueEntries || queueEntries.length === 0) {
      return res.status(200).json({
        success: true, // Hata değil, işlem yapılacak bir şey yok
        message: "Kullanıcı zaten bir turnuva sırasında değil.",
      });
    }

    // Aktif eşleşme durumunda turnuvadan çıkılmamalı (Bu kuralı koruyoruz)
    const activeEntry = queueEntries.find((entry) => entry.status === "active");
    if (activeEntry) {
      return res.status(400).json({
        success: false,
        message: "Aktif bir turnuva devam ederken sıradan çıkamazsınız.",
      });
    }

    // Kullanıcının queue ID'lerini topla (artık birden fazla olabilir, ama normalde tek olmalı)
    const queueIds = queueEntries.map((entry) => entry.id);

    // Önce ilişkili TÜM EŞLEŞMELERİ TEMİZLE (durumuna bakılmaksızın)
    // Bu, takılı kalmış 'pending' veya 'completed' eşleşmeleri de temizler.
    if (queueIds.length > 0) {
      const { error: matchDeleteError } = await supabase
        .from("tournament_matches")
        .delete()
        .or(
          `user1_id.in.(${queueIds
            .map((id) => `'${id}'`)
            .join(",")}),user2_id.in.(${queueIds
            .map((id) => `'${id}'`)
            .join(",")})`
        );

      if (matchDeleteError) {
        console.error("Error deleting associated matches:", matchDeleteError);
        // Kritik bir hata değilse devam edebiliriz, en azından queue temizlensin
      }
    }

    // Sonra TÜM queue kayıtlarını temizle (user_id ile eşleşen)
    const { data: deletedData, error: queueDeleteError } = await supabase
      .from("tournament_queue")
      .delete()
      .eq("user_id", userId) // user_id ile eşleşen tüm kayıtları sil
      .select(); // Silinen kayıtları döndürsün (opsiyonel)

    if (queueDeleteError) throw queueDeleteError;

    return res.status(200).json({
      success: true,
      message:
        "Turnuva sırasından ve ilişkili tüm eşleşmelerden başarıyla çıkıldı.",
      deletedQueueEntries: deletedData ? deletedData.length : 0,
    });
  } catch (error) {
    console.error("Turnuva sırasından çıkarken hata:", error);
    return res.status(500).json({
      success: false,
      message: "Turnuva sırasından çıkarken bir hata oluştu",
      error: error.message,
    });
  }
});

module.exports = router;
