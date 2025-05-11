-- Turnuvaya katılmak için bekleyen kullanıcılar tablosu
CREATE TABLE IF NOT EXISTS tournament_queue (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL,
  outfit_image_url TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'waiting', -- waiting, matched, active, completed
  joined_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id)  -- Bir kullanıcı aynı anda sadece bir sırada bekleyebilir
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