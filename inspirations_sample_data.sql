-- Inspirations tablosuna örnek veriler
-- Bu dosyayı Supabase SQL Editor'da çalıştırın

-- Varsayılan kullanıcı ID'leri (Supabase'inize göre değiştirin)
-- NOT: Bu ID'leri veritabanınızdaki gerçek kullanıcı ID'leriyle değiştirin
DO $$
DECLARE
    user_id1 UUID := '00000000-0000-0000-0000-000000000001'; -- Örnek kullanıcı ID'si 1
    user_id2 UUID := '00000000-0000-0000-0000-000000000002'; -- Örnek kullanıcı ID'si 2
BEGIN

-- 15 örnek veri ekliyoruz
INSERT INTO public.inspirations (user_id, image_url, caption, like_count, save_count, comment_count, view_count, created_at)
VALUES
    -- Kullanıcı 1'in paylaşımları (versus içerenler)
    (user_id1, 'https://source.unsplash.com/random/800x1000?outfit=1', 'Versus stilinde moda kombinim #fashion #style', 24, 12, 5, 120, NOW() - INTERVAL '1 day'),
    (user_id1, 'https://source.unsplash.com/random/800x1000?outfit=2', 'Bu versus kombinimi nasıl buldunuz? #ootd', 56, 23, 8, 210, NOW() - INTERVAL '2 days'),
    (user_id1, 'https://source.unsplash.com/random/800x1000?outfit=3', 'Bugünkü versus tarzı kombini çok sevdim', 41, 18, 6, 145, NOW() - INTERVAL '3 days'),
    (user_id1, 'https://source.unsplash.com/random/800x1000?outfit=4', 'Yeni versus tarzım ile karşınızdayım #fashion', 32, 15, 4, 110, NOW() - INTERVAL '4 days'),
    (user_id2, 'https://source.unsplash.com/random/800x1000?outfit=5', 'Versus stilinde gece kıyafeti #nightout', 75, 38, 14, 290, NOW() - INTERVAL '2 days'),
    (user_id2, 'https://source.unsplash.com/random/800x1000?outfit=6', 'Siyah versus stili ile şık bir görünüm #blackstyle', 48, 22, 7, 180, NOW() - INTERVAL '5 days'),
    (user_id2, 'https://source.unsplash.com/random/800x1000?outfit=7', 'Versus tarzda sade şıklık', 63, 31, 9, 230, NOW() - INTERVAL '6 days'),
    
    -- Kullanıcı 2'nin paylaşımları (finish.png içerenler)
    (user_id2, 'https://source.unsplash.com/random/800x1000?outfit=8', 'finish.png ile tamamlanmış kombinin #fashion', 85, 42, 15, 320, NOW() - INTERVAL '7 days'),
    (user_id2, 'https://source.unsplash.com/random/800x1000?outfit=9', 'Bu finish.png stilini nasıl buldunuz? #ootd #stylish', 67, 33, 11, 250, NOW() - INTERVAL '8 days'),
    (user_id1, 'https://source.unsplash.com/random/800x1000?outfit=10', 'finish.png ile bugünkü tarzım #dailylook', 52, 26, 8, 195, NOW() - INTERVAL '9 days'),
    (user_id1, 'https://source.unsplash.com/random/800x1000?outfit=11', 'Günlük finish.png stilim #casualstyle', 43, 21, 6, 165, NOW() - INTERVAL '10 days'),
    (user_id1, 'https://source.unsplash.com/random/800x1000?outfit=12', 'finish.png ile resmi stil #formalwear', 72, 36, 13, 270, NOW() - INTERVAL '11 days'),
    (user_id2, 'https://source.unsplash.com/random/800x1000?outfit=13', 'En sevdiğim finish.png kombinim #favorite', 59, 29, 10, 220, NOW() - INTERVAL '12 days'),
    (user_id1, 'https://source.unsplash.com/random/800x1000?outfit=14', 'Hafta sonu için finish.png tarzı #weekend', 37, 18, 5, 135, NOW() - INTERVAL '13 days'),
    (user_id2, 'https://source.unsplash.com/random/800x1000?outfit=15', 'finish.png tarzında minimal şıklık #minimal', 81, 40, 16, 300, NOW() - INTERVAL '14 days');

END $$; 