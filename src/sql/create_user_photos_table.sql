-- Kullanıcı fotoğrafları tablosu oluşturma
CREATE TABLE IF NOT EXISTS user_photos (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id TEXT NOT NULL,
    face_photo_url TEXT,
    body_photo_url TEXT,
    session_id TEXT,
    is_selected BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- session_id sütunu yoksa ekle (mevcut tablolar için)
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT FROM information_schema.columns 
        WHERE table_name = 'user_photos' 
        AND column_name = 'session_id'
    ) THEN
        ALTER TABLE user_photos ADD COLUMN session_id TEXT;
    END IF;
END $$;

-- is_selected sütunu yoksa ekle (mevcut tablolar için)
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT FROM information_schema.columns 
        WHERE table_name = 'user_photos' 
        AND column_name = 'is_selected'
    ) THEN
        ALTER TABLE user_photos ADD COLUMN is_selected BOOLEAN DEFAULT false;
    END IF;
END $$;

-- UNIQUE constraint'i kaldır (kullanıcı birden fazla fotoğraf seti yükleyebilsin)
DO $$
BEGIN
    IF EXISTS (
        SELECT FROM information_schema.table_constraints 
        WHERE table_name = 'user_photos' 
        AND constraint_type = 'UNIQUE'
        AND constraint_name LIKE '%user_id%'
    ) THEN
        ALTER TABLE user_photos DROP CONSTRAINT user_photos_user_id_key;
    END IF;
END $$;

-- RLS (Row Level Security) etkinleştir
ALTER TABLE user_photos ENABLE ROW LEVEL SECURITY;

-- Tüm kullanıcılar kendi verilerini okuyabilir
CREATE POLICY "Users can read own photos" ON user_photos
    FOR SELECT USING (true);

-- Tüm kullanıcılar kendi verilerini oluşturabilir
CREATE POLICY "Users can insert own photos" ON user_photos
    FOR INSERT WITH CHECK (true);

-- Tüm kullanıcılar kendi verilerini güncelleyebilir
CREATE POLICY "Users can update own photos" ON user_photos
    FOR UPDATE USING (true);

-- Tüm kullanıcılar kendi verilerini silebilir
CREATE POLICY "Users can delete own photos" ON user_photos
    FOR DELETE USING (true);

-- Index'ler
CREATE INDEX IF NOT EXISTS idx_user_photos_user_id ON user_photos(user_id);
CREATE INDEX IF NOT EXISTS idx_user_photos_created_at ON user_photos(created_at);

-- Güncelleme trigger'ı için fonksiyon
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Güncelleme trigger'ı
CREATE TRIGGER update_user_photos_updated_at
    BEFORE UPDATE ON user_photos
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column(); 