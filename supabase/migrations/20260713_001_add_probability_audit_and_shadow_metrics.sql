-- Separate model probability, calibrated probability, and final execution probability.
-- This prevents the calibrator from learning from its own previous output and
-- gives operators enough information to audit every decision.

ALTER TABLE public.ai_signals
  ADD COLUMN IF NOT EXISTS win_prob_raw double precision,
  ADD COLUMN IF NOT EXISTS win_prob_calibrated double precision,
  ADD COLUMN IF NOT EXISTS win_prob_final double precision,
  ADD COLUMN IF NOT EXISTS calibration_applied boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS calibration_version text,
  ADD COLUMN IF NOT EXISTS calibration_method text,
  ADD COLUMN IF NOT EXISTS calibration_scope text,
  ADD COLUMN IF NOT EXISTS calibration_sample_size integer,
  ADD COLUMN IF NOT EXISTS calibration_bin_sample_size integer,
  ADD COLUMN IF NOT EXISTS calibration_shift double precision,
  ADD COLUMN IF NOT EXISTS probability_adjustments jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS h1_shadow_checked boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS h1_shadow_would_block boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS h1_shadow_reason text,
  ADD COLUMN IF NOT EXISTS plan_base_min_win_prob double precision,
  ADD COLUMN IF NOT EXISTS plan_gate_adjustment double precision NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS plan_effective_min_win_prob double precision,
  ADD COLUMN IF NOT EXISTS plan_gate_mode text,
  ADD COLUMN IF NOT EXISTS shadow_reason text,
  ADD COLUMN IF NOT EXISTS gate_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS mfe_r double precision,
  ADD COLUMN IF NOT EXISTS mae_r double precision;

ALTER TABLE public."ea-log"
  ADD COLUMN IF NOT EXISTS win_prob_raw double precision,
  ADD COLUMN IF NOT EXISTS win_prob_calibrated double precision,
  ADD COLUMN IF NOT EXISTS win_prob_final double precision,
  ADD COLUMN IF NOT EXISTS calibration_applied boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS calibration_version text,
  ADD COLUMN IF NOT EXISTS calibration_method text,
  ADD COLUMN IF NOT EXISTS calibration_scope text,
  ADD COLUMN IF NOT EXISTS calibration_sample_size integer,
  ADD COLUMN IF NOT EXISTS calibration_shift double precision,
  ADD COLUMN IF NOT EXISTS probability_adjustments jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS h1_shadow_checked boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS h1_shadow_would_block boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS h1_shadow_reason text,
  ADD COLUMN IF NOT EXISTS plan_base_min_win_prob double precision,
  ADD COLUMN IF NOT EXISTS plan_gate_adjustment double precision NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS plan_effective_min_win_prob double precision,
  ADD COLUMN IF NOT EXISTS plan_gate_mode text;

CREATE INDEX IF NOT EXISTS idx_ai_signals_raw_calibration_training
  ON public.ai_signals (created_at DESC, symbol, timeframe, dir)
  WHERE win_prob_raw IS NOT NULL
    AND actual_result IN ('WIN', 'LOSS')
    AND reverse_execution = false;

CREATE INDEX IF NOT EXISTS idx_ai_signals_shadow_outcomes
  ON public.ai_signals (created_at DESC, actual_result)
  WHERE is_virtual = true;

CREATE INDEX IF NOT EXISTS idx_ai_signals_h1_shadow_audit
  ON public.ai_signals (created_at DESC, h1_shadow_would_block, actual_result)
  WHERE h1_shadow_checked = true;

COMMENT ON COLUMN public.ai_signals.win_prob_raw IS
  'Uncalibrated model probability. This is the only probability eligible for calibration training.';
COMMENT ON COLUMN public.ai_signals.win_prob_calibrated IS
  'Probability after statistical calibration but before strategy and performance adjustments.';
COMMENT ON COLUMN public.ai_signals.win_prob_final IS
  'Final probability used by execution gates. Legacy win_prob remains an alias of this value.';
COMMENT ON COLUMN public.ai_signals.probability_adjustments IS
  'Versioned audit details for calibration and post-calibration probability adjustments.';
COMMENT ON COLUMN public.ai_signals.h1_shadow_would_block IS
  'True when the retired H1 soft precheck would have blocked this candidate; execution is not blocked in shadow mode.';
COMMENT ON COLUMN public.ai_signals.plan_gate_adjustment IS
  'Dashboard safety-only gate increase added to the AI daily-plan probability gate.';
COMMENT ON COLUMN public.ai_signals.shadow_reason IS
  'Decision code that caused this candidate to be tracked without real execution.';
COMMENT ON COLUMN public.ai_signals.mfe_r IS
  'Maximum favorable excursion in planned risk multiples for a shadow trade.';
COMMENT ON COLUMN public.ai_signals.mae_r IS
  'Maximum adverse excursion in planned risk multiples for a shadow trade.';

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
  s.win_prob_raw,
  s.win_prob_raw AS win_prob,
  s.win_prob_calibrated,
  COALESCE(s.win_prob_final, s.win_prob) AS win_prob_final,
  (FLOOR(s.win_prob_raw * 20.0) / 20.0) AS win_prob_bin_0_05,
  s.actual_result,
  s.profit_loss,
  s.entry_price,
  s.exit_price,
  s.closed_at,
  s.hold_duration_minutes,
  COALESCE(s.is_virtual, false) AS is_virtual,
  COALESCE(s.reverse_execution, false) AS reverse_execution,
  s.original_dir,
  s.regime,
  s.strategy,
  s.regime_confidence,
  s.calibration_method,
  s.calibration_version,
  s.calibration_scope,
  s.calibration_sample_size,
  s.h1_shadow_checked,
  s.h1_shadow_would_block,
  s.h1_shadow_reason,
  s.plan_base_min_win_prob,
  s.plan_gate_adjustment,
  s.plan_effective_min_win_prob,
  s.plan_gate_mode,
  s.shadow_reason,
  s.mfe_r,
  s.mae_r,
  CASE WHEN s.actual_result = 'WIN' THEN 1 WHEN s.actual_result = 'LOSS' THEN 0 ELSE NULL END AS realized_win,
  CASE
    WHEN s.actual_result IN ('WIN', 'LOSS') AND s.win_prob_raw IS NOT NULL THEN
      POWER(s.win_prob_raw - CASE WHEN s.actual_result = 'WIN' THEN 1 ELSE 0 END, 2)
    ELSE NULL
  END AS brier_score_raw,
  CASE
    WHEN s.actual_result IN ('WIN', 'LOSS') AND s.win_prob_raw IS NOT NULL THEN
      POWER(s.win_prob_raw - CASE WHEN s.actual_result = 'WIN' THEN 1 ELSE 0 END, 2)
    ELSE NULL
  END AS brier_score,
  CASE
    WHEN s.actual_result IN ('WIN', 'LOSS') AND s.win_prob_calibrated IS NOT NULL THEN
      POWER(s.win_prob_calibrated - CASE WHEN s.actual_result = 'WIN' THEN 1 ELSE 0 END, 2)
    ELSE NULL
  END AS brier_score_calibrated
FROM public.ai_signals s
WHERE s.win_prob_raw IS NOT NULL;

CREATE OR REPLACE VIEW public.ai_signals_calibration_bins_daily AS
SELECT
  DATE_TRUNC('day', created_at)::date AS day,
  symbol,
  timeframe,
  dir,
  is_virtual,
  win_prob_bin_0_05,
  COUNT(*) AS n,
  AVG(win_prob_raw) AS avg_raw_win_prob,
  AVG(win_prob_raw) AS avg_pred_win_prob,
  AVG(win_prob_calibrated) AS avg_calibrated_win_prob,
  AVG(realized_win::double precision) AS realized_win_rate,
  AVG(brier_score_raw) AS avg_brier_score_raw,
  AVG(brier_score_raw) AS avg_brier_score,
  AVG(brier_score_calibrated) AS avg_brier_score_calibrated,
  AVG(profit_loss) AS avg_profit_loss,
  SUM(profit_loss) AS sum_profit_loss
FROM public.ai_signals_calibration_raw
WHERE reverse_execution = false AND realized_win IS NOT NULL
GROUP BY 1,2,3,4,5,6;

CREATE OR REPLACE VIEW public.ai_signals_calibration_weekly AS
SELECT
  DATE_TRUNC('week', created_at)::date AS week,
  symbol,
  timeframe,
  dir,
  is_virtual,
  COUNT(*) AS n,
  AVG(win_prob_raw) AS avg_raw_win_prob,
  AVG(win_prob_raw) AS avg_pred_win_prob,
  AVG(win_prob_calibrated) AS avg_calibrated_win_prob,
  AVG(realized_win::double precision) AS realized_win_rate,
  AVG(brier_score_raw) AS avg_brier_score_raw,
  AVG(brier_score_raw) AS avg_brier_score,
  AVG(brier_score_calibrated) AS avg_brier_score_calibrated,
  AVG(profit_loss) AS avg_profit_loss,
  SUM(profit_loss) AS sum_profit_loss
FROM public.ai_signals_calibration_raw
WHERE reverse_execution = false AND realized_win IS NOT NULL
GROUP BY 1,2,3,4,5;

GRANT SELECT ON public.ai_signals_calibration_raw TO authenticated, service_role;
GRANT SELECT ON public.ai_signals_calibration_bins_daily TO authenticated, service_role;
GRANT SELECT ON public.ai_signals_calibration_weekly TO authenticated, service_role;
