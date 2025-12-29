-- ========================================
-- 戦歴レビュー（AI vs 手動 / virtual除外・分離）
-- ========================================
-- 目的:
-- - ai_signals に AIトレード・手動トレードが混在しても誤解なく評価できるようにする
-- - virtual（paper/shadow）学習用データは損益評価から除外し、件数/ラベリング状況のみ確認する
--
-- 実行方法: Supabase Dashboard > SQL Editor で実行
-- ========================================

-- 0) 期間と総件数
SELECT
  '0) 期間と総件数' AS section,
  COUNT(*) AS total_rows,
  MIN(created_at) AS min_created_at,
  MAX(created_at) AS max_created_at
FROM ai_signals;

-- 1) 混在状況（AI/手動/virtual × ステータス）
SELECT
  '1) 混在状況' AS section,
  COALESCE(is_manual_trade, false) AS is_manual_trade,
  COALESCE(is_virtual, false) AS is_virtual,
  actual_result,
  COUNT(*) AS rows
FROM ai_signals
GROUP BY 1,2,3,4
ORDER BY is_manual_trade, is_virtual, rows DESC;

-- 2) 実トレード成績（virtual除外、WIN/LOSSのみ）
WITH base AS (
  SELECT *
  FROM ai_signals
  WHERE COALESCE(is_virtual, false) = false
    AND actual_result IN ('WIN','LOSS')
)
SELECT
  '2) 実トレード成績（AI vs 手動）' AS section,
  CASE WHEN COALESCE(is_manual_trade,false) THEN 'MANUAL' ELSE 'AI' END AS trade_type,
  COUNT(*) AS trades,
  ROUND((AVG(CASE WHEN actual_result='WIN' THEN 1 ELSE 0 END)*100)::numeric, 2) AS win_rate_pct,
  ROUND(SUM(profit_loss)::numeric, 2) AS total_pnl,
  ROUND(AVG(profit_loss)::numeric, 2) AS avg_pnl,
  ROUND(AVG(ABS(profit_loss))::numeric, 2) AS avg_abs_pnl,
  ROUND((
    (SUM(CASE WHEN profit_loss>0 THEN profit_loss ELSE 0 END)
     / NULLIF(ABS(SUM(CASE WHEN profit_loss<0 THEN profit_loss ELSE 0 END)), 0))
  )::numeric, 3) AS profit_factor
FROM base
GROUP BY 1,2
ORDER BY trade_type;

-- 3) AIのみ：予測勝率の帯別（virtual除外、WIN/LOSSのみ）
WITH base AS (
  SELECT *
  FROM ai_signals
  WHERE COALESCE(is_virtual, false) = false
    AND COALESCE(is_manual_trade,false) = false
    AND actual_result IN ('WIN','LOSS')
    AND win_prob IS NOT NULL
), bucketed AS (
  SELECT
    CASE
      WHEN win_prob >= 0.80 THEN '0.80-'
      WHEN win_prob >= 0.75 THEN '0.75-0.80'
      WHEN win_prob >= 0.70 THEN '0.70-0.75'
      WHEN win_prob >= 0.65 THEN '0.65-0.70'
      WHEN win_prob >= 0.60 THEN '0.60-0.65'
      ELSE '<0.60'
    END AS win_prob_bucket,
    *
  FROM base
)
SELECT
  '3) AI予測精度（帯別）' AS section,
  win_prob_bucket,
  COUNT(*) AS trades,
  ROUND((AVG(CASE WHEN actual_result='WIN' THEN 1 ELSE 0 END)*100)::numeric, 2) AS win_rate_pct,
  ROUND((AVG(win_prob)*100)::numeric, 2) AS avg_pred_pct,
  ROUND(SUM(profit_loss)::numeric, 2) AS total_pnl
FROM bucketed
GROUP BY 1,2
ORDER BY win_prob_bucket;

-- 4) AIのみ：銘柄別（virtual除外、WIN/LOSSのみ）
SELECT
  '4) AI銘柄別' AS section,
  symbol,
  COUNT(*) AS trades,
  ROUND((AVG(CASE WHEN actual_result='WIN' THEN 1 ELSE 0 END)*100)::numeric, 2) AS win_rate_pct,
  ROUND(SUM(profit_loss)::numeric, 2) AS total_pnl,
  ROUND(AVG(profit_loss)::numeric, 2) AS avg_pnl,
  ROUND((AVG(win_prob)*100)::numeric, 2) AS avg_pred_pct
FROM ai_signals
WHERE COALESCE(is_virtual, false) = false
  AND COALESCE(is_manual_trade,false) = false
  AND actual_result IN ('WIN','LOSS')
GROUP BY symbol
ORDER BY total_pnl DESC;

-- 5) AIのみ：エントリー方式別（virtual除外、WIN/LOSSのみ）
SELECT
  '5) AIエントリー方式別' AS section,
  COALESCE(entry_method, '(null)') AS entry_method,
  COUNT(*) AS trades,
  ROUND((AVG(CASE WHEN actual_result='WIN' THEN 1 ELSE 0 END)*100)::numeric, 2) AS win_rate_pct,
  ROUND(SUM(profit_loss)::numeric, 2) AS total_pnl,
  ROUND(AVG(profit_loss)::numeric, 2) AS avg_pnl
FROM ai_signals
WHERE COALESCE(is_virtual, false) = false
  AND COALESCE(is_manual_trade,false) = false
  AND actual_result IN ('WIN','LOSS')
GROUP BY 1,2
ORDER BY total_pnl DESC;

-- 6) キャンセル理由（virtual除外）
SELECT
  '6) キャンセル理由' AS section,
  COALESCE(cancelled_reason,'(null)') AS cancelled_reason,
  COUNT(*) AS cancels
FROM ai_signals
WHERE COALESCE(is_virtual, false) = false
  AND actual_result = 'CANCELLED'
GROUP BY 1,2
ORDER BY cancels DESC;

-- 7) 時間帯別（UTC、AIのみ、virtual除外、WIN/LOSSのみ）
SELECT
  '7) AI時間帯別（UTC）' AS section,
  EXTRACT(HOUR FROM created_at) AS utc_hour,
  COUNT(*) AS trades,
  ROUND((AVG(CASE WHEN actual_result='WIN' THEN 1 ELSE 0 END)*100)::numeric, 2) AS win_rate_pct,
  ROUND(SUM(profit_loss)::numeric, 2) AS total_pnl
FROM ai_signals
WHERE COALESCE(is_virtual, false) = false
  AND COALESCE(is_manual_trade,false) = false
  AND actual_result IN ('WIN','LOSS')
GROUP BY 1,2
ORDER BY utc_hour;

-- 8) virtual学習データの状況（損益評価には使わない）
SELECT
  '8) virtual状況' AS section,
  actual_result,
  COUNT(*) AS virtual_rows,
  COUNT(*) FILTER (WHERE virtual_filled_at IS NOT NULL) AS filled_count,
  COUNT(*) FILTER (WHERE planned_entry_price IS NOT NULL) AS with_planned_entry,
  COUNT(*) FILTER (WHERE planned_sl IS NOT NULL AND planned_tp IS NOT NULL) AS with_planned_sl_tp
FROM ai_signals
WHERE COALESCE(is_virtual, false) = true
GROUP BY 1,2
ORDER BY virtual_rows DESC;

-- 9) データ欠損（WIN/LOSSなのに重要列がNULL）
SELECT
  '9) 欠損チェック' AS section,
  COUNT(*) FILTER (WHERE actual_result IN ('WIN','LOSS')) AS wl_rows,
  COUNT(*) FILTER (WHERE actual_result IN ('WIN','LOSS') AND profit_loss IS NULL) AS wl_missing_profit_loss,
  COUNT(*) FILTER (WHERE actual_result IN ('WIN','LOSS') AND exit_price IS NULL) AS wl_missing_exit_price,
  COUNT(*) FILTER (WHERE actual_result IN ('WIN','LOSS') AND entry_price IS NULL) AS wl_missing_entry_price,
  COUNT(*) FILTER (WHERE actual_result IN ('WIN','LOSS') AND closed_at IS NULL) AS wl_missing_closed_at,
  COUNT(*) FILTER (WHERE actual_result IN ('WIN','LOSS') AND entry_method IS NULL) AS wl_missing_entry_method
FROM ai_signals;
