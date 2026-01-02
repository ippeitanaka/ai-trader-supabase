-- REPORT_13_EA_LOG_SIGNAL_SNAPSHOT__DUAL.sql
--
-- Purpose:
--   ea-log 1行に対して、ai_signals の dir=BUY(+1) / dir=SELL(-1) をそれぞれ近い時刻で拾い、
--   「同じタイミングでBUY/SELLどちらの特徴量がどうだったか」を並べて比較する。
--
-- When useful:
--   - ai_signals 側に BUY/SELL 両方の行が残っている運用（または仮想/検証で2行残る）をしている場合。
--   - 片方しか残っていない場合は NULL になります。

WITH params AS (
  SELECT
    TIMESTAMPTZ '2026-01-02 00:00:00+00' AS from_ts,
    TIMESTAMPTZ '2026-01-03 00:00:00+00' AS to_ts,
    'XAUUSD'::text AS sym,
    'M15'::text AS tf,
    300::int AS max_dt_sec
),
base_ea AS (
  SELECT
    e.id AS ea_id,
    e.created_at AS ea_created_at,
    e.at AS ea_at,
    e.sym,
    e.tf,
    e.tech_action,
    e.suggested_action,
    e.suggested_dir,
    e.buy_win_prob,
    e.sell_win_prob,
    e.win_prob AS ea_win_prob,
    e.trade_decision,
    e.ai_reasoning
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

    -- BUY side STRICT（本命）
    b_strict.id AS buy_strict_sig_id,
    b_strict.created_at AS buy_strict_sig_created_at,
    ABS(EXTRACT(EPOCH FROM (b_strict.created_at - ea.ea_created_at)))::int AS buy_strict_dt_sec,
    b_strict.symbol AS buy_strict_symbol,
    b_strict.timeframe AS buy_strict_timeframe,
    b_strict.win_prob AS buy_strict_win_prob,
    b_strict.rsi AS buy_rsi,
    b_strict.atr AS buy_atr,
    b_strict.adx AS buy_adx,
    b_strict.bb_width AS buy_bb_width,
    b_strict.macd_cross AS buy_macd_cross,
    b_strict.ichimoku_tk_cross AS buy_tk_cross,
    b_strict.ichimoku_price_vs_cloud AS buy_price_vs_cloud,

    -- BUY side LOOSE（診断用候補）
    b_loose.id AS buy_loose_sig_id,
    b_loose.created_at AS buy_loose_sig_created_at,
    ABS(EXTRACT(EPOCH FROM (b_loose.created_at - ea.ea_created_at)))::int AS buy_loose_dt_sec,
    b_loose.symbol AS buy_loose_symbol,
    b_loose.timeframe AS buy_loose_timeframe,
    b_loose.win_prob AS buy_loose_win_prob,
    CASE
      WHEN b_strict.id IS NOT NULL THEN 'STRICT'
      WHEN b_loose.id IS NOT NULL THEN 'LOOSE'
      ELSE 'NONE'
    END AS buy_match_mode,

    -- SELL side STRICT（本命）
    s_strict.id AS sell_strict_sig_id,
    s_strict.created_at AS sell_strict_sig_created_at,
    ABS(EXTRACT(EPOCH FROM (s_strict.created_at - ea.ea_created_at)))::int AS sell_strict_dt_sec,
    s_strict.symbol AS sell_strict_symbol,
    s_strict.timeframe AS sell_strict_timeframe,
    s_strict.win_prob AS sell_strict_win_prob,
    s_strict.rsi AS sell_rsi,
    s_strict.atr AS sell_atr,
    s_strict.adx AS sell_adx,
    s_strict.bb_width AS sell_bb_width,
    s_strict.macd_cross AS sell_macd_cross,
    s_strict.ichimoku_tk_cross AS sell_tk_cross,
    s_strict.ichimoku_price_vs_cloud AS sell_price_vs_cloud,

    -- SELL side LOOSE（診断用候補）
    s_loose.id AS sell_loose_sig_id,
    s_loose.created_at AS sell_loose_sig_created_at,
    ABS(EXTRACT(EPOCH FROM (s_loose.created_at - ea.ea_created_at)))::int AS sell_loose_dt_sec,
    s_loose.symbol AS sell_loose_symbol,
    s_loose.timeframe AS sell_loose_timeframe,
    s_loose.win_prob AS sell_loose_win_prob,
    CASE
      WHEN s_strict.id IS NOT NULL THEN 'STRICT'
      WHEN s_loose.id IS NOT NULL THEN 'LOOSE'
      ELSE 'NONE'
    END AS sell_match_mode

  FROM base_ea ea
  LEFT JOIN LATERAL (
    SELECT *
    FROM public.ai_signals b
    WHERE b.symbol = ea.sym
      AND b.timeframe = ea.tf
      AND b.dir = 1
      AND b.created_at >= ea.ea_created_at - (SELECT make_interval(secs => max_dt_sec) FROM params)
      AND b.created_at <= ea.ea_created_at + (SELECT make_interval(secs => max_dt_sec) FROM params)
    ORDER BY ABS(EXTRACT(EPOCH FROM (b.created_at - ea.ea_created_at))) ASC
    LIMIT 1
  ) b_strict ON true
  LEFT JOIN LATERAL (
    SELECT *
    FROM public.ai_signals b
    WHERE b.created_at >= ea.ea_created_at - (SELECT make_interval(secs => max_dt_sec) FROM params)
      AND b.created_at <= ea.ea_created_at + (SELECT make_interval(secs => max_dt_sec) FROM params)
      AND b.dir = 1
    ORDER BY ABS(EXTRACT(EPOCH FROM (b.created_at - ea.ea_created_at))) ASC
    LIMIT 1
  ) b_loose ON b_strict.id IS NULL
  LEFT JOIN LATERAL (
    SELECT *
    FROM public.ai_signals s
    WHERE s.symbol = ea.sym
      AND s.timeframe = ea.tf
      AND s.dir = -1
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
      AND s.dir = -1
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
  tech_action,
  suggested_action,
  suggested_dir,
  ea_win_prob,
  buy_win_prob,
  sell_win_prob,
  trade_decision,
  ai_reasoning,

  buy_match_mode,
  buy_strict_sig_id,
  buy_strict_sig_created_at,
  buy_strict_dt_sec,
  buy_strict_symbol,
  buy_strict_timeframe,
  buy_strict_win_prob,

  buy_loose_sig_id,
  buy_loose_sig_created_at,
  buy_loose_dt_sec,
  buy_loose_symbol,
  buy_loose_timeframe,
  buy_loose_win_prob,

  buy_rsi,
  buy_atr,
  buy_adx,
  buy_bb_width,
  buy_macd_cross,
  buy_tk_cross,
  buy_price_vs_cloud,

  sell_match_mode,
  sell_strict_sig_id,
  sell_strict_sig_created_at,
  sell_strict_dt_sec,
  sell_strict_symbol,
  sell_strict_timeframe,
  sell_strict_win_prob,

  sell_loose_sig_id,
  sell_loose_sig_created_at,
  sell_loose_dt_sec,
  sell_loose_symbol,
  sell_loose_timeframe,
  sell_loose_win_prob,

  sell_rsi,
  sell_atr,
  sell_adx,
  sell_bb_width,
  sell_macd_cross,
  sell_tk_cross,
  sell_price_vs_cloud
FROM joined
ORDER BY ea_created_at DESC;
