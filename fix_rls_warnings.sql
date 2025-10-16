-- RLS警告修正: ビューをSECURITY INVOKERで再作成
-- 実行日: 2025-10-17
-- 目的: security_definer_view 警告を解消し、ポリシー重複エラーを修正

-- ビューを削除して再作成
DROP VIEW IF EXISTS public.ml_active_patterns CASCADE;
DROP VIEW IF EXISTS public.ml_latest_training CASCADE;
DROP VIEW IF EXISTS public.ml_active_recommendations CASCADE;

-- 既存のポリシーを削除（再実行時のエラー回避）
DROP POLICY IF EXISTS "Allow service role full access to ml_patterns" ON public.ml_patterns;
DROP POLICY IF EXISTS "Allow service role full access to ml_training_history" ON public.ml_training_history;
DROP POLICY IF EXISTS "Allow service role full access to ml_recommendations" ON public.ml_recommendations;
DROP POLICY IF EXISTS "Allow read access to ml_patterns" ON public.ml_patterns;
DROP POLICY IF EXISTS "Allow read access to ml_training_history" ON public.ml_training_history;
DROP POLICY IF EXISTS "Allow read access to ml_recommendations" ON public.ml_recommendations;

-- ポリシーを再作成
CREATE POLICY "Allow service role full access to ml_patterns"
  ON public.ml_patterns FOR ALL
  USING (auth.role() = 'service_role');

CREATE POLICY "Allow service role full access to ml_training_history"
  ON public.ml_training_history FOR ALL
  USING (auth.role() = 'service_role');

CREATE POLICY "Allow service role full access to ml_recommendations"
  ON public.ml_recommendations FOR ALL
  USING (auth.role() = 'service_role');

CREATE POLICY "Allow read access to ml_patterns"
  ON public.ml_patterns FOR SELECT
  USING (true);

CREATE POLICY "Allow read access to ml_training_history"
  ON public.ml_training_history FOR SELECT
  USING (true);

CREATE POLICY "Allow read access to ml_recommendations"
  ON public.ml_recommendations FOR SELECT
  USING (true);

-- 有効なパターンのみを表示
CREATE VIEW public.ml_active_patterns
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
CREATE VIEW public.ml_latest_training
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
CREATE VIEW public.ml_active_recommendations
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

COMMENT ON VIEW public.ml_active_patterns IS '有効なMLパターン（SECURITY INVOKER）';
COMMENT ON VIEW public.ml_latest_training IS '最新の学習履歴（SECURITY INVOKER）';
COMMENT ON VIEW public.ml_active_recommendations IS 'アクティブな推奨事項（SECURITY INVOKER）';

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- トリガーの再作成
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- 既存のトリガーを削除
DROP TRIGGER IF EXISTS trigger_ml_patterns_updated_at ON public.ml_patterns;

-- ファンクションを再作成
CREATE OR REPLACE FUNCTION update_ml_pattern_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- トリガーを再作成
CREATE TRIGGER trigger_ml_patterns_updated_at
  BEFORE UPDATE ON public.ml_patterns
  FOR EACH ROW
  EXECUTE FUNCTION update_ml_pattern_timestamp();

COMMENT ON FUNCTION update_ml_pattern_timestamp() IS 'ml_patternsのupdated_atを自動更新';
