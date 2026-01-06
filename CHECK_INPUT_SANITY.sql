-- Input sanity / blame split (EA inputs vs AI decision)
-- Run in Supabase SQL Editor.
-- Focus: real trades (order_ticket IS NOT NULL) over last 7 days.

-- 0) What created these signals?
select
  symbol,
  coalesce(method_selected_by,'unknown') as method_selected_by,
  coalesce(entry_method,'unknown') as entry_method,
  count(*) as trades,
  round(avg(win_prob)::numeric, 4) as avg_win_prob,
  round((count(*) filter (where actual_result='WIN')::numeric / nullif(count(*),0))*100, 2) as winrate_pct,
  round(sum(profit_loss)::numeric, 2) as pnl
from ai_signals
where created_at >= now() - interval '7 days'
  and actual_result in ('WIN','LOSS')
  and order_ticket is not null
group by symbol, coalesce(method_selected_by,'unknown'), coalesce(entry_method,'unknown')
order by pnl asc;

-- 0.5) Are we skipping due to bad EA inputs? (last 7 days)
-- After the ai-trader input-sanity guard, you should see these instead of executions.
select
  sym as symbol,
  count(*) as events,
  count(*) filter (where method_reason ilike '%GUARD: bad_inputs%') as bad_inputs_skips,
  round((count(*) filter (where method_reason ilike '%GUARD: bad_inputs%')::numeric / nullif(count(*),0))*100, 2) as bad_inputs_pct,
  max(created_at) as last_seen
from "ea-log"
where created_at >= now() - interval '7 days'
group by 1
order by bad_inputs_skips desc, 1;

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
from ai_signals
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
from ai_signals
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
from ai_signals
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
from ai_signals
where created_at >= now() - interval '7 days'
  and symbol='XAUUSD'
  and actual_result in ('WIN','LOSS')
  and order_ticket is not null
order by profit_loss asc
limit 30;
