-- Production ML impact check (run in Supabase Dashboard -> SQL Editor)
-- Goal: confirm ML is being used in decision making after enabling AI_TRADER_ML_MODE=on
-- Notes:
-- - This script defaults to EA real trades only (excludes manual + virtual/paper).
-- - Adjust lookback windows in the params CTE.

-- ─────────────────────────────────────────────────────────────
-- Params (edit here)
-- ─────────────────────────────────────────────────────────────
-- IMPORTANT (Postgres): WITH/CTE scope is per-statement.
-- This file repeats the same params/base CTE for each SELECT so you can run the whole file at once.

-- 0) Sanity: composition of recent signals (after filters)
WITH params AS (
  SELECT
    interval '6 hours'  AS lookback_signals,
    interval '72 hours' AS lookback_outcomes,
    false AS include_virtual,
    false AS include_manual
),
raw_signals AS (
  SELECT s.*
  FROM public.ai_signals s
  CROSS JOIN params p
  WHERE s.created_at >= now() - p.lookback_signals
),
base_signals AS (
  SELECT s.*
  FROM raw_signals s
  CROSS JOIN params p
  WHERE (p.include_virtual OR NOT COALESCE(s.is_virtual, false))
    AND (p.include_manual OR NOT COALESCE(s.is_manual_trade, false))
)
SELECT
  'raw' AS scope,
  count(*) AS signals,
  sum(CASE WHEN COALESCE(is_virtual, false) THEN 1 ELSE 0 END) AS virtual_signals,
  sum(CASE WHEN COALESCE(is_manual_trade, false) THEN 1 ELSE 0 END) AS manual_signals,
  min(created_at) AS first_signal,
  max(created_at) AS last_signal
FROM raw_signals
UNION ALL
SELECT
  'filtered' AS scope,
  count(*) AS signals,
  sum(CASE WHEN COALESCE(is_virtual, false) THEN 1 ELSE 0 END) AS virtual_signals,
  sum(CASE WHEN COALESCE(is_manual_trade, false) THEN 1 ELSE 0 END) AS manual_signals,
  min(created_at) AS first_signal,
  max(created_at) AS last_signal
FROM base_signals;

-- 1) Overall volume + ML usage rate + data integrity
WITH params AS (
  SELECT
    interval '6 hours'  AS lookback_signals,
    interval '72 hours' AS lookback_outcomes,
    false AS include_virtual,
    false AS include_manual
),
base_signals AS (
  SELECT s.*
  FROM public.ai_signals s
  CROSS JOIN params p
  WHERE s.created_at >= now() - p.lookback_signals
    AND (p.include_virtual OR NOT COALESCE(s.is_virtual, false))
    AND (p.include_manual OR NOT COALESCE(s.is_manual_trade, false))
)
SELECT
  count(*) AS signals,
  sum(CASE WHEN ml_pattern_used THEN 1 ELSE 0 END) AS ml_used,
  round(100.0 * avg(CASE WHEN ml_pattern_used THEN 1 ELSE 0 END), 1) AS ml_used_pct,
  sum(CASE WHEN ml_pattern_used AND ml_pattern_id IS NULL THEN 1 ELSE 0 END) AS ml_used_missing_id,
  sum(CASE WHEN ml_pattern_used AND (ml_pattern_name IS NULL OR ml_pattern_name = '') THEN 1 ELSE 0 END) AS ml_used_missing_name,
  sum(CASE WHEN ml_pattern_used AND ml_pattern_confidence IS NULL THEN 1 ELSE 0 END) AS ml_used_missing_confidence,
  sum(CASE WHEN NOT ml_pattern_used AND (ml_pattern_id IS NOT NULL OR ml_pattern_name IS NOT NULL OR ml_pattern_confidence IS NOT NULL) THEN 1 ELSE 0 END) AS ml_not_used_but_has_fields
FROM base_signals;

-- 2) By symbol/timeframe: are we matching patterns?
WITH params AS (
  SELECT
    interval '6 hours'  AS lookback_signals,
    interval '72 hours' AS lookback_outcomes,
    false AS include_virtual,
    false AS include_manual
),
base_signals AS (
  SELECT s.*
  FROM public.ai_signals s
  CROSS JOIN params p
  WHERE s.created_at >= now() - p.lookback_signals
    AND (p.include_virtual OR NOT COALESCE(s.is_virtual, false))
    AND (p.include_manual OR NOT COALESCE(s.is_manual_trade, false))
)
SELECT
  symbol,
  timeframe,
  count(*) AS signals,
  sum(CASE WHEN ml_pattern_used THEN 1 ELSE 0 END) AS ml_used,
  round(100.0 * avg(CASE WHEN ml_pattern_used THEN 1 ELSE 0 END), 1) AS ml_used_pct
FROM base_signals
GROUP BY symbol, timeframe
ORDER BY signals DESC;

-- 3) Which patterns are being used most?
WITH params AS (
  SELECT
    interval '6 hours'  AS lookback_signals,
    interval '72 hours' AS lookback_outcomes,
    false AS include_virtual,
    false AS include_manual
),
base_signals AS (
  SELECT s.*
  FROM public.ai_signals s
  CROSS JOIN params p
  WHERE s.created_at >= now() - p.lookback_signals
    AND (p.include_virtual OR NOT COALESCE(s.is_virtual, false))
    AND (p.include_manual OR NOT COALESCE(s.is_manual_trade, false))
)
SELECT
  COALESCE(NULLIF(ml_pattern_name, ''), '(no_name)') AS pattern_name,
  ml_pattern_id,
  round(avg(ml_pattern_confidence), 2) AS avg_confidence,
  min(ml_pattern_confidence) AS min_confidence,
  max(ml_pattern_confidence) AS max_confidence,
  count(*) AS uses
FROM base_signals
WHERE ml_pattern_used = true
GROUP BY ml_pattern_name, ml_pattern_id
ORDER BY uses DESC
LIMIT 20;

-- 3b) Confidence distribution (only where ML used)
WITH params AS (
  SELECT
    interval '6 hours'  AS lookback_signals,
    interval '72 hours' AS lookback_outcomes,
    false AS include_virtual,
    false AS include_manual
),
base_signals AS (
  SELECT s.*
  FROM public.ai_signals s
  CROSS JOIN params p
  WHERE s.created_at >= now() - p.lookback_signals
    AND (p.include_virtual OR NOT COALESCE(s.is_virtual, false))
    AND (p.include_manual OR NOT COALESCE(s.is_manual_trade, false))
)
SELECT
  CASE
    WHEN ml_pattern_confidence IS NULL THEN '(null)'
    WHEN ml_pattern_confidence < 50 THEN '<50'
    WHEN ml_pattern_confidence < 60 THEN '50-59.99'
    WHEN ml_pattern_confidence < 70 THEN '60-69.99'
    WHEN ml_pattern_confidence < 80 THEN '70-79.99'
    WHEN ml_pattern_confidence < 90 THEN '80-89.99'
    ELSE '90-100'
  END AS confidence_bucket,
  count(*) AS uses
FROM base_signals
WHERE ml_pattern_used = true
GROUP BY 1
ORDER BY
  CASE confidence_bucket
    WHEN '(null)' THEN 0
    WHEN '<50' THEN 1
    WHEN '50-59.99' THEN 2
    WHEN '60-69.99' THEN 3
    WHEN '70-79.99' THEN 4
    WHEN '80-89.99' THEN 5
    WHEN '90-100' THEN 6
    ELSE 99
  END;

-- 4) Outcomes summary: ML used vs not (completed trades)
WITH params AS (
  SELECT
    interval '6 hours'  AS lookback_signals,
    interval '72 hours' AS lookback_outcomes,
    false AS include_virtual,
    false AS include_manual
),
base_outcomes AS (
  SELECT s.*
  FROM public.ai_signals s
  CROSS JOIN params p
  WHERE s.closed_at IS NOT NULL
    AND s.closed_at >= now() - p.lookback_outcomes
    AND s.actual_result IN ('WIN', 'LOSS')
    AND (p.include_virtual OR NOT COALESCE(s.is_virtual, false))
    AND (p.include_manual OR NOT COALESCE(s.is_manual_trade, false))
)
SELECT
  ml_pattern_used,
  count(*) AS trades,
  round(100.0 * avg(CASE WHEN actual_result = 'WIN' THEN 1 ELSE 0 END), 1) AS win_rate_pct,
  round(avg(COALESCE(profit_loss, 0))::numeric, 2) AS avg_profit_loss,
  round(sum(COALESCE(profit_loss, 0))::numeric, 2) AS total_profit_loss,
  round(avg(COALESCE(hold_duration_minutes, 0))::numeric, 1) AS avg_hold_minutes
FROM base_outcomes
GROUP BY ml_pattern_used
ORDER BY trades DESC;

-- 4b) Outcomes by symbol/timeframe: ML vs No-ML comparison (side-by-side)
WITH params AS (
  SELECT
    interval '6 hours'  AS lookback_signals,
    interval '72 hours' AS lookback_outcomes,
    false AS include_virtual,
    false AS include_manual
),
base_outcomes AS (
  SELECT s.*
  FROM public.ai_signals s
  CROSS JOIN params p
  WHERE s.closed_at IS NOT NULL
    AND s.closed_at >= now() - p.lookback_outcomes
    AND s.actual_result IN ('WIN', 'LOSS')
    AND (p.include_virtual OR NOT COALESCE(s.is_virtual, false))
    AND (p.include_manual OR NOT COALESCE(s.is_manual_trade, false))
)
SELECT
  symbol,
  timeframe,
  count(*) AS trades,
  count(*) FILTER (WHERE ml_pattern_used) AS ml_trades,
  round(100.0 * avg(CASE WHEN actual_result = 'WIN' THEN 1 ELSE 0 END) FILTER (WHERE ml_pattern_used), 1) AS ml_win_rate_pct,
  round(100.0 * avg(CASE WHEN actual_result = 'WIN' THEN 1 ELSE 0 END) FILTER (WHERE NOT ml_pattern_used), 1) AS no_ml_win_rate_pct,
  round(avg(profit_loss)::numeric FILTER (WHERE ml_pattern_used), 2) AS ml_avg_profit_loss,
  round(avg(profit_loss)::numeric FILTER (WHERE NOT ml_pattern_used), 2) AS no_ml_avg_profit_loss
FROM base_outcomes
GROUP BY symbol, timeframe
HAVING count(*) >= 5
ORDER BY trades DESC;

-- 4c) Outcomes by pattern (only where ML used)
WITH params AS (
  SELECT
    interval '6 hours'  AS lookback_signals,
    interval '72 hours' AS lookback_outcomes,
    false AS include_virtual,
    false AS include_manual
),
base_outcomes AS (
  SELECT s.*
  FROM public.ai_signals s
  CROSS JOIN params p
  WHERE s.closed_at IS NOT NULL
    AND s.closed_at >= now() - p.lookback_outcomes
    AND s.actual_result IN ('WIN', 'LOSS')
    AND (p.include_virtual OR NOT COALESCE(s.is_virtual, false))
    AND (p.include_manual OR NOT COALESCE(s.is_manual_trade, false))
)
SELECT
  COALESCE(NULLIF(ml_pattern_name, ''), '(no_name)') AS pattern_name,
  ml_pattern_id,
  count(*) AS trades,
  round(100.0 * avg(CASE WHEN actual_result = 'WIN' THEN 1 ELSE 0 END), 1) AS win_rate_pct,
  round(avg(COALESCE(ml_pattern_confidence, 0))::numeric, 2) AS avg_confidence,
  round(avg(COALESCE(profit_loss, 0))::numeric, 2) AS avg_profit_loss,
  round(sum(COALESCE(profit_loss, 0))::numeric, 2) AS total_profit_loss
FROM base_outcomes
WHERE ml_pattern_used = true
GROUP BY ml_pattern_name, ml_pattern_id
HAVING count(*) >= 3
ORDER BY trades DESC
LIMIT 50;

-- 5) Spot-check: latest suspicious rows (ML fields missing/contradicting)
WITH params AS (
  SELECT
    interval '6 hours'  AS lookback_signals,
    interval '72 hours' AS lookback_outcomes,
    false AS include_virtual,
    false AS include_manual
),
base_signals AS (
  SELECT s.*
  FROM public.ai_signals s
  CROSS JOIN params p
  WHERE s.created_at >= now() - p.lookback_signals
    AND (p.include_virtual OR NOT COALESCE(s.is_virtual, false))
    AND (p.include_manual OR NOT COALESCE(s.is_manual_trade, false))
)
SELECT
  id,
  created_at,
  symbol,
  timeframe,
  dir,
  win_prob,
  ml_pattern_used,
  ml_pattern_id,
  ml_pattern_name,
  ml_pattern_confidence,
  is_virtual,
  is_manual_trade,
  instance,
  model_version
FROM base_signals
WHERE (ml_pattern_used AND (ml_pattern_id IS NULL OR ml_pattern_name IS NULL OR ml_pattern_name = '' OR ml_pattern_confidence IS NULL))
   OR (NOT ml_pattern_used AND (ml_pattern_id IS NOT NULL OR ml_pattern_name IS NOT NULL OR ml_pattern_confidence IS NOT NULL))
ORDER BY created_at DESC
LIMIT 50;

-- 6) Virtual backlog health: how much PENDING is accumulating?
-- If PENDING grows old, virtual evaluation and learning become biased/slow.
WITH params AS (
  SELECT
    interval '30 days' AS lookback_virtual,
    false AS include_manual
),
virtual_rows AS (
  SELECT s.*
  FROM public.ai_signals s
  CROSS JOIN params p
  WHERE COALESCE(s.is_virtual, false) = true
    AND s.created_at >= now() - p.lookback_virtual
    AND (p.include_manual OR NOT COALESCE(s.is_manual_trade, false))
)
SELECT
  count(*) FILTER (WHERE actual_result = 'PENDING') AS pending_total,
  count(*) FILTER (WHERE actual_result = 'PENDING' AND created_at < now() - interval '24 hours') AS pending_24h_plus,
  count(*) FILTER (WHERE actual_result = 'PENDING' AND created_at < now() - interval '3 days') AS pending_3d_plus,
  count(*) FILTER (WHERE actual_result = 'PENDING' AND created_at < now() - interval '7 days') AS pending_7d_plus,
  count(*) FILTER (WHERE actual_result IN ('WIN','LOSS')) AS resolved_win_loss,
  round(100.0 * (count(*) FILTER (WHERE actual_result IN ('WIN','LOSS'))::double precision) / NULLIF(count(*)::double precision, 0), 1) AS resolved_pct
FROM virtual_rows;

-- 6b) Oldest virtual PENDING rows (check whether watch loop/update is stuck)
WITH params AS (
  SELECT
    interval '30 days' AS lookback_virtual,
    false AS include_manual
)
SELECT
  id,
  created_at,
  symbol,
  timeframe,
  dir,
  win_prob,
  ml_pattern_used,
  is_virtual,
  actual_result,
  planned_entry_price,
  planned_sl,
  planned_tp,
  planned_order_type,
  virtual_filled_at,
  instance
FROM public.ai_signals
WHERE COALESCE(is_virtual, false) = true
  AND actual_result = 'PENDING'
  AND created_at >= now() - (SELECT lookback_virtual FROM params)
  AND ((SELECT include_manual FROM params) OR NOT COALESCE(is_manual_trade, false))
ORDER BY created_at ASC
LIMIT 50;

-- 6c) Virtual PENDING by symbol/timeframe (helps identify where backlog concentrates)
WITH params AS (
  SELECT
    interval '30 days' AS lookback_virtual,
    false AS include_manual
)
SELECT
  symbol,
  timeframe,
  count(*) FILTER (WHERE actual_result = 'PENDING') AS pending,
  count(*) FILTER (WHERE actual_result IN ('WIN','LOSS')) AS resolved,
  count(*) AS total,
  round(100.0 * (count(*) FILTER (WHERE actual_result IN ('WIN','LOSS'))::double precision) / NULLIF(count(*)::double precision, 0), 1) AS resolved_pct
FROM public.ai_signals
WHERE COALESCE(is_virtual, false) = true
  AND created_at >= now() - (SELECT lookback_virtual FROM params)
  AND ((SELECT include_manual FROM params) OR NOT COALESCE(is_manual_trade, false))
GROUP BY symbol, timeframe
HAVING count(*) >= 20
ORDER BY pending DESC;

-- 7) Virtual performance slice: likely "missed opportunities" candidates (choose bins/filters as needed)
WITH params AS (
  SELECT
    interval '30 days' AS lookback_virtual,
    false AS include_manual
)
SELECT
  symbol,
  timeframe,
  floor(win_prob * 20.0) / 20.0 AS win_prob_bin,
  ml_pattern_used,
  count(*) AS n,
  round(100.0 * avg(CASE WHEN actual_result = 'WIN' THEN 1 ELSE 0 END), 1) AS win_rate_pct
FROM public.ai_signals
WHERE COALESCE(is_virtual, false) = true
  AND actual_result IN ('WIN','LOSS')
  AND closed_at >= now() - (SELECT lookback_virtual FROM params)
  AND win_prob IS NOT NULL
  AND ((SELECT include_manual FROM params) OR NOT COALESCE(is_manual_trade, false))
GROUP BY symbol, timeframe, win_prob_bin, ml_pattern_used
HAVING count(*) >= 20
ORDER BY win_rate_pct DESC, n DESC;

-- End of script
