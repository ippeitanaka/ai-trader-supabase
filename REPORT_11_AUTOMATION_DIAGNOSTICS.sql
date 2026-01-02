-- 11. 自動運用 診断レポート（Supabase SQL Editor 用）
--
-- 目的:
-- - 完全自動運用の「現状把握」と「改善点の特定」を最短で行う
-- - 銘柄別 / 時間帯別 / エントリー方式別 / AI勝率校正 / SKIP理由 をまとめて確認
--
-- 使い方:
-- 1) 各セクションの params の since/until/symbol/timeframe だけ必要に応じて変更
-- 2) Supabase SQL Editor に貼り付けて、見たいセクションだけ実行

-- =========================================================
-- 1) サマリー（対象期間の全体像）
-- =========================================================
WITH params AS (
	SELECT
		(now() - interval '14 days') AS since,
		now() AS until,
		NULL::text AS symbol,
		NULL::text AS timeframe,
		false AS include_virtual,
		false AS include_manual
), base AS (
	SELECT s.*
	FROM ai_signals s
	CROSS JOIN params p
	WHERE s.created_at >= p.since
		AND s.created_at <  p.until
		AND (p.symbol IS NULL OR s.symbol = p.symbol)
		AND (p.timeframe IS NULL OR s.timeframe = p.timeframe)
		AND (p.include_virtual OR COALESCE(s.is_virtual,false) = false)
		AND (p.include_manual  OR COALESCE(s.is_manual_trade,false) = false)
)
SELECT
	(SELECT since FROM params) AS since,
	(SELECT until FROM params) AS until,
	(SELECT symbol FROM params) AS symbol_filter,
	(SELECT timeframe FROM params) AS timeframe_filter,
	COUNT(*) AS total_signals,
	SUM(CASE WHEN actual_result = 'FILLED' THEN 1 ELSE 0 END) AS filled,
	SUM(CASE WHEN actual_result = 'WIN' THEN 1 ELSE 0 END) AS wins,
	SUM(CASE WHEN actual_result = 'LOSS' THEN 1 ELSE 0 END) AS losses,
	SUM(CASE WHEN actual_result = 'CANCELLED' THEN 1 ELSE 0 END) AS cancelled,
	SUM(CASE WHEN actual_result IS NULL THEN 1 ELSE 0 END) AS unknown_result,
	SUM(CASE WHEN COALESCE(is_virtual,false) THEN 1 ELSE 0 END) AS virtual_signals,
	SUM(CASE WHEN COALESCE(is_manual_trade,false) THEN 1 ELSE 0 END) AS manual_signals,
	ROUND(
		(SUM(CASE WHEN actual_result = 'WIN' THEN 1 ELSE 0 END)::numeric)
		/ NULLIF(SUM(CASE WHEN actual_result IN ('WIN','LOSS') THEN 1 ELSE 0 END),0)
		* 100, 2
	) AS win_rate_pct,
	ROUND(SUM(COALESCE(profit_loss,0))::numeric, 2) AS total_profit_loss
FROM base;

-- =========================================================
-- 2) 銘柄×TF 成績（WIN/LOSS 確定のみ）
-- =========================================================
WITH params AS (
	SELECT
		(now() - interval '30 days') AS since,
		now() AS until,
		NULL::text AS symbol,
		NULL::text AS timeframe,
		false AS include_virtual,
		false AS include_manual
), t AS (
	SELECT s.*
	FROM ai_signals s
	CROSS JOIN params p
	WHERE s.created_at >= p.since
		AND s.created_at <  p.until
		AND s.actual_result IN ('WIN','LOSS')
		AND (p.symbol IS NULL OR s.symbol = p.symbol)
		AND (p.timeframe IS NULL OR s.timeframe = p.timeframe)
		AND (p.include_virtual OR COALESCE(s.is_virtual,false) = false)
		AND (p.include_manual  OR COALESCE(s.is_manual_trade,false) = false)
)
SELECT
	symbol,
	timeframe,
	COUNT(*) AS trades,
	ROUND(AVG(CASE WHEN actual_result='WIN' THEN 1 ELSE 0 END)::numeric * 100, 2) AS win_rate_pct,
	ROUND(SUM(profit_loss)::numeric, 2) AS total_pl,
	ROUND(AVG(profit_loss)::numeric, 2) AS avg_pl,
	ROUND(AVG(win_prob)::numeric, 4) AS avg_pred_win_prob,
	ROUND(AVG(CASE WHEN actual_result='WIN' THEN profit_loss END)::numeric, 2) AS avg_win_pl,
	ROUND(AVG(CASE WHEN actual_result='LOSS' THEN profit_loss END)::numeric, 2) AS avg_loss_pl,
	ROUND(
		(
			(SUM(CASE WHEN profit_loss > 0 THEN profit_loss ELSE 0 END))
			/ NULLIF(ABS(SUM(CASE WHEN profit_loss < 0 THEN profit_loss ELSE 0 END)),0)
		)::numeric,
		3
	) AS profit_factor
FROM t
GROUP BY symbol, timeframe
HAVING COUNT(*) >= 5
ORDER BY total_pl DESC;

-- =========================================================
-- 3) エントリー方式別 成績（WIN/LOSS 確定のみ）
-- =========================================================
WITH params AS (
	SELECT
		(now() - interval '30 days') AS since,
		now() AS until,
		NULL::text AS symbol,
		NULL::text AS timeframe,
		false AS include_virtual,
		false AS include_manual
), t AS (
	SELECT s.*
	FROM ai_signals s
	CROSS JOIN params p
	WHERE s.created_at >= p.since
		AND s.created_at <  p.until
		AND s.actual_result IN ('WIN','LOSS')
		AND (p.symbol IS NULL OR s.symbol = p.symbol)
		AND (p.timeframe IS NULL OR s.timeframe = p.timeframe)
		AND (p.include_virtual OR COALESCE(s.is_virtual,false) = false)
		AND (p.include_manual  OR COALESCE(s.is_manual_trade,false) = false)
)
SELECT
	COALESCE(entry_method,'(null)') AS entry_method,
	COUNT(*) AS trades,
	ROUND(AVG(CASE WHEN actual_result='WIN' THEN 1 ELSE 0 END)::numeric * 100, 2) AS win_rate_pct,
	ROUND(SUM(profit_loss)::numeric, 2) AS total_pl,
	ROUND(
		(
			(SUM(CASE WHEN profit_loss > 0 THEN profit_loss ELSE 0 END))
			/ NULLIF(ABS(SUM(CASE WHEN profit_loss < 0 THEN profit_loss ELSE 0 END)),0)
		)::numeric,
		3
	) AS profit_factor,
	ROUND(AVG(win_prob)::numeric, 4) AS avg_pred_win_prob
FROM t
GROUP BY COALESCE(entry_method,'(null)')
ORDER BY total_pl DESC;

-- =========================================================
-- 4) 時間帯（UTC）×銘柄 成績（WIN/LOSS 確定のみ）
--   ※ 悪い時間帯の“切る/ガードする”候補を見つける
-- =========================================================
WITH params AS (
	SELECT
		(now() - interval '60 days') AS since,
		now() AS until,
		NULL::text AS symbol,
		NULL::text AS timeframe,
		false AS include_virtual,
		false AS include_manual
), t AS (
	SELECT
		s.*,
		EXTRACT(HOUR FROM (s.created_at AT TIME ZONE 'UTC'))::int AS utc_hour
	FROM ai_signals s
	CROSS JOIN params p
	WHERE s.created_at >= p.since
		AND s.created_at <  p.until
		AND s.actual_result IN ('WIN','LOSS')
		AND (p.symbol IS NULL OR s.symbol = p.symbol)
		AND (p.timeframe IS NULL OR s.timeframe = p.timeframe)
		AND (p.include_virtual OR COALESCE(s.is_virtual,false) = false)
		AND (p.include_manual  OR COALESCE(s.is_manual_trade,false) = false)
)
SELECT
	symbol,
	utc_hour,
	COUNT(*) AS trades,
	ROUND(AVG(CASE WHEN actual_result='WIN' THEN 1 ELSE 0 END)::numeric * 100, 2) AS win_rate_pct,
	ROUND(SUM(profit_loss)::numeric, 2) AS total_pl
FROM t
GROUP BY symbol, utc_hour
HAVING COUNT(*) >= 5
ORDER BY total_pl ASC;

-- =========================================================
-- 5) AI勝率の校正（win_prob のビン別に実際勝率を見る）
--   ※ "予測60%" が実際に60%近いか、ズレているかを確認
-- =========================================================
WITH params AS (
	SELECT
		(now() - interval '90 days') AS since,
		now() AS until,
		NULL::text AS symbol,
		NULL::text AS timeframe,
		false AS include_virtual,
		false AS include_manual
), t AS (
	SELECT
		s.*,
		FLOOR(s.win_prob * 20)::int AS prob_bin_i
	FROM ai_signals s
	CROSS JOIN params p
	WHERE s.created_at >= p.since
		AND s.created_at <  p.until
		AND s.actual_result IN ('WIN','LOSS')
		AND s.win_prob IS NOT NULL
		AND (p.symbol IS NULL OR s.symbol = p.symbol)
		AND (p.timeframe IS NULL OR s.timeframe = p.timeframe)
		AND (p.include_virtual OR COALESCE(s.is_virtual,false) = false)
		AND (p.include_manual  OR COALESCE(s.is_manual_trade,false) = false)
)
SELECT
	TO_CHAR((prob_bin_i / 20.0)::numeric, '0.00')
		|| ' - ' || TO_CHAR(((prob_bin_i / 20.0) + 0.05)::numeric, '0.00') AS prob_range,
	COUNT(*) AS trades,
	ROUND(AVG(CASE WHEN actual_result='WIN' THEN 1 ELSE 0 END)::numeric * 100, 2) AS realized_win_rate_pct,
	ROUND(AVG(win_prob)::numeric * 100, 2) AS avg_pred_win_rate_pct,
	ROUND(SUM(profit_loss)::numeric, 2) AS total_pl
FROM t
GROUP BY prob_bin_i
ORDER BY prob_bin_i DESC;

-- =========================================================
-- 6) EAログ: SKIP理由（trade_decision）上位
--   ※ "どの理由で機会が減っているか" を把握
-- =========================================================
WITH params AS (
	SELECT
		(now() - interval '7 days') AS since,
		now() AS until,
		NULL::text AS symbol,
		NULL::text AS timeframe
), l AS (
	SELECT el.*
	FROM "ea-log" el
	CROSS JOIN params p
	WHERE el.created_at >= p.since
		AND el.created_at <  p.until
		AND (p.symbol IS NULL OR el.sym = p.symbol)
		AND (p.timeframe IS NULL OR el.tf = p.timeframe)
)
SELECT
	sym,
	tf,
	trade_decision,
	COUNT(*) AS events,
	ROUND(AVG(win_prob)::numeric * 100, 2) AS avg_win_prob_pct
FROM l
GROUP BY sym, tf, trade_decision
ORDER BY events DESC
LIMIT 50;

-- =========================================================
-- 6b) EAログ: SKIPPED内訳（sym/tf 指定）
--   ※ BTCUSD が全SKIPPEDのとき、具体的な SKIPPED_* を特定する
-- =========================================================
WITH params AS (
	SELECT
		(now() - interval '14 days') AS since,
		now() AS until,
		'BTCUSD'::text AS symbol,
		'M15'::text AS timeframe
), l AS (
	SELECT el.*
	FROM "ea-log" el
	CROSS JOIN params p
	WHERE el.created_at >= p.since
		AND el.created_at <  p.until
		AND el.sym = p.symbol
		AND COALESCE(el.tf,'') = p.timeframe
		AND el.trade_decision ILIKE 'SKIPPED%'
)
SELECT
	sym,
	COALESCE(tf,'(null)') AS tf,
	trade_decision,
	COUNT(*) AS events,
	ROUND(AVG(win_prob)::numeric * 100, 2) AS avg_win_prob_pct,
	ROUND(MIN(win_prob)::numeric * 100, 2) AS min_win_prob_pct,
	ROUND(MAX(win_prob)::numeric * 100, 2) AS max_win_prob_pct
FROM l
GROUP BY sym, COALESCE(tf,'(null)'), trade_decision
ORDER BY events DESC
LIMIT 50;

-- =========================================================
-- 7) EAログ: 実行率（EXECUTED系 vs SKIPPED系）
-- =========================================================
WITH params AS (
	SELECT
		(now() - interval '7 days') AS since,
		now() AS until,
		NULL::text AS symbol,
		NULL::text AS timeframe
), l AS (
	SELECT el.*
	FROM "ea-log" el
	CROSS JOIN params p
	WHERE el.created_at >= p.since
		AND el.created_at <  p.until
		AND (p.symbol IS NULL OR el.sym = p.symbol)
		AND (p.timeframe IS NULL OR el.tf = p.timeframe)
		AND el.trade_decision IS NOT NULL
		AND el.sym <> 'UNKNOWN'
), tagged AS (
	SELECT
		sym,
		tf,
		CASE
			WHEN trade_decision ILIKE 'EXECUTED%' THEN 'EXECUTED'
			WHEN trade_decision ILIKE 'SKIPPED%' THEN 'SKIPPED'
			ELSE COALESCE(trade_decision,'(null)')
		END AS decision_bucket
	FROM l
)
SELECT
	sym,
	tf,
	decision_bucket,
	COUNT(*) AS events,
	ROUND(COUNT(*)::numeric / NULLIF(SUM(COUNT(*)) OVER (PARTITION BY sym, tf),0) * 100, 2) AS pct
FROM tagged
GROUP BY sym, tf, decision_bucket
ORDER BY sym, tf, events DESC;

-- =========================================================
-- 7b) EAログ: SKIPPEDの最近サンプル（ai_reasoning確認）
--   ※ GUARDや閾値未満などが ai_reasoning に出る前提
-- =========================================================
WITH params AS (
	SELECT
		(now() - interval '3 days') AS since,
		now() AS until,
		'BTCUSD'::text AS symbol,
		'M15'::text AS timeframe
)
SELECT
	created_at,
	at,
	sym,
	COALESCE(tf,'(null)') AS tf,
	action,
	tech_action,
	suggested_action,
	suggested_dir,
	CASE WHEN buy_win_prob IS NULL THEN NULL ELSE ROUND((buy_win_prob * 100.0)::numeric, 1) END AS buy_win_prob_pct,
	CASE WHEN sell_win_prob IS NULL THEN NULL ELSE ROUND((sell_win_prob * 100.0)::numeric, 1) END AS sell_win_prob_pct,
	trade_decision,
	ROUND((win_prob * 100.0)::numeric, 1) AS win_prob_pct,
	LEFT(COALESCE(ai_reasoning,''), 220) AS reasoning_prefix,
	order_ticket
FROM "ea-log" el
CROSS JOIN params p
WHERE el.created_at >= p.since
	AND el.created_at <  p.until
	AND el.sym = p.symbol
	AND COALESCE(el.tf,'') = p.timeframe
	AND el.trade_decision ILIKE 'SKIPPED%'
ORDER BY el.created_at DESC
LIMIT 200;

-- =========================================================
-- 9) レジーム(ADX/BB幅) × エントリー方式別 成績（WIN/LOSS 確定のみ）
--   ※ レンジ局面でbreakoutが悪化していないか、ガードの妥当性を確認
--   ※ adx / bb_width が未記録の期間は '(missing)' に入る
-- =========================================================
WITH params AS (
	SELECT
		(now() - interval '90 days') AS since,
		now() AS until,
		NULL::text AS symbol,
		NULL::text AS timeframe,
		false AS include_virtual,
		false AS include_manual,
		15::numeric AS range_adx_max,
		0.003::numeric AS range_bb_width_max
), t AS (
	SELECT
		s.*,
		CASE
			WHEN s.adx IS NULL OR s.bb_width IS NULL THEN '(missing)'
			WHEN s.adx < (SELECT range_adx_max FROM params)
				AND s.bb_width < (SELECT range_bb_width_max FROM params)
				THEN 'RANGE'
			ELSE 'NOT_RANGE'
		END AS regime
	FROM ai_signals s
	CROSS JOIN params p
	WHERE s.created_at >= p.since
		AND s.created_at <  p.until
		AND s.actual_result IN ('WIN','LOSS')
		AND (p.symbol IS NULL OR s.symbol = p.symbol)
		AND (p.timeframe IS NULL OR s.timeframe = p.timeframe)
		AND (p.include_virtual OR COALESCE(s.is_virtual,false) = false)
		AND (p.include_manual  OR COALESCE(s.is_manual_trade,false) = false)
)
SELECT
	regime,
	COALESCE(entry_method,'(null)') AS entry_method,
	COUNT(*) AS trades,
	ROUND(AVG(CASE WHEN actual_result='WIN' THEN 1 ELSE 0 END)::numeric * 100, 2) AS win_rate_pct,
	ROUND(SUM(profit_loss)::numeric, 2) AS total_pl,
	ROUND(AVG(win_prob)::numeric, 4) AS avg_pred_win_prob,
	ROUND(AVG(adx)::numeric, 2) AS avg_adx,
	ROUND(AVG(bb_width)::numeric, 6) AS avg_bb_width
FROM t
GROUP BY regime, COALESCE(entry_method,'(null)')
HAVING COUNT(*) >= 10
ORDER BY regime, total_pl DESC;

-- =========================================================
-- 8) 突合チェック: ai_signals の order_ticket が ea-log に存在しないもの
--   ※ ログ/記録漏れの確認
-- =========================================================
WITH params AS (
	SELECT
		(now() - interval '30 days') AS since,
		now() AS until,
		NULL::text AS symbol
)
SELECT
	s.created_at,
	s.symbol,
	s.timeframe,
	s.actual_result,
	s.order_ticket,
	ROUND((s.win_prob*100.0)::numeric,1) AS win_prob_pct
FROM ai_signals s
CROSS JOIN params p
WHERE s.created_at >= p.since
	AND s.created_at <  p.until
	AND s.order_ticket IS NOT NULL
	AND (p.symbol IS NULL OR s.symbol = p.symbol)
	AND NOT EXISTS (
		SELECT 1
		FROM "ea-log" el
		WHERE el.order_ticket = s.order_ticket
	)
ORDER BY s.created_at DESC
LIMIT 200;