ALTER TABLE public.ai_signals
  ADD COLUMN IF NOT EXISTS reverse_execution boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS original_dir integer NULL;

COMMENT ON COLUMN public.ai_signals.reverse_execution IS 'true when the EA executed the opposite direction from the server/AI decision; exclude from calibration and ML training';
COMMENT ON COLUMN public.ai_signals.original_dir IS 'Original server/AI decision direction before any EA-side reverse execution (1=BUY, -1=SELL)';

DROP VIEW IF EXISTS public.ai_signals_calibration_bins_daily;
DROP VIEW IF EXISTS public.ai_signals_calibration_weekly;
DROP VIEW IF EXISTS public.ai_signals_calibration_raw;
CREATE OR REPLACE VIEW public.ai_signals_calibration_raw AS
SELECT
  s.id,
  s.created_at,
  s.symbol,
  s.timeframe,
  s.dir,
  s.win_prob,
  (FLOOR(s.win_prob * 20.0) / 20.0) AS win_prob_bin_0_05,
  (to_jsonb(s)->>'actual_result') AS actual_result,
  (to_jsonb(s)->>'profit_loss')::double precision AS profit_loss,
  (to_jsonb(s)->>'entry_price')::double precision AS entry_price,
  (to_jsonb(s)->>'exit_price')::double precision AS exit_price,
  (to_jsonb(s)->>'closed_at')::timestamptz AS closed_at,
  (to_jsonb(s)->>'hold_duration_minutes')::integer AS hold_duration_minutes,
  COALESCE((to_jsonb(s)->>'is_virtual')::boolean, false) AS is_virtual,
  COALESCE((to_jsonb(s)->>'reverse_execution')::boolean, false) AS reverse_execution,
  (to_jsonb(s)->>'original_dir')::integer AS original_dir,
  (to_jsonb(s)->>'regime') AS regime,
  (to_jsonb(s)->>'strategy') AS strategy,
  (to_jsonb(s)->>'regime_confidence') AS regime_confidence,
  CASE
    WHEN (to_jsonb(s)->>'actual_result') = 'WIN' THEN 1
    WHEN (to_jsonb(s)->>'actual_result') = 'LOSS' THEN 0
    ELSE NULL
  END AS realized_win,
  CASE
    WHEN (to_jsonb(s)->>'actual_result') IN ('WIN','LOSS') THEN
      POWER(s.win_prob - CASE WHEN (to_jsonb(s)->>'actual_result') = 'WIN' THEN 1 ELSE 0 END, 2)
    ELSE NULL
  END AS brier_score
FROM public.ai_signals s
WHERE s.win_prob IS NOT NULL;

COMMENT ON VIEW public.ai_signals_calibration_raw IS 'ai_signals with realized WIN/LOSS label and calibration metrics (bin=0.05, brier_score). Use is_virtual=false, reverse_execution=false and actual_result in (WIN,LOSS) for clean real-trade calibration.';

CREATE OR REPLACE VIEW public.ai_signals_calibration_bins_daily AS
SELECT
  DATE_TRUNC('day', created_at)::date AS day,
  symbol,
  timeframe,
  dir,
  win_prob_bin_0_05,
  COUNT(*) AS n,
  AVG(win_prob) AS avg_pred_win_prob,
  AVG(realized_win::double precision) AS realized_win_rate,
  AVG(brier_score) AS avg_brier_score,
  AVG(profit_loss) AS avg_profit_loss,
  SUM(profit_loss) AS sum_profit_loss
FROM public.ai_signals_calibration_raw
WHERE
  is_virtual = false
  AND reverse_execution = false
  AND realized_win IS NOT NULL
GROUP BY 1,2,3,4,5;

COMMENT ON VIEW public.ai_signals_calibration_bins_daily IS 'Daily calibration bins for non-virtual, non-reversed real trades only (WIN/LOSS).';

CREATE OR REPLACE VIEW public.ai_signals_calibration_weekly AS
SELECT
  DATE_TRUNC('week', created_at)::date AS week,
  symbol,
  timeframe,
  dir,
  COUNT(*) AS n,
  AVG(win_prob) AS avg_pred_win_prob,
  AVG(realized_win::double precision) AS realized_win_rate,
  AVG(brier_score) AS avg_brier_score,
  AVG(profit_loss) AS avg_profit_loss,
  SUM(profit_loss) AS sum_profit_loss
FROM public.ai_signals_calibration_raw
WHERE
  is_virtual = false
  AND reverse_execution = false
  AND realized_win IS NOT NULL
GROUP BY 1,2,3,4;

COMMENT ON VIEW public.ai_signals_calibration_weekly IS 'Weekly calibration summary for non-virtual, non-reversed real trades only (WIN/LOSS).';

GRANT SELECT ON public.ai_signals_calibration_raw TO authenticated, service_role;
GRANT SELECT ON public.ai_signals_calibration_bins_daily TO authenticated, service_role;
GRANT SELECT ON public.ai_signals_calibration_weekly TO authenticated, service_role;