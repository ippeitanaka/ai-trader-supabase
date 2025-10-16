-- Migration: Create ML learning tables
-- Created: 2025-10-17
-- Purpose: Store machine learning patterns and training results

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 1. 学習済みパターンテーブル (Learned Patterns)
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CREATE TABLE IF NOT EXISTS public.ml_patterns (
  id BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- パターン識別
  pattern_name TEXT NOT NULL,
  pattern_type TEXT NOT NULL, -- 'technical', 'ichimoku', 'combined'
  
  -- 条件範囲
  symbol TEXT,
  timeframe TEXT,
  direction INTEGER, -- 1=buy, -1=sell
  
  -- テクニカル指標の条件範囲
  rsi_min DOUBLE PRECISION,
  rsi_max DOUBLE PRECISION,
  atr_min DOUBLE PRECISION,
  atr_max DOUBLE PRECISION,
  ichimoku_score_min DOUBLE PRECISION,
  ichimoku_score_max DOUBLE PRECISION,
  
  -- パフォーマンス統計
  total_trades INTEGER DEFAULT 0,
  win_count INTEGER DEFAULT 0,
  loss_count INTEGER DEFAULT 0,
  win_rate DOUBLE PRECISION DEFAULT 0.0,
  avg_profit DOUBLE PRECISION DEFAULT 0.0,
  avg_loss DOUBLE PRECISION DEFAULT 0.0,
  profit_factor DOUBLE PRECISION DEFAULT 0.0,
  
  -- 信頼度・有効性
  confidence_score DOUBLE PRECISION DEFAULT 0.0,
  sample_size_adequate BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true,
  
  UNIQUE(pattern_name)
);

CREATE INDEX IF NOT EXISTS idx_ml_patterns_symbol ON public.ml_patterns (symbol);
CREATE INDEX IF NOT EXISTS idx_ml_patterns_win_rate ON public.ml_patterns (win_rate DESC);
CREATE INDEX IF NOT EXISTS idx_ml_patterns_active ON public.ml_patterns (is_active);
CREATE INDEX IF NOT EXISTS idx_ml_patterns_updated_at ON public.ml_patterns (updated_at DESC);

COMMENT ON TABLE public.ml_patterns IS '機械学習で発見された取引パターン';

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 2. 学習履歴テーブル (Training History)
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CREATE TABLE IF NOT EXISTS public.ml_training_history (
  id BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- 学習実行情報
  training_type TEXT NOT NULL, -- 'pattern_extraction', 'performance_analysis', 'full_retrain'
  duration_ms INTEGER,
  
  -- データセット統計
  total_signals_analyzed INTEGER DEFAULT 0,
  complete_trades_count INTEGER DEFAULT 0,
  patterns_discovered INTEGER DEFAULT 0,
  patterns_updated INTEGER DEFAULT 0,
  
  -- 全体パフォーマンス
  overall_win_rate DOUBLE PRECISION,
  best_pattern_win_rate DOUBLE PRECISION,
  worst_pattern_win_rate DOUBLE PRECISION,
  
  -- 学習結果サマリー
  insights JSONB,
  recommendations JSONB,
  
  -- ステータス
  status TEXT DEFAULT 'completed', -- 'running', 'completed', 'failed'
  error_message TEXT,
  
  -- メタデータ
  version TEXT,
  triggered_by TEXT -- 'cron', 'manual', 'api'
);

CREATE INDEX IF NOT EXISTS idx_ml_training_history_created_at ON public.ml_training_history (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ml_training_history_status ON public.ml_training_history (status);

COMMENT ON TABLE public.ml_training_history IS 'ML学習の実行履歴とサマリー';

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 3. パフォーマンス改善提案テーブル (Recommendations)
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CREATE TABLE IF NOT EXISTS public.ml_recommendations (
  id BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- 提案情報
  recommendation_type TEXT NOT NULL, -- 'avoid_pattern', 'favor_pattern', 'adjust_parameter', 'market_condition'
  priority TEXT DEFAULT 'medium', -- 'high', 'medium', 'low'
  title TEXT NOT NULL,
  description TEXT,
  
  -- 根拠データ
  based_on_pattern_id BIGINT REFERENCES public.ml_patterns(id),
  supporting_data JSONB,
  
  -- 期待効果
  expected_win_rate_improvement DOUBLE PRECISION,
  expected_profit_improvement DOUBLE PRECISION,
  
  -- ステータス
  status TEXT DEFAULT 'active', -- 'active', 'applied', 'dismissed'
  applied_at TIMESTAMPTZ,
  dismissed_at TIMESTAMPTZ,
  
  -- メタデータ
  training_history_id BIGINT REFERENCES public.ml_training_history(id)
);

CREATE INDEX IF NOT EXISTS idx_ml_recommendations_status ON public.ml_recommendations (status);
CREATE INDEX IF NOT EXISTS idx_ml_recommendations_priority ON public.ml_recommendations (priority);
CREATE INDEX IF NOT EXISTS idx_ml_recommendations_created_at ON public.ml_recommendations (created_at DESC);

COMMENT ON TABLE public.ml_recommendations IS 'AIによるトレード改善提案';

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 4. RLS (Row Level Security) ポリシー
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ALTER TABLE public.ml_patterns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ml_training_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ml_recommendations ENABLE ROW LEVEL SECURITY;

-- 既存のポリシーを削除（再実行時のエラー回避）
DROP POLICY IF EXISTS "Allow service role full access to ml_patterns" ON public.ml_patterns;
DROP POLICY IF EXISTS "Allow service role full access to ml_training_history" ON public.ml_training_history;
DROP POLICY IF EXISTS "Allow service role full access to ml_recommendations" ON public.ml_recommendations;
DROP POLICY IF EXISTS "Allow read access to ml_patterns" ON public.ml_patterns;
DROP POLICY IF EXISTS "Allow read access to ml_training_history" ON public.ml_training_history;
DROP POLICY IF EXISTS "Allow read access to ml_recommendations" ON public.ml_recommendations;

-- Service roleからの全アクセス許可
CREATE POLICY "Allow service role full access to ml_patterns"
  ON public.ml_patterns FOR ALL
  USING (auth.role() = 'service_role');

CREATE POLICY "Allow service role full access to ml_training_history"
  ON public.ml_training_history FOR ALL
  USING (auth.role() = 'service_role');

CREATE POLICY "Allow service role full access to ml_recommendations"
  ON public.ml_recommendations FOR ALL
  USING (auth.role() = 'service_role');

-- anon/authenticatedからの読み取り許可
CREATE POLICY "Allow read access to ml_patterns"
  ON public.ml_patterns FOR SELECT
  USING (true);

CREATE POLICY "Allow read access to ml_training_history"
  ON public.ml_training_history FOR SELECT
  USING (true);

CREATE POLICY "Allow read access to ml_recommendations"
  ON public.ml_recommendations FOR SELECT
  USING (true);

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 5. 便利なビュー
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- 有効なパターンのみを表示
CREATE OR REPLACE VIEW public.ml_active_patterns
WITH (security_invoker = true)
AS
SELECT 
  pattern_name,
  pattern_type,
  symbol,
  timeframe,
  direction,
  win_rate,
  total_trades,
  confidence_score,
  rsi_min,
  rsi_max,
  ichimoku_score_min,
  ichimoku_score_max,
  updated_at
FROM public.ml_patterns
WHERE is_active = true
  AND total_trades >= 5  -- 最低サンプル数
ORDER BY win_rate DESC;

-- 最新の学習サマリー
CREATE OR REPLACE VIEW public.ml_latest_training
WITH (security_invoker = true)
AS
SELECT 
  created_at,
  training_type,
  total_signals_analyzed,
  complete_trades_count,
  patterns_discovered,
  overall_win_rate,
  best_pattern_win_rate,
  status
FROM public.ml_training_history
ORDER BY created_at DESC
LIMIT 10;

-- アクティブな推奨事項
CREATE OR REPLACE VIEW public.ml_active_recommendations
WITH (security_invoker = true)
AS
SELECT 
  r.id,
  r.created_at,
  r.recommendation_type,
  r.priority,
  r.title,
  r.description,
  r.expected_win_rate_improvement,
  p.pattern_name,
  p.win_rate as pattern_win_rate
FROM public.ml_recommendations r
LEFT JOIN public.ml_patterns p ON r.based_on_pattern_id = p.id
WHERE r.status = 'active'
ORDER BY 
  CASE r.priority 
    WHEN 'high' THEN 1 
    WHEN 'medium' THEN 2 
    WHEN 'low' THEN 3 
  END,
  r.created_at DESC;

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 6. 自動更新トリガー
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- 既存のトリガーを削除（再実行時のエラー回避）
DROP TRIGGER IF EXISTS trigger_ml_patterns_updated_at ON public.ml_patterns;

CREATE OR REPLACE FUNCTION update_ml_pattern_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_ml_patterns_updated_at
  BEFORE UPDATE ON public.ml_patterns
  FOR EACH ROW
  EXECUTE FUNCTION update_ml_pattern_timestamp();

COMMENT ON FUNCTION update_ml_pattern_timestamp() IS 'ml_patternsのupdated_atを自動更新';
