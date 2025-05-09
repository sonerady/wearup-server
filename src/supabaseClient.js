// supabaseClient.js
const { createClient } = require("@supabase/supabase-js");

// Supabase URL ve Key bilgilerini .env dosyasından al
const supabaseUrl = process.env.SUPABASE_URL;
// Anonim anahtar yerine servis anahtarı kullanıyoruz - daha fazla izin sağlar
const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

console.log("Supabase bağlantısı kuruluyor:");
console.log("URL:", supabaseUrl);
console.log("Key:", supabaseKey ? "***" + supabaseKey.slice(-5) : "undefined");

// Supabase client oluştur
const supabase = createClient(supabaseUrl, supabaseKey);

module.exports = supabase;
