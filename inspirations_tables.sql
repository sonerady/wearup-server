-- Inspiration özelliği için gerekli tablolar ve fonksiyonlar
-- Bu dosyayı Supabase SQL Editor'da çalıştırın

-- Kullanıcıların paylaşacağı inspiration gönderileri tablosu
CREATE TABLE IF NOT EXISTS public.inspirations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    image_url TEXT NOT NULL,
    caption TEXT DEFAULT '',
    like_count INTEGER DEFAULT 0,
    save_count INTEGER DEFAULT 0,
    comment_count INTEGER DEFAULT 0,
    view_count INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Beğeniler tablosu
CREATE TABLE IF NOT EXISTS public.likes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    inspiration_id UUID NOT NULL REFERENCES public.inspirations(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE (user_id, inspiration_id)
);

-- Kaydedilenler tablosu
CREATE TABLE IF NOT EXISTS public.saves (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    inspiration_id UUID NOT NULL REFERENCES public.inspirations(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE (user_id, inspiration_id)
);

-- Yorumlar tablosu
CREATE TABLE IF NOT EXISTS public.comments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    inspiration_id UUID NOT NULL REFERENCES public.inspirations(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Görüntüleme sayacını artırmak için fonksiyon
CREATE OR REPLACE FUNCTION increment_view_count(post_id UUID)
RETURNS VOID AS $$
BEGIN
    UPDATE public.inspirations
    SET view_count = view_count + 1
    WHERE id = post_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Beğeni eklendiğinde/kaldırıldığında beğeni sayacını güncelleyen trigger
CREATE OR REPLACE FUNCTION update_like_count()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        UPDATE public.inspirations
        SET like_count = like_count + 1
        WHERE id = NEW.inspiration_id;
    ELSIF TG_OP = 'DELETE' THEN
        UPDATE public.inspirations
        SET like_count = like_count - 1
        WHERE id = OLD.inspiration_id;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trigger_update_like_count
AFTER INSERT OR DELETE ON public.likes
FOR EACH ROW
EXECUTE FUNCTION update_like_count();

-- Kaydetme eklendiğinde/kaldırıldığında kaydetme sayacını güncelleyen trigger
CREATE OR REPLACE FUNCTION update_save_count()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        UPDATE public.inspirations
        SET save_count = save_count + 1
        WHERE id = NEW.inspiration_id;
    ELSIF TG_OP = 'DELETE' THEN
        UPDATE public.inspirations
        SET save_count = save_count - 1
        WHERE id = OLD.inspiration_id;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trigger_update_save_count
AFTER INSERT OR DELETE ON public.saves
FOR EACH ROW
EXECUTE FUNCTION update_save_count();

-- Yorum eklendiğinde/silindiğinde yorum sayacını güncelleyen trigger
CREATE OR REPLACE FUNCTION update_comment_count()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        UPDATE public.inspirations
        SET comment_count = comment_count + 1
        WHERE id = NEW.inspiration_id;
    ELSIF TG_OP = 'DELETE' THEN
        UPDATE public.inspirations
        SET comment_count = comment_count - 1
        WHERE id = OLD.inspiration_id;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trigger_update_comment_count
AFTER INSERT OR DELETE ON public.comments
FOR EACH ROW
EXECUTE FUNCTION update_comment_count();

-- Performans için indeksler
CREATE INDEX IF NOT EXISTS idx_inspirations_user_id ON public.inspirations(user_id);
CREATE INDEX IF NOT EXISTS idx_likes_user_id ON public.likes(user_id);
CREATE INDEX IF NOT EXISTS idx_likes_inspiration_id ON public.likes(inspiration_id);
CREATE INDEX IF NOT EXISTS idx_saves_user_id ON public.saves(user_id);
CREATE INDEX IF NOT EXISTS idx_saves_inspiration_id ON public.saves(inspiration_id);
CREATE INDEX IF NOT EXISTS idx_comments_user_id ON public.comments(user_id);
CREATE INDEX IF NOT EXISTS idx_comments_inspiration_id ON public.comments(inspiration_id);

-- Tüm tablolar için RLS (Row Level Security) politikaları
-- Inspirations tablosu - Herkes okuyabilir, sadece sahip yazabilir/silebilir
ALTER TABLE public.inspirations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Herkes inspirations okuyabilir"
    ON public.inspirations FOR SELECT
    USING (true);

CREATE POLICY "Kullanıcılar kendi inspiration gönderilerini ekleyebilir"
    ON public.inspirations FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Kullanıcılar kendi inspiration gönderilerini güncelleyebilir"
    ON public.inspirations FOR UPDATE
    USING (auth.uid() = user_id);

CREATE POLICY "Kullanıcılar kendi inspiration gönderilerini silebilir"
    ON public.inspirations FOR DELETE
    USING (auth.uid() = user_id);

-- Likes tablosu
ALTER TABLE public.likes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Herkes likes okuyabilir"
    ON public.likes FOR SELECT
    USING (true);

CREATE POLICY "Kullanıcılar beğeni ekleyip kaldırabilir"
    ON public.likes FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Kullanıcılar kendi beğenilerini silebilir"
    ON public.likes FOR DELETE
    USING (auth.uid() = user_id);

-- Saves tablosu
ALTER TABLE public.saves ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Herkes saves okuyabilir"
    ON public.saves FOR SELECT
    USING (true);

CREATE POLICY "Kullanıcılar gönderi kaydedebilir"
    ON public.saves FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Kullanıcılar kendi kaydettiklerini silebilir"
    ON public.saves FOR DELETE
    USING (auth.uid() = user_id);

-- Comments tablosu
ALTER TABLE public.comments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Herkes comments okuyabilir"
    ON public.comments FOR SELECT
    USING (true);

CREATE POLICY "Kullanıcılar yorum ekleyebilir"
    ON public.comments FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Kullanıcılar kendi yorumlarını güncelleyebilir"
    ON public.comments FOR UPDATE
    USING (auth.uid() = user_id);

CREATE POLICY "Kullanıcılar kendi yorumlarını silebilir"
    ON public.comments FOR DELETE
    USING (auth.uid() = user_id); 