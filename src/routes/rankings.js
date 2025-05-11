const express = require("express");
const router = express.Router();
const { createClient } = require("@supabase/supabase-js");

// Supabase client oluştur
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

// En iyi oyuncuları getir
router.get("/top-players", async (req, res) => {
  try {
    const { data: topPlayers, error } = await supabase
      .from("user_rankings")
      .select(
        `
        id,
        rank,
        ranking_points,
        season,
        user_id
      `
      )
      .order("rank", { ascending: true })
      .limit(3);

    if (error) throw error;

    // Frontend'in beklediği format için verilerimizi dönüştürelim
    const formattedTopPlayers = topPlayers.map((player, index) => {
      return {
        id: player.user_id,
        name: `Top Player ${index + 1}`,
        points: player.ranking_points,
        image: `https://randomuser.me/api/portraits/${
          index % 2 ? "women" : "men"
        }/${index + 1}.jpg`,
        color:
          player.rank === 1
            ? "#5B8FFF"
            : player.rank === 2
            ? "#FFD166"
            : "#F4A261",
        position: player.rank,
        medal: player.rank, // Sadece sıra numarasını gönder, client tarafında çözülecek
      };
    });

    res.status(200).json({
      success: true,
      topPlayers: formattedTopPlayers,
    });
  } catch (error) {
    console.error("Error fetching top players:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching top players",
      error: error.message,
    });
  }
});

// Tüm sıralamaları getir
router.get("/all", async (req, res) => {
  try {
    const { data: rankings, error } = await supabase
      .from("user_rankings")
      .select(
        `
        id,
        rank,
        ranking_points,
        season,
        user_id
      `
      )
      .order("rank", { ascending: true })
      .limit(100);

    if (error) throw error;

    // Frontend'in beklediği format için verilerimizi dönüştürelim
    const formattedRankings = rankings.map((player, index) => {
      const flags = [
        "🇹🇷",
        "🇺🇸",
        "🇬🇧",
        "🇯🇵",
        "🇩🇪",
        "🇫🇷",
        "🇮🇹",
        "🇪🇸",
        "🇨🇳",
        "🇷🇺",
      ];
      return {
        position: player.rank,
        flag: flags[index % flags.length],
        name: `Player ${player.user_id.substring(0, 6)}`,
        image: `https://randomuser.me/api/portraits/${
          index % 2 ? "women" : "men"
        }/${(index % 30) + 1}.jpg`,
        rp: player.ranking_points,
        coins:
          Math.floor(player.ranking_points / 1000) +
          (30 - player.rank > 0 ? 30 - player.rank : 0),
      };
    });

    res.status(200).json({
      success: true,
      rankings: formattedRankings,
    });
  } catch (error) {
    console.error("Error fetching rankings:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching rankings",
      error: error.message,
    });
  }
});

// Aktif turnuvaları getir
router.get("/active-tournaments", async (req, res) => {
  try {
    const { data: tournaments, error } = await supabase
      .from("tournaments")
      .select(
        `
        id,
        title,
        description,
        start_time,
        end_time,
        status,
        prize_pool
      `
      )
      .eq("status", "active");

    if (error) throw error;

    res.status(200).json({
      success: true,
      tournaments,
    });
  } catch (error) {
    console.error("Error fetching active tournaments:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching active tournaments",
      error: error.message,
    });
  }
});

// Kullanıcının sıralamasını getir
router.get("/user/:userId", async (req, res) => {
  const { userId } = req.params;

  try {
    const { data: userRanking, error } = await supabase
      .from("user_rankings")
      .select(
        `
        id,
        rank,
        ranking_points,
        season,
        user_id
      `
      )
      .eq("user_id", userId)
      .order("season", { ascending: false })
      .single();

    if (error) {
      if (error.code === "PGRST116") {
        // Veri bulunamadı, yeni kullanıcı için varsayılan değerler oluştur
        return res.status(200).json({
          success: true,
          userRanking: {
            rank: 999,
            points: 0,
            season: new Date().toISOString().substring(0, 7), // YYYY-MM
            username: `Player ${userId.substring(0, 6)}`,
            avatar: `https://randomuser.me/api/portraits/men/1.jpg`,
          },
        });
      }
      throw error;
    }

    if (!userRanking) {
      return res.status(404).json({
        success: false,
        message: "User ranking not found",
      });
    }

    const formattedUserRanking = {
      rank: userRanking.rank,
      points: userRanking.ranking_points,
      season: userRanking.season,
      username: `Player ${userRanking.user_id.substring(0, 6)}`,
      avatar: `https://randomuser.me/api/portraits/men/1.jpg`,
    };

    res.status(200).json({
      success: true,
      userRanking: formattedUserRanking,
    });
  } catch (error) {
    console.error("Error fetching user ranking:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching user ranking",
      error: error.message,
    });
  }
});

module.exports = router;
