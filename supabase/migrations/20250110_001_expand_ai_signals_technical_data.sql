-- ai_signalsテーブルにテクニカル指標の詳細データを追加
-- v1.4.0: 全テクニカル指標の生データを保存してML学習を強化

ALTER TABLE ai_signals
-- 価格情報（NULL許可）
ADD COLUMN IF NOT EXISTS bid DECIMAL(20, 5),
ADD COLUMN IF NOT EXISTS ask DECIMAL(20, 5),

-- 移動平均線
ADD COLUMN IF NOT EXISTS ema_25 DECIMAL(20, 5),
ADD COLUMN IF NOT EXISTS sma_100 DECIMAL(20, 5),
ADD COLUMN IF NOT EXISTS ma_cross INTEGER, -- 1=golden cross, -1=dead cross

-- MACD
ADD COLUMN IF NOT EXISTS macd_main DECIMAL(20, 5),
ADD COLUMN IF NOT EXISTS macd_signal DECIMAL(20, 5),
ADD COLUMN IF NOT EXISTS macd_histogram DECIMAL(20, 5),
ADD COLUMN IF NOT EXISTS macd_cross INTEGER, -- 1=bullish, -1=bearish

-- 一目均衡表
ADD COLUMN IF NOT EXISTS ichimoku_tenkan DECIMAL(20, 5),
ADD COLUMN IF NOT EXISTS ichimoku_kijun DECIMAL(20, 5),
ADD COLUMN IF NOT EXISTS ichimoku_senkou_a DECIMAL(20, 5),
ADD COLUMN IF NOT EXISTS ichimoku_senkou_b DECIMAL(20, 5),
ADD COLUMN IF NOT EXISTS ichimoku_chikou DECIMAL(20, 5),
ADD COLUMN IF NOT EXISTS ichimoku_tk_cross INTEGER,     -- 転換線 vs 基準線
ADD COLUMN IF NOT EXISTS ichimoku_cloud_color INTEGER,  -- 雲の色
ADD COLUMN IF NOT EXISTS ichimoku_price_vs_cloud INTEGER, -- 価格 vs 雲の位置

-- EA側の判断（参考情報）
ADD COLUMN IF NOT EXISTS ea_dir INTEGER,
ADD COLUMN IF NOT EXISTS ea_reason TEXT,
ADD COLUMN IF NOT EXISTS ea_ichimoku_score DECIMAL(5, 2);

-- インデックスを追加（検索パフォーマンス向上）
CREATE INDEX IF NOT EXISTS idx_ai_signals_ma_cross ON ai_signals(ma_cross);
CREATE INDEX IF NOT EXISTS idx_ai_signals_macd_cross ON ai_signals(macd_cross);
CREATE INDEX IF NOT EXISTS idx_ai_signals_win_prob ON ai_signals(win_prob);
CREATE INDEX IF NOT EXISTS idx_ai_signals_actual_result ON ai_signals(actual_result);

-- コメント追加
COMMENT ON COLUMN ai_signals.ema_25 IS 'EMA 25期間の値';
COMMENT ON COLUMN ai_signals.sma_100 IS 'SMA 100期間の値';
COMMENT ON COLUMN ai_signals.ma_cross IS 'MA クロス状態: 1=ゴールデンクロス, -1=デッドクロス';
COMMENT ON COLUMN ai_signals.macd_main IS 'MACD メインライン';
COMMENT ON COLUMN ai_signals.macd_signal IS 'MACD シグナルライン';
COMMENT ON COLUMN ai_signals.macd_histogram IS 'MACD ヒストグラム';
COMMENT ON COLUMN ai_signals.ichimoku_tenkan IS '一目均衡表: 転換線';
COMMENT ON COLUMN ai_signals.ichimoku_kijun IS '一目均衡表: 基準線';
COMMENT ON COLUMN ai_signals.ea_dir IS 'EA側の判断方向: 1=買い, -1=売り, 0=中立';
