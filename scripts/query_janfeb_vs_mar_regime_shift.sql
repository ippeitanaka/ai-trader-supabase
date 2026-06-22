-- Jan-Feb vs Mar+ regime shift report
--
-- Goal:
-- - Compare the strong period (Jan-Feb) against the weak period (Mar+) using
--   the same real EA trade slice.
-- - Show whether deterioration came from symbol/timeframe mix, ML usage,
--   execution method, or win-probability calibration quality.
--
-- Recommended usage:
-- 1) Supabase SQL Editor on production
-- 2) Local psql against an imported production snapshot
--
-- Example overrides:
--   psql "postgresql://..." \
--     -v compare_start='2026-01-01' \
--     -v split_date='2026-03-01' \
--     -v compare_end='2026-06-01' \
--     -f scripts/query_janfeb_vs_mar_regime_shift.sql

\if :{?compare_start}
\else
\set compare_start '2026-01-01'
\endif

\if :{?split_date}
\else
\set split_date '2026-03-01'
\endif

\if :{?compare_end}
\else
\set compare_end '2026-07-01'
\endif

\if :{?include_virtual}
\else
\set include_virtual 'false'
\endif

\if :{?include_manual}
\else
\set include_manual 'false'
\endif

\if :{?include_reverse}
\else
\set include_reverse 'false'
\endif

-- 0) Monthly baseline: trade count, win rate, and P/L trend
WITH params AS (
  SELECT
    :'compare_start'::timestamptz AS compare_start,
    :'split_date'::timestamptz AS split_date,
    :'compare_end'::timestamptz AS compare_end,
    :'include_virtual'::boolean AS include_virtual,
    :'include_manual'::boolean AS include_manual,
    :'include_reverse'::boolean AS include_reverse
),
base AS (
  SELECT
    s.id,
    s.created_at,
    s.closed_at,
    s.symbol,
    s.timeframe,
    s.dir,
    s.win_prob,
    s.entry_method,
    s.ml_pattern_used,
    s.ml_pattern_name,
    COALESCE(s.is_virtual, false) AS is_virtual,
    COALESCE(s.is_manual_trade, false) AS is_manual_trade,
    COALESCE((to_jsonb(s)->>'reverse_execution')::boolean, false) AS reverse_execution,
    s.actual_result,
    s.profit_loss,
    CASE
      WHEN s.closed_at < p.split_date THEN '2026-01_to_2026-02'
      ELSE '2026-03_plus'
    END AS phase
  FROM public.ai_signals s
  CROSS JOIN params p
  WHERE s.closed_at IS NOT NULL
    AND s.closed_at >= p.compare_start
    AND s.closed_at < p.compare_end
    AND s.actual_result IN ('WIN', 'LOSS', 'BREAK_EVEN')
    AND (p.include_virtual OR NOT COALESCE(s.is_virtual, false))
    AND (p.include_manual OR NOT COALESCE(s.is_manual_trade, false))
    AND (p.include_reverse OR NOT COALESCE((to_jsonb(s)->>'reverse_execution')::boolean, false))
)
SELECT
  to_char(date_trunc('month', closed_at), 'YYYY-MM') AS ym,
  count(*) AS trades,
  count(*) FILTER (WHERE actual_result = 'WIN') AS wins,
  count(*) FILTER (WHERE actual_result = 'LOSS') AS losses,
  count(*) FILTER (WHERE actual_result = 'BREAK_EVEN') AS break_even,
  ROUND(
    100.0 * count(*) FILTER (WHERE actual_result = 'WIN')
    / NULLIF(count(*) FILTER (WHERE actual_result IN ('WIN', 'LOSS', 'BREAK_EVEN')), 0),
    1
  ) AS win_rate_pct,
  ROUND(avg(win_prob * 100.0)::numeric, 1) AS avg_win_prob_pct,
  ROUND(avg(COALESCE(profit_loss, 0))::numeric, 2) AS avg_profit_loss,
  ROUND(sum(COALESCE(profit_loss, 0))::numeric, 2) AS total_profit_loss
FROM base
GROUP BY 1
ORDER BY 1;

-- 1) Headline comparison: Jan-Feb vs Mar+
WITH params AS (
  SELECT
    :'compare_start'::timestamptz AS compare_start,
    :'split_date'::timestamptz AS split_date,
    :'compare_end'::timestamptz AS compare_end,
    :'include_virtual'::boolean AS include_virtual,
    :'include_manual'::boolean AS include_manual,
    :'include_reverse'::boolean AS include_reverse
),
base AS (
  SELECT
    s.closed_at,
    s.win_prob,
    s.actual_result,
    s.profit_loss,
    CASE
      WHEN s.closed_at < p.split_date THEN '2026-01_to_2026-02'
      ELSE '2026-03_plus'
    END AS phase
  FROM public.ai_signals s
  CROSS JOIN params p
  WHERE s.closed_at IS NOT NULL
    AND s.closed_at >= p.compare_start
    AND s.closed_at < p.compare_end
    AND s.actual_result IN ('WIN', 'LOSS', 'BREAK_EVEN')
    AND (p.include_virtual OR NOT COALESCE(s.is_virtual, false))
    AND (p.include_manual OR NOT COALESCE(s.is_manual_trade, false))
    AND (p.include_reverse OR NOT COALESCE((to_jsonb(s)->>'reverse_execution')::boolean, false))
)
SELECT
  phase,
  count(*) AS trades,
  count(*) FILTER (WHERE actual_result = 'WIN') AS wins,
  count(*) FILTER (WHERE actual_result = 'LOSS') AS losses,
  count(*) FILTER (WHERE actual_result = 'BREAK_EVEN') AS break_even,
  ROUND(
    100.0 * count(*) FILTER (WHERE actual_result = 'WIN')
    / NULLIF(count(*) FILTER (WHERE actual_result IN ('WIN', 'LOSS', 'BREAK_EVEN')), 0),
    1
  ) AS win_rate_pct,
  ROUND(avg(win_prob * 100.0)::numeric, 1) AS avg_win_prob_pct,
  ROUND(avg(COALESCE(profit_loss, 0))::numeric, 2) AS avg_profit_loss,
  ROUND(sum(COALESCE(profit_loss, 0))::numeric, 2) AS total_profit_loss,
  ROUND(stddev_pop(COALESCE(profit_loss, 0))::numeric, 2) AS profit_loss_stddev
FROM base
GROUP BY phase
ORDER BY phase;

-- 2) Symbol/timeframe mix shift: where did the damage concentrate?
WITH params AS (
  SELECT
    :'compare_start'::timestamptz AS compare_start,
    :'split_date'::timestamptz AS split_date,
    :'compare_end'::timestamptz AS compare_end,
    :'include_virtual'::boolean AS include_virtual,
    :'include_manual'::boolean AS include_manual,
    :'include_reverse'::boolean AS include_reverse
),
base AS (
  SELECT
    s.symbol,
    s.timeframe,
    s.actual_result,
    s.profit_loss,
    CASE
      WHEN s.closed_at < p.split_date THEN '2026-01_to_2026-02'
      ELSE '2026-03_plus'
    END AS phase
  FROM public.ai_signals s
  CROSS JOIN params p
  WHERE s.closed_at IS NOT NULL
    AND s.closed_at >= p.compare_start
    AND s.closed_at < p.compare_end
    AND s.actual_result IN ('WIN', 'LOSS', 'BREAK_EVEN')
    AND (p.include_virtual OR NOT COALESCE(s.is_virtual, false))
    AND (p.include_manual OR NOT COALESCE(s.is_manual_trade, false))
    AND (p.include_reverse OR NOT COALESCE((to_jsonb(s)->>'reverse_execution')::boolean, false))
),
agg AS (
  SELECT
    phase,
    symbol,
    timeframe,
    count(*) AS trades,
    ROUND(
      100.0 * count(*) FILTER (WHERE actual_result = 'WIN')
      / NULLIF(count(*) FILTER (WHERE actual_result IN ('WIN', 'LOSS', 'BREAK_EVEN')), 0),
      1
    ) AS win_rate_pct,
    ROUND(sum(COALESCE(profit_loss, 0))::numeric, 2) AS total_profit_loss
  FROM base
  GROUP BY phase, symbol, timeframe
)
SELECT *
FROM agg
WHERE trades >= 5
ORDER BY phase, total_profit_loss ASC, trades DESC;

-- 3) ML usage comparison: did ML help or hurt after March?
WITH params AS (
  SELECT
    :'compare_start'::timestamptz AS compare_start,
    :'split_date'::timestamptz AS split_date,
    :'compare_end'::timestamptz AS compare_end,
    :'include_virtual'::boolean AS include_virtual,
    :'include_manual'::boolean AS include_manual,
    :'include_reverse'::boolean AS include_reverse
),
base AS (
  SELECT
    CASE
      WHEN s.closed_at < p.split_date THEN '2026-01_to_2026-02'
      ELSE '2026-03_plus'
    END AS phase,
    COALESCE(s.ml_pattern_used, false) AS ml_pattern_used,
    s.actual_result,
    s.profit_loss,
    s.win_prob
  FROM public.ai_signals s
  CROSS JOIN params p
  WHERE s.closed_at IS NOT NULL
    AND s.closed_at >= p.compare_start
    AND s.closed_at < p.compare_end
    AND s.actual_result IN ('WIN', 'LOSS', 'BREAK_EVEN')
    AND (p.include_virtual OR NOT COALESCE(s.is_virtual, false))
    AND (p.include_manual OR NOT COALESCE(s.is_manual_trade, false))
    AND (p.include_reverse OR NOT COALESCE((to_jsonb(s)->>'reverse_execution')::boolean, false))
)
SELECT
  phase,
  ml_pattern_used,
  count(*) AS trades,
  ROUND(
    100.0 * count(*) FILTER (WHERE actual_result = 'WIN')
    / NULLIF(count(*) FILTER (WHERE actual_result IN ('WIN', 'LOSS', 'BREAK_EVEN')), 0),
    1
  ) AS win_rate_pct,
  ROUND(avg(win_prob * 100.0)::numeric, 1) AS avg_win_prob_pct,
  ROUND(avg(COALESCE(profit_loss, 0))::numeric, 2) AS avg_profit_loss,
  ROUND(sum(COALESCE(profit_loss, 0))::numeric, 2) AS total_profit_loss
FROM base
GROUP BY phase, ml_pattern_used
ORDER BY phase, ml_pattern_used DESC;

-- 4) Entry method comparison: detect market-only / pullback mix changes
WITH params AS (
  SELECT
    :'compare_start'::timestamptz AS compare_start,
    :'split_date'::timestamptz AS split_date,
    :'compare_end'::timestamptz AS compare_end,
    :'include_virtual'::boolean AS include_virtual,
    :'include_manual'::boolean AS include_manual,
    :'include_reverse'::boolean AS include_reverse
),
base AS (
  SELECT
    CASE
      WHEN s.closed_at < p.split_date THEN '2026-01_to_2026-02'
      ELSE '2026-03_plus'
    END AS phase,
    COALESCE(NULLIF(s.entry_method, ''), '(null)') AS entry_method,
    s.actual_result,
    s.profit_loss,
    s.win_prob
  FROM public.ai_signals s
  CROSS JOIN params p
  WHERE s.closed_at IS NOT NULL
    AND s.closed_at >= p.compare_start
    AND s.closed_at < p.compare_end
    AND s.actual_result IN ('WIN', 'LOSS', 'BREAK_EVEN')
    AND (p.include_virtual OR NOT COALESCE(s.is_virtual, false))
    AND (p.include_manual OR NOT COALESCE(s.is_manual_trade, false))
    AND (p.include_reverse OR NOT COALESCE((to_jsonb(s)->>'reverse_execution')::boolean, false))
)
SELECT
  phase,
  entry_method,
  count(*) AS trades,
  ROUND(
    100.0 * count(*) FILTER (WHERE actual_result = 'WIN')
    / NULLIF(count(*) FILTER (WHERE actual_result IN ('WIN', 'LOSS', 'BREAK_EVEN')), 0),
    1
  ) AS win_rate_pct,
  ROUND(avg(win_prob * 100.0)::numeric, 1) AS avg_win_prob_pct,
  ROUND(sum(COALESCE(profit_loss, 0))::numeric, 2) AS total_profit_loss
FROM base
GROUP BY phase, entry_method
ORDER BY phase, total_profit_loss ASC, trades DESC;

-- 5) Calibration quality by win-probability bucket
WITH params AS (
  SELECT
    :'compare_start'::timestamptz AS compare_start,
    :'split_date'::timestamptz AS split_date,
    :'compare_end'::timestamptz AS compare_end,
    :'include_virtual'::boolean AS include_virtual,
    :'include_manual'::boolean AS include_manual,
    :'include_reverse'::boolean AS include_reverse
),
base AS (
  SELECT
    CASE
      WHEN s.closed_at < p.split_date THEN '2026-01_to_2026-02'
      ELSE '2026-03_plus'
    END AS phase,
    s.win_prob,
    s.actual_result,
    CASE
      WHEN s.win_prob >= 0.80 THEN '>=0.80'
      WHEN s.win_prob >= 0.75 THEN '0.75-0.79'
      WHEN s.win_prob >= 0.70 THEN '0.70-0.74'
      WHEN s.win_prob >= 0.65 THEN '0.65-0.69'
      WHEN s.win_prob >= 0.60 THEN '0.60-0.64'
      ELSE '<0.60'
    END AS win_prob_bucket
  FROM public.ai_signals s
  CROSS JOIN params p
  WHERE s.closed_at IS NOT NULL
    AND s.closed_at >= p.compare_start
    AND s.closed_at < p.compare_end
    AND s.actual_result IN ('WIN', 'LOSS', 'BREAK_EVEN')
    AND (p.include_virtual OR NOT COALESCE(s.is_virtual, false))
    AND (p.include_manual OR NOT COALESCE(s.is_manual_trade, false))
    AND (p.include_reverse OR NOT COALESCE((to_jsonb(s)->>'reverse_execution')::boolean, false))
)
SELECT
  phase,
  win_prob_bucket,
  count(*) AS trades,
  ROUND(avg(win_prob * 100.0)::numeric, 1) AS avg_predicted_win_prob_pct,
  ROUND(
    100.0 * count(*) FILTER (WHERE actual_result = 'WIN')
    / NULLIF(count(*) FILTER (WHERE actual_result IN ('WIN', 'LOSS', 'BREAK_EVEN')), 0),
    1
  ) AS realized_win_rate_pct,
  ROUND(
    avg(power(win_prob - CASE WHEN actual_result = 'WIN' THEN 1.0 ELSE 0.0 END, 2))::numeric,
    4
  ) AS brier_score
FROM base
GROUP BY phase, win_prob_bucket
ORDER BY phase,
  CASE win_prob_bucket
    WHEN '>=0.80' THEN 1
    WHEN '0.75-0.79' THEN 2
    WHEN '0.70-0.74' THEN 3
    WHEN '0.65-0.69' THEN 4
    WHEN '0.60-0.64' THEN 5
    ELSE 6
  END;

-- 6) Worst individual ML patterns after March (if ML was active)
WITH params AS (
  SELECT
    :'compare_start'::timestamptz AS compare_start,
    :'split_date'::timestamptz AS split_date,
    :'compare_end'::timestamptz AS compare_end,
    :'include_virtual'::boolean AS include_virtual,
    :'include_manual'::boolean AS include_manual,
    :'include_reverse'::boolean AS include_reverse
),
base AS (
  SELECT
    COALESCE(NULLIF(s.ml_pattern_name, ''), '(no_name)') AS ml_pattern_name,
    s.actual_result,
    s.profit_loss
  FROM public.ai_signals s
  CROSS JOIN params p
  WHERE s.closed_at IS NOT NULL
    AND s.closed_at >= GREATEST(p.compare_start, p.split_date)
    AND s.closed_at < p.compare_end
    AND s.actual_result IN ('WIN', 'LOSS', 'BREAK_EVEN')
    AND COALESCE(s.ml_pattern_used, false) = true
    AND (p.include_virtual OR NOT COALESCE(s.is_virtual, false))
    AND (p.include_manual OR NOT COALESCE(s.is_manual_trade, false))
    AND (p.include_reverse OR NOT COALESCE((to_jsonb(s)->>'reverse_execution')::boolean, false))
)
SELECT
  ml_pattern_name,
  count(*) AS trades,
  ROUND(
    100.0 * count(*) FILTER (WHERE actual_result = 'WIN')
    / NULLIF(count(*) FILTER (WHERE actual_result IN ('WIN', 'LOSS', 'BREAK_EVEN')), 0),
    1
  ) AS win_rate_pct,
  ROUND(sum(COALESCE(profit_loss, 0))::numeric, 2) AS total_profit_loss,
  ROUND(avg(COALESCE(profit_loss, 0))::numeric, 2) AS avg_profit_loss
FROM base
GROUP BY ml_pattern_name
HAVING count(*) >= 3
ORDER BY total_profit_loss ASC, trades DESC
LIMIT 20;