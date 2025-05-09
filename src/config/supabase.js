const { createClient } = require("@supabase/supabase-js");

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;

// Eğer .env dosyasında SUPABASE_SERVICE_ROLE_KEY varsa onu kullan, yoksa normal key'i kullan
console.log("Supabase bağlantısı kuruluyor:");
console.log("URL:", supabaseUrl);
console.log("Key:", supabaseKey.slice(0, 3) + "***" + supabaseKey.slice(-5));

// Service role key kullanıyoruz - Bu RLS kısıtlamalarını bypass eder!
const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

// Admin yetkilerini true olarak ayarlayalım (RLS bypass için)
supabase.auth.admin = true;

module.exports = supabase;
