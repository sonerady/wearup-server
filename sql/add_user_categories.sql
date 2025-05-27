-- Kullanıcı kategorileri için yeni sütun ekleme
ALTER TABLE users 
ADD COLUMN IF NOT EXISTS preferred_categories TEXT DEFAULT '["tshirt", "pants", "shoes", "bag", "jacket", "accessories"]';

-- Aktif kategoriler için yeni sütun ekleme (kullanıcının şu anda seçili olan kategorileri)
ALTER TABLE users 
ADD COLUMN IF NOT EXISTS active_categories TEXT DEFAULT '["tshirt"]';

-- Mevcut kullanıcılar için varsayılan kategori verilerini güncelle
UPDATE users 
SET preferred_categories = '["tshirt", "pants", "shoes", "bag", "jacket", "accessories"]'
WHERE preferred_categories IS NULL OR preferred_categories = '';

-- Mevcut kullanıcılar için varsayılan aktif kategori verilerini güncelle
UPDATE users 
SET active_categories = '["tshirt"]'
WHERE active_categories IS NULL OR active_categories = '';

-- Kategori verilerini kontrol etmek için
SELECT id, username, preferred_categories, active_categories FROM users LIMIT 5; 