const express = require("express");
const router = express.Router();
const supabase = require("../lib/supabaseClient"); // Bir önceki adımda oluşturduğumuz client
const multer = require("multer");
const upload = multer({ storage: multer.memoryStorage() });

// Helper function to get user_id from request (assuming it's passed in query or body)
// You might have a middleware for this already if using actual auth
const getUserId = (req) => {
  return req.query.userId || req.body.userId;
};

// GET all planner events for a user
router.get("/events", async (req, res) => {
  const userId = getUserId(req);
  if (!userId) {
    return res
      .status(400)
      .json({ success: false, message: "User ID is required" });
  }

  try {
    const { data, error } = await supabase
      .from("planner_events")
      .select("*")
      .eq("user_id", userId)
      .order("event_date", { ascending: true });

    if (error) throw error;
    res.json({ success: true, data });
  } catch (error) {
    console.error("Error fetching planner events:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch planner events",
      error: error.message,
    });
  }
});

// POST a new planner event
router.post("/events", async (req, res) => {
  const {
    userId,
    title,
    notes,
    type,
    event_date, // YYYY-MM-DD formatında
    images, // Array of image_url strings
    selected_outfits, // Array of objects
    selected_items, // Array of objects
  } = req.body;

  if (!userId || !title || !type || !event_date) {
    return res.status(400).json({
      success: false,
      message: "Missing required fields (userId, title, type, event_date)",
    });
  }

  try {
    const { data, error } = await supabase
      .from("planner_events")
      .insert([
        {
          user_id: userId,
          title,
          notes,
          type,
          event_date,
          images: images || null,
          selected_outfits: selected_outfits || null,
          selected_items: selected_items || null,
        },
      ])
      .select(); // Insert sonrası eklenen veriyi döndürür

    if (error) throw error;
    res.status(201).json({ success: true, data: data[0] });
  } catch (error) {
    console.error("Error creating planner event:", error);
    res.status(500).json({
      success: false,
      message: "Failed to create planner event",
      error: error.message,
    });
  }
});

// PUT (update) an existing planner event by ID
router.put("/events/:eventId", async (req, res) => {
  const { eventId } = req.params;
  const {
    userId, // Important for RLS or additional checks if needed
    title,
    notes,
    type,
    event_date,
    images,
    selected_outfits,
    selected_items,
  } = req.body;

  // userId kontrolü RLS ile yapılıyorsa burada tekrar yapmaya gerek olmayabilir,
  // ama API katmanında da bir yetkilendirme/kontrol yapmak iyi bir pratiktir.
  // Örneğin: const currentUserId = getUserId(req); if (currentUserId !== userIdFromDbEvent) { return 403; }

  try {
    const { data, error } = await supabase
      .from("planner_events")
      .update({
        title,
        notes,
        type,
        event_date,
        images,
        selected_outfits,
        selected_items,
        updated_at: new Date(), // updated_at trigger ile otomatik güncellenir ama explicit de gönderilebilir
      })
      .eq("id", eventId)
      // .eq('user_id', userId) // Eğer RLS yoksa veya ek güvenlik katmanı isteniyorsa
      .select();

    if (error) throw error;
    if (!data || data.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Event not found or user unauthorized to update",
      });
    }
    res.json({ success: true, data: data[0] });
  } catch (error) {
    console.error("Error updating planner event:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update planner event",
      error: error.message,
    });
  }
});

// DELETE a planner event by ID
router.delete("/events/:eventId", async (req, res) => {
  const { eventId } = req.params;
  const userId = getUserId(req); // Get user_id from query for ownership check if not using RLS only

  if (!userId) {
    // RLS varsa bu kontrol opsiyonel olabilir, ama client'tan userId almak iyi bir pratik.
    // return res.status(400).json({ success: false, message: 'User ID is required for deletion authorization' });
  }

  try {
    const { data, error } = await supabase
      .from("planner_events")
      .delete()
      .eq("id", eventId);
    // .eq('user_id', userId); // RLS yoksa veya ek güvenlik katmanı isteniyorsa

    // 'data' delete işleminde genellikle boş döner veya etkilenen satır sayısını içerir.
    // Supabase v2'de .delete() sonrası .select() zincirlenemez.
    // Başarılı silme durumunda error null olur.

    if (error) throw error;
    // Silinen bir şey olup olmadığını kontrol etmek için count kullanılabilir ama Supabase bunu doğrudan döndürmeyebilir.
    // Genellikle hata yoksa başarılı kabul edilir.
    res.json({ success: true, message: "Event deleted successfully" });
  } catch (error) {
    console.error("Error deleting planner event:", error);
    res.status(500).json({
      success: false,
      message: "Failed to delete planner event",
      error: error.message,
    });
  }
});

// POST /api/planner/upload-images (multipart/form-data)
router.post("/upload-images", upload.array("images", 10), async (req, res) => {
  const { userId } = req.body;
  const files = req.files;

  if (!userId || !files || files.length === 0) {
    return res
      .status(400)
      .json({
        success: false,
        message: "userId ve images dosya dizisi gereklidir",
      });
  }

  try {
    const uploadPromises = files.map(async (file) => {
      try {
        const ext = file.mimetype.includes("png") ? "png" : "jpg";
        const fileName = `${userId}/${Date.now()}_${Math.random()
          .toString(36)
          .substring(2, 8)}.${ext}`;

        const { error: uploadErr } = await supabase.storage
          .from("events")
          .upload(fileName, file.buffer, {
            contentType: file.mimetype,
            upsert: false,
          });

        if (uploadErr) throw uploadErr;

        const { data: publicUrlData } = supabase.storage
          .from("events")
          .getPublicUrl(fileName);

        return publicUrlData.publicUrl;
      } catch (err) {
        console.error("Image upload error:", err);
        return null;
      }
    });

    const urls = (await Promise.all(uploadPromises)).filter(Boolean);
    return res.json({ success: true, urls });
  } catch (err) {
    console.error("upload-images route error:", err);
    return res
      .status(500)
      .json({ success: false, message: "Upload failed", error: err.message });
  }
});

// ------------------------------

module.exports = router;
