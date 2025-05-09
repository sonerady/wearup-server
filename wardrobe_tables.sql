-- Önce fonksiyonu sil
DROP FUNCTION IF EXISTS insert_wardrobe_item;

-- Sonra tabloları sil
DROP TABLE IF EXISTS wardrobe_outfit_items CASCADE;
DROP TABLE IF EXISTS wardrobe_outfits CASCADE;
DROP TABLE IF EXISTS wardrobe_items CASCADE;

-- Wardrobe Items tablosu
CREATE TABLE wardrobe_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL,
  item_name TEXT NOT NULL,
  category TEXT NOT NULL,
  seasons JSONB DEFAULT '[]'::jsonb,
  color TEXT,
  notes TEXT,
  link_address TEXT,
  item_size TEXT,
  purchase_price NUMERIC,
  purchase_date DATE,
  tags JSONB DEFAULT '[]'::jsonb,
  visibility TEXT DEFAULT 'private',
  image_url TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  last_worn TIMESTAMP WITH TIME ZONE
);

-- Outfits tablosu - item_ids kaldırıldı, artık ilişkisel tablodan alınacak
CREATE TABLE wardrobe_outfits (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL,
  name TEXT NOT NULL,
  visibility TEXT DEFAULT 'private',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Outfit Items ara tablosu
CREATE TABLE wardrobe_outfit_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  outfit_id UUID NOT NULL,
  item_id UUID NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  CONSTRAINT unique_outfit_item UNIQUE (outfit_id, item_id)
);

-- RLS'i tamamen devre dışı bırak
ALTER TABLE wardrobe_items DISABLE ROW LEVEL SECURITY;
ALTER TABLE wardrobe_outfits DISABLE ROW LEVEL SECURITY;
ALTER TABLE wardrobe_outfit_items DISABLE ROW LEVEL SECURITY;

-- Tüm RLS politikalarını kaldır
DROP POLICY IF EXISTS "Kullanıcılar kendi öğelerini görebilir" ON wardrobe_items;
DROP POLICY IF EXISTS "Kullanıcılar kendi öğelerini ekleyebilir" ON wardrobe_items;
DROP POLICY IF EXISTS "Kullanıcılar kendi öğelerini güncelleyebilir" ON wardrobe_items;
DROP POLICY IF EXISTS "Kullanıcılar kendi öğelerini silebilir" ON wardrobe_items;
DROP POLICY IF EXISTS "Herkese açık öğeler görülebilir" ON wardrobe_items;

DROP POLICY IF EXISTS "Kullanıcılar kendi outfitlerini görebilir" ON wardrobe_outfits;
DROP POLICY IF EXISTS "Kullanıcılar kendi outfitlerini ekleyebilir" ON wardrobe_outfits;
DROP POLICY IF EXISTS "Kullanıcılar kendi outfitlerini güncelleyebilir" ON wardrobe_outfits;
DROP POLICY IF EXISTS "Kullanıcılar kendi outfitlerini silebilir" ON wardrobe_outfits;
DROP POLICY IF EXISTS "Herkese açık outfitler görülebilir" ON wardrobe_outfits;

-- PostgreSQL indeksleri ekle (bunlar performans için hala faydalı)
CREATE INDEX idx_wardrobe_items_user_id ON wardrobe_items(user_id);
CREATE INDEX idx_wardrobe_items_category ON wardrobe_items(category);
CREATE INDEX idx_wardrobe_outfits_user_id ON wardrobe_outfits(user_id);
CREATE INDEX idx_outfit_items_outfit ON wardrobe_outfit_items(outfit_id);
CREATE INDEX idx_outfit_items_item ON wardrobe_outfit_items(item_id);

-- RLS politikasını bypass eden bir stored procedure oluşturalım (tabloları oluşturduktan sonra)
CREATE OR REPLACE FUNCTION insert_wardrobe_item(
  p_user_id UUID,
  p_item_name TEXT,
  p_category TEXT,
  p_seasons JSONB DEFAULT '[]'::jsonb,
  p_color TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL,
  p_link_address TEXT DEFAULT NULL,
  p_item_size TEXT DEFAULT NULL,
  p_purchase_price NUMERIC DEFAULT NULL,
  p_purchase_date DATE DEFAULT NULL,
  p_tags JSONB DEFAULT '[]'::jsonb,
  p_visibility TEXT DEFAULT 'private',
  p_image_url TEXT DEFAULT NULL
) RETURNS SETOF wardrobe_items
LANGUAGE plpgsql
SECURITY DEFINER -- Bu, fonksiyonu oluşturan kullanıcının ayrıcalıklarıyla çalıştırır
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  INSERT INTO wardrobe_items(
    user_id,
    item_name,
    category,
    seasons,
    color,
    notes,
    link_address,
    item_size,
    purchase_price,
    purchase_date,
    tags,
    visibility,
    image_url,
    created_at,
    updated_at,
    last_worn
  )
  VALUES(
    p_user_id,
    p_item_name,
    p_category,
    p_seasons,
    p_color,
    p_notes,
    p_link_address,
    p_item_size,
    p_purchase_price,
    p_purchase_date,
    p_tags,
    p_visibility,
    p_image_url,
    NOW(),
    NOW(),
    NULL
  )
  RETURNING *;
END;
$$; 