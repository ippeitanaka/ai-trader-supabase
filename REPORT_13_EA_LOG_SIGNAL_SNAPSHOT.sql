-- REPORT_13_EA_LOG_SIGNAL_SNAPSHOT.sql
--
-- Purpose:
--   ea-log（運用ログ）と ai_signals（学習/特徴量保存）を突き合わせて、
--   「なぜAI推奨がBUY/SELLどちら寄りになったのか」を指標値ベースで検証できるようにする。
--
-- Notes:
--   - "ea-log" はハイフン付きテーブル名なので必ずダブルクォートで囲む。
--   - EAが送る at はタイムゾーン解釈でズレるケースがあるため、まずは created_at 同士の近さでJOINする。
--   - ai_signals は 1判断=1行（通常）なので、ea-log 1行につき「created_at が最も近い ai_signals」を1件引く。
--
-- How to use:
--   1) params の期間と銘柄/TFを必要に応じて変更
--   2) 実行 → dt_sec が小さいほど同一判断に近い

-- Quick sanity checks (run together; this file contains multiple SELECT statements)
-- - If ai_signals_count = 0, the EA is likely not writing ai_signals for these decisions.
-- - If ai_signals_count > 0 but STRICT match fails, you may have symbol/timeframe mismatch (e.g., suffix) or clock skew.
WITH params AS (
  SELECT
    TIMESTAMPTZ '2026-01-02 00:00:00+00' AS from_ts,
    TIMESTAMPTZ '2026-01-03 00:00:00+00' AS to_ts,
    'XAUUSD'::text AS sym,
    'M15'::text AS tf
)
SELECT
  (SELECT count(*) FROM "ea-log" e CROSS JOIN params p
    WHERE e.created_at >= p.from_ts AND e.created_at < p.to_ts
      AND (p.sym IS NULL OR e.sym = p.sym)
      AND (p.tf IS NULL OR e.tf = p.tf)
  ) AS ea_log_count,
  (SELECT count(*) FROM public.ai_signals s CROSS JOIN params p
    WHERE s.created_at >= p.from_ts AND s.created_at < p.to_ts
      AND (p.sym IS NULL OR s.symbol = p.sym)
      AND (p.tf IS NULL OR s.timeframe = p.tf)
  ) AS ai_signals_count,
  (SELECT count(*) FROM public.ai_signals s CROSS JOIN params p
    WHERE s.created_at >= p.from_ts AND s.created_at < p.to_ts
  ) AS ai_signals_count_all_symbols;

WITH params AS (
  SELECT
    -- ここを調査したい期間に変更（UTC想定）
    TIMESTAMPTZ '2026-01-02 00:00:00+00' AS from_ts,
    TIMESTAMPTZ '2026-01-03 00:00:00+00' AS to_ts,

    -- 絞り込み（NULLなら全件）
    'XAUUSD'::text AS sym,
    'M15'::text AS tf,

    -- created_at の許容差（秒）: ea-log と ai_signals のINSERT時刻が多少ズレても拾う
    30::int AS max_dt_sec
),
base_ea AS (
  SELECT
    e.id AS ea_id,
    e.created_at AS ea_created_at,
    e.at AS ea_at,
    e.sym,
    e.tf,
    e.action,
    e.tech_action,
    e.suggested_action,
    e.suggested_dir,
    e.buy_win_prob,
    e.sell_win_prob,
    e.win_prob AS ea_win_prob,
    e.trade_decision,
    e.ai_reasoning,
    e.order_ticket
  FROM "ea-log" e
  CROSS JOIN params p
  WHERE e.created_at >= p.from_ts
    AND e.created_at < p.to_ts
    AND (p.sym IS NULL OR e.sym = p.sym)
    AND (p.tf IS NULL OR e.tf = p.tf)
),
joined AS (
  SELECT
    ea.*,
    -- STRICT（symbol/tf一致）: これが本命の結合
    s_strict.id AS strict_sig_id,
    s_strict.created_at AS strict_sig_created_at,
    s_strict.symbol AS strict_sig_symbol,
    s_strict.timeframe AS strict_sig_timeframe,
    s_strict.dir AS strict_sig_dir,
    s_strict.win_prob AS strict_sig_win_prob,

    -- LOOSE（時刻近傍の診断用候補）: 別銘柄/別TFが混ざり得るのでfeaturesには使わない
    s_loose.id AS loose_sig_id,
    s_loose.created_at AS loose_sig_created_at,
    s_loose.symbol AS loose_sig_symbol,
    s_loose.timeframe AS loose_sig_timeframe,
    s_loose.dir AS loose_sig_dir,
    s_loose.win_prob AS loose_sig_win_prob,

    CASE
      WHEN s_strict.id IS NOT NULL THEN 'STRICT'
      WHEN s_loose.id IS NOT NULL THEN 'LOOSE'
      ELSE 'NONE'
    END AS match_mode,

    -- core features（STRICTのみ）
    s_strict.price AS price,
    s_strict.bid AS bid,
    s_strict.ask AS ask,
    s_strict.rsi AS rsi,
    s_strict.atr AS atr,
    s_strict.atr_norm AS atr_norm,
    s_strict.adx AS adx,
    s_strict.di_plus AS di_plus,
    s_strict.di_minus AS di_minus,
    s_strict.bb_width AS bb_width,

    -- MA/MACD（STRICTのみ）
    s_strict.ema_25 AS ema_25,
    s_strict.sma_100 AS sma_100,
    s_strict.ma_cross AS ma_cross,
    s_strict.macd_main AS macd_main,
    s_strict.macd_signal AS macd_signal,
    s_strict.macd_histogram AS macd_histogram,
    s_strict.macd_cross AS macd_cross,

    -- Ichimoku（STRICTのみ）
    s_strict.ichimoku_tenkan AS ichimoku_tenkan,
    s_strict.ichimoku_kijun AS ichimoku_kijun,
    s_strict.ichimoku_senkou_a AS ichimoku_senkou_a,
    s_strict.ichimoku_senkou_b AS ichimoku_senkou_b,
    s_strict.ichimoku_chikou AS ichimoku_chikou,
    s_strict.ichimoku_tk_cross AS ichimoku_tk_cross,
    s_strict.ichimoku_cloud_color AS ichimoku_cloud_color,
    s_strict.ichimoku_price_vs_cloud AS ichimoku_price_vs_cloud,

    -- Derived helpers（説明用 / STRICTのみ）
    (s_strict.ema_25 - s_strict.sma_100) AS ma_diff_25_100,
    (s_strict.macd_main - s_strict.macd_signal) AS macd_diff,
    (s_strict.ichimoku_tenkan - s_strict.ichimoku_kijun) AS ichimoku_tk_diff,
    LEAST(s_strict.ichimoku_senkou_a, s_strict.ichimoku_senkou_b) AS ichimoku_cloud_bottom,
    GREATEST(s_strict.ichimoku_senkou_a, s_strict.ichimoku_senkou_b) AS ichimoku_cloud_top,
    ABS(s_strict.ichimoku_senkou_a - s_strict.ichimoku_senkou_b) AS ichimoku_cloud_thickness,

    CASE
      WHEN ea.suggested_dir NOT IN (1,-1) THEN NULL
      WHEN s_strict.ema_25 IS NULL OR s_strict.sma_100 IS NULL THEN NULL
      WHEN ea.suggested_dir = 1 THEN (s_strict.ema_25 > s_strict.sma_100)
      WHEN ea.suggested_dir = -1 THEN (s_strict.ema_25 < s_strict.sma_100)
      ELSE NULL
    END AS align_ma_with_suggested_dir,
    CASE
      WHEN ea.suggested_dir NOT IN (1,-1) THEN NULL
      WHEN s_strict.macd_main IS NULL OR s_strict.macd_signal IS NULL THEN NULL
      WHEN ea.suggested_dir = 1 THEN (s_strict.macd_main > s_strict.macd_signal)
      WHEN ea.suggested_dir = -1 THEN (s_strict.macd_main < s_strict.macd_signal)
      ELSE NULL
    END AS align_macd_with_suggested_dir,
    CASE
      WHEN ea.suggested_dir NOT IN (1,-1) THEN NULL
      WHEN s_strict.ichimoku_price_vs_cloud IS NULL THEN NULL
      WHEN ea.suggested_dir = 1 THEN (s_strict.ichimoku_price_vs_cloud = 1)
      WHEN ea.suggested_dir = -1 THEN (s_strict.ichimoku_price_vs_cloud = -1)
      ELSE NULL
    END AS align_price_vs_cloud_with_suggested_dir,

    -- Helpful: ai_signals context（STRICTのみ）
    s_strict.reason AS sig_reason,
    s_strict.instance AS sig_instance,
    s_strict.model_version AS sig_model_version,
    s_strict.entry_method AS sig_entry_method,
    s_strict.method_selected_by AS sig_method_selected_by,

    -- time delta
    ABS(EXTRACT(EPOCH FROM (s_strict.created_at - ea.ea_created_at)))::int AS strict_dt_sec,
    ABS(EXTRACT(EPOCH FROM (s_loose.created_at - ea.ea_created_at)))::int AS loose_dt_sec
  FROM base_ea ea
  LEFT JOIN LATERAL (
    SELECT *
    FROM public.ai_signals s
    WHERE s.symbol = ea.sym
      AND s.timeframe = ea.tf
      AND s.created_at >= ea.ea_created_at - (SELECT make_interval(secs => max_dt_sec) FROM params)
      AND s.created_at <= ea.ea_created_at + (SELECT make_interval(secs => max_dt_sec) FROM params)
    ORDER BY ABS(EXTRACT(EPOCH FROM (s.created_at - ea.ea_created_at))) ASC
    LIMIT 1
  ) s_strict ON true
  LEFT JOIN LATERAL (
    SELECT *
    FROM public.ai_signals s
    WHERE s.created_at >= ea.ea_created_at - (SELECT make_interval(secs => max_dt_sec) FROM params)
      AND s.created_at <= ea.ea_created_at + (SELECT make_interval(secs => max_dt_sec) FROM params)
    ORDER BY ABS(EXTRACT(EPOCH FROM (s.created_at - ea.ea_created_at))) ASC
    LIMIT 1
  ) s_loose ON s_strict.id IS NULL
)
SELECT
  ea_id,
  ea_created_at,
  ea_at,
  sym,
  tf,
  action,
  tech_action,
  suggested_action,
  suggested_dir,
  ea_win_prob,
  buy_win_prob,
  sell_win_prob,
  trade_decision,
  ai_reasoning,
  order_ticket,

  match_mode,

  -- STRICT（本命）
  strict_sig_id,
  strict_sig_created_at,
  strict_dt_sec,
  strict_sig_dir,
  strict_sig_win_prob,
  strict_sig_symbol,
  strict_sig_timeframe,

  -- LOOSE（診断用候補）
  loose_sig_id,
  loose_sig_created_at,
  loose_dt_sec,
  loose_sig_dir,
  loose_sig_win_prob,
  loose_sig_symbol,
  loose_sig_timeframe,

  -- features snapshot
  price,
  bid,
  ask,
  rsi,
  atr,
  atr_norm,
  adx,
  di_plus,
  di_minus,
  bb_width,

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

  -- derived helpers
  ma_diff_25_100,
  macd_diff,
  ichimoku_tk_diff,
  ichimoku_cloud_bottom,
  ichimoku_cloud_top,
  ichimoku_cloud_thickness,
  align_ma_with_suggested_dir,
  align_macd_with_suggested_dir,
  align_price_vs_cloud_with_suggested_dir,

  sig_reason,
  sig_instance,
  sig_model_version,
  sig_entry_method,
  sig_method_selected_by
FROM joined
ORDER BY ea_created_at DESC;
