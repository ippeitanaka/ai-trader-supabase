-- strict pattern flow check
-- Use after the next M15 signal to confirm:
-- 1. ai_signals receives strict flags
-- 2. strict pattern rows exist in ml_patterns

-- 0) Recent ea-log entries (first cut: did the EA make a decision at all?)
SELECT
  created_at,
  at,
  sym,
  tf,
  action,
  trade_decision,
  win_prob,
  order_ticket,
  ai_reasoning
FROM public."ea-log"
WHERE created_at >= now() - interval '12 hours'
ORDER BY created_at DESC
LIMIT 30;

-- 1) Latest signals with strict columns
SELECT
  id,
  created_at,
  symbol,
  timeframe,
  dir,
  actual_result,
  bull_engulfing,
  bear_engulfing,
  inside_bar,
  inside_break_dir,
  strict_macd_rsi_setup,
  strict_ma_rsi_setup,
  strict_ichimoku_tk_rsi_setup,
  strict_cloud_macd_setup,
  strict_engulfing_setup,
  strict_inside_breakout_setup,
  ml_pattern_used,
  ml_pattern_name,
  ml_pattern_confidence
FROM public.ai_signals
WHERE created_at >= now() - interval '12 hours'
ORDER BY created_at DESC
LIMIT 20;

-- 2) Recent strict flag hit counts
SELECT
  COUNT(*) AS total_recent_signals,
  COALESCE(SUM(CASE WHEN strict_macd_rsi_setup THEN 1 ELSE 0 END), 0) AS strict_macd_rsi_hits,
  COALESCE(SUM(CASE WHEN strict_ma_rsi_setup THEN 1 ELSE 0 END), 0) AS strict_ma_rsi_hits,
  COALESCE(SUM(CASE WHEN strict_ichimoku_tk_rsi_setup THEN 1 ELSE 0 END), 0) AS strict_ichimoku_tk_rsi_hits,
  COALESCE(SUM(CASE WHEN strict_cloud_macd_setup THEN 1 ELSE 0 END), 0) AS strict_cloud_macd_hits,
  COALESCE(SUM(CASE WHEN strict_engulfing_setup THEN 1 ELSE 0 END), 0) AS strict_engulfing_hits,
  COALESCE(SUM(CASE WHEN strict_inside_breakout_setup THEN 1 ELSE 0 END), 0) AS strict_inside_breakout_hits
FROM public.ai_signals
WHERE created_at >= now() - interval '12 hours';

-- 3) Rows where at least one strict setup fired
SELECT
  id,
  created_at,
  symbol,
  timeframe,
  dir,
  rsi,
  ma_cross,
  macd_cross,
  ichimoku_tk_cross,
  ichimoku_cloud_color,
  ichimoku_price_vs_cloud,
  strict_macd_rsi_setup,
  strict_ma_rsi_setup,
  strict_ichimoku_tk_rsi_setup,
  strict_cloud_macd_setup,
  strict_engulfing_setup,
  strict_inside_breakout_setup
FROM public.ai_signals
WHERE created_at >= now() - interval '12 hours'
  AND (
    strict_macd_rsi_setup
    OR strict_ma_rsi_setup
    OR strict_ichimoku_tk_rsi_setup
    OR strict_cloud_macd_setup
    OR strict_engulfing_setup
    OR strict_inside_breakout_setup
  )
ORDER BY created_at DESC
LIMIT 20;

-- 4) Learned strict patterns
SELECT
  id,
  updated_at,
  pattern_name,
  pattern_type,
  symbol,
  timeframe,
  direction,
  real_trades,
  total_trades,
  win_rate,
  profit_factor,
  confidence_score,
  adx_bucket,
  bb_width_bucket,
  atr_norm_bucket,
  is_active
FROM public.ml_patterns
WHERE pattern_type IN (
  'strict_macd_rsi',
  'strict_ma_rsi',
  'strict_ichimoku_tk_rsi',
  'strict_cloud_macd',
  'strict_engulfing',
  'strict_inside_breakout'
)
ORDER BY updated_at DESC, confidence_score DESC
LIMIT 50;

-- 5) Strict ML usage in recent signals
SELECT
  id,
  created_at,
  symbol,
  timeframe,
  dir,
  ml_pattern_used,
  ml_pattern_name,
  ml_pattern_confidence
FROM public.ai_signals
WHERE created_at >= now() - interval '24 hours'
  AND ml_pattern_used = true
  AND ml_pattern_name ~ 'STRICT_'
ORDER BY created_at DESC
LIMIT 20;

-- 6) Strict setup rows with execution details
SELECT
  id,
  created_at,
  symbol,
  timeframe,
  dir,
  is_virtual,
  actual_result,
  order_ticket,
  planned_entry_price,
  entry_price,
  exit_price,
  profit_loss,
  virtual_filled_at,
  reason,
  strict_macd_rsi_setup,
  strict_ma_rsi_setup,
  strict_ichimoku_tk_rsi_setup,
  strict_cloud_macd_setup,
  strict_engulfing_setup,
  strict_inside_breakout_setup,
  ml_pattern_used,
  ml_pattern_name,
  ml_pattern_confidence
FROM public.ai_signals
WHERE created_at >= now() - interval '24 hours'
  AND (
    strict_macd_rsi_setup
    OR strict_ma_rsi_setup
    OR strict_ichimoku_tk_rsi_setup
    OR strict_cloud_macd_setup
    OR strict_engulfing_setup
    OR strict_inside_breakout_setup
  )
ORDER BY created_at DESC
LIMIT 30;

-- 7) Nearest ea-log row for each recent strict signal
-- Useful when order_ticket is absent in ea-log or when you want the closest decision log.
SELECT
  s.id AS signal_id,
  s.created_at AS signal_created_at,
  s.symbol,
  s.timeframe,
  s.dir,
  s.is_virtual,
  s.actual_result,
  s.order_ticket AS signal_order_ticket,
  s.planned_entry_price,
  s.entry_price,
  s.virtual_filled_at,
  s.strict_engulfing_setup,
  s.strict_inside_breakout_setup,
  s.ml_pattern_used,
  s.ml_pattern_name,
  e.created_at AS ea_log_created_at,
  e.action AS ea_action,
  e.trade_decision,
  e.win_prob AS ea_win_prob,
  e.order_ticket AS ea_order_ticket,
  e.ai_reasoning,
  ABS(EXTRACT(EPOCH FROM (e.created_at - s.created_at))) AS seconds_diff
FROM public.ai_signals s
LEFT JOIN LATERAL (
  SELECT
    l.created_at,
    l.action,
    l.trade_decision,
    l.win_prob,
    l.order_ticket,
    l.ai_reasoning
  FROM public."ea-log" l
  WHERE l.sym = s.symbol
    AND l.tf = s.timeframe
    AND l.created_at BETWEEN s.created_at - interval '3 minutes' AND s.created_at + interval '3 minutes'
  ORDER BY ABS(EXTRACT(EPOCH FROM (l.created_at - s.created_at))) ASC,
           l.created_at DESC
  LIMIT 1
) e ON true
WHERE s.created_at >= now() - interval '24 hours'
  AND (
    s.strict_macd_rsi_setup
    OR s.strict_ma_rsi_setup
    OR s.strict_ichimoku_tk_rsi_setup
    OR s.strict_cloud_macd_setup
    OR s.strict_engulfing_setup
    OR s.strict_inside_breakout_setup
  )
ORDER BY s.created_at DESC
LIMIT 30;

-- 8) Direct order_ticket match between ai_signals and ea-log
-- This is the strongest linkage when both sides have the same ticket recorded.
SELECT
  s.id AS signal_id,
  s.created_at AS signal_created_at,
  s.symbol,
  s.timeframe,
  s.dir,
  s.is_virtual,
  s.actual_result,
  s.order_ticket,
  s.planned_entry_price,
  s.entry_price,
  s.profit_loss,
  s.virtual_filled_at,
  s.strict_engulfing_setup,
  s.strict_inside_breakout_setup,
  e.created_at AS ea_log_created_at,
  e.action AS ea_action,
  e.trade_decision,
  e.win_prob AS ea_win_prob,
  e.ai_reasoning
FROM public.ai_signals s
LEFT JOIN public."ea-log" e
  ON e.order_ticket IS NOT NULL
 AND s.order_ticket IS NOT NULL
 AND e.order_ticket::text = s.order_ticket::text
WHERE s.created_at >= now() - interval '7 days'
  AND s.order_ticket IS NOT NULL
ORDER BY s.created_at DESC
LIMIT 30;

-- 9) Virtual strict signals where FILLED was set but entry_price is still null
-- These rows indicate the virtual fill update may have partially applied.
SELECT
  id,
  created_at,
  symbol,
  timeframe,
  dir,
  is_virtual,
  actual_result,
  planned_entry_price,
  entry_price,
  virtual_filled_at,
  profit_loss,
  reason,
  strict_macd_rsi_setup,
  strict_ma_rsi_setup,
  strict_ichimoku_tk_rsi_setup,
  strict_cloud_macd_setup,
  strict_engulfing_setup,
  strict_inside_breakout_setup
FROM public.ai_signals
WHERE created_at >= now() - interval '7 days'
  AND is_virtual = true
  AND actual_result = 'FILLED'
  AND entry_price IS NULL
ORDER BY created_at DESC
LIMIT 30;

-- 10) Preview backfill values for virtual FILLED rows missing entry_price
SELECT
  id,
  created_at,
  symbol,
  timeframe,
  dir,
  planned_entry_price,
  entry_price,
  virtual_filled_at,
  actual_result,
  reason
FROM public.ai_signals
WHERE created_at >= now() - interval '30 days'
  AND is_virtual = true
  AND actual_result = 'FILLED'
  AND entry_price IS NULL
  AND planned_entry_price IS NOT NULL
ORDER BY created_at DESC
LIMIT 100;

-- 11) One-time repair for historical virtual FILLED rows
-- Review 10) first, then run this UPDATE manually if the preview looks correct.
-- UPDATE public.ai_signals
-- SET entry_price = planned_entry_price
-- WHERE created_at >= now() - interval '30 days'
--   AND is_virtual = true
--   AND actual_result = 'FILLED'
--   AND entry_price IS NULL
--   AND planned_entry_price IS NOT NULL;

-- 11b) Executable repair with RETURNING
-- Run this exact statement to confirm the UPDATE actually touched rows.
WITH repaired AS (
  UPDATE public.ai_signals
  SET entry_price = planned_entry_price
  WHERE created_at >= now() - interval '30 days'
    AND is_virtual = true
    AND actual_result = 'FILLED'
    AND entry_price IS NULL
    AND planned_entry_price IS NOT NULL
  RETURNING
    id,
    created_at,
    symbol,
    timeframe,
    dir,
    planned_entry_price,
    entry_price,
    virtual_filled_at,
    actual_result,
    reason
)
SELECT *
FROM repaired
ORDER BY created_at DESC;

-- 11c) Repair count only
WITH repaired AS (
  UPDATE public.ai_signals
  SET entry_price = planned_entry_price
  WHERE created_at >= now() - interval '30 days'
    AND is_virtual = true
    AND actual_result = 'FILLED'
    AND entry_price IS NULL
    AND planned_entry_price IS NOT NULL
  RETURNING id
)
SELECT COUNT(*) AS repaired_rows
FROM repaired;

-- 12) Post-fix verification window
-- Adjust deployed_at_utc to the ai-signals redeploy time, then confirm new rows after the fix.
WITH params AS (
  SELECT TIMESTAMPTZ '2026-04-19 13:00:00+00' AS deployed_at_utc
)
SELECT
  s.id,
  s.created_at,
  s.symbol,
  s.timeframe,
  s.dir,
  s.is_virtual,
  s.actual_result,
  s.order_ticket,
  s.planned_entry_price,
  s.entry_price,
  s.virtual_filled_at,
  s.reason,
  s.strict_engulfing_setup,
  s.strict_inside_breakout_setup,
  s.ml_pattern_used,
  s.ml_pattern_name
FROM public.ai_signals s
CROSS JOIN params p
WHERE s.created_at >= p.deployed_at_utc
ORDER BY s.created_at DESC
LIMIT 50;

-- 12b) Post-fix row count only
WITH params AS (
  SELECT TIMESTAMPTZ '2026-04-19 13:00:00+00' AS deployed_at_utc
)
SELECT COUNT(*) AS rows_since_fix
FROM public.ai_signals s
CROSS JOIN params p
WHERE s.created_at >= p.deployed_at_utc;

-- 13) Post-fix virtual FILLED rows still missing entry_price
WITH params AS (
  SELECT TIMESTAMPTZ '2026-04-19 13:00:00+00' AS deployed_at_utc
)
SELECT
  s.id,
  s.created_at,
  s.symbol,
  s.timeframe,
  s.dir,
  s.planned_entry_price,
  s.entry_price,
  s.virtual_filled_at,
  s.actual_result,
  s.reason
FROM public.ai_signals s
CROSS JOIN params p
WHERE s.created_at >= p.deployed_at_utc
  AND s.is_virtual = true
  AND s.actual_result = 'FILLED'
  AND s.entry_price IS NULL
ORDER BY s.created_at DESC
LIMIT 50;

-- 13b) Post-fix missing-entry count only
WITH params AS (
  SELECT TIMESTAMPTZ '2026-04-19 13:00:00+00' AS deployed_at_utc
)
SELECT COUNT(*) AS missing_entry_rows_since_fix
FROM public.ai_signals s
CROSS JOIN params p
WHERE s.created_at >= p.deployed_at_utc
  AND s.is_virtual = true
  AND s.actual_result = 'FILLED'
  AND s.entry_price IS NULL;

-- 14) Rolling recent ai_signals count (avoids hardcoded deploy timestamp issues)
SELECT
  COUNT(*) AS ai_signals_last_2h,
  MAX(created_at) AS latest_ai_signal_at
FROM public.ai_signals
WHERE created_at >= now() - interval '2 hours';

-- 15) Rolling recent ea-log count and latest timestamp
SELECT
  COUNT(*) AS ea_log_last_2h,
  MAX(created_at) AS latest_ea_log_at
FROM public."ea-log"
WHERE created_at >= now() - interval '2 hours';

-- 16) Latest ea-log rows in the last 2 hours
SELECT
  created_at,
  at,
  sym,
  tf,
  action,
  trade_decision,
  win_prob,
  order_ticket,
  ai_reasoning
FROM public."ea-log"
WHERE created_at >= now() - interval '2 hours'
ORDER BY created_at DESC
LIMIT 20;



