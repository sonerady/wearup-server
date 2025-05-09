-- Outfit Likes tablosu
CREATE TABLE IF NOT EXISTS outfit_likes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    outfit_id UUID NOT NULL REFERENCES outfits(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    
    -- Her kullanıcı bir outfit'i yalnızca bir kez beğenebilir
    CONSTRAINT outfit_likes_unique_user_outfit UNIQUE (user_id, outfit_id)
);

-- Outfit Saves tablosu
CREATE TABLE IF NOT EXISTS outfit_saves (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    outfit_id UUID NOT NULL REFERENCES outfits(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    
    -- Her kullanıcı bir outfit'i yalnızca bir kez kaydedebilir
    CONSTRAINT outfit_saves_unique_user_outfit UNIQUE (user_id, outfit_id)
);

-- Outfit Comments tablosu
CREATE TABLE IF NOT EXISTS outfit_comments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    outfit_id UUID NOT NULL REFERENCES outfits(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    comment TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- İndeksler
CREATE INDEX IF NOT EXISTS outfit_likes_outfit_id_idx ON outfit_likes(outfit_id);
CREATE INDEX IF NOT EXISTS outfit_likes_user_id_idx ON outfit_likes(user_id);

CREATE INDEX IF NOT EXISTS outfit_saves_outfit_id_idx ON outfit_saves(outfit_id);
CREATE INDEX IF NOT EXISTS outfit_saves_user_id_idx ON outfit_saves(user_id);

CREATE INDEX IF NOT EXISTS outfit_comments_outfit_id_idx ON outfit_comments(outfit_id);
CREATE INDEX IF NOT EXISTS outfit_comments_user_id_idx ON outfit_comments(user_id);

-- RLS (Row Level Security) Politikaları
ALTER TABLE outfit_likes ENABLE ROW LEVEL SECURITY;
ALTER TABLE outfit_saves ENABLE ROW LEVEL SECURITY;
ALTER TABLE outfit_comments ENABLE ROW LEVEL SECURITY;

-- Like için politikalar
CREATE POLICY "Users can add or remove their own likes"
    ON outfit_likes
    FOR ALL
    USING (auth.uid() = user_id);

CREATE POLICY "Anyone can view all likes"
    ON outfit_likes
    FOR SELECT
    USING (true);

-- Save için politikalar
CREATE POLICY "Users can add or remove their own saves"
    ON outfit_saves
    FOR ALL
    USING (auth.uid() = user_id);

CREATE POLICY "Anyone can view all saves"
    ON outfit_saves
    FOR SELECT
    USING (true);

-- Comment için politikalar 
CREATE POLICY "Users can add their own comments"
    ON outfit_comments
    FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update/delete their own comments"
    ON outfit_comments
    FOR ALL
    USING (auth.uid() = user_id);

CREATE POLICY "Anyone can view all comments"
    ON outfit_comments
    FOR SELECT
    USING (true); 