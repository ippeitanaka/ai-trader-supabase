-- Out-of-sample (OOS) calibrated gate sweep
--
-- Goal:
-- - Build a win_prob calibration map on a TRAIN window.
-- - Apply it to a TEST window (OOS) to estimate how many trades would pass gates
--   and what realized outcomes look like.
--
-- Why:
-- - With calibration ON, raw win_prob may be overconfident and gets adjusted down.
-- - If min_win_prob is kept on the *raw* scale, executions can drop to ~0.
-- - In-sample sweeps can look too good; OOS gives a reality check.
--
-- Run:
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -f scripts/query_oos_calibrated_gate_sweep.sql
--
-- Override variables example:
--   psql "postgresql://..." \
--     -v train_start='2025-08-01' -v train_end='2025-10-01' \
--     -v test_start='2025-10-01' -v test_end='2025-12-01' \
--     -v winprob_floor='0.55' -v assumed_cost_r='0.02' -v max_cost_r='0.12' \
--     -f scripts/query_oos_calibrated_gate_sweep.sql

\if :{?instance_filter}
\else
\set instance_filter 'main'
\endif

-- Default windows are chosen to match the currently imported local data (2025-10..12).
\if :{?train_start}
\else
\set train_start '2025-10-01'
\endif

\if :{?train_end}
\else
\set train_end   '2025-11-01'
\endif

\if :{?test_start}
\else
\set test_start  '2025-11-01'
\endif

\if :{?test_end}
\else
\set test_end    '2026-01-01'
\endif

\if :{?winprob_floor}
\else
\set winprob_floor 0.55
\endif

\if :{?assumed_cost_r}
\else
\set assumed_cost_r 0.00
\endif

\if :{?max_cost_r}
\else
\set max_cost_r 0.12
\endif

\if :{?min_exec_n}
\else
\set min_exec_n 10
\endif

\if :{?min_realized_win_rate}
\else
\set min_realized_win_rate 0.50
\endif

\if :{?default_reward_rr}
\else
\set default_reward_rr 1.50
\endif

\if :{?default_risk_atr_mult}
\else
\set default_risk_atr_mult 2.00
\endif

DROP VIEW IF EXISTS oos_scored;

CREATE TEMP VIEW oos_scored AS
WITH params AS (
  SELECT
    :'instance_filter'::text AS instance_filter,
    :'train_start'::timestamptz AS train_start,
    :'train_end'::timestamptz AS train_end,
    :'test_start'::timestamptz AS test_start,
    :'test_end'::timestamptz AS test_end,
    :'winprob_floor'::double precision AS winprob_floor,
    :'assumed_cost_r'::double precision AS assumed_cost_r,
    :'max_cost_r'::double precision AS max_cost_r,
    :'default_reward_rr'::double precision AS default_reward_rr,
    :'default_risk_atr_mult'::double precision AS default_risk_atr_mult
),
cfg AS (
  SELECT
    p.*,
    COALESCE(c.reward_rr, p.default_reward_rr) AS reward_rr,
    COALESCE(c.risk_atr_mult, p.default_risk_atr_mult) AS risk_atr_mult
  FROM params p
  LEFT JOIN LATERAL (
    SELECT reward_rr, risk_atr_mult
    FROM public.ai_config
    WHERE instance = p.instance_filter
    ORDER BY updated_at DESC
    LIMIT 1
  ) c ON TRUE
),
train_base AS (
  SELECT
    r.id,
    r.created_at,
    r.symbol,
    r.timeframe,
    r.dir,
    r.win_prob AS win_prob_raw,
    r.win_prob_bin_0_05,
    r.realized_win,
    r.profit_loss,
    r.is_virtual,
    s.instance,
    s.atr,
    s.bid,
    s.ask,
    cfg.train_start,
    cfg.train_end,
    cfg.test_start,
    cfg.test_end,
    cfg.reward_rr,
    cfg.risk_atr_mult,
    cfg.winprob_floor,
    cfg.assumed_cost_r,
    cfg.max_cost_r,
    CASE
      WHEN s.ask IS NOT NULL AND s.bid IS NOT NULL AND s.ask >= s.bid
        AND s.atr IS NOT NULL AND s.atr > 0
        AND cfg.risk_atr_mult IS NOT NULL AND cfg.risk_atr_mult > 0
      THEN ((s.ask - s.bid)::double precision) / ((s.atr::double precision) * cfg.risk_atr_mult)
      ELSE cfg.assumed_cost_r
    END AS cost_r
  FROM public.ai_signals_calibration_raw r
  JOIN public.ai_signals s ON s.id = r.id
  JOIN cfg ON TRUE
  WHERE
    r.created_at >= cfg.train_start AND r.created_at < cfg.train_end
    AND r.realized_win IS NOT NULL
    AND r.is_virtual = false
    AND (cfg.instance_filter IS NULL OR s.instance = cfg.instance_filter)
),
train_map AS (
  SELECT
    win_prob_bin_0_05,
    COUNT(*) AS n,
    AVG(realized_win::double precision) AS p_cal
  FROM train_base
  GROUP BY win_prob_bin_0_05
),
train_global AS (
  SELECT
    COUNT(*) AS n,
    AVG(realized_win::double precision) AS p_global
  FROM train_base
),
test_base AS (
  SELECT
    r.id,
    r.created_at,
    r.symbol,
    r.timeframe,
    r.dir,
    r.win_prob AS win_prob_raw,
    r.win_prob_bin_0_05,
    r.realized_win,
    r.profit_loss,
    r.is_virtual,
    s.instance,
    s.atr,
    s.bid,
    s.ask,
    cfg.train_start,
    cfg.train_end,
    cfg.test_start,
    cfg.test_end,
    cfg.reward_rr,
    cfg.risk_atr_mult,
    cfg.winprob_floor,
    cfg.assumed_cost_r,
    cfg.max_cost_r,
    CASE
      WHEN s.ask IS NOT NULL AND s.bid IS NOT NULL AND s.ask >= s.bid
        AND s.atr IS NOT NULL AND s.atr > 0
        AND cfg.risk_atr_mult IS NOT NULL AND cfg.risk_atr_mult > 0
      THEN ((s.ask - s.bid)::double precision) / ((s.atr::double precision) * cfg.risk_atr_mult)
      ELSE cfg.assumed_cost_r
    END AS cost_r
  FROM public.ai_signals_calibration_raw r
  JOIN public.ai_signals s ON s.id = r.id
  JOIN cfg ON TRUE
  WHERE
    r.created_at >= cfg.test_start AND r.created_at < cfg.test_end
    AND r.realized_win IS NOT NULL
    AND r.is_virtual = false
    AND (cfg.instance_filter IS NULL OR s.instance = cfg.instance_filter)
),
with_cal AS (
  SELECT
    t.*,
    COALESCE(m.p_cal, g.p_global, 0.50) AS win_prob_cal_est,
    COALESCE(m.n, 0) AS bin_n,
    g.n AS train_n,
    g.p_global
  FROM test_base t
  LEFT JOIN train_map m
    ON m.win_prob_bin_0_05 = t.win_prob_bin_0_05
  CROSS JOIN train_global g
),
winprob_sweep AS (
  SELECT * FROM (VALUES
    (0.45::double precision),
    (0.50::double precision),
    (0.55::double precision),
    (0.60::double precision),
    (0.65::double precision)
  ) v(client_min_win_prob)
),
ev_sweep AS (
  SELECT * FROM (VALUES
    (0.00::double precision),
    (0.05::double precision),
    (0.10::double precision),
    (0.15::double precision),
    (0.20::double precision)
  ) v(min_ev_r)
),
scored AS (
  SELECT
    b.*,
    w.client_min_win_prob,
    e.min_ev_r,
    (b.win_prob_cal_est * b.reward_rr) - ((1 - b.win_prob_cal_est) * 1.0) - b.cost_r AS expected_value_r,
    GREATEST(b.winprob_floor, w.client_min_win_prob) AS action_gate_min_p,
    (b.cost_r <= b.max_cost_r) AS cost_ok,
    CASE
      WHEN (b.cost_r <= b.max_cost_r)
       AND b.win_prob_cal_est >= GREATEST(b.winprob_floor, w.client_min_win_prob)
       AND ((b.win_prob_cal_est * b.reward_rr) - ((1 - b.win_prob_cal_est) * 1.0) - b.cost_r) >= e.min_ev_r
      THEN 1 ELSE 0
    END AS would_execute
  FROM with_cal b
  CROSS JOIN winprob_sweep w
  CROSS JOIN ev_sweep e
)
SELECT * FROM scored;

-- Recommended settings under constraints (win-rate target + minimum sample size)
WITH agg AS (
  SELECT
    MIN(train_start) AS train_start,
    MIN(train_end) AS train_end,
    MIN(test_start) AS test_start,
    MIN(test_end) AS test_end,
    client_min_win_prob,
    min_ev_r,
    COUNT(*) AS n_total,
    SUM(would_execute) AS n_execute,
    ROUND((SUM(would_execute)::double precision / NULLIF(COUNT(*),0))::numeric, 4) AS execute_rate,
    ROUND(AVG(CASE WHEN would_execute=1 THEN realized_win::double precision END)::numeric, 4) AS realized_win_rate_exec,
    ROUND(AVG(CASE WHEN would_execute=1 THEN profit_loss END)::numeric, 2) AS avg_profit_loss_exec,
    ROUND(SUM(CASE WHEN would_execute=1 THEN profit_loss END)::numeric, 2) AS sum_profit_loss_exec
  FROM oos_scored
  GROUP BY client_min_win_prob, min_ev_r
)
SELECT
  'RECOMMENDED'::text AS mode,
  a.train_start,
  a.train_end,
  a.test_start,
  a.test_end,
  a.client_min_win_prob,
  a.min_ev_r,
  a.n_total,
  a.n_execute,
  a.execute_rate,
  a.realized_win_rate_exec,
  a.avg_profit_loss_exec,
  a.sum_profit_loss_exec,
  :'min_exec_n'::integer AS min_exec_n,
  :'min_realized_win_rate'::double precision AS min_realized_win_rate
FROM agg a
WHERE
  a.n_execute >= :'min_exec_n'::integer
  AND a.realized_win_rate_exec >= :'min_realized_win_rate'::double precision
ORDER BY
  a.sum_profit_loss_exec DESC NULLS LAST,
  a.execute_rate DESC,
  a.realized_win_rate_exec DESC
LIMIT 15;

-- Full sweep table (OOS)
SELECT
  'OOS'::text AS mode,
  MIN(train_start) AS train_start,
  MIN(train_end) AS train_end,
  MIN(test_start) AS test_start,
  MIN(test_end) AS test_end,
  client_min_win_prob,
  min_ev_r,
  COUNT(*) AS n_total,
  SUM(would_execute) AS n_execute,
  ROUND((SUM(would_execute)::double precision / NULLIF(COUNT(*),0))::numeric, 4) AS execute_rate,
  ROUND(AVG(win_prob_raw)::numeric, 4) AS avg_win_prob_raw,
  ROUND(AVG(win_prob_cal_est)::numeric, 4) AS avg_win_prob_cal_est,
  ROUND(AVG(cost_r)::numeric, 6) AS avg_cost_r,
  ROUND(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY cost_r)::numeric, 6) AS p95_cost_r,
  ROUND(AVG(CASE WHEN would_execute=1 THEN win_prob_cal_est END)::numeric, 4) AS avg_win_prob_cal_est_exec,
  ROUND(AVG(CASE WHEN would_execute=1 THEN realized_win::double precision END)::numeric, 4) AS realized_win_rate_exec,
  ROUND(AVG(CASE WHEN would_execute=1 THEN profit_loss END)::numeric, 2) AS avg_profit_loss_exec,
  ROUND(SUM(CASE WHEN would_execute=1 THEN profit_loss END)::numeric, 2) AS sum_profit_loss_exec
FROM oos_scored
GROUP BY client_min_win_prob, min_ev_r
ORDER BY client_min_win_prob, min_ev_r;
