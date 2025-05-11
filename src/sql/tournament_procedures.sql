-- Kullanıcının turnuva eşleşmesini kontrol eden fonksiyon
CREATE OR REPLACE FUNCTION check_user_tournament_match(user_id_param UUID)
RETURNS TABLE (
  id UUID,
  user1_id UUID,
  user2_id UUID,
  status TEXT,
  user1_votes INTEGER,
  user2_votes INTEGER,
  total_votes INTEGER,
  created_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ
) AS $$
BEGIN
  -- Önce kullanıcının queue kayıtlarını bul
  RETURN QUERY
  WITH user_queue AS (
    SELECT id FROM tournament_queue
    WHERE user_id = user_id_param
  )
  SELECT
    tm.id,
    tm.user1_id,
    tm.user2_id,
    tm.status,
    tm.user1_votes,
    tm.user2_votes,
    tm.total_votes,
    tm.created_at,
    tm.started_at,
    tm.ended_at
  FROM tournament_matches tm
  WHERE 
    (tm.user1_id IN (SELECT id FROM user_queue) OR 
     tm.user2_id IN (SELECT id FROM user_queue))
    AND tm.status IN ('pending', 'active');
END;
$$ LANGUAGE plpgsql;

-- Kullanıcının eşleşmesini ID üzerinden alan fonksiyon
CREATE OR REPLACE FUNCTION get_user_tournament_match(queue_id_param UUID)
RETURNS TABLE (
  id UUID,
  user1_id UUID,
  user2_id UUID,
  status TEXT,
  user1_votes INTEGER,
  user2_votes INTEGER,
  total_votes INTEGER,
  created_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  user1_image TEXT,
  user2_image TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    tm.id,
    tm.user1_id,
    tm.user2_id,
    tm.status,
    tm.user1_votes,
    tm.user2_votes,
    tm.total_votes,
    tm.created_at,
    tm.started_at,
    tm.ended_at,
    u1.outfit_image_url AS user1_image,
    u2.outfit_image_url AS user2_image
  FROM tournament_matches tm
  JOIN tournament_queue u1 ON tm.user1_id = u1.id
  JOIN tournament_queue u2 ON tm.user2_id = u2.id
  WHERE 
    (tm.user1_id = queue_id_param OR 
     tm.user2_id = queue_id_param)
    AND tm.status IN ('pending', 'active');
END;
$$ LANGUAGE plpgsql; 