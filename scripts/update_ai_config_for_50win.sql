-- Update ai_config for "win-rate >= 50% is OK + increase opportunities" baseline
--
-- Assumptions:
-- - You want more executions while keeping a disciplined (calibrated) win_prob gate.
-- - Use with server-side calibration ON and AI_TRADER_CALIBRATION_REQUIRED=on.
--
-- Run (local):
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v instance='main' -f scripts/update_ai_config_for_50win.sql

\if :{?instance}
\else
\set instance 'main'
\endif

-- 1) Ensure row exists
INSERT INTO public.ai_config (instance)
SELECT :'instance'::text
WHERE NOT EXISTS (
  SELECT 1 FROM public.ai_config WHERE instance = :'instance'::text
);

-- 2) Set baseline params
UPDATE public.ai_config
SET
  min_win_prob = 0.50,
  reward_rr = COALESCE(reward_rr, 1.50),
  risk_atr_mult = COALESCE(risk_atr_mult, 2.00),
  updated_at = NOW()
WHERE instance = :'instance'::text;

-- 3) Show result
SELECT instance, min_win_prob, reward_rr, risk_atr_mult, updated_at
FROM public.ai_config
WHERE instance = :'instance'::text;
