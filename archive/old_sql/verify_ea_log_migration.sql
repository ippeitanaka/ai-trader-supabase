-- ===== EA-Log テーブル簡素化 - 動作確認用SQL =====
-- 実行日: 2025-10-15
-- Supabase SQL Editorで実行してください

-- 1️⃣ テーブル構造確認
SELECT 
  column_name,
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_schema = 'public' 
  AND table_name = 'ea-log'
ORDER BY ordinal_position;

-- 期待される結果: 10カラム
-- id, created_at, at, sym, tf, action, trade_decision, win_prob, ai_reasoning, order_ticket

-- 2️⃣ データ件数確認
SELECT 
  'ea-log' as table_name,
  COUNT(*) as record_count
FROM public."ea-log"
UNION ALL
SELECT 
  'ai_signals' as table_name,
  COUNT(*) as record_count
FROM public.ai_signals;

-- 3️⃣ 最新データ確認（日本語ビュー）
SELECT * FROM public.ea_log_monitor
ORDER BY "判断日時" DESC
LIMIT 10;

-- 4️⃣ 生データ確認
SELECT 
  id,
  at AS 判断日時,
  sym AS 銘柄,
  tf,
  action AS 方向,
  trade_decision AS 実行状況,
  ROUND(CAST(win_prob * 100 AS NUMERIC), 1) AS 勝率パーセント,
  LEFT(ai_reasoning, 50) AS AI判断根拠抜粋,
  order_ticket AS 注文番号,
  created_at AS 記録日時
FROM public."ea-log"
ORDER BY at DESC
LIMIT 15;

-- 5️⃣ インデックス確認
SELECT 
  indexname,
  indexdef
FROM pg_indexes
WHERE tablename = 'ea-log'
ORDER BY indexname;

-- 6️⃣ RLSポリシー確認
SELECT 
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd
FROM pg_policies
WHERE tablename = 'ea-log';

-- 7️⃣ 統計情報（勝率分布）
SELECT 
  CASE 
    WHEN win_prob >= 0.75 THEN '🟢 高 (75%以上)'
    WHEN win_prob >= 0.60 THEN '🟡 中 (60-74%)'
    WHEN win_prob < 0.60 THEN '🔴 低 (60%未満)'
    ELSE '❓ 不明'
  END AS 信頼度レベル,
  COUNT(*) AS 件数,
  ROUND(CAST(AVG(win_prob * 100) AS NUMERIC), 1) AS 平均勝率,
  ROUND(CAST(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER () AS NUMERIC), 1) AS 割合パーセント
FROM public."ea-log"
WHERE win_prob IS NOT NULL
GROUP BY 
  CASE 
    WHEN win_prob >= 0.75 THEN '🟢 高 (75%以上)'
    WHEN win_prob >= 0.60 THEN '🟡 中 (60-74%)'
    WHEN win_prob < 0.60 THEN '🔴 低 (60%未満)'
    ELSE '❓ 不明'
  END
ORDER BY 平均勝率 DESC;

-- 8️⃣ 実行状況の統計
SELECT 
  trade_decision AS 実行状況,
  COUNT(*) AS 件数,
  ROUND(CAST(AVG(win_prob * 100) AS NUMERIC), 1) AS 平均勝率,
  ROUND(CAST(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER () AS NUMERIC), 1) AS 割合パーセント
FROM public."ea-log"
WHERE trade_decision IS NOT NULL
GROUP BY trade_decision
ORDER BY 件数 DESC;

-- 9️⃣ 銘柄別の統計
SELECT 
  sym AS 銘柄,
  COUNT(*) AS 取引回数,
  ROUND(CAST(AVG(win_prob * 100) AS NUMERIC), 1) AS 平均勝率,
  COUNT(CASE WHEN trade_decision = 'EXECUTED' THEN 1 END) AS 実行件数,
  COUNT(CASE WHEN action = 'BUY' THEN 1 END) AS BUY判断,
  COUNT(CASE WHEN action = 'SELL' THEN 1 END) AS SELL判断
FROM public."ea-log"
GROUP BY sym
ORDER BY 取引回数 DESC;

-- 🔟 時系列データ（最近の傾向）
SELECT 
  DATE_TRUNC('hour', at) AS 時間帯,
  COUNT(*) AS 件数,
  ROUND(CAST(AVG(win_prob * 100) AS NUMERIC), 1) AS 平均勝率,
  STRING_AGG(DISTINCT sym, ', ') AS 銘柄
FROM public."ea-log"
WHERE at >= NOW() - INTERVAL '24 hours'
GROUP BY DATE_TRUNC('hour', at)
ORDER BY 時間帯 DESC
LIMIT 24;

-- ===== 完了メッセージ =====
DO $$ 
BEGIN 
  RAISE NOTICE '✅ EA-Log テーブル簡素化の動作確認完了';
  RAISE NOTICE '📊 上記の結果を確認してください';
  RAISE NOTICE '🚀 次は Edge Function (ea-log) をデプロイしてください';
END $$;
