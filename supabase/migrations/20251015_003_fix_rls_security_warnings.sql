-- ===================================================================
-- RLS Security Warnings 修正
-- 2025-10-15
-- ===================================================================

-- 1. ai_signals テーブルにRLSを有効化
ALTER TABLE public.ai_signals ENABLE ROW LEVEL SECURITY;

-- 2. ai_signals テーブルのRLSポリシー設定
-- service_role: すべての操作を許可（Edge Functionsから使用）
CREATE POLICY "service_role_all_ai_signals" 
ON public.ai_signals 
FOR ALL 
TO service_role 
USING (true) 
WITH CHECK (true);

-- authenticated: 読み取りのみ許可（ダッシュボード表示用）
CREATE POLICY "authenticated_read_ai_signals" 
ON public.ai_signals 
FOR SELECT 
TO authenticated 
USING (true);

-- 3. ビューを SECURITY INVOKER に変更（実行者の権限で動作）
-- ea_log_monitor
DROP VIEW IF EXISTS public.ea_log_monitor;
CREATE VIEW public.ea_log_monitor
WITH (security_invoker = true)
AS
SELECT 
    id,
    created_at AS "作成日時",
    at AS "判定時刻",
    sym AS "銘柄",
    tf AS "時間足",
    action AS "アクション",
    trade_decision AS "トレード判定",
    win_prob AS "勝率",
    ai_reasoning AS "AI理由",
    order_ticket AS "オーダー番号"
FROM public."ea-log"
ORDER BY created_at DESC;

-- ai_signals_training_complete
DROP VIEW IF EXISTS public.ai_signals_training_complete;
CREATE VIEW public.ai_signals_training_complete
WITH (security_invoker = true)
AS
SELECT 
    id, symbol, timeframe, dir, win_prob, rsi, atr, price, 
    entry_price, exit_price, profit_loss, actual_result,
    created_at, closed_at, hold_duration_minutes,
    sl_hit, tp_hit, reason, instance, model_version
FROM public.ai_signals
WHERE actual_result IN ('WIN', 'LOSS', 'BREAK_EVEN')
  AND entry_price IS NOT NULL
  AND exit_price IS NOT NULL;

-- ai_signals_quality
DROP VIEW IF EXISTS public.ai_signals_quality;
CREATE VIEW public.ai_signals_quality
WITH (security_invoker = true)
AS
SELECT 
    actual_result,
    COUNT(*) as total_count,
    COUNT(entry_price) as with_entry_price,
    ROUND(CAST(COUNT(entry_price) AS NUMERIC) * 100.0 / COUNT(*), 1) as entry_price_coverage_pct,
    COUNT(exit_price) as with_exit_price,
    ROUND(CAST(COUNT(exit_price) AS NUMERIC) * 100.0 / COUNT(*), 1) as exit_price_coverage_pct,
    COUNT(CASE WHEN entry_price IS NOT NULL AND exit_price IS NOT NULL THEN 1 END) as complete_records,
    ROUND(CAST(COUNT(CASE WHEN entry_price IS NOT NULL AND exit_price IS NOT NULL THEN 1 END) AS NUMERIC) * 100.0 / COUNT(*), 1) as complete_pct
FROM public.ai_signals
GROUP BY actual_result
ORDER BY actual_result;

-- ai_signals_stats
DROP VIEW IF EXISTS public.ai_signals_stats;
CREATE VIEW public.ai_signals_stats
WITH (security_invoker = true)
AS
SELECT 
    COUNT(*) as total_signals,
    COUNT(CASE WHEN actual_result = 'PENDING' THEN 1 END) as pending_count,
    COUNT(CASE WHEN actual_result = 'FILLED' THEN 1 END) as filled_count,
    COUNT(CASE WHEN actual_result = 'WIN' THEN 1 END) as win_count,
    COUNT(CASE WHEN actual_result = 'LOSS' THEN 1 END) as loss_count,
    COUNT(CASE WHEN actual_result = 'CANCELLED' THEN 1 END) as cancelled_count,
    COUNT(CASE WHEN entry_price IS NOT NULL THEN 1 END) as with_entry_price,
    ROUND(CAST(COUNT(CASE WHEN entry_price IS NOT NULL THEN 1 END) AS NUMERIC) * 100.0 / NULLIF(COUNT(*), 0), 1) as entry_coverage_pct,
    COUNT(CASE WHEN actual_result IN ('WIN','LOSS','BREAK_EVEN') AND entry_price IS NOT NULL AND exit_price IS NOT NULL THEN 1 END) as ml_ready_count,
    ROUND(CAST(COUNT(CASE WHEN actual_result IN ('WIN','LOSS','BREAK_EVEN') AND entry_price IS NOT NULL AND exit_price IS NOT NULL THEN 1 END) AS NUMERIC) * 100.0 / NULLIF(COUNT(*), 0), 1) as ml_ready_pct
FROM public.ai_signals;

-- 4. ビューへのアクセス権限を設定
GRANT SELECT ON public.ea_log_monitor TO authenticated, service_role;
GRANT SELECT ON public.ai_signals_training_complete TO authenticated, service_role;
GRANT SELECT ON public.ai_signals_quality TO authenticated, service_role;
GRANT SELECT ON public.ai_signals_stats TO authenticated, service_role;

-- 完了メッセージ
COMMENT ON TABLE public.ai_signals IS 'RLS enabled - ML training data with security policies';
