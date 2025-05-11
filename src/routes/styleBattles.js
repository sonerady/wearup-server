const express = require("express");
const router = express.Router();
const { createClient } = require("@supabase/supabase-js");

// Supabase client oluştur
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

// Tüm aktif stil savaşlarını getir
router.get("/active-battles", async (req, res) => {
  try {
    const { data: battles, error } = await supabase
      .from("style_battles")
      .select(
        `
        id, 
        title, 
        status, 
        start_time, 
        end_time, 
        total_votes,
        battle_participants (
          id,
          user_id,
          outfit_image_url,
          votes,
          is_winner
        )
      `
      )
      .eq("status", "active")
      .order("start_time", { ascending: false });

    if (error) throw error;

    // Frontend'in beklediği format için verilerimizi dönüştürelim
    const formattedBattles = battles.map((battle) => {
      const user1 = battle.battle_participants[0];
      const user2 = battle.battle_participants[1];

      // Kalan süreyi hesapla
      const now = new Date();
      const endTime = new Date(battle.end_time);
      const timeLeftMs = endTime - now;
      let timeLeft;

      if (timeLeftMs <= 0) {
        timeLeft = "Finished";
      } else {
        const hoursLeft = Math.floor(timeLeftMs / (1000 * 60 * 60));
        if (hoursLeft < 1) {
          timeLeft = "Less than 1 hour";
        } else {
          timeLeft = `${hoursLeft} hour${hoursLeft > 1 ? "s" : ""}`;
        }
      }

      return {
        id: battle.id,
        title: battle.title,
        user1: {
          id: user1?.id,
          name: user1?.user_id
            ? `Stylist ${user1.user_id.substring(0, 6)}`
            : "Stylist 1",
          image: user1?.outfit_image_url || "https://via.placeholder.com/300",
          votes: user1?.votes || 0,
        },
        user2: {
          id: user2?.id,
          name: user2?.user_id
            ? `Stylist ${user2.user_id.substring(0, 6)}`
            : "Stylist 2",
          image: user2?.outfit_image_url || "https://via.placeholder.com/300",
          votes: user2?.votes || 0,
        },
        timeLeft,
        totalVotes: battle.total_votes,
        status: battle.status,
      };
    });

    res.status(200).json({
      success: true,
      battles: formattedBattles,
    });
  } catch (error) {
    console.error("Error fetching active battles:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching active battles",
      error: error.message,
    });
  }
});

// Tüm bitmiş stil savaşlarını getir
router.get("/finished-battles", async (req, res) => {
  try {
    const { data: battles, error } = await supabase
      .from("style_battles")
      .select(
        `
        id, 
        title, 
        status, 
        start_time, 
        end_time, 
        total_votes,
        battle_participants (
          id,
          user_id,
          outfit_image_url,
          votes,
          is_winner
        )
      `
      )
      .eq("status", "finished")
      .order("end_time", { ascending: false });

    if (error) throw error;

    // Frontend'in beklediği format için verilerimizi dönüştürelim
    const formattedBattles = battles.map((battle) => {
      const user1 = battle.battle_participants[0];
      const user2 = battle.battle_participants[1];

      return {
        id: battle.id,
        title: battle.title,
        user1: {
          id: user1?.id,
          name: user1?.user_id
            ? `Stylist ${user1.user_id.substring(0, 6)}`
            : "Stylist 1",
          image: user1?.outfit_image_url || "https://via.placeholder.com/300",
          votes: user1?.votes || 0,
        },
        user2: {
          id: user2?.id,
          name: user2?.user_id
            ? `Stylist ${user2.user_id.substring(0, 6)}`
            : "Stylist 2",
          image: user2?.outfit_image_url || "https://via.placeholder.com/300",
          votes: user2?.votes || 0,
        },
        timeLeft: "Finished",
        totalVotes: battle.total_votes,
        status: battle.status,
      };
    });

    res.status(200).json({
      success: true,
      battles: formattedBattles,
    });
  } catch (error) {
    console.error("Error fetching finished battles:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching finished battles",
      error: error.message,
    });
  }
});

// Oy verme işlemi
router.post("/vote", async (req, res) => {
  const { userId, battleId, participantId } = req.body;

  console.log("Received vote request:", { userId, battleId, participantId });

  if (!userId || !battleId || !participantId) {
    return res.status(400).json({
      success: false,
      message: "Missing required fields: userId, battleId, participantId",
    });
  }

  try {
    // İlgili katılımcıyı ve savaşı bul
    const { data: participant, error: participantError } = await supabase
      .from("battle_participants")
      .select("*")
      .eq("id", participantId)
      .single();

    if (participantError) {
      console.error("Participant error:", participantError);
      throw participantError;
    }

    if (!participant) {
      console.log("Participant not found:", participantId);
      return res.status(404).json({
        success: false,
        message: "Participant not found",
      });
    }

    // Savaşın durumunu kontrol et
    const { data: battle, error: battleError } = await supabase
      .from("style_battles")
      .select("status, total_votes")
      .eq("id", battleId)
      .single();

    if (battleError) {
      console.error("Battle error:", battleError);
      throw battleError;
    }

    if (battle.status === "finished") {
      console.log("Battle is finished:", battleId);
      return res.status(400).json({
        success: false,
        message: "This battle is already finished",
      });
    }

    // Kullanıcının daha önce oy verip vermediğini kontrol et, ama buna göre işlem yapmak yerine
    // sadece kaydı güncelle veya yeni kayıt ekle
    const { data: existingVote, error: voteCheckError } = await supabase
      .from("user_votes")
      .select("*")
      .eq("user_id", userId)
      .eq("battle_id", battleId);

    if (voteCheckError) {
      console.error("Vote check error:", voteCheckError);
      throw voteCheckError;
    }

    // Eğer zaten oy verildiyse, mevcut kaydı silip yeni kayıt ekleyeceğiz
    if (existingVote && existingVote.length > 0) {
      // Önce eski oyu sil
      const { error: deleteError } = await supabase
        .from("user_votes")
        .delete()
        .eq("user_id", userId)
        .eq("battle_id", battleId);

      if (deleteError) {
        console.error("Vote delete error:", deleteError);
        throw deleteError;
      }

      console.log("Previous vote deleted, adding new vote");
    }

    // Şimdi yeni oy ekle
    const { data: voteData, error: voteError } = await supabase
      .from("user_votes")
      .insert([
        { user_id: userId, battle_id: battleId, participant_id: participantId },
      ]);

    if (voteError) {
      console.error("Vote insert error:", voteError);
      throw voteError;
    }

    // Katılımcının oylarını arttır
    const { data: updateData, error: updateError } = await supabase
      .from("battle_participants")
      .update({ votes: participant.votes + 1 })
      .eq("id", participantId);

    if (updateError) {
      console.error("Participant update error:", updateError);
      throw updateError;
    }

    // Toplam oy sayısını arttır - rpc fonksiyonu yerine direkt güncelleme yapalım
    const newTotalVotes = (battle.total_votes || 0) + 1;
    const { data: battleUpdateData, error: battleUpdateError } = await supabase
      .from("style_battles")
      .update({ total_votes: newTotalVotes })
      .eq("id", battleId);

    if (battleUpdateError) {
      console.error("Battle update error:", battleUpdateError);
      throw battleUpdateError;
    }

    console.log("Vote recorded successfully");
    res.status(200).json({
      success: true,
      message: "Vote recorded successfully",
    });
  } catch (error) {
    console.error("Error voting for participant:", error);
    res.status(500).json({
      success: false,
      message: "Error voting for participant",
      error: error.message,
    });
  }
});

// Tek bir stil savaşı detaylarını getir
router.get("/battle/:id", async (req, res) => {
  const { id } = req.params;

  try {
    const { data: battle, error } = await supabase
      .from("style_battles")
      .select(
        `
        id, 
        title, 
        status, 
        start_time, 
        end_time, 
        total_votes,
        battle_participants (
          id,
          user_id,
          outfit_image_url,
          votes,
          is_winner
        )
      `
      )
      .eq("id", id)
      .single();

    if (error) throw error;

    if (!battle) {
      return res.status(404).json({
        success: false,
        message: "Battle not found",
      });
    }

    // Frontend'in beklediği format için verilerimizi dönüştürelim
    const user1 = battle.battle_participants[0];
    const user2 = battle.battle_participants[1];

    // Kalan süreyi hesapla
    const now = new Date();
    const endTime = new Date(battle.end_time);
    const timeLeftMs = endTime - now;
    let timeLeft;

    if (timeLeftMs <= 0 || battle.status === "finished") {
      timeLeft = "Finished";
    } else {
      const hoursLeft = Math.floor(timeLeftMs / (1000 * 60 * 60));
      if (hoursLeft < 1) {
        timeLeft = "Less than 1 hour";
      } else {
        timeLeft = `${hoursLeft} hour${hoursLeft > 1 ? "s" : ""}`;
      }
    }

    const formattedBattle = {
      id: battle.id,
      title: battle.title,
      user1: {
        id: user1?.id,
        name: user1?.user_id
          ? `Stylist ${user1.user_id.substring(0, 6)}`
          : "Stylist 1",
        image: user1?.outfit_image_url || "https://via.placeholder.com/300",
        votes: user1?.votes || 0,
      },
      user2: {
        id: user2?.id,
        name: user2?.user_id
          ? `Stylist ${user2.user_id.substring(0, 6)}`
          : "Stylist 2",
        image: user2?.outfit_image_url || "https://via.placeholder.com/300",
        votes: user2?.votes || 0,
      },
      timeLeft,
      totalVotes: battle.total_votes,
      status: battle.status,
    };

    res.status(200).json({
      success: true,
      battle: formattedBattle,
    });
  } catch (error) {
    console.error("Error fetching battle details:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching battle details",
      error: error.message,
    });
  }
});

module.exports = router;
