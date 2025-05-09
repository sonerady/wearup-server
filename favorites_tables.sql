-- Favoriler için tablolar
DROP TABLE IF EXISTS item_favorites CASCADE;
DROP TABLE IF EXISTS combine_favorites CASCADE;
DROP TABLE IF EXISTS inspiration_favorites CASCADE;

-- Kullanıcı favorileri (foreign key kısıtlaması kaldırıldı)
CREATE TABLE item_favorites (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL,
  item_id UUID NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
  -- Foreign key kısıtlamaları geliştirme sürecinde kaldırıldı
);

-- Combine/outfit favorileri (foreign key kısıtlaması kaldırıldı)
CREATE TABLE combine_favorites (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL,
  outfit_id UUID NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
  -- Foreign key kısıtlamaları geliştirme sürecinde kaldırıldı
);

-- İlham/inspiration favorileri (foreign key kısıtlaması kaldırıldı)
CREATE TABLE inspiration_favorites (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL,
  inspiration_type TEXT NOT NULL, -- 'outfit', 'item', 'external', etc.
  inspiration_id UUID, -- NULL olabilir (örn: dış kaynak için)
  inspiration_data JSONB, -- Tam veri (resim URL'si, açıklama, vb. dahil)
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
  -- Foreign key kısıtlamaları geliştirme sürecinde kaldırıldı
);

-- Performans için indeksler
CREATE INDEX idx_item_favorites_user_id ON item_favorites(user_id);
CREATE INDEX idx_combine_favorites_user_id ON combine_favorites(user_id);
CREATE INDEX idx_inspiration_favorites_user_id ON inspiration_favorites(user_id);

-- Kullanıcı favorilerini saklayan view (birleşik görünüm) - TİP UYUMSUZLUĞU DÜZELTİLDİ
CREATE OR REPLACE VIEW user_all_favorites AS
  SELECT id, user_id, 'item'::TEXT AS favorite_type, item_id::TEXT AS favorite_id, '{}'::JSONB AS favorite_data, created_at
  FROM item_favorites
  UNION ALL
  SELECT id, user_id, 'combine'::TEXT AS favorite_type, outfit_id::TEXT AS favorite_id, '{}'::JSONB AS favorite_data, created_at
  FROM combine_favorites
  UNION ALL
  SELECT id, user_id, inspiration_type AS favorite_type, COALESCE(inspiration_id::TEXT, '') AS favorite_id, COALESCE(inspiration_data, '{}'::JSONB) AS favorite_data, created_at
  FROM inspiration_favorites;

-- RLS güvenliği kapalı kalacak (development için)
ALTER TABLE item_favorites DISABLE ROW LEVEL SECURITY;
ALTER TABLE combine_favorites DISABLE ROW LEVEL SECURITY;
ALTER TABLE inspiration_favorites DISABLE ROW LEVEL SECURITY; 