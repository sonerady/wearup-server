const express = require("express");
const router = express.Router();
const { createClient } = require("@supabase/supabase-js");

// Supabase client oluştur
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

// Kullanıcıyı turnuva sırasına ekle
router.post("/join", async (req, res) => {
  const { userId, outfitImageUrl } = req.body;

  if (!userId || !outfitImageUrl) {
    return res.status(400).json({
      success: false,
      message: "Missing required fields: userId, outfitImageUrl",
    });
  }

  try {
    // Kullanıcının zaten sırada olup olmadığını kontrol et
    const { data: existingQueue, error: queueCheckError } = await supabase
      .from("tournament_queue")
      .select("*")
      .eq("user_id", userId)
      .eq("status", "waiting");

    if (queueCheckError) throw queueCheckError;

    if (existingQueue && existingQueue.length > 0) {
      return res.status(200).json({
        success: true,
        message: "You are already in the tournament queue",
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
      return res.status(200).json({
        success: true,
        message: "You already have an active tournament match",
        matchId: existingMatch[0].id,
        status: existingMatch[0].status,
      });
    }

    // Kullanıcıyı sıraya ekle
    const { data: queueData, error: queueError } = await supabase
      .from("tournament_queue")
      .insert([
        {
          user_id: userId,
          outfit_image_url: outfitImageUrl,
          status: "waiting",
        },
      ])
      .select();

    if (queueError) throw queueError;

    return res.status(201).json({
      success: true,
      message: "Successfully joined tournament queue",
      queueId: queueData[0].id,
    });
  } catch (error) {
    console.error("Error joining tournament queue:", error);
    return res.status(500).json({
      success: false,
      message: "Error joining tournament queue",
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

module.exports = router;
