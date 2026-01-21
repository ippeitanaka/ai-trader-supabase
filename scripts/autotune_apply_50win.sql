-- Autotune + apply baseline settings for "win-rate >= 50% is OK + increase opportunities"
--
-- What this does:
-- - Runs an out-of-sample (OOS) calibrated gate sweep (train -> test).
-- - Picks the best setting under constraints (min executions + realized win-rate).
-- - Applies the chosen client_min_win_prob to public.ai_config for the instance.
-- - Prints suggested env values to use with the Edge Function.
--
-- Run (local):
--   psql -X -P pager=off "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -f scripts/autotune_apply_50win.sql
--
-- Override example:
--   psql -X -P pager=off "postgresql://..." \
--     -v instance_filter='main' \
--     -v train_start='2025-10-01' -v train_end='2025-11-01' \
--     -v test_start='2025-11-01' -v test_end='2026-01-01' \
--     -v winprob_floor='0.50' -v assumed_cost_r='0.02' -v max_cost_r='0.12' \
--     -v min_exec_n='20' -v min_realized_win_rate='0.50' \
--     -f scripts/autotune_apply_50win.sql

\if :{?instance_filter}
\else
\set instance_filter 'main'
\endif

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
\set winprob_floor 0.50
\endif

\if :{?assumed_cost_r}
\else
\set assumed_cost_r 0.02
\endif

\if :{?max_cost_r}
\else
\set max_cost_r 0.12
\endif

\if :{?min_exec_n}
\else
\set min_exec_n 20
\endif

\if :{?min_realized_win_rate}
\else
\set min_realized_win_rate 0.50
\endif

\if :{?min_ev_r_min}
\else
\set min_ev_r_min 0.05
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
    r.win_prob_bin_0_05,
    r.realized_win
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
    COALESCE(m.p_cal, g.p_global, 0.50) AS win_prob_cal_est
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

-- Pick the best setting under constraints and save into psql variables.
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
),
chosen AS (
  SELECT
    a.*
  FROM agg a
  WHERE
    a.n_execute >= :'min_exec_n'::integer
    AND a.realized_win_rate_exec >= :'min_realized_win_rate'::double precision
    AND a.client_min_win_prob >= :'winprob_floor'::double precision
    AND a.min_ev_r >= :'min_ev_r_min'::double precision
  ORDER BY
    a.sum_profit_loss_exec DESC NULLS LAST,
    a.execute_rate DESC,
    a.realized_win_rate_exec DESC,
    a.client_min_win_prob ASC,
    a.min_ev_r ASC
  LIMIT 1
)
SELECT
  client_min_win_prob,
  min_ev_r,
  n_execute,
  execute_rate,
  realized_win_rate_exec,
  sum_profit_loss_exec
FROM chosen
\gset

-- If no recommendation matched constraints, fall back to safe defaults.
\if :{?client_min_win_prob}
\else
\set client_min_win_prob :winprob_floor
\set min_ev_r :min_ev_r_min
\endif

\if :{?min_ev_r}
\else
\set min_ev_r :min_ev_r_min
\endif

-- Apply: ai_config for the instance
INSERT INTO public.ai_config (instance)
SELECT :'instance_filter'::text
WHERE NOT EXISTS (
  SELECT 1 FROM public.ai_config WHERE instance = :'instance_filter'::text
);

UPDATE public.ai_config
SET
  min_win_prob = :'client_min_win_prob'::double precision,
  reward_rr = COALESCE(reward_rr, :'default_reward_rr'::double precision),
  risk_atr_mult = COALESCE(risk_atr_mult, :'default_risk_atr_mult'::double precision),
  updated_at = NOW()
WHERE instance = :'instance_filter'::text;

-- Output: what was applied
SELECT
  'APPLIED'::text AS mode,
  instance,
  min_win_prob,
  reward_rr,
  risk_atr_mult,
  updated_at
FROM public.ai_config
WHERE instance = :'instance_filter'::text;

-- Output: suggested env values
SELECT
  'SUGGESTED_ENV'::text AS mode,
  :'winprob_floor'::double precision AS AI_TRADER_MIN_WIN_PROB_FLOOR,
  :'min_ev_r'::double precision AS AI_TRADER_MIN_EV_R,
  :'max_cost_r'::double precision AS AI_TRADER_MAX_COST_R,
  :'assumed_cost_r'::double precision AS AI_TRADER_ASSUMED_COST_R,
  'on'::text AS AI_TRADER_WINPROB_CALIBRATION,
  'on'::text AS AI_TRADER_CALIBRATION_REQUIRED;
