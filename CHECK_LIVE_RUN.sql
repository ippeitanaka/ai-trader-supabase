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

-- 4) Status breakdown (last 2 hours)
-- Helps distinguish: "still open" vs "update missing"
select
  actual_result,
  count(*) as cnt,
  count(*) filter (where order_ticket is not null) as with_ticket,
  round((avg(win_prob) * 100.0)::numeric, 1) as avg_win_prob_pct
from ai_signals
where created_at >= now() - interval '2 hours'
group by actual_result
order by cnt desc;

-- 5) FILLED details (last 2 hours)
-- If FILLED rows never get closed_at/profit_loss, the EA update call may be failing.
select
  created_at,
  symbol,
  timeframe,
  dir,
  round((win_prob * 100.0)::numeric, 1) as win_prob_pct,
  actual_result,
  order_ticket,
  entry_price,
  closed_at,
  profit_loss,
  sl_hit,
  tp_hit,
  hold_duration_minutes,
  cancelled_reason
from ai_signals
where created_at >= now() - interval '2 hours'
  and actual_result = 'FILLED'
order by created_at desc
limit 200;

-- 6) Cross-check: ea-log EXECUTED vs ai_signals (ticket match)
-- If ea-log has tickets but ai_signals is missing the same tickets, ai-signals POST likely failed.
select
  e.created_at as ea_created_at,
  e.at as ea_at,
  e.sym,
  e.tf,
  e.action,
  e.trade_decision,
  e.win_prob as ea_win_prob,
  e.order_ticket,
  s.created_at as signal_created_at,
  s.actual_result,
  s.win_prob as signal_win_prob,
  s.closed_at
from "ea-log" e
left join ai_signals s
  on s.order_ticket = e.order_ticket
where e.created_at >= now() - interval '2 hours'
  and e.order_ticket is not null
order by e.created_at desc
limit 200;

-- 7) Potentially stuck updates (last 24 hours)
-- FILLED but still no close info after N minutes -> update path is suspicious.
-- Adjust the interval if your holding times are typically longer.
select
  created_at,
  symbol,
  timeframe,
  dir,
  order_ticket,
  actual_result,
  entry_price,
  closed_at,
  profit_loss,
  (now() - created_at) as age
from ai_signals
where created_at >= now() - interval '24 hours'
  and actual_result = 'FILLED'
  and closed_at is null
  and profit_loss is null
  and created_at < now() - interval '45 minutes'
order by created_at desc
limit 200;

-- 8) ea_log_monitor: NULL diagnostics (last 24 hours)
-- If you see NULLs in Supabase Studio for ea_log_monitor, this helps identify
-- whether it's expected (e.g., 注文番号 is NULL for non-executed rows) or unexpected.
select
  count(*) as total,
  count(*) filter (where "Tech方向" is null) as null_tech_action,
  count(*) filter (where "AI推奨" is null) as null_ai_suggest,
  count(*) filter (where "BUY勝率" is null) as null_buy_win_prob,
  count(*) filter (where "SELL勝率" is null) as null_sell_win_prob,
  count(*) filter (where "AI判断根拠" is null or btrim("AI判断根拠") = '') as null_ai_reasoning,
  count(*) filter (where "注文番号" is null) as null_order_ticket
from ea_log_monitor
where "記録日時" >= now() - interval '24 hours';

-- 9) ea_log_monitor: sample rows where columns are NULL (last 24 hours)
-- Adjust the WHERE to the column you care about.
select *
from ea_log_monitor
where "記録日時" >= now() - interval '24 hours'
  and (
    "AI推奨" is null
    or "BUY勝率" is null
    or "SELL勝率" is null
    or "AI判断根拠" is null
    or btrim("AI判断根拠") = ''
  )
order by "記録日時" desc
limit 200;
