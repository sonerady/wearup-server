-- Turnuvaya katılmak için bekleyen kullanıcılar tablosu
CREATE TABLE IF NOT EXISTS tournament_queue (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL,
  outfit_image_url TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'waiting', -- waiting, matched, active, completed
  joined_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id),  -- Bir kullanıcı aynı anda sadece bir sırada bekleyebilir
  item_id UUID,
  item_type TEXT DEFAULT 'outfit'
);

-- Turnuva eşleşmeleri tablosu
CREATE TABLE IF NOT EXISTS tournament_matches (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user1_id UUID REFERENCES tournament_queue(id),
  user2_id UUID REFERENCES tournament_queue(id),
  status TEXT NOT NULL DEFAULT 'pending', -- pending, active, completed
  user1_votes INTEGER DEFAULT 0,
  user2_votes INTEGER DEFAULT 0,
  total_votes INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  started_at TIMESTAMP WITH TIME ZONE,
  ended_at TIMESTAMP WITH TIME ZONE,
  winner_id UUID
);

-- Otomatik eşleştirme trigger fonksiyonu
CREATE OR REPLACE FUNCTION match_tournament_players()
RETURNS TRIGGER AS $$
BEGIN
  -- Mevcut eşleşmemiş iki kullanıcıyı bul
  WITH waiting_users AS (
    SELECT id
    FROM tournament_queue
    WHERE status = 'waiting'
    ORDER BY joined_at ASC
    LIMIT 2
    FOR UPDATE SKIP LOCKED
  )
  UPDATE tournament_queue
  SET status = 'matched',
      updated_at = NOW()
  WHERE id IN (SELECT id FROM waiting_users)
  RETURNING id, user_id;
  
  -- Yeterli sayıda bekleyen kullanıcı varsa eşleştir
  IF (SELECT COUNT(*) FROM tournament_queue WHERE status = 'matched' AND updated_at > NOW() - INTERVAL '10 seconds') >= 2 THEN
    -- Eşleştirilen kullanıcıları al
    WITH matched_users AS (
      SELECT id, user_id
      FROM tournament_queue
      WHERE status = 'matched'
      ORDER BY updated_at DESC
      LIMIT 2
      FOR UPDATE
    ),
    user_array AS (
      SELECT array_agg(id) AS user_ids
      FROM matched_users
    )
    -- Yeni turnuva eşleşmesi oluştur
    INSERT INTO tournament_matches (user1_id, user2_id, status)
    SELECT user_ids[1], user_ids[2], 'pending'
    FROM user_array
    WHERE array_length(user_ids, 1) = 2;
    
    -- Eşleştirilen kullanıcıları güncelle
    UPDATE tournament_queue
    SET status = 'matched',
        updated_at = NOW()
    WHERE id IN (SELECT id FROM matched_users);
  END IF;
  
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Yeni bir kullanıcı kuyruğa eklendiğinde otomatik eşleştirme için trigger
CREATE TRIGGER match_players_trigger
AFTER INSERT ON tournament_queue
FOR EACH ROW
EXECUTE FUNCTION match_tournament_players();

-- tournament_queue tablosunu güncelle
DO $$
BEGIN
    -- item_id sütunu kontrolü ve ekleme
    IF NOT EXISTS (
        SELECT FROM information_schema.columns 
        WHERE table_name = 'tournament_queue' 
        AND column_name = 'item_id'
    ) THEN
        ALTER TABLE tournament_queue ADD COLUMN item_id UUID;
    END IF;

    -- item_type sütunu kontrolü ve ekleme
    IF NOT EXISTS (
        SELECT FROM information_schema.columns 
        WHERE table_name = 'tournament_queue' 
        AND column_name = 'item_type'
    ) THEN
        ALTER TABLE tournament_queue ADD COLUMN item_type TEXT DEFAULT 'outfit';
    END IF;

    -- İlham paylaşımları tablosunu da güncelle
    IF EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_name = 'inspirations'
    ) THEN
        -- user_id sütunu zaten var mı kontrol et
        IF EXISTS (
            SELECT FROM information_schema.columns 
            WHERE table_name = 'inspirations' 
            AND column_name = 'user_id'
        ) THEN
            -- user_id için foreign key var mı kontrol et
            IF NOT EXISTS (
                SELECT FROM information_schema.table_constraints tc
                JOIN information_schema.key_column_usage kcu
                ON tc.constraint_name = kcu.constraint_name
                WHERE tc.constraint_type = 'FOREIGN KEY'
                AND kcu.table_name = 'inspirations'
                AND kcu.column_name = 'user_id'
            ) THEN
                -- foreign key eklemeden önce index oluştur (daha hızlı sorgular için)
                IF NOT EXISTS (
                    SELECT FROM pg_indexes
                    WHERE tablename = 'inspirations'
                    AND indexname = 'idx_inspirations_user_id'
                ) THEN
                    CREATE INDEX idx_inspirations_user_id ON inspirations(user_id);
                END IF;
                
                -- users tablosu varsa, foreign key ekle
                IF EXISTS (
                    SELECT FROM information_schema.tables
                    WHERE table_name = 'users'
                ) THEN
                    BEGIN
                        ALTER TABLE inspirations
                        ADD CONSTRAINT fk_inspirations_user
                        FOREIGN KEY (user_id)
                        REFERENCES users(id);
                        
                        RAISE NOTICE 'inspirations tablosuna users tablosu ile foreign key ilişkisi eklendi';
                    EXCEPTION WHEN OTHERS THEN
                        RAISE NOTICE 'Foreign key eklenemedi: %', SQLERRM;
                    END;
                END IF;
            END IF;
            
            -- like_count ve likes_count sütunları için düzeltmeler
            IF NOT EXISTS (
                SELECT FROM information_schema.columns 
                WHERE table_name = 'inspirations' 
                AND column_name = 'likes_count'
            ) THEN
                ALTER TABLE inspirations ADD COLUMN likes_count INTEGER DEFAULT 0;
            END IF;
            
            IF NOT EXISTS (
                SELECT FROM information_schema.columns 
                WHERE table_name = 'inspirations' 
                AND column_name = 'like_count'
            ) THEN
                ALTER TABLE inspirations ADD COLUMN like_count INTEGER DEFAULT 0;
            END IF;
            
            -- Diğer ilgili sütunları da kontrol et ve ekle
            IF NOT EXISTS (
                SELECT FROM information_schema.columns 
                WHERE table_name = 'inspirations' 
                AND column_name = 'save_count'
            ) THEN
                ALTER TABLE inspirations ADD COLUMN save_count INTEGER DEFAULT 0;
            END IF;
            
            IF NOT EXISTS (
                SELECT FROM information_schema.columns 
                WHERE table_name = 'inspirations' 
                AND column_name = 'comment_count'
            ) THEN
                ALTER TABLE inspirations ADD COLUMN comment_count INTEGER DEFAULT 0;
            END IF;
            
            IF NOT EXISTS (
                SELECT FROM information_schema.columns 
                WHERE table_name = 'inspirations' 
                AND column_name = 'view_count'
            ) THEN
                ALTER TABLE inspirations ADD COLUMN view_count INTEGER DEFAULT 0;
            END IF;
        END IF;
    END IF;
END $$; 