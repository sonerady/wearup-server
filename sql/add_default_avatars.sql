-- Gender'a göre default avatar URL'leri atayan sistem
-- Bu script hem mevcut kullanıcıları güncelleyecek hem de yeni kullanıcılar için trigger kuracak

-- 1. Mevcut kullanıcılar için NULL avatar_url'leri gender'a göre güncelle
UPDATE users 
SET avatar_url = CASE 
    WHEN user_gender = 'female' THEN 'https://halurilrsdzgnieeajxm.supabase.co/storage/v1/object/public/for-links//female.jpg'
    WHEN user_gender = 'male' THEN 'https://halurilrsdzgnieeajxm.supabase.co/storage/v1/object/public/for-links//male.jpg'
    WHEN user_gender = 'prefer_not_to_say' THEN 'https://halurilrsdzgnieeajxm.supabase.co/storage/v1/object/public/for-links//female.jpg' -- Varsayılan olarak female
    ELSE 'https://halurilrsdzgnieeajxm.supabase.co/storage/v1/object/public/for-links//female.jpg' -- Gender belirtilmemişse varsayılan
END
WHERE avatar_url IS NULL OR avatar_url = '';

-- 2. Gender alanı NULL olan kullanıcılar için varsayılan değer atama
UPDATE users 
SET user_gender = 'female',
    avatar_url = 'https://halurilrsdzgnieeajxm.supabase.co/storage/v1/object/public/for-links//female.jpg'
WHERE user_gender IS NULL AND (avatar_url IS NULL OR avatar_url = '');

-- 3. Yeni kullanıcı oluşturulduğunda otomatik avatar atama trigger fonksiyonu
CREATE OR REPLACE FUNCTION set_default_avatar_on_insert()
RETURNS TRIGGER AS $$
BEGIN
    -- Eğer avatar_url boş veya null ise gender'a göre default avatar ata
    IF NEW.avatar_url IS NULL OR NEW.avatar_url = '' THEN
        CASE 
            WHEN NEW.user_gender = 'male' THEN
                NEW.avatar_url := 'https://halurilrsdzgnieeajxm.supabase.co/storage/v1/object/public/for-links//male.jpg';
            WHEN NEW.user_gender = 'female' THEN
                NEW.avatar_url := 'https://halurilrsdzgnieeajxm.supabase.co/storage/v1/object/public/for-links//female.jpg';
            WHEN NEW.user_gender = 'prefer_not_to_say' THEN
                NEW.avatar_url := 'https://halurilrsdzgnieeajxm.supabase.co/storage/v1/object/public/for-links//female.jpg';
            ELSE
                -- Gender belirtilmemişse varsayılan olarak female avatar'ı ata
                NEW.user_gender := 'female';
                NEW.avatar_url := 'https://halurilrsdzgnieeajxm.supabase.co/storage/v1/object/public/for-links//female.jpg';
        END CASE;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 4. Trigger oluştur (eğer mevcut değilse)
DROP TRIGGER IF EXISTS trigger_set_default_avatar_on_insert ON users;
CREATE TRIGGER trigger_set_default_avatar_on_insert
    BEFORE INSERT ON users
    FOR EACH ROW
    EXECUTE FUNCTION set_default_avatar_on_insert();

-- 5. Gender güncellendiğinde avatar'ı da güncelleme trigger fonksiyonu
CREATE OR REPLACE FUNCTION update_avatar_on_gender_change()
RETURNS TRIGGER AS $$
BEGIN
    -- Eğer gender değişti ve mevcut avatar default avatarlardan biriyse güncelle
    IF OLD.user_gender IS DISTINCT FROM NEW.user_gender THEN
        -- Sadece default avatar'ları güncelle, özel avatar'ları dokunma
        IF OLD.avatar_url IN (
            'https://halurilrsdzgnieeajxm.supabase.co/storage/v1/object/public/for-links//female.jpg',
            'https://halurilrsdzgnieeajxm.supabase.co/storage/v1/object/public/for-links//male.jpg'
        ) OR NEW.avatar_url IS NULL OR NEW.avatar_url = '' THEN
            CASE 
                WHEN NEW.user_gender = 'male' THEN
                    NEW.avatar_url := 'https://halurilrsdzgnieeajxm.supabase.co/storage/v1/object/public/for-links//male.jpg';
                WHEN NEW.user_gender = 'female' THEN
                    NEW.avatar_url := 'https://halurilrsdzgnieeajxm.supabase.co/storage/v1/object/public/for-links//female.jpg';
                WHEN NEW.user_gender = 'prefer_not_to_say' THEN
                    NEW.avatar_url := 'https://halurilrsdzgnieeajxm.supabase.co/storage/v1/object/public/for-links//female.jpg';
            END CASE;
        END IF;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 6. Gender güncelleme trigger'ı oluştur
DROP TRIGGER IF EXISTS trigger_update_avatar_on_gender_change ON users;
CREATE TRIGGER trigger_update_avatar_on_gender_change
    BEFORE UPDATE ON users
    FOR EACH ROW
    EXECUTE FUNCTION update_avatar_on_gender_change();

-- 7. Kontrol sorgusu - Kaç kullanıcının avatar'ı güncellendi görmek için
SELECT 
    user_gender,
    COUNT(*) as kullanici_sayisi,
    COUNT(CASE WHEN avatar_url IS NOT NULL AND avatar_url != '' THEN 1 END) as avatar_olan_sayisi
FROM users 
GROUP BY user_gender
ORDER BY user_gender;

-- Script tamamlandı mesajı
SELECT 'Default avatar atama sistemi başarıyla kuruldu!' as durum; 