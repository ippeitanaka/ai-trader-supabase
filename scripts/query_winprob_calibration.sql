-- Win probability calibration report
-- Purpose: Compare prediction calibration between past "good" months and recent performance.
--
-- How to run (Supabase CLI):
--   supabase db query --file scripts/query_winprob_calibration.sql
--
-- Notes:
-- - Uses public.ai_signals_calibration_raw view (created by migration 20260115_001_add_ai_signals_calibration_views.sql)
-- - Real trades only: is_virtual=false and actual_result in ('WIN','LOSS')

DROP VIEW IF EXISTS calib_base;
CREATE TEMP VIEW calib_base AS
WITH periods AS (
  SELECT '2025-10/11'::text AS period, '2025-10-01'::timestamptz AS start_at, '2025-12-01'::timestamptz AS end_at
  UNION ALL
  SELECT 'Recent-14d', (NOW() - INTERVAL '14 days')::timestamptz, NOW()::timestamptz
)
SELECT
  p.period,
  r.created_at,
  r.symbol,
  r.timeframe,
  r.dir,
  r.win_prob,
  r.win_prob_bin_0_05,
  r.realized_win,
  r.brier_score,
  r.profit_loss,
  r.regime,
  r.strategy,
  r.regime_confidence
FROM public.ai_signals_calibration_raw r
JOIN periods p
  ON r.created_at >= p.start_at AND r.created_at < p.end_at
WHERE
  r.is_virtual = false
  AND r.realized_win IS NOT NULL;

-- 1) Period-level calibration summary
SELECT
  period,
  COUNT(*) AS n,
  ROUND(AVG(win_prob)::numeric, 4) AS avg_pred_win_prob,
  ROUND(AVG(realized_win::double precision)::numeric, 4) AS realized_win_rate,
  ROUND(AVG(brier_score)::numeric, 4) AS avg_brier_score,
  ROUND(AVG(profit_loss)::numeric, 2) AS avg_profit_loss,
  ROUND(SUM(profit_loss)::numeric, 2) AS sum_profit_loss
FROM calib_base
GROUP BY period
ORDER BY period;

-- 2) Reliability diagram style bins (0.05)
-- Tip: focus bins with enough samples.
SELECT
  period,
  win_prob_bin_0_05 AS win_prob_bin,
  COUNT(*) AS n,
  ROUND(AVG(win_prob)::numeric, 4) AS avg_pred_win_prob,
  ROUND(AVG(realized_win::double precision)::numeric, 4) AS realized_win_rate,
  ROUND(AVG(brier_score)::numeric, 4) AS avg_brier_score,
  ROUND(AVG(profit_loss)::numeric, 2) AS avg_profit_loss,
  ROUND(SUM(profit_loss)::numeric, 2) AS sum_profit_loss
FROM calib_base
GROUP BY period, win_prob_bin_0_05
HAVING COUNT(*) >= 10
ORDER BY period, win_prob_bin;

-- 3) Threshold slices (what matters for execution)
-- You can adjust the thresholds to match EA MinWinProb.
SELECT
  period,
  CASE
    WHEN win_prob >= 0.80 THEN '>=0.80'
    WHEN win_prob >= 0.75 THEN '0.75-0.79'
    WHEN win_prob >= 0.70 THEN '0.70-0.74'
    WHEN win_prob >= 0.60 THEN '0.60-0.69'
    ELSE '<0.60'
  END AS band,
  COUNT(*) AS n,
  ROUND(AVG(win_prob)::numeric, 4) AS avg_pred_win_prob,
  ROUND(AVG(realized_win::double precision)::numeric, 4) AS realized_win_rate,
  ROUND(AVG(brier_score)::numeric, 4) AS avg_brier_score,
  ROUND(AVG(profit_loss)::numeric, 2) AS avg_profit_loss,
  ROUND(SUM(profit_loss)::numeric, 2) AS sum_profit_loss
FROM calib_base
GROUP BY period, band
ORDER BY period, band;

-- 4) Where it breaks down (symbol/timeframe)
SELECT
  period,
  symbol,
  timeframe,
  dir,
  COUNT(*) AS n,
  ROUND(AVG(win_prob)::numeric, 4) AS avg_pred_win_prob,
  ROUND(AVG(realized_win::double precision)::numeric, 4) AS realized_win_rate,
  ROUND(AVG(brier_score)::numeric, 4) AS avg_brier_score,
  ROUND(SUM(profit_loss)::numeric, 2) AS sum_profit_loss
FROM calib_base
GROUP BY period, symbol, timeframe, dir
HAVING COUNT(*) >= 20
ORDER BY sum_profit_loss ASC;
