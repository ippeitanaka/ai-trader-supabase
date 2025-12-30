-- Live run verification (production)
-- Run these in Supabase SQL Editor (project: nebphrnnpmuqbkymwefs)

-- 1) EA decision logs (ea-log): last 2 hours
select
  created_at,
  at,
  sym,
  tf,
  action,
  tech_action,
  suggested_action,
  suggested_dir,
  trade_decision,
  round((win_prob * 100.0)::numeric, 1) as win_prob_pct,
  round((buy_win_prob * 100.0)::numeric, 1) as buy_win_prob_pct,
  round((sell_win_prob * 100.0)::numeric, 1) as sell_win_prob_pct,
  left(coalesce(ai_reasoning, ''), 120) as reasoning_prefix,
  order_ticket
from "ea-log"
where created_at >= now() - interval '2 hours'
order by created_at desc
limit 200;

-- 2) AI signals (ai_signals): last 2 hours
-- Notes:
-- - actual_result='FILLED' when entry happened
select
  created_at,
  symbol,
  timeframe,
  dir,
  round((win_prob * 100.0)::numeric, 1) as win_prob_pct,
  actual_result,
  order_ticket,
  instance,
  model_version
from ai_signals
where created_at >= now() - interval '2 hours'
order by created_at desc
limit 200;

-- 3) Quick summary by symbol (last 2 hours)
select
  symbol,
  count(*) as signals,
  sum(case when actual_result = 'FILLED' then 1 else 0 end) as filled,
  sum(case when actual_result = 'WIN' then 1 else 0 end) as wins,
  sum(case when actual_result = 'LOSS' then 1 else 0 end) as losses
from ai_signals
where created_at >= now() - interval '2 hours'
group by symbol
order by signals desc;
