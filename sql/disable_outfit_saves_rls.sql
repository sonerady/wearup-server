-- Tüm RLS politikalarını kaldır
DROP POLICY IF EXISTS outfit_saves_insert_policy ON public.outfit_saves;
DROP POLICY IF EXISTS outfit_saves_select_policy ON public.outfit_saves;
DROP POLICY IF EXISTS outfit_saves_update_policy ON public.outfit_saves;
DROP POLICY IF EXISTS outfit_saves_delete_policy ON public.outfit_saves;

-- Eğer bilinmeyen isimde ek politikalar varsa, bunları sorgulamak için:
-- SELECT * FROM pg_policies WHERE tablename = 'outfit_saves';

-- RLS'i tamamen devre dışı bırak
ALTER TABLE public.outfit_saves DISABLE ROW LEVEL SECURITY;

-- RLS devre dışı bırakıldı ve tüm politikalar kaldırıldı
COMMENT ON TABLE public.outfit_saves IS 'Outfit kaydetme işlemleri - RLS devre dışı bırakıldı'; 