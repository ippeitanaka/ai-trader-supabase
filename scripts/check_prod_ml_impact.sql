-- Production ML impact check (run in Supabase Dashboard -> SQL Editor)
-- Goal: confirm ML is being used in decision making after enabling AI_TRADER_ML_MODE=on
-- Time window: last 6 hours (adjust as needed)

-- 1) Overall volume + ML usage rate
select
  count(*) as signals,
  sum(case when ml_pattern_used then 1 else 0 end) as ml_used,
  round(100.0 * avg(case when ml_pattern_used then 1 else 0 end), 1) as ml_used_pct,
  min(created_at) as first_signal,
  max(created_at) as last_signal
from public.ai_signals
where created_at >= now() - interval '6 hours';

-- 2) By symbol/timeframe: are we matching patterns?
select
  symbol,
  timeframe,
  count(*) as signals,
  sum(case when ml_pattern_used then 1 else 0 end) as ml_used,
  round(100.0 * avg(case when ml_pattern_used then 1 else 0 end), 1) as ml_used_pct
from public.ai_signals
where created_at >= now() - interval '6 hours'
group by symbol, timeframe
order by signals desc;

-- 3) Which patterns are being used most?
select
  coalesce(ml_pattern_name, '(no_name)') as pattern_name,
  ml_pattern_id,
  round(avg(coalesce(ml_pattern_confidence, 0)), 2) as avg_confidence,
  count(*) as uses
from public.ai_signals
where created_at >= now() - interval '6 hours'
  and ml_pattern_used = true
group by ml_pattern_name, ml_pattern_id
order by uses desc
limit 20;

-- 4) Optional: outcomes for recent completed trades (will lag until trades close)
select
  symbol,
  timeframe,
  ml_pattern_used,
  count(*) as trades,
  round(100.0 * avg(case when actual_result = 'WIN' then 1 else 0 end), 1) as win_rate_pct
from public.ai_signals
where closed_at is not null
  and actual_result in ('WIN','LOSS')
  and created_at >= now() - interval '72 hours'
group by symbol, timeframe, ml_pattern_used
order by trades desc;
