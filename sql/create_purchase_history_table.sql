-- Purchase History tablosu - RevenueCat webhook'ları için
-- Bu tablo tüm satın alma geçmişini tutar

CREATE TABLE IF NOT EXISTS purchase_history (
    id BIGSERIAL PRIMARY KEY,
    user_id TEXT NOT NULL,
    product_id TEXT NOT NULL,
    transaction_id TEXT NOT NULL,
    credits_added INTEGER NOT NULL DEFAULT 0,
    price DECIMAL(10,2) DEFAULT 0,
    currency VARCHAR(3) DEFAULT 'USD',
    store VARCHAR(50) DEFAULT 'unknown',
    environment VARCHAR(20) DEFAULT 'production',
    event_type VARCHAR(50) NOT NULL,
    purchased_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Unique constraint
    CONSTRAINT unique_transaction_per_user UNIQUE (user_id, transaction_id)
);

-- Index'leri ayrı ayrı oluştur
CREATE INDEX IF NOT EXISTS idx_purchase_history_user_id ON purchase_history (user_id);
CREATE INDEX IF NOT EXISTS idx_purchase_history_transaction_id ON purchase_history (transaction_id);
CREATE INDEX IF NOT EXISTS idx_purchase_history_product_id ON purchase_history (product_id);
CREATE INDEX IF NOT EXISTS idx_purchase_history_created_at ON purchase_history (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_purchase_history_event_type ON purchase_history (event_type);

-- Kullanıcı referansı için foreign key (opsiyonel - users tablosu varsa)
-- ALTER TABLE purchase_history 
-- ADD CONSTRAINT fk_purchase_history_user 
-- FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

-- Row Level Security (RLS) aktif et
ALTER TABLE purchase_history ENABLE ROW LEVEL SECURITY;

-- Kullanıcılar sadece kendi satın alma geçmişlerini görebilir
CREATE POLICY "Users can view own purchase history" ON purchase_history
    FOR SELECT USING (auth.uid()::text = user_id);

-- Admin'ler tüm purchase history'yi görebilir (opsiyonel)
CREATE POLICY "Admins can view all purchase history" ON purchase_history
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM users 
            WHERE users.id = auth.uid()::text 
            AND users.is_admin = true
        )
    );

-- Webhook'ların insert yapabilmesi için service role policy
CREATE POLICY "Service role can insert purchases" ON purchase_history
    FOR INSERT WITH CHECK (true);

-- Webhook'ların duplicate kontrolü yapabilmesi için service role policy  
CREATE POLICY "Service role can select for duplicates" ON purchase_history
    FOR SELECT USING (true);

-- Tabloya açıklama ekle
COMMENT ON TABLE purchase_history IS 'RevenueCat webhook''larından gelen tüm satın alma kayıtları';
COMMENT ON COLUMN purchase_history.user_id IS 'Satın alma yapan kullanıcı ID''si';
COMMENT ON COLUMN purchase_history.product_id IS 'Satın alınan ürün ID''si (RevenueCat''dan gelen)';
COMMENT ON COLUMN purchase_history.transaction_id IS 'İşlem ID''si (duplicate kontrolü için)';
COMMENT ON COLUMN purchase_history.credits_added IS 'Eklenen kredi miktarı';
COMMENT ON COLUMN purchase_history.price IS 'Ürün fiyatı';
COMMENT ON COLUMN purchase_history.currency IS 'Para birimi';
COMMENT ON COLUMN purchase_history.store IS 'App Store/Google Play/etc';
COMMENT ON COLUMN purchase_history.environment IS 'SANDBOX/PRODUCTION';
COMMENT ON COLUMN purchase_history.event_type IS 'INITIAL_PURCHASE/RENEWAL/CANCELLATION/etc';
COMMENT ON COLUMN purchase_history.purchased_at IS 'Satın alma zamanı (RevenueCat''dan)';
COMMENT ON COLUMN purchase_history.created_at IS 'Webhook''un işlendiği zaman'; 