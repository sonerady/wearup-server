-- Supabase'de reference_explores tablosunu oluşturan SQL
CREATE TABLE public.reference_explores (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id TEXT NOT NULL,
    image_url TEXT NOT NULL,
    prompt TEXT NOT NULL,
    enhanced_prompt TEXT,
    reference_images TEXT[] DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- İndeksler
CREATE INDEX idx_reference_explores_user_id ON public.reference_explores(user_id);
CREATE INDEX idx_reference_explores_created_at ON public.reference_explores(created_at);

-- RLS (Row Level Security) olmadan açık erişim
ALTER TABLE public.reference_explores ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow full access to all users" ON public.reference_explores FOR ALL USING (true) WITH CHECK (true);

-- Trigger ile updated_at değerini güncellemek için
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_reference_explores_updated_at
BEFORE UPDATE ON public.reference_explores
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- Tablo açıklaması
COMMENT ON TABLE public.reference_explores IS 'WearUp! uygulamasında oluşturulan AI görselleri';
COMMENT ON COLUMN public.reference_explores.id IS 'Benzersiz kayıt ID';
COMMENT ON COLUMN public.reference_explores.user_id IS 'Kullanıcı ID (anonymous_id veya auth.user.id)';
COMMENT ON COLUMN public.reference_explores.image_url IS 'Oluşturulan görsel URL';
COMMENT ON COLUMN public.reference_explores.prompt IS 'Kullanıcının girdiği orijinal prompt';
COMMENT ON COLUMN public.reference_explores.enhanced_prompt IS 'AI tarafından geliştirilmiş prompt';
COMMENT ON COLUMN public.reference_explores.reference_images IS 'Kullanıcının referans olarak yüklediği görsellerin URL listesi';
COMMENT ON COLUMN public.reference_explores.created_at IS 'Kaydın oluşturulma zamanı';
COMMENT ON COLUMN public.reference_explores.updated_at IS 'Kaydın son güncellenme zamanı'; 