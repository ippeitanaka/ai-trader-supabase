-- Calibrated gate sweep (approx)
-- Purpose:
-- - The runtime Edge Function calibrates win_prob downward based on realized outcomes.
-- - If you keep ai_config.min_win_prob on the *old (raw)* scale (e.g. 0.70),
--   you can end up with near-zero executions after calibration.
-- - This script approximates that effect by replacing per-row win_prob with a
--   bin-calibrated estimate (realized win-rate by 0.05 bin), then sweeping gates.
--
-- How to run:
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -f scripts/query_calibrated_gate_sweep.sql
--
-- Notes:
-- - This is an *in-sample* approximation (uses the same period to build the mapping).
--   For a truer estimate, build the mapping on an earlier period and evaluate on a later one.

\set instance_filter 'main'
\set winprob_floor 0.55
\set assumed_cost_r 0.00
\set default_reward_rr 1.50
\set default_risk_atr_mult 2.00

WITH params AS (
  SELECT
    :'instance_filter'::text AS instance_filter,
    :'winprob_floor'::double precision AS winprob_floor,
    :'assumed_cost_r'::double precision AS assumed_cost_r,
    :'default_reward_rr'::double precision AS default_reward_rr,
    :'default_risk_atr_mult'::double precision AS default_risk_atr_mult
),
cfg AS (
  SELECT
    p.instance_filter,
    COALESCE(c.reward_rr, p.default_reward_rr) AS reward_rr,
    COALESCE(c.risk_atr_mult, p.default_risk_atr_mult) AS risk_atr_mult,
    p.winprob_floor,
    p.assumed_cost_r
  FROM params p
  LEFT JOIN LATERAL (
    SELECT reward_rr, risk_atr_mult
    FROM public.ai_config
    WHERE instance = p.instance_filter
    ORDER BY updated_at DESC
    LIMIT 1
  ) c ON TRUE
),
periods AS (
  SELECT '2025-10/11'::text AS period, '2025-10-01'::timestamptz AS start_at, '2025-12-01'::timestamptz AS end_at
),
base AS (
  SELECT
    pr.period,
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
    cfg.reward_rr,
    cfg.risk_atr_mult,
    cfg.winprob_floor,
    cfg.assumed_cost_r,
    CASE
      WHEN s.ask IS NOT NULL AND s.bid IS NOT NULL AND s.ask >= s.bid
        AND s.atr IS NOT NULL AND s.atr > 0
        AND cfg.risk_atr_mult IS NOT NULL AND cfg.risk_atr_mult > 0
      THEN (s.ask - s.bid) / (s.atr * cfg.risk_atr_mult)
      ELSE cfg.assumed_cost_r
    END AS cost_r
  FROM public.ai_signals_calibration_raw r
  JOIN public.ai_signals s ON s.id = r.id
  JOIN cfg ON TRUE
  JOIN periods pr
    ON r.created_at >= pr.start_at AND r.created_at < pr.end_at
  WHERE
    r.realized_win IS NOT NULL
    AND r.is_virtual = false
    AND (cfg.instance_filter IS NULL OR s.instance = cfg.instance_filter)
),
calib_map AS (
  SELECT
    period,
    win_prob_bin_0_05,
    AVG(realized_win::double precision) AS p_cal
  FROM base
  GROUP BY period, win_prob_bin_0_05
),
with_cal AS (
  SELECT
    b.*,
    COALESCE(m.p_cal, 0.50) AS win_prob_cal_est
  FROM base b
  LEFT JOIN calib_map m
    ON m.period = b.period AND m.win_prob_bin_0_05 = b.win_prob_bin_0_05
),
winprob_sweep AS (
  SELECT * FROM (VALUES
    (0.45::double precision),
    (0.50::double precision),
    (0.55::double precision),
    (0.60::double precision),
    (0.65::double precision),
    (0.70::double precision)
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
    b.period,
    b.win_prob_raw,
    b.win_prob_cal_est,
    b.realized_win,
    b.profit_loss,
    b.reward_rr,
    b.cost_r,
    w.client_min_win_prob,
    e.min_ev_r,
    (b.win_prob_cal_est * b.reward_rr) - ((1 - b.win_prob_cal_est) * 1.0) - b.cost_r AS expected_value_r,
    GREATEST(b.winprob_floor, w.client_min_win_prob) AS action_gate_min_p,
    CASE
      WHEN b.win_prob_cal_est >= GREATEST(b.winprob_floor, w.client_min_win_prob)
       AND ((b.win_prob_cal_est * b.reward_rr) - ((1 - b.win_prob_cal_est) * 1.0) - b.cost_r) >= e.min_ev_r
      THEN 1 ELSE 0
    END AS would_execute
  FROM with_cal b
  CROSS JOIN winprob_sweep w
  CROSS JOIN ev_sweep e
)
SELECT
  period,
  client_min_win_prob,
  min_ev_r,
  COUNT(*) AS n_total,
  SUM(would_execute) AS n_execute,
  ROUND((SUM(would_execute)::double precision / NULLIF(COUNT(*),0))::numeric, 4) AS execute_rate,
  ROUND(AVG(win_prob_raw)::numeric, 4) AS avg_win_prob_raw,
  ROUND(AVG(win_prob_cal_est)::numeric, 4) AS avg_win_prob_cal_est,
  ROUND(AVG(CASE WHEN would_execute=1 THEN win_prob_cal_est END)::numeric, 4) AS avg_win_prob_cal_est_exec,
  ROUND(AVG(CASE WHEN would_execute=1 THEN realized_win::double precision END)::numeric, 4) AS realized_win_rate_exec,
  ROUND(AVG(CASE WHEN would_execute=1 THEN profit_loss END)::numeric, 2) AS avg_profit_loss_exec,
  ROUND(SUM(CASE WHEN would_execute=1 THEN profit_loss END)::numeric, 2) AS sum_profit_loss_exec
FROM scored
GROUP BY period, client_min_win_prob, min_ev_r
ORDER BY period, client_min_win_prob, min_ev_r;
