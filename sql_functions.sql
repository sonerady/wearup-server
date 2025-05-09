-- SQL Yardımcı Fonksiyonları
-- Bu dosyayı Supabase SQL Editor'da çalıştırın

-- Item favorileri kontrol etmek için fonksiyon
CREATE OR REPLACE FUNCTION check_item_favorite(p_user_id UUID, p_item_id UUID)
RETURNS SETOF item_favorites AS $$
BEGIN
    RETURN QUERY
    SELECT * FROM item_favorites
    WHERE user_id = p_user_id AND item_id = p_item_id;
EXCEPTION
    WHEN undefined_table THEN
        -- Tablo yoksa boş küme dön
        RETURN;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Item favori eklemek için fonksiyon
CREATE OR REPLACE FUNCTION add_item_favorite(p_user_id UUID, p_item_id UUID)
RETURNS SETOF item_favorites AS $$
DECLARE
    new_id UUID;
    fav_record item_favorites%ROWTYPE;
BEGIN
    -- Önce kontrol et
    SELECT * INTO fav_record FROM item_favorites
    WHERE user_id = p_user_id AND item_id = p_item_id;
    
    -- Eğer yoksa ekle
    IF NOT FOUND THEN
        new_id := uuid_generate_v4();
        
        INSERT INTO item_favorites (id, user_id, item_id, created_at)
        VALUES (new_id, p_user_id, p_item_id, now())
        RETURNING * INTO fav_record;
    END IF;
    
    RETURN NEXT fav_record;
EXCEPTION
    WHEN undefined_table THEN
        -- Tablo yoksa boş dön
        RETURN;
    WHEN foreign_key_violation THEN
        -- Foreign key hatası olduğunda, kullanıcı ID'yi koru ama item ID'yi geçersiz kıl
        new_id := uuid_generate_v4();
        
        RAISE NOTICE 'Foreign key hatası, geçici kayıt oluşturuluyor: user_id=%, item_id=%', p_user_id, p_item_id;
        
        -- Geçici kayıt dönüş
        fav_record.id := new_id;
        fav_record.user_id := p_user_id;
        fav_record.item_id := p_item_id;
        fav_record.created_at := now();
        
        RETURN NEXT fav_record;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- SQL sorgusu çalıştırmak için yardımcı fonksiyon
CREATE OR REPLACE FUNCTION execute_sql(sql_query TEXT)
RETURNS JSON AS $$
DECLARE
    result JSON;
BEGIN
    EXECUTE sql_query INTO result;
    RETURN result;
EXCEPTION
    WHEN OTHERS THEN
        RETURN json_build_object('error', SQLERRM, 'detail', SQLSTATE);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER; 