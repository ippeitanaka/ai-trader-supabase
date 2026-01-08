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

-- 1.1) Are the repeated values just rounding? (ea-log, today)
-- Compare raw win_prob (more precision) vs rounded.
select
  e.created_at,
  e.sym,
  e.tf,
  e.trade_decision,
  e.win_prob as win_prob_raw,
  round((e.win_prob * 100.0)::numeric, 3) as win_prob_pct_3dp,
  round((e.win_prob * 100.0)::numeric, 1) as win_prob_pct_1dp,
  e.buy_win_prob as buy_win_prob_raw,
  e.sell_win_prob as sell_win_prob_raw,
  left(coalesce(e.ai_reasoning, ''), 120) as reasoning_prefix
from "ea-log" e
where e.created_at >= date_trunc('day', now())
order by e.created_at desc
limit 200;

-- 1.2) Distribution of win_prob (ea-log, today)
-- If you see only a few buckets AND many rows mention QuadFusion/Fallback,
-- OpenAI may not be used and the rule-based engine produces clustered probabilities.
select
  round((e.win_prob * 100.0)::numeric, 1) as win_prob_pct_1dp,
  count(*) as events,
  count(*) filter (where e.ai_reasoning ilike '%QuadFusion%') as quadfusion_mentions,
  count(*) filter (where e.ai_reasoning ilike '%[Fallback]%' or e.ai_reasoning ilike '%fallback%') as fallback_mentions,
  max(e.created_at) as last_seen
from "ea-log" e
where e.created_at >= date_trunc('day', now())
group by 1
order by events desc, 1 desc;

-- 1.3) Quantization check: distinct win_prob per symbol/TF (ea-log, today)
-- If distinct_count is very small (e.g., <=3) for many symbols/TFs, the model is effectively bucketizing.
select
  e.sym as symbol,
  coalesce(e.tf, 'unknown') as timeframe,
  count(*) as events,
  count(distinct e.win_prob) as distinct_win_prob_raw,
  count(distinct round((e.win_prob * 100.0)::numeric, 1)) as distinct_win_prob_pct_1dp,
  min(e.win_prob) as min_win_prob_raw,
  max(e.win_prob) as max_win_prob_raw,
  max(e.created_at) as last_seen
from "ea-log" e
where e.created_at >= date_trunc('day', now())
group by 1, 2
having count(*) >= 10
order by distinct_win_prob_raw asc, events desc;

-- 2) AI signals (ai_signals): last 2 hours
-- Notes:
-- - For real trades, order_ticket should be present when actual_result='FILLED'.
-- - For virtual (paper/shadow) trades, order_ticket may be NULL by design.
select
  created_at,
  symbol,
  timeframe,
  dir,
  round((win_prob * 100.0)::numeric, 1) as win_prob_pct,
  is_virtual,
  actual_result,
  order_ticket,
  instance,
  model_version
from ai_signals
where created_at >= now() - interval '2 hours'
order by created_at desc
limit 200;

-- 2.2) ai_signals method source & win_prob clustering (today)
-- If method_selected_by='Fallback' dominates, repeated win_prob values are expected.
select
  coalesce(method_selected_by, 'unknown') as method_selected_by,
  round((win_prob * 100.0)::numeric, 1) as win_prob_pct_1dp,
  count(*) as signals,
  count(*) filter (where coalesce(is_virtual, false) = false) as real_like,
  count(*) filter (where coalesce(is_virtual, false) = true) as virtual_like,
  max(created_at) as last_seen
from ai_signals
where created_at >= date_trunc('day', now())
group by 1, 2
order by signals desc, 1, 2 desc;

-- 2.3) Quantization check: distinct win_prob per symbol/TF (ai_signals, today)
select
  s.symbol,
  coalesce(s.timeframe, 'unknown') as timeframe,
  coalesce(s.method_selected_by, 'unknown') as method_selected_by,
  count(*) as signals,
  count(distinct s.win_prob) as distinct_win_prob_raw,
  count(distinct round((s.win_prob * 100.0)::numeric, 1)) as distinct_win_prob_pct_1dp,
  min(s.win_prob) as min_win_prob_raw,
  max(s.win_prob) as max_win_prob_raw,
  max(s.created_at) as last_seen
from ai_signals s
where s.created_at >= date_trunc('day', now())
group by 1, 2, 3
having count(*) >= 10
order by distinct_win_prob_raw asc, signals desc;

-- 2.1) Anomaly check: FILLED with NULL ticket on non-virtual rows (last 48 hours)
-- This should be 0 if the server-side guards are working.
select
  created_at,
  symbol,
  timeframe,
  is_virtual,
  actual_result,
  order_ticket,
  entry_price,
  left(coalesce(reason, ''), 120) as reason_prefix,
  instance,
  model_version
from ai_signals
where created_at >= now() - interval '48 hours'
  and coalesce(is_virtual, false) = false
  and actual_result = 'FILLED'
  and order_ticket is null
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
