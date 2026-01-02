-- Training dataset quality check (run in Supabase SQL Editor)
-- Purpose:
--   Quickly validate whether the dataset is usable for ML training without exporting CSV.
--   Reports counts, label balance, virtual ratio, and snapshot missingness.
--
-- How to use:
--   1) Adjust params below
--   2) Run the whole script

WITH params AS (
	SELECT
		-- Date window (UTC)
		TIMESTAMPTZ '2026-01-01 00:00:00+00' AS start_ts,
		TIMESTAMPTZ '2026-01-03 00:00:00+00' AS end_ts,

		-- Filters (NULL means "no filter")
		NULL::text AS only_symbol,
		NULL::text AS only_timeframe,

		-- Include virtual trades?
		TRUE AS include_virtual,

		-- Exclude manual trades (recommended)
		TRUE AS exclude_manual
),
base AS (
	SELECT
		a.*,
		-- Normalize label: WIN=1, LOSS=0, else NULL
		CASE
			WHEN a.actual_result = 'WIN' THEN 1
			WHEN a.actual_result = 'LOSS' THEN 0
			ELSE NULL
		END AS y,
		-- Convenience: treat 0 placeholders as NULL for regime features
		NULLIF(a.atr_norm, 0) AS atr_norm_n,
		NULLIF(a.adx, 0) AS adx_n,
		NULLIF(a.di_plus, 0) AS di_plus_n,
		NULLIF(a.di_minus, 0) AS di_minus_n,
		NULLIF(a.bb_width, 0) AS bb_width_n,
		(
			CASE WHEN a.bid IS NOT NULL THEN 1 ELSE 0 END +
			CASE WHEN a.ask IS NOT NULL THEN 1 ELSE 0 END +
			CASE WHEN a.ema_25 IS NOT NULL THEN 1 ELSE 0 END +
			CASE WHEN a.sma_100 IS NOT NULL THEN 1 ELSE 0 END +
			CASE WHEN a.macd_main IS NOT NULL THEN 1 ELSE 0 END +
			CASE WHEN a.macd_signal IS NOT NULL THEN 1 ELSE 0 END +
			CASE WHEN a.ichimoku_tenkan IS NOT NULL THEN 1 ELSE 0 END +
			CASE WHEN a.ichimoku_kijun IS NOT NULL THEN 1 ELSE 0 END +
			CASE WHEN a.ichimoku_senkou_a IS NOT NULL THEN 1 ELSE 0 END +
			CASE WHEN a.ichimoku_senkou_b IS NOT NULL THEN 1 ELSE 0 END
		) AS snapshot_nonnull_count,
		(
			a.bid IS NOT NULL OR a.ask IS NOT NULL OR a.ema_25 IS NOT NULL OR a.sma_100 IS NOT NULL OR
			a.macd_main IS NOT NULL OR a.macd_signal IS NOT NULL OR
			a.ichimoku_tenkan IS NOT NULL OR a.ichimoku_kijun IS NOT NULL OR
			a.ichimoku_senkou_a IS NOT NULL OR a.ichimoku_senkou_b IS NOT NULL
		) AS snapshot_available
	FROM public.ai_signals a
	CROSS JOIN params p
	WHERE
		a.created_at >= p.start_ts
		AND a.created_at < p.end_ts
		AND (p.only_symbol IS NULL OR a.symbol = p.only_symbol)
		AND (p.only_timeframe IS NULL OR a.timeframe = p.only_timeframe)
		AND (NOT p.exclude_manual OR COALESCE(a.is_manual_trade, FALSE) = FALSE)
		AND (p.include_virtual OR COALESCE(a.is_virtual, FALSE) = FALSE)
		AND a.closed_at IS NOT NULL
		AND a.actual_result IN ('WIN', 'LOSS')
),
agg AS (
	SELECT
		COUNT(*)::bigint AS n_rows,
		SUM((y = 1)::int)::bigint AS n_win,
		SUM((y = 0)::int)::bigint AS n_loss,
		SUM((COALESCE(is_virtual, FALSE))::int)::bigint AS n_virtual,
		SUM((COALESCE(is_virtual, FALSE) = FALSE)::int)::bigint AS n_real,
		SUM((snapshot_available)::int)::bigint AS n_snapshot_available,
		SUM((snapshot_available = FALSE)::int)::bigint AS n_snapshot_missing,
		AVG(snapshot_nonnull_count)::numeric(10,2) AS avg_snapshot_nonnull_count,
		AVG(win_prob)::numeric(10,4) AS avg_win_prob,
		AVG(win_prob) FILTER (WHERE y = 1)::numeric(10,4) AS avg_win_prob_on_win,
		AVG(win_prob) FILTER (WHERE y = 0)::numeric(10,4) AS avg_win_prob_on_loss,

		-- Missingness (key features)
		SUM((rsi IS NULL)::int)::bigint AS miss_rsi,
		SUM((atr IS NULL)::int)::bigint AS miss_atr,
		SUM((atr_norm_n IS NULL)::int)::bigint AS miss_atr_norm,
		SUM((adx_n IS NULL)::int)::bigint AS miss_adx,
		SUM((di_plus_n IS NULL)::int)::bigint AS miss_di_plus,
		SUM((di_minus_n IS NULL)::int)::bigint AS miss_di_minus,
		SUM((bb_width_n IS NULL)::int)::bigint AS miss_bb_width,

		SUM((bid IS NULL)::int)::bigint AS miss_bid,
		SUM((ask IS NULL)::int)::bigint AS miss_ask,
		SUM((ema_25 IS NULL)::int)::bigint AS miss_ema_25,
		SUM((sma_100 IS NULL)::int)::bigint AS miss_sma_100,
		SUM((macd_main IS NULL)::int)::bigint AS miss_macd_main,
		SUM((macd_signal IS NULL)::int)::bigint AS miss_macd_signal,
		SUM((ichimoku_tenkan IS NULL)::int)::bigint AS miss_ichi_tenkan,
		SUM((ichimoku_kijun IS NULL)::int)::bigint AS miss_ichi_kijun,
		SUM((ichimoku_senkou_a IS NULL)::int)::bigint AS miss_ichi_senkou_a,
		SUM((ichimoku_senkou_b IS NULL)::int)::bigint AS miss_ichi_senkou_b
	FROM base
)
SELECT
	*,
	CASE WHEN n_rows > 0 THEN (n_win::numeric / n_rows) ELSE NULL END AS win_rate,
	CASE WHEN n_rows > 0 THEN (n_virtual::numeric / n_rows) ELSE NULL END AS virtual_ratio,
	CASE WHEN n_rows > 0 THEN (n_snapshot_available::numeric / n_rows) ELSE NULL END AS snapshot_available_ratio
FROM agg;

-- Earliest timestamp where snapshot is available (helps decide from_ts)
WITH params AS (
	SELECT
		TIMESTAMPTZ '2025-12-01 00:00:00+00' AS start_ts,
		TIMESTAMPTZ '2026-01-03 00:00:00+00' AS end_ts,
		NULL::text AS only_symbol,
		NULL::text AS only_timeframe,
		TRUE AS include_virtual,
		TRUE AS exclude_manual
),
base AS (
	SELECT
		a.*,
		(
			a.bid IS NOT NULL OR a.ask IS NOT NULL OR a.ema_25 IS NOT NULL OR a.sma_100 IS NOT NULL OR
			a.macd_main IS NOT NULL OR a.macd_signal IS NOT NULL OR
			a.ichimoku_tenkan IS NOT NULL OR a.ichimoku_kijun IS NOT NULL OR
			a.ichimoku_senkou_a IS NOT NULL OR a.ichimoku_senkou_b IS NOT NULL
		) AS snapshot_available
	FROM public.ai_signals a
	CROSS JOIN params p
	WHERE
		a.created_at >= p.start_ts
		AND a.created_at < p.end_ts
		AND (p.only_symbol IS NULL OR a.symbol = p.only_symbol)
		AND (p.only_timeframe IS NULL OR a.timeframe = p.only_timeframe)
		AND (NOT p.exclude_manual OR COALESCE(a.is_manual_trade, FALSE) = FALSE)
		AND (p.include_virtual OR COALESCE(a.is_virtual, FALSE) = FALSE)
		AND a.closed_at IS NOT NULL
		AND a.actual_result IN ('WIN', 'LOSS')
)
SELECT
	MIN(created_at) FILTER (WHERE snapshot_available) AS first_snapshot_created_at,
	MAX(created_at) FILTER (WHERE snapshot_available) AS last_snapshot_created_at,
	COUNT(*) FILTER (WHERE snapshot_available)::bigint AS n_with_snapshot,
	COUNT(*) FILTER (WHERE NOT snapshot_available)::bigint AS n_without_snapshot
FROM base;

-- Breakdown by symbol/timeframe (top 50)
WITH params AS (
	SELECT
		TIMESTAMPTZ '2025-12-01 00:00:00+00' AS start_ts,
		TIMESTAMPTZ '2026-01-03 00:00:00+00' AS end_ts,
		NULL::text AS only_symbol,
		NULL::text AS only_timeframe,
		TRUE AS include_virtual,
		TRUE AS exclude_manual
),
base AS (
	SELECT
		a.*,
		CASE WHEN a.actual_result = 'WIN' THEN 1 WHEN a.actual_result = 'LOSS' THEN 0 ELSE NULL END AS y,
		(
			a.bid IS NOT NULL OR a.ask IS NOT NULL OR a.ema_25 IS NOT NULL OR a.sma_100 IS NOT NULL OR
			a.macd_main IS NOT NULL OR a.macd_signal IS NOT NULL OR
			a.ichimoku_tenkan IS NOT NULL OR a.ichimoku_kijun IS NOT NULL OR
			a.ichimoku_senkou_a IS NOT NULL OR a.ichimoku_senkou_b IS NOT NULL
		) AS snapshot_available
	FROM public.ai_signals a
	CROSS JOIN params p
	WHERE
		a.created_at >= p.start_ts
		AND a.created_at < p.end_ts
		AND (p.only_symbol IS NULL OR a.symbol = p.only_symbol)
		AND (p.only_timeframe IS NULL OR a.timeframe = p.only_timeframe)
		AND (NOT p.exclude_manual OR COALESCE(a.is_manual_trade, FALSE) = FALSE)
		AND (p.include_virtual OR COALESCE(a.is_virtual, FALSE) = FALSE)
		AND a.closed_at IS NOT NULL
		AND a.actual_result IN ('WIN', 'LOSS')
)
SELECT
	symbol,
	timeframe,
	COUNT(*)::bigint AS n,
	SUM((y = 1)::int)::bigint AS n_win,
	SUM((y = 0)::int)::bigint AS n_loss,
	CASE WHEN COUNT(*) > 0 THEN AVG(y::numeric) ELSE NULL END AS win_rate,
	SUM((COALESCE(is_virtual, FALSE))::int)::bigint AS n_virtual,
	CASE WHEN COUNT(*) > 0 THEN AVG((COALESCE(is_virtual, FALSE))::int::numeric) ELSE NULL END AS virtual_ratio,
	SUM((snapshot_available)::int)::bigint AS n_snapshot_available,
	CASE WHEN COUNT(*) > 0 THEN AVG((snapshot_available)::int::numeric) ELSE NULL END AS snapshot_available_ratio
FROM base
GROUP BY symbol, timeframe
ORDER BY n DESC
LIMIT 50;

-- Breakdown for snapshot-qualified rows only (recommended training set)
WITH params AS (
	SELECT
		TIMESTAMPTZ '2025-12-01 00:00:00+00' AS start_ts,
		TIMESTAMPTZ '2026-01-03 00:00:00+00' AS end_ts,
		NULL::text AS only_symbol,
		NULL::text AS only_timeframe,
		TRUE AS include_virtual,
		TRUE AS exclude_manual,
		8::int AS min_snapshot_nonnull_count
),
base AS (
	SELECT
		a.*,
		CASE WHEN a.actual_result = 'WIN' THEN 1 WHEN a.actual_result = 'LOSS' THEN 0 ELSE NULL END AS y,
		(
			CASE WHEN a.bid IS NOT NULL THEN 1 ELSE 0 END +
			CASE WHEN a.ask IS NOT NULL THEN 1 ELSE 0 END +
			CASE WHEN a.ema_25 IS NOT NULL THEN 1 ELSE 0 END +
			CASE WHEN a.sma_100 IS NOT NULL THEN 1 ELSE 0 END +
			CASE WHEN a.macd_main IS NOT NULL THEN 1 ELSE 0 END +
			CASE WHEN a.macd_signal IS NOT NULL THEN 1 ELSE 0 END +
			CASE WHEN a.ichimoku_tenkan IS NOT NULL THEN 1 ELSE 0 END +
			CASE WHEN a.ichimoku_kijun IS NOT NULL THEN 1 ELSE 0 END +
			CASE WHEN a.ichimoku_senkou_a IS NOT NULL THEN 1 ELSE 0 END +
			CASE WHEN a.ichimoku_senkou_b IS NOT NULL THEN 1 ELSE 0 END
		) AS snapshot_nonnull_count,
		(
			a.bid IS NOT NULL OR a.ask IS NOT NULL OR a.ema_25 IS NOT NULL OR a.sma_100 IS NOT NULL OR
			a.macd_main IS NOT NULL OR a.macd_signal IS NOT NULL OR
			a.ichimoku_tenkan IS NOT NULL OR a.ichimoku_kijun IS NOT NULL OR
			a.ichimoku_senkou_a IS NOT NULL OR a.ichimoku_senkou_b IS NOT NULL
		) AS snapshot_available
	FROM public.ai_signals a
	CROSS JOIN params p
	WHERE
		a.created_at >= p.start_ts
		AND a.created_at < p.end_ts
		AND (p.only_symbol IS NULL OR a.symbol = p.only_symbol)
		AND (p.only_timeframe IS NULL OR a.timeframe = p.only_timeframe)
		AND (NOT p.exclude_manual OR COALESCE(a.is_manual_trade, FALSE) = FALSE)
		AND (p.include_virtual OR COALESCE(a.is_virtual, FALSE) = FALSE)
		AND a.closed_at IS NOT NULL
		AND a.actual_result IN ('WIN', 'LOSS')
)
SELECT
	symbol,
	timeframe,
	COUNT(*)::bigint AS n,
	SUM((y = 1)::int)::bigint AS n_win,
	SUM((y = 0)::int)::bigint AS n_loss,
	CASE WHEN COUNT(*) > 0 THEN AVG(y::numeric) ELSE NULL END AS win_rate,
	SUM((COALESCE(is_virtual, FALSE))::int)::bigint AS n_virtual,
	CASE WHEN COUNT(*) > 0 THEN AVG((COALESCE(is_virtual, FALSE))::int::numeric) ELSE NULL END AS virtual_ratio,
	MIN(created_at) AS first_created_at,
	MAX(created_at) AS last_created_at
FROM base
WHERE snapshot_available AND snapshot_nonnull_count >= (SELECT min_snapshot_nonnull_count FROM params)
GROUP BY symbol, timeframe
ORDER BY n DESC;

-- Diagnostic: snapshot coverage by is_virtual (helps confirm whether real trades lack snapshots)
WITH params AS (
	SELECT
		TIMESTAMPTZ '2025-12-01 00:00:00+00' AS start_ts,
		TIMESTAMPTZ '2026-01-03 00:00:00+00' AS end_ts,
		NULL::text AS only_symbol,
		NULL::text AS only_timeframe,
		TRUE AS include_virtual,
		TRUE AS exclude_manual
),
base AS (
	SELECT
		a.symbol,
		a.timeframe,
		COALESCE(a.is_virtual, FALSE) AS is_virtual,
		(
			a.bid IS NOT NULL OR a.ask IS NOT NULL OR a.ema_25 IS NOT NULL OR a.sma_100 IS NOT NULL OR
			a.macd_main IS NOT NULL OR a.macd_signal IS NOT NULL OR
			a.ichimoku_tenkan IS NOT NULL OR a.ichimoku_kijun IS NOT NULL OR
			a.ichimoku_senkou_a IS NOT NULL OR a.ichimoku_senkou_b IS NOT NULL
		) AS snapshot_available,
		(
			CASE WHEN a.bid IS NOT NULL THEN 1 ELSE 0 END +
			CASE WHEN a.ask IS NOT NULL THEN 1 ELSE 0 END +
			CASE WHEN a.ema_25 IS NOT NULL THEN 1 ELSE 0 END +
			CASE WHEN a.sma_100 IS NOT NULL THEN 1 ELSE 0 END +
			CASE WHEN a.macd_main IS NOT NULL THEN 1 ELSE 0 END +
			CASE WHEN a.macd_signal IS NOT NULL THEN 1 ELSE 0 END +
			CASE WHEN a.ichimoku_tenkan IS NOT NULL THEN 1 ELSE 0 END +
			CASE WHEN a.ichimoku_kijun IS NOT NULL THEN 1 ELSE 0 END +
			CASE WHEN a.ichimoku_senkou_a IS NOT NULL THEN 1 ELSE 0 END +
			CASE WHEN a.ichimoku_senkou_b IS NOT NULL THEN 1 ELSE 0 END
		) AS snapshot_nonnull_count
	FROM public.ai_signals a
	CROSS JOIN params p
	WHERE
		a.created_at >= p.start_ts
		AND a.created_at < p.end_ts
		AND (p.only_symbol IS NULL OR a.symbol = p.only_symbol)
		AND (p.only_timeframe IS NULL OR a.timeframe = p.only_timeframe)
		AND (NOT p.exclude_manual OR COALESCE(a.is_manual_trade, FALSE) = FALSE)
		AND (p.include_virtual OR COALESCE(a.is_virtual, FALSE) = FALSE)
		AND a.closed_at IS NOT NULL
		AND a.actual_result IN ('WIN', 'LOSS')
)
SELECT
	symbol,
	timeframe,
	is_virtual,
	COUNT(*)::bigint AS n,
	SUM((snapshot_available)::int)::bigint AS n_snapshot_available,
	CASE WHEN COUNT(*) > 0 THEN AVG((snapshot_available)::int::numeric) ELSE NULL END AS snapshot_available_ratio,
	AVG(snapshot_nonnull_count)::numeric(10,2) AS avg_snapshot_nonnull_count
FROM base
GROUP BY symbol, timeframe, is_virtual
ORDER BY symbol, timeframe, is_virtual;

-- Diagnostic: snapshot coverage by instance/model_version (helps detect older EA builds sending partial payload)
WITH params AS (
	SELECT
		TIMESTAMPTZ '2025-12-01 00:00:00+00' AS start_ts,
		TIMESTAMPTZ '2026-01-03 00:00:00+00' AS end_ts,
		NULL::text AS only_symbol,
		NULL::text AS only_timeframe,
		TRUE AS include_virtual,
		TRUE AS exclude_manual
),
base AS (
	SELECT
		a.symbol,
		a.timeframe,
		COALESCE(a.is_virtual, FALSE) AS is_virtual,
		COALESCE(a.instance, 'unknown') AS instance,
		COALESCE(a.model_version, 'unknown') AS model_version,
		(
			a.bid IS NOT NULL OR a.ask IS NOT NULL OR a.ema_25 IS NOT NULL OR a.sma_100 IS NOT NULL OR
			a.macd_main IS NOT NULL OR a.macd_signal IS NOT NULL OR
			a.ichimoku_tenkan IS NOT NULL OR a.ichimoku_kijun IS NOT NULL OR
			a.ichimoku_senkou_a IS NOT NULL OR a.ichimoku_senkou_b IS NOT NULL
		) AS snapshot_available,
		(
			CASE WHEN a.bid IS NOT NULL THEN 1 ELSE 0 END +
			CASE WHEN a.ask IS NOT NULL THEN 1 ELSE 0 END +
			CASE WHEN a.ema_25 IS NOT NULL THEN 1 ELSE 0 END +
			CASE WHEN a.sma_100 IS NOT NULL THEN 1 ELSE 0 END +
			CASE WHEN a.macd_main IS NOT NULL THEN 1 ELSE 0 END +
			CASE WHEN a.macd_signal IS NOT NULL THEN 1 ELSE 0 END +
			CASE WHEN a.ichimoku_tenkan IS NOT NULL THEN 1 ELSE 0 END +
			CASE WHEN a.ichimoku_kijun IS NOT NULL THEN 1 ELSE 0 END +
			CASE WHEN a.ichimoku_senkou_a IS NOT NULL THEN 1 ELSE 0 END +
			CASE WHEN a.ichimoku_senkou_b IS NOT NULL THEN 1 ELSE 0 END
		) AS snapshot_nonnull_count
	FROM public.ai_signals a
	CROSS JOIN params p
	WHERE
		a.created_at >= p.start_ts
		AND a.created_at < p.end_ts
		AND (p.only_symbol IS NULL OR a.symbol = p.only_symbol)
		AND (p.only_timeframe IS NULL OR a.timeframe = p.only_timeframe)
		AND (NOT p.exclude_manual OR COALESCE(a.is_manual_trade, FALSE) = FALSE)
		AND (p.include_virtual OR COALESCE(a.is_virtual, FALSE) = FALSE)
		AND a.closed_at IS NOT NULL
		AND a.actual_result IN ('WIN', 'LOSS')
)
SELECT
	instance,
	model_version,
	is_virtual,
	COUNT(*)::bigint AS n,
	SUM((snapshot_available)::int)::bigint AS n_snapshot_available,
	CASE WHEN COUNT(*) > 0 THEN AVG((snapshot_available)::int::numeric) ELSE NULL END AS snapshot_available_ratio,
	AVG(snapshot_nonnull_count)::numeric(10,2) AS avg_snapshot_nonnull_count,
	MIN(symbol) AS example_symbol,
	MIN(timeframe) AS example_timeframe
FROM base
GROUP BY instance, model_version, is_virtual
ORDER BY n DESC, instance, model_version, is_virtual;

-- Diagnostic: sample rows where real trades are missing snapshot fields
WITH params AS (
	SELECT
		TIMESTAMPTZ '2025-12-01 00:00:00+00' AS start_ts,
		TIMESTAMPTZ '2026-01-03 00:00:00+00' AS end_ts,
		NULL::text AS only_symbol,
		NULL::text AS only_timeframe,
		TRUE AS exclude_manual
)
SELECT
	a.id,
	a.created_at,
	a.closed_at,
	a.symbol,
	a.timeframe,
	COALESCE(a.instance, 'unknown') AS instance,
	COALESCE(a.model_version, 'unknown') AS model_version,
	COALESCE(a.is_virtual, FALSE) AS is_virtual,
	a.order_ticket,
	a.dir,
	a.win_prob,
	a.actual_result,
	(
		a.bid IS NOT NULL OR a.ask IS NOT NULL OR a.ema_25 IS NOT NULL OR a.sma_100 IS NOT NULL OR
		a.macd_main IS NOT NULL OR a.macd_signal IS NOT NULL OR
		a.ichimoku_tenkan IS NOT NULL OR a.ichimoku_kijun IS NOT NULL OR
		a.ichimoku_senkou_a IS NOT NULL OR a.ichimoku_senkou_b IS NOT NULL
	) AS snapshot_available,
	a.reason
FROM public.ai_signals a
CROSS JOIN params p
WHERE
	a.created_at >= p.start_ts
	AND a.created_at < p.end_ts
	AND (p.only_symbol IS NULL OR a.symbol = p.only_symbol)
	AND (p.only_timeframe IS NULL OR a.timeframe = p.only_timeframe)
	AND (NOT p.exclude_manual OR COALESCE(a.is_manual_trade, FALSE) = FALSE)
	AND COALESCE(a.is_virtual, FALSE) = FALSE
	AND a.closed_at IS NOT NULL
	AND a.actual_result IN ('WIN', 'LOSS')
	AND (
		a.bid IS NULL AND a.ask IS NULL AND a.ema_25 IS NULL AND a.sma_100 IS NULL AND
		a.macd_main IS NULL AND a.macd_signal IS NULL AND
		a.ichimoku_tenkan IS NULL AND a.ichimoku_kijun IS NULL AND
		a.ichimoku_senkou_a IS NULL AND a.ichimoku_senkou_b IS NULL
	)
ORDER BY a.created_at DESC
LIMIT 50;
