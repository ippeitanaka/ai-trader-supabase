-- Input sanity / blame split (EA inputs vs AI decision)
-- Run in Supabase SQL Editor.
-- Focus:
-- - Real trades: ai_signals rows with order_ticket IS NOT NULL and actual_result in ('WIN','LOSS')
-- - EA decision logs: public."ea-log"
-- Notes (important column names):
-- - ai_signals: reason (NOT reasoning)
-- - ea-log: ai_reasoning

-- 0) What created these signals?
select
  symbol,
  coalesce(method_selected_by,'unknown') as method_selected_by,
  coalesce(entry_method,'unknown') as entry_method,
  count(*) as trades,
  round(avg(win_prob)::numeric, 4) as avg_win_prob,
  round((count(*) filter (where actual_result='WIN')::numeric / nullif(count(*),0))*100, 2) as winrate_pct,
  round(sum(profit_loss)::numeric, 2) as pnl
from public.ai_signals
where created_at >= now() - interval '7 days'
  and actual_result in ('WIN','LOSS')
  and order_ticket is not null
group by symbol, coalesce(method_selected_by,'unknown'), coalesce(entry_method,'unknown')
order by pnl asc;

-- 0.5) Are we skipping due to bad EA inputs? (last 7 days)
-- After the ai-trader input-sanity guard, you should see these instead of executions.
select
  e.sym as symbol,
  count(*) as events,
  count(*) filter (where e.ai_reasoning ilike '%GUARD: bad_inputs%') as bad_inputs_skips,
  round(
    (count(*) filter (where e.ai_reasoning ilike '%GUARD: bad_inputs%')::numeric / nullif(count(*), 0)::numeric) * 100,
    2
  ) as bad_inputs_pct,
  max(e."at") as last_seen
from public."ea-log" e
where e."at" >= now() - interval '7 days'
group by 1
order by bad_inputs_skips desc, 1;

-- 0.6) Same as 0.5, but last 24 hours (quick verification after deploy/EA update)
select
  e.sym as symbol,
  coalesce(e.tf, 'unknown') as timeframe,
  count(*) as events,
  count(*) filter (where e.ai_reasoning ilike '%GUARD: bad_inputs%') as bad_inputs_skips,
  round(
    (count(*) filter (where e.ai_reasoning ilike '%GUARD: bad_inputs%')::numeric / nullif(count(*), 0)::numeric) * 100,
    2
  ) as bad_inputs_pct,
  max(e."at") as last_seen
from public."ea-log" e
where e."at" >= now() - interval '24 hours'
group by 1, 2
having count(*) >= 10
order by bad_inputs_skips desc, 1, 2;

-- 0.7) Inspect recent bad_inputs guard events (last 24 hours)
select
  e."at",
  e.sym as symbol,
  e.tf as timeframe,
  e.action,
  e.trade_decision,
  round((e.win_prob * 100)::numeric, 1) as win_prob_pct,
  left(coalesce(e.ai_reasoning, ''), 160) as ai_reasoning_prefix,
  e.order_ticket
from public."ea-log" e
where e."at" >= now() - interval '24 hours'
  and e.ai_reasoning ilike '%GUARD: bad_inputs%'
order by e."at" desc
limit 100;

-- 0.8) Is EA actively logging right now? (last 2 hours)
-- If this shows recent rows but 0.7 stops appearing, the new EA build is likely running correctly.
select
  e.sym as symbol,
  coalesce(e.tf, 'unknown') as timeframe,
  count(*) as events,
  count(*) filter (where e.ai_reasoning ilike '%GUARD: bad_inputs%') as bad_inputs_skips,
  max(e."at") as last_seen
from public."ea-log" e
where e."at" >= now() - interval '2 hours'
group by 1, 2
order by last_seen desc;

-- 1) EA input quality: obvious anomalies (XAUUSD, last 7 days)
-- If these counts are high, blame is more likely on EA-side indicator calculations / payload.
select
  count(*) as trades,
  count(*) filter (where rsi is null or rsi < 0 or rsi > 100) as bad_rsi,
  count(*) filter (where atr is null or atr <= 0) as bad_atr,
  count(*) filter (where atr_norm is null or atr_norm <= 0 or atr_norm > 0.05) as bad_atr_norm,
  count(*) filter (where adx is null or adx < 0 or adx > 100) as bad_adx,
  count(*) filter (where bb_width is null or bb_width <= 0 or bb_width > 0.2) as bad_bb_width,
  count(*) filter (where ema_25 is null or sma_100 is null) as missing_ma,
  count(*) filter (where bid is null or ask is null or bid <= 0 or ask <= 0 or ask < bid) as bad_bid_ask,
  count(*) filter (where macd_main is null or macd_signal is null or macd_histogram is null) as missing_macd,
  count(*) filter (where ichimoku_tenkan is null or ichimoku_kijun is null or ichimoku_senkou_a is null or ichimoku_senkou_b is null) as missing_ichimoku
from public.ai_signals
where created_at >= now() - interval '7 days'
  and symbol='XAUUSD'
  and actual_result in ('WIN','LOSS')
  and order_ticket is not null;

-- 2) EA input ranges (XAUUSD, last 7 days)
-- Values that are constantly 0 or wildly out of range indicate EA computation issues.
select
  round(min(rsi)::numeric, 3) as rsi_min,
  round(max(rsi)::numeric, 3) as rsi_max,
  round(min(atr)::numeric, 6) as atr_min,
  round(max(atr)::numeric, 6) as atr_max,
  round(min(atr_norm)::numeric, 8) as atr_norm_min,
  round(max(atr_norm)::numeric, 8) as atr_norm_max,
  round(min(adx)::numeric, 3) as adx_min,
  round(max(adx)::numeric, 3) as adx_max,
  round(min(bb_width)::numeric, 8) as bb_width_min,
  round(max(bb_width)::numeric, 8) as bb_width_max,
  round(min(ask-bid)::numeric, 6) as spread_min,
  round(max(ask-bid)::numeric, 6) as spread_max
from public.ai_signals
where created_at >= now() - interval '7 days'
  and symbol='XAUUSD'
  and actual_result in ('WIN','LOSS')
  and order_ticket is not null;

-- 3) Are we overconfident?
-- If win_prob is high but realized winrate is low, blame shifts toward AI calibration / regime shift.
select
  case
    when win_prob >= 0.80 then '80%以上'
    when win_prob >= 0.70 then '70-80%'
    when win_prob >= 0.60 then '60-70%'
    else '60%未満'
  end as bucket,
  count(*) as trades,
  round(avg(win_prob*100)::numeric, 2) as avg_pred_pct,
  round((count(*) filter (where actual_result='WIN')::numeric / nullif(count(*),0))*100, 2) as winrate_pct,
  round(sum(profit_loss)::numeric, 2) as pnl
from public.ai_signals
where created_at >= now() - interval '7 days'
  and symbol='XAUUSD'
  and actual_result in ('WIN','LOSS')
  and order_ticket is not null
group by 1
order by avg_pred_pct desc;

-- 4) Inspect the worst losers (XAUUSD, real trades)
select
  created_at,
  timeframe,
  dir,
  coalesce(entry_method,'unknown') as entry_method,
  coalesce(method_selected_by,'unknown') as method_selected_by,
  round((win_prob*100)::numeric, 1) as win_prob_pct,
  profit_loss,
  rsi,
  atr,
  atr_norm,
  adx,
  bb_width,
  (ask-bid) as spread,
  ma_cross,
  ichimoku_cloud_color,
  ichimoku_price_vs_cloud,
  left(coalesce(reason,''), 120) as reason_prefix,
  order_ticket
from public.ai_signals
where created_at >= now() - interval '7 days'
  and symbol='XAUUSD'
  and actual_result in ('WIN','LOSS')
  and order_ticket is not null
order by profit_loss asc
limit 30;

-- 4.1) Are NEW real trades still carrying bb_width<=0? (last 6 hours, all symbols)
-- This helps confirm whether an old EA build is still running somewhere.
select
  created_at,
  symbol,
  timeframe,
  order_ticket,
  bb_width,
  case
    when bb_width is null then 'NULL (missing)'
    when bb_width <= 0 then 'BAD (<=0)'
    else 'OK'
  end as bb_width_status,
  instance,
  model_version
from public.ai_signals
where created_at >= now() - interval '6 hours'
  and actual_result in ('WIN','LOSS')
  and order_ticket is not null
order by created_at desc
limit 50;

-- 4.2) bb_width recurrence check for REAL trades (last 48 hours, all symbols)
-- Expectation after EA/input guards: bb_bad_le0 should stay at 0.
select
  count(*) as trades,
  count(*) filter (where bb_width is null) as bb_null,
  count(*) filter (where bb_width is not null and bb_width <= 0) as bb_bad_le0,
  count(*) filter (where bb_width is not null and bb_width > 0) as bb_ok_pos,
  min(created_at) as oldest,
  max(created_at) as newest
from public.ai_signals
where created_at >= now() - interval '48 hours'
  and actual_result in ('WIN','LOSS')
  and order_ticket is not null;

-- 4.2b) Are there any recent executed trades not yet closed? (last 48 hours)
-- If you see FILLED here, it may simply mean positions are still open (so 4.2 shows 0).
select
  actual_result,
  count(*) as signals,
  max(created_at) as newest
from public.ai_signals
where created_at >= now() - interval '48 hours'
  and order_ticket is not null
group by actual_result
order by signals desc;

-- 4.3) Show rows if 4.2 finds any bb_width<=0 (last 7 days)
select
  created_at,
  symbol,
  timeframe,
  order_ticket,
  bb_width,
  instance,
  model_version,
  left(coalesce(reason, ''), 120) as reason_prefix
from public.ai_signals
where created_at >= now() - interval '7 days'
  and actual_result in ('WIN','LOSS')
  and order_ticket is not null
  and bb_width is not null
  and bb_width <= 0
order by created_at desc
limit 100;

-- 5) Confirm ML is not applied to real-trade decisions (log-only marker)
-- ai-trader attaches the marker to its explanation.
-- In this schema, ai_signals.reason is typically a short entry summary (often EA-side),
-- while ai_signals.method_reason (when present) is the ai-trader explanation.

-- 5.1) Marker count (last 7 days, real trades)
select
  count(*) as real_trades,
  count(*) filter (where method_reason ilike '%ML: log_only%') as with_ml_log_only_marker,
  max(created_at) as newest
from public.ai_signals
where created_at >= now() - interval '7 days'
  and actual_result in ('WIN','LOSS')
  and order_ticket is not null;

-- 5.2) Recent rows with the marker (last 48 hours, real trades)
-- Note: If there were no real trades in the last 48 hours, this query returns 0 rows.
-- Supabase SQL Editor will still show "success" in that case.
select
  created_at,
  symbol,
  timeframe,
  dir,
  round((win_prob * 100)::numeric, 1) as win_prob_pct,
  actual_result,
  order_ticket,
  instance,
  model_version,
  left(coalesce(method_reason, ''), 200) as method_reason_prefix
from public.ai_signals
where created_at >= now() - interval '48 hours'
  and actual_result in ('WIN','LOSS')
  and order_ticket is not null
  and method_reason ilike '%ML: log_only%'
order by created_at desc
limit 50;

-- 5.2b) Recent ticketed signals (any status) showing both reason fields (last 48 hours)
-- Use this to verify where explanations are stored: reason vs method_reason.
select
  created_at,
  symbol,
  timeframe,
  actual_result,
  order_ticket,
  left(coalesce(reason, ''), 120) as reason_prefix,
  left(coalesce(method_reason, ''), 200) as method_reason_prefix
from public.ai_signals
where created_at >= now() - interval '48 hours'
  and order_ticket is not null
order by created_at desc
limit 100;

-- 5.3) Verify ML log_only marker via ea-log (works even if no executions)
-- ea-log records every decision; ai_reasoning should include the marker.
select
  count(*) as events,
  count(*) filter (where e.ai_reasoning ilike '%ML: log_only%') as with_ml_log_only_marker,
  max(e."at") as last_seen
from public."ea-log" e
where e."at" >= now() - interval '48 hours';

-- 5.4) Sample recent ea-log rows that include the marker (last 48 hours)
select
  e."at",
  e.sym as symbol,
  e.tf as timeframe,
  e.action,
  e.trade_decision,
  round((e.win_prob * 100)::numeric, 1) as win_prob_pct,
  left(coalesce(e.ai_reasoning, ''), 200) as ai_reasoning_prefix
from public."ea-log" e
where e."at" >= now() - interval '48 hours'
  and e.ai_reasoning ilike '%ML: log_only%'
order by e."at" desc
limit 50;

-- 5.5) Correlate ai_signals <-> ea-log by order_ticket (last 48 hours)
-- Use this when ai_signals.method_reason does not contain the marker.
select
  s.created_at as signal_created_at,
  s.symbol,
  s.timeframe,
  s.actual_result,
  s.order_ticket,
  left(coalesce(s.reason, ''), 80) as signal_reason_prefix,
  left(coalesce(s.method_reason, ''), 120) as signal_method_reason_prefix,
  e."at" as ea_at,
  e.trade_decision as ea_trade_decision,
  left(coalesce(e.ai_reasoning, ''), 160) as ea_ai_reasoning_prefix
from public.ai_signals s
left join public."ea-log" e
  on e.order_ticket = s.order_ticket
where s.created_at >= now() - interval '48 hours'
  and s.order_ticket is not null
order by s.created_at desc
limit 100;

-- 5.6) Summary: among ticketed ai_signals (last 48h), how many have a matching ea-log row
-- and how many of those show ML log_only marker.
select
  count(*) as ticketed_signals,
  count(*) filter (where e.order_ticket is not null) as matched_ea_log,
  count(*) filter (where e.ai_reasoning ilike '%ML: log_only%') as matched_with_ml_log_only_marker,
  max(s.created_at) as newest_signal
from public.ai_signals s
left join public."ea-log" e
  on e.order_ticket = s.order_ticket
where s.created_at >= now() - interval '48 hours'
  and s.order_ticket is not null;
