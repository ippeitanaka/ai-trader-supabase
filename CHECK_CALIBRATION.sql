-- Quick calibration check (run locally)
-- Usage:
--   supabase db query --file CHECK_CALIBRATION.sql

-- Recent 30 days: overall and high-confidence slice
WITH base AS (
  SELECT *
  FROM public.ai_signals_calibration_raw
  WHERE
    is_virtual = false
    AND realized_win IS NOT NULL
    AND created_at >= (NOW() - INTERVAL '30 days')
)
SELECT
  'ALL' AS slice,
  COUNT(*) AS n,
  ROUND(AVG(win_prob)::numeric, 4) AS avg_pred_win_prob,
  ROUND(AVG(realized_win::double precision)::numeric, 4) AS realized_win_rate,
  ROUND(AVG(brier_score)::numeric, 4) AS avg_brier_score,
  ROUND(SUM(profit_loss)::numeric, 2) AS sum_profit_loss
FROM base

UNION ALL

SELECT
  'WIN_PROB>=0.75' AS slice,
  COUNT(*) AS n,
  ROUND(AVG(win_prob)::numeric, 4) AS avg_pred_win_prob,
  ROUND(AVG(realized_win::double precision)::numeric, 4) AS realized_win_rate,
  ROUND(AVG(brier_score)::numeric, 4) AS avg_brier_score,
  ROUND(SUM(profit_loss)::numeric, 2) AS sum_profit_loss
FROM base
WHERE win_prob >= 0.75
ORDER BY slice;
