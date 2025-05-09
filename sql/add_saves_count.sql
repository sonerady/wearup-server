-- Outfits tablosuna saves_count sütunu ekle
ALTER TABLE public.outfits
ADD COLUMN saves_count INTEGER DEFAULT 0;

-- Mevcut tüm outfits için saves_count değerlerini güncelle
-- Her outfit için outfit_saves tablosundaki kayıt sayısını hesapla
UPDATE public.outfits AS o
SET saves_count = COALESCE(
    (SELECT COUNT(*) 
     FROM public.outfit_saves 
     WHERE outfit_id = o.id),
    0
);

-- saves_count sütunu için index oluştur
CREATE INDEX IF NOT EXISTS outfits_saves_count_idx ON public.outfits(saves_count);

-- Trigger fonksiyonu oluştur
CREATE OR REPLACE FUNCTION update_outfit_saves_count()
RETURNS TRIGGER AS $$
BEGIN
    -- Eğer yeni kayıt eklendiyse (INSERT)
    IF TG_OP = 'INSERT' THEN
        -- Outfit'in saves_count değerini bir artır
        UPDATE public.outfits
        SET saves_count = saves_count + 1
        WHERE id = NEW.outfit_id;
    
    -- Eğer kayıt silindiyse (DELETE)
    ELSIF TG_OP = 'DELETE' THEN
        -- Outfit'in saves_count değerini bir azalt
        UPDATE public.outfits
        SET saves_count = GREATEST(0, saves_count - 1) -- Negatif olmaması için
        WHERE id = OLD.outfit_id;
    END IF;
    
    RETURN NULL; -- After trigger için dönüş değeri önemli değil
END;
$$ LANGUAGE plpgsql;

-- Trigger oluştur - outfit_saves tablosuna eklemeler için
CREATE TRIGGER trig_outfit_saves_insert_after
AFTER INSERT ON public.outfit_saves
FOR EACH ROW
EXECUTE FUNCTION update_outfit_saves_count();

-- Trigger oluştur - outfit_saves tablosundan silmeler için
CREATE TRIGGER trig_outfit_saves_delete_after
AFTER DELETE ON public.outfit_saves
FOR EACH ROW
EXECUTE FUNCTION update_outfit_saves_count();

-- Yorum: Bu SQL outfits tablosuna saves_count sütunu ekler, 
-- mevcut saves'leri sayarak her kaydı günceller ve sorgu performansı 
-- için bir index oluşturur.
-- Ayrıca, outfit_saves tablosundaki değişikliklerde otomatik olarak 
-- outfits.saves_count alanını güncelleyen trigger'lar eklenmiştir. 