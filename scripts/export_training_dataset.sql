-- scripts/export_training_dataset.sql
--
-- Purpose:
--   ai_signals から「学習用データセット（特徴量 + ラベル + 重み）」を抽出する。
--   - 実トレードのみだと先細りしやすいので、仮想（paper/shadow）も含められる設計。
--   - 仮想は低重み（デフォルト 0.25）で扱う。
--   - 過去に発生した指標の異常値（例: ichimoku_chikou が極端に大きい）を
--     学習に混ぜないよう、明らかな外れ値は NULL 化して影響を遮断する。
--
-- How to use:
--   1) params を必要に応じて変更
--   2) 実行して結果をCSV出力（Supabase SQL editor / psql 等）
--
-- Notes:
--   - 既存の Edge Function `ml-training` の方針（VIRTUAL_TRADE_WEIGHT=0.25）に合わせています。

WITH params AS (
	SELECT
		-- 対象期間（UTC想定）
		TIMESTAMPTZ '2025-12-01 00:00:00+00' AS from_ts,
		TIMESTAMPTZ '2026-01-03 00:00:00+00' AS to_ts,

		-- 絞り込み（NULLなら全件）
		NULL::text AS sym,
		NULL::text AS tf,

		-- 学習に仮想トレードを含めるか
		true AS include_virtual,

		-- スナップショット（bid/ask/各種指標）を学習に使う前提なら true 推奨
		-- 古い期間の「指標スナップショット未保存」行を自動で落とせる
		true AS require_snapshot,
		8::int AS min_snapshot_nonnull_count,

		-- 仮想トレードの重み（ml-training と合わせるなら 0.25）
		0.25::double precision AS virtual_trade_weight,

		-- 明らかな外れ値の上限（price系/一目線など）
		-- 例: 9e14 のような異常値を除外したい
		1e8::double precision AS max_abs_price_like,

		-- MACD系の外れ値上限（通常は小さい）
		1e6::double precision AS max_abs_macd
),
base AS (
	SELECT
		s.*,
		p.virtual_trade_weight,
		p.max_abs_price_like,
		p.max_abs_macd,
		p.require_snapshot,
		p.min_snapshot_nonnull_count
	FROM public.ai_signals s
	CROSS JOIN params p
	WHERE s.created_at >= p.from_ts
		AND s.created_at < p.to_ts
		AND (p.sym IS NULL OR s.symbol = p.sym)
		AND (p.tf IS NULL OR s.timeframe = p.tf)
		AND s.actual_result IN ('WIN','LOSS')
		AND s.closed_at IS NOT NULL
		-- 手動トレードは学習から除外（EA/AIのみ）
		AND (s.is_manual_trade = false OR s.is_manual_trade IS NULL)
		-- 仮想を除外したい場合
		AND (p.include_virtual OR (s.is_virtual = false OR s.is_virtual IS NULL))
),
cleaned AS (
	SELECT
		id,
		created_at,
		symbol,
		timeframe,
		dir,
		win_prob,
		require_snapshot,
		min_snapshot_nonnull_count,

		-- ラベル（WIN=1, LOSS=0）
		CASE
			WHEN actual_result = 'WIN' THEN 1
			WHEN actual_result = 'LOSS' THEN 0
			ELSE NULL
		END AS label,

		-- 重み（仮想は低重み）
		CASE
			WHEN COALESCE(is_virtual,false) THEN virtual_trade_weight
			ELSE 1.0
		END AS sample_weight,

		COALESCE(is_virtual,false) AS is_virtual,
		COALESCE(is_manual_trade,false) AS is_manual_trade,

		-- 主要特徴量（double precision）
		rsi,
		atr,
		NULLIF(atr_norm, 0) AS atr_norm,
		NULLIF(adx, 0) AS adx,
		NULLIF(di_plus, 0) AS di_plus,
		NULLIF(di_minus, 0) AS di_minus,
		NULLIF(bb_width, 0) AS bb_width,

		-- 価格・指標スナップショット（numeric(20,5) など）
		-- 明らかな外れ値は NULL 化（過去の異常値混入対策）
		CASE WHEN bid IS NULL OR ABS(bid::double precision) <= max_abs_price_like THEN bid ELSE NULL END AS bid,
		CASE WHEN ask IS NULL OR ABS(ask::double precision) <= max_abs_price_like THEN ask ELSE NULL END AS ask,
		CASE WHEN ema_25 IS NULL OR ABS(ema_25::double precision) <= max_abs_price_like THEN ema_25 ELSE NULL END AS ema_25,
		CASE WHEN sma_100 IS NULL OR ABS(sma_100::double precision) <= max_abs_price_like THEN sma_100 ELSE NULL END AS sma_100,
		ma_cross,

		CASE WHEN macd_main IS NULL OR ABS(macd_main::double precision) <= max_abs_macd THEN macd_main ELSE NULL END AS macd_main,
		CASE WHEN macd_signal IS NULL OR ABS(macd_signal::double precision) <= max_abs_macd THEN macd_signal ELSE NULL END AS macd_signal,
		CASE WHEN macd_histogram IS NULL OR ABS(macd_histogram::double precision) <= max_abs_macd THEN macd_histogram ELSE NULL END AS macd_histogram,
		macd_cross,

		CASE WHEN ichimoku_tenkan IS NULL OR ABS(ichimoku_tenkan::double precision) <= max_abs_price_like THEN ichimoku_tenkan ELSE NULL END AS ichimoku_tenkan,
		CASE WHEN ichimoku_kijun IS NULL OR ABS(ichimoku_kijun::double precision) <= max_abs_price_like THEN ichimoku_kijun ELSE NULL END AS ichimoku_kijun,
		CASE WHEN ichimoku_senkou_a IS NULL OR ABS(ichimoku_senkou_a::double precision) <= max_abs_price_like THEN ichimoku_senkou_a ELSE NULL END AS ichimoku_senkou_a,
		CASE WHEN ichimoku_senkou_b IS NULL OR ABS(ichimoku_senkou_b::double precision) <= max_abs_price_like THEN ichimoku_senkou_b ELSE NULL END AS ichimoku_senkou_b,
		CASE WHEN ichimoku_chikou IS NULL OR ABS(ichimoku_chikou::double precision) <= max_abs_price_like THEN ichimoku_chikou ELSE NULL END AS ichimoku_chikou,
		ichimoku_tk_cross,
		ichimoku_cloud_color,
		ichimoku_price_vs_cloud,

		-- スナップショット充足度（後でフィルタしやすくする）
		(
			CASE WHEN bid IS NOT NULL THEN 1 ELSE 0 END +
			CASE WHEN ask IS NOT NULL THEN 1 ELSE 0 END +
			CASE WHEN ema_25 IS NOT NULL THEN 1 ELSE 0 END +
			CASE WHEN sma_100 IS NOT NULL THEN 1 ELSE 0 END +
			CASE WHEN macd_main IS NOT NULL THEN 1 ELSE 0 END +
			CASE WHEN macd_signal IS NOT NULL THEN 1 ELSE 0 END +
			CASE WHEN ichimoku_tenkan IS NOT NULL THEN 1 ELSE 0 END +
			CASE WHEN ichimoku_kijun IS NOT NULL THEN 1 ELSE 0 END +
			CASE WHEN ichimoku_senkou_a IS NOT NULL THEN 1 ELSE 0 END +
			CASE WHEN ichimoku_senkou_b IS NOT NULL THEN 1 ELSE 0 END
		) AS snapshot_nonnull_count,
		(
			bid IS NOT NULL OR ask IS NOT NULL OR ema_25 IS NOT NULL OR sma_100 IS NOT NULL OR
			macd_main IS NOT NULL OR macd_signal IS NOT NULL OR
			ichimoku_tenkan IS NOT NULL OR ichimoku_kijun IS NOT NULL OR
			ichimoku_senkou_a IS NOT NULL OR ichimoku_senkou_b IS NOT NULL
		) AS snapshot_available,

		-- 追加メタ（存在しない環境もあるので、必要ならコメントアウトしてください）
		entry_method,
		method_selected_by,
		ml_pattern_used,
		ml_pattern_name,
		ml_pattern_confidence
	FROM base
),
filtered AS (
	SELECT *
	FROM cleaned
	WHERE label IS NOT NULL
		AND dir IN (1,-1)
		AND win_prob IS NOT NULL
		AND win_prob >= 0 AND win_prob <= 1
		AND rsi IS NOT NULL
		AND rsi >= 0 AND rsi <= 100
		AND (NOT require_snapshot OR (snapshot_available AND snapshot_nonnull_count >= min_snapshot_nonnull_count))
)
SELECT
	id,
	created_at,
	symbol,
	timeframe,
	dir,
	win_prob,
	label,
	sample_weight,
	is_virtual,
	is_manual_trade,
	rsi,
	atr,
	atr_norm,
	adx,
	di_plus,
	di_minus,
	bb_width,
	bid,
	ask,
	ema_25,
	sma_100,
	ma_cross,
	macd_main,
	macd_signal,
	macd_histogram,
	macd_cross,
	ichimoku_tenkan,
	ichimoku_kijun,
	ichimoku_senkou_a,
	ichimoku_senkou_b,
	ichimoku_chikou,
	ichimoku_tk_cross,
	ichimoku_cloud_color,
	ichimoku_price_vs_cloud,
	snapshot_nonnull_count,
	snapshot_available,
	entry_method,
	method_selected_by,
	ml_pattern_used,
	ml_pattern_name,
	ml_pattern_confidence
FROM filtered
ORDER BY created_at DESC;