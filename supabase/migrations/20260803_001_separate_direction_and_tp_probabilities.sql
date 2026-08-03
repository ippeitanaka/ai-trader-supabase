ALTER TABLE public.ai_signals
  ADD COLUMN IF NOT EXISTS direction_prob double precision,
  ADD COLUMN IF NOT EXISTS direction_prob_raw double precision,
  ADD COLUMN IF NOT EXISTS tp_before_sl_prob double precision,
  ADD COLUMN IF NOT EXISTS tp_before_sl_prob_raw double precision,
  ADD COLUMN IF NOT EXISTS tp_before_sl_prob_calibrated double precision,
  ADD COLUMN IF NOT EXISTS tp_before_sl_prob_final double precision,
  ADD COLUMN IF NOT EXISTS probability_target_version text,
  ADD COLUMN IF NOT EXISTS direction_horizon_minutes integer,
  ADD COLUMN IF NOT EXISTS planned_reward_rr double precision,
  ADD COLUMN IF NOT EXISTS planned_risk_atr_mult double precision,
  ADD COLUMN IF NOT EXISTS planned_cost_r double precision;

ALTER TABLE public."ea-log"
  ADD COLUMN IF NOT EXISTS direction_prob double precision,
  ADD COLUMN IF NOT EXISTS direction_prob_raw double precision,
  ADD COLUMN IF NOT EXISTS tp_before_sl_prob double precision,
  ADD COLUMN IF NOT EXISTS tp_before_sl_prob_raw double precision,
  ADD COLUMN IF NOT EXISTS tp_before_sl_prob_calibrated double precision,
  ADD COLUMN IF NOT EXISTS tp_before_sl_prob_final double precision,
  ADD COLUMN IF NOT EXISTS probability_target_version text,
  ADD COLUMN IF NOT EXISTS direction_horizon_minutes integer,
  ADD COLUMN IF NOT EXISTS planned_entry_price double precision,
  ADD COLUMN IF NOT EXISTS planned_sl double precision,
  ADD COLUMN IF NOT EXISTS planned_tp double precision,
  ADD COLUMN IF NOT EXISTS planned_reward_rr double precision,
  ADD COLUMN IF NOT EXISTS planned_risk_atr_mult double precision,
  ADD COLUMN IF NOT EXISTS planned_cost_r double precision;

UPDATE public.ai_signals
SET
  tp_before_sl_prob = COALESCE(tp_before_sl_prob, win_prob_final, win_prob),
  tp_before_sl_prob_raw = COALESCE(tp_before_sl_prob_raw, win_prob_raw, win_prob),
  tp_before_sl_prob_calibrated = COALESCE(tp_before_sl_prob_calibrated, win_prob_calibrated, win_prob),
  tp_before_sl_prob_final = COALESCE(tp_before_sl_prob_final, win_prob_final, win_prob),
  probability_target_version = COALESCE(probability_target_version, 'legacy_profit_v1')
WHERE win_prob IS NOT NULL;

UPDATE public."ea-log"
SET
  tp_before_sl_prob = COALESCE(tp_before_sl_prob, win_prob_final, win_prob),
  tp_before_sl_prob_raw = COALESCE(tp_before_sl_prob_raw, win_prob_raw, win_prob),
  tp_before_sl_prob_calibrated = COALESCE(tp_before_sl_prob_calibrated, win_prob_calibrated, win_prob),
  tp_before_sl_prob_final = COALESCE(tp_before_sl_prob_final, win_prob_final, win_prob),
  probability_target_version = COALESCE(probability_target_version, 'legacy_profit_v1')
WHERE win_prob IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ai_signals_probability_target_version
  ON public.ai_signals (probability_target_version, created_at DESC);

COMMENT ON COLUMN public.ai_signals.direction_prob IS
  'Probability that price is on the trade-direction side of entry after direction_horizon_minutes.';
COMMENT ON COLUMN public.ai_signals.tp_before_sl_prob IS
  'Execution probability that planned TP is reached before planned SL; win_prob is its legacy alias.';
COMMENT ON COLUMN public.ai_signals.probability_target_version IS
  'Definition/version of the probability targets used for this signal.';
