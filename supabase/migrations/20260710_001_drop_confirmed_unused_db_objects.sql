-- Drop only confirmed unused legacy objects.
-- Intentionally keep public.ai_config and analysis views used by calibration/audit workflows.
-- Do not use CASCADE; if a dependency exists, this migration must fail loudly.

drop view if exists public.ea_log_summary;
drop view if exists public.ai_signals_quality;
drop view if exists public.ai_signals_stats;
drop view if exists public.ai_signals_training_complete;
drop view if exists public.ml_active_patterns;
drop view if exists public.ml_latest_training;
drop view if exists public.ml_active_recommendations;

-- Safe as a no-op on production when absent; only removes a leftover temp table if it exists.
drop table if exists public."ea-log-new";