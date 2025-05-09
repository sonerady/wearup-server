-- Virtual Try On tablosu
CREATE TABLE public.virtual_tryons (
    id SERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    result_photo TEXT, -- İşlem sonucu oluşan fotoğraf URL'i (opsiyonel)
    status VARCHAR(20) NOT NULL DEFAULT 'pending', -- 'pending', 'processing', 'completed', 'failed'
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    process_time FLOAT, -- İşlem süresi (saniye)
    notes TEXT, -- Ekstra notlar, hatalar vs.
    is_deleted BOOLEAN DEFAULT FALSE
);

-- Model Fotoğrafları için ayrı tablo
CREATE TABLE public.virtual_tryon_model_photos (
    id SERIAL PRIMARY KEY,
    tryon_id INTEGER NOT NULL REFERENCES public.virtual_tryons(id) ON DELETE CASCADE,
    photo_url TEXT NOT NULL,
    is_selected BOOLEAN DEFAULT FALSE, -- Seçili olan model fotoğrafı
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Ürün Fotoğrafları için ayrı tablo
CREATE TABLE public.virtual_tryon_product_photos (
    id SERIAL PRIMARY KEY,
    tryon_id INTEGER NOT NULL REFERENCES public.virtual_tryons(id) ON DELETE CASCADE,
    photo_url TEXT NOT NULL,
    is_selected BOOLEAN DEFAULT FALSE, -- Seçili olan ürün fotoğrafı
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Virtual Try On işlemleri için indeksler
CREATE INDEX idx_virtual_tryons_user_id ON public.virtual_tryons(user_id);
CREATE INDEX idx_virtual_tryons_status ON public.virtual_tryons(status);
CREATE INDEX idx_virtual_tryons_created_at ON public.virtual_tryons(created_at);

-- Model fotoğrafları için indeksler
CREATE INDEX idx_virtual_tryon_model_photos_tryon_id ON public.virtual_tryon_model_photos(tryon_id);
CREATE INDEX idx_virtual_tryon_model_photos_is_selected ON public.virtual_tryon_model_photos(is_selected);

-- Ürün fotoğrafları için indeksler
CREATE INDEX idx_virtual_tryon_product_photos_tryon_id ON public.virtual_tryon_product_photos(tryon_id);
CREATE INDEX idx_virtual_tryon_product_photos_is_selected ON public.virtual_tryon_product_photos(is_selected);

-- Silinen kayıtları otomatik olarak işaretlemek için trigger fonksiyonu
CREATE OR REPLACE FUNCTION update_virtual_tryon_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger oluşturma - Ana tablo
CREATE TRIGGER update_virtual_tryon_updated_at
BEFORE UPDATE ON public.virtual_tryons
FOR EACH ROW
EXECUTE FUNCTION update_virtual_tryon_updated_at_column();

-- Trigger oluşturma - Model fotoğrafları
CREATE TRIGGER update_virtual_tryon_model_photos_updated_at
BEFORE UPDATE ON public.virtual_tryon_model_photos
FOR EACH ROW
EXECUTE FUNCTION update_virtual_tryon_updated_at_column();

-- Trigger oluşturma - Ürün fotoğrafları
CREATE TRIGGER update_virtual_tryon_product_photos_updated_at
BEFORE UPDATE ON public.virtual_tryon_product_photos
FOR EACH ROW
EXECUTE FUNCTION update_virtual_tryon_updated_at_column();

-- RLS politikalarını devre dışı bırakma
ALTER TABLE public.virtual_tryons DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.virtual_tryon_model_photos DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.virtual_tryon_product_photos DISABLE ROW LEVEL SECURITY;

-- Tabloları herkes tarafından erişilebilir yap
GRANT ALL ON public.virtual_tryons TO anon, authenticated, service_role;
GRANT ALL ON public.virtual_tryon_model_photos TO anon, authenticated, service_role;
GRANT ALL ON public.virtual_tryon_product_photos TO anon, authenticated, service_role;
GRANT USAGE, SELECT ON SEQUENCE public.virtual_tryons_id_seq TO anon, authenticated, service_role;
GRANT USAGE, SELECT ON SEQUENCE public.virtual_tryon_model_photos_id_seq TO anon, authenticated, service_role;
GRANT USAGE, SELECT ON SEQUENCE public.virtual_tryon_product_photos_id_seq TO anon, authenticated, service_role; 