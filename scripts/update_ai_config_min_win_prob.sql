-- Update ai_config.min_win_prob for an instance
--
-- Use case:
-- - Align server-side gating with the EA's MinWinProb setting.
-- - If the EA forgets to send min_win_prob, ai-trader falls back to ai_config.min_win_prob.
--
-- Run (local Supabase):
--   psql -X -P pager=off "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
--     -v instance='main' -v min_win_prob='0.60' \
--     -f scripts/update_ai_config_min_win_prob.sql
--
-- Run (Supabase Dashboard SQL editor):
--   Replace the psql variables with literals, e.g.
--     instance := 'main'
--     min_win_prob := 0.60

\if :{?instance}
\else
\set instance 'main'
\endif

\if :{?min_win_prob}
\else
\set min_win_prob '0.60'
\endif

-- 1) Ensure row exists
INSERT INTO public.ai_config (instance)
SELECT :'instance'::text
WHERE NOT EXISTS (
  SELECT 1 FROM public.ai_config WHERE instance = :'instance'::text
);

-- 2) Update value
UPDATE public.ai_config
SET
  min_win_prob = :'min_win_prob'::double precision,
  updated_at = NOW()
WHERE instance = :'instance'::text;

-- 3) Show result
SELECT instance, min_win_prob, reward_rr, risk_atr_mult, updated_at
FROM public.ai_config
WHERE instance = :'instance'::text;
