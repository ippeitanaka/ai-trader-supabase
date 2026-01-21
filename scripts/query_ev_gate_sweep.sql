-- EV gate sweep report
-- Purpose:
-- - Tune AI_TRADER_MIN_EV_R / win_prob floor using historical realized outcomes.
-- - Simulate the server-side gate introduced in supabase/functions/ai-trader/index.ts:
--     - expected_value_r = p*RR - (1-p)*1 - costR
--     - ev_gate_min_p = (1 + costR + min_ev_r) / (RR + 1)
--     - action_gate_min_p = max(winprob_floor, client_min_win_prob)
--     - execute if p >= action_gate_min_p AND expected_value_r >= min_ev_r
--
-- How to run:
--   supabase db query --file scripts/query_ev_gate_sweep.sql
--
-- Notes:
-- - Uses public.ai_signals_calibration_raw view for realized_win/profit_loss.
-- - Joins public.ai_signals for bid/ask/atr/instance.
-- - Prefer analyzing is_virtual=true (shadow trades) to reduce selection bias.

DROP VIEW IF EXISTS ev_sweep_base;
CREATE TEMP VIEW ev_sweep_base AS
WITH params AS (
  SELECT
    'main'::text AS instance_filter,
    0.50::double precision AS winprob_floor,
    -- If bid/ask are missing in historical data, fall back to this assumed cost in R.
    0.02::double precision AS assumed_cost_r,
    -- Hard cost guard (same meaning as AI_TRADER_MAX_COST_R)
    0.12::double precision AS max_cost_r,
    -- Recommendation constraints
    20::integer AS min_exec_n,
    0.50::double precision AS min_realized_win_rate,
    -- If ai_config has values, they override these defaults.
    1.50::double precision AS default_reward_rr,
    2.00::double precision AS default_risk_atr_mult,
    0.55::double precision AS default_client_min_win_prob
),
cfg AS (
  SELECT
    p.instance_filter,
    COALESCE(c.reward_rr, p.default_reward_rr) AS reward_rr,
    COALESCE(c.risk_atr_mult, p.default_risk_atr_mult) AS risk_atr_mult,
    COALESCE(c.min_win_prob, p.default_client_min_win_prob) AS client_min_win_prob,
    p.winprob_floor,
    p.assumed_cost_r,
    p.max_cost_r,
    p.min_exec_n,
    p.min_realized_win_rate
  FROM params p
  LEFT JOIN LATERAL (
    SELECT reward_rr, risk_atr_mult, min_win_prob
    FROM public.ai_config
    WHERE instance = p.instance_filter
    ORDER BY updated_at DESC
    LIMIT 1
  ) c ON TRUE
),
periods AS (
  SELECT '2025-10/11'::text AS period, '2025-10-01'::timestamptz AS start_at, '2025-12-01'::timestamptz AS end_at
  UNION ALL
  SELECT 'Recent-14d', (NOW() - INTERVAL '14 days')::timestamptz, NOW()::timestamptz
)
SELECT
  pr.period,
  r.created_at,
  r.symbol,
  r.timeframe,
  r.dir,
  r.win_prob,
  r.realized_win,
  r.brier_score,
  r.profit_loss,
  r.regime,
  r.strategy,
  r.regime_confidence,
  r.is_virtual,
  s.instance,
  s.atr,
  s.bid,
  s.ask,
  cfg.reward_rr,
  cfg.risk_atr_mult,
  cfg.client_min_win_prob,
  cfg.winprob_floor,
  cfg.assumed_cost_r,
  cfg.max_cost_r,
  cfg.min_exec_n,
  cfg.min_realized_win_rate,
  -- costR = spread / (ATR * risk_atr_mult)
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
  AND r.is_virtual IN (false, true)
  AND (cfg.instance_filter IS NULL OR s.instance = cfg.instance_filter);

-- 1) Show the effective parameters used
SELECT
  MIN(instance) AS instance,
  ROUND(AVG(reward_rr)::numeric, 4) AS reward_rr,
  ROUND(AVG(risk_atr_mult)::numeric, 4) AS risk_atr_mult,
  ROUND(AVG(client_min_win_prob)::numeric, 4) AS client_min_win_prob,
  ROUND(AVG(winprob_floor)::numeric, 4) AS winprob_floor,
  ROUND(AVG(assumed_cost_r)::numeric, 6) AS assumed_cost_r,
  ROUND(AVG(cost_r)::numeric, 6) AS avg_cost_r,
  ROUND(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY cost_r)::numeric, 6) AS p95_cost_r,
  COUNT(*) AS n
FROM ev_sweep_base;

-- 2) Sweep min_ev_r (recommend values that maximize profit while keeping enough trades)
WITH sweep AS (
  SELECT * FROM (VALUES
    (0.00::double precision),
    (0.05::double precision),
    (0.10::double precision),
    (0.15::double precision),
    (0.20::double precision),
    (0.25::double precision),
    (0.30::double precision)
  ) v(min_ev_r)
),
scored AS (
  SELECT
    b.*,
    s.min_ev_r,
    -- ev_gate_min_p per-row
    LEAST(0.90, GREATEST(0.00, (1 + b.cost_r + s.min_ev_r) / (b.reward_rr + 1))) AS ev_gate_min_p,
    -- action_gate_min_p = max(floor, clientMin)
    GREATEST(b.winprob_floor, b.client_min_win_prob) AS action_gate_min_p,
    -- expected_value_r in R-multiples
    (b.win_prob * b.reward_rr) - ((1 - b.win_prob) * 1.0) - b.cost_r AS expected_value_r,
    (b.cost_r <= b.max_cost_r) AS cost_ok,
    CASE
      WHEN (b.cost_r <= b.max_cost_r)
      AND b.win_prob >= GREATEST(b.winprob_floor, b.client_min_win_prob)
      AND ((b.win_prob * b.reward_rr) - ((1 - b.win_prob) * 1.0) - b.cost_r) >= s.min_ev_r
      THEN 1 ELSE 0
    END AS would_execute
  FROM ev_sweep_base b
  CROSS JOIN sweep s
)
SELECT
  period,
  CASE WHEN is_virtual THEN 'virtual' ELSE 'real' END AS trade_type,
  MIN(min_ev_r) AS min_ev_r,
  COUNT(*) AS n_total,
  SUM(would_execute) AS n_execute,
  ROUND((SUM(would_execute)::double precision / NULLIF(COUNT(*),0))::numeric, 4) AS execute_rate,
  ROUND(AVG(expected_value_r)::numeric, 4) AS avg_expected_value_r,
  ROUND(AVG(CASE WHEN would_execute=1 THEN expected_value_r END)::numeric, 4) AS avg_expected_value_r_exec,
  ROUND(AVG(CASE WHEN would_execute=1 THEN win_prob END)::numeric, 4) AS avg_win_prob_exec,
  ROUND(AVG(CASE WHEN would_execute=1 THEN realized_win::double precision END)::numeric, 4) AS realized_win_rate_exec,
  ROUND(AVG(CASE WHEN would_execute=1 THEN profit_loss END)::numeric, 2) AS avg_profit_loss_exec,
  ROUND(SUM(CASE WHEN would_execute=1 THEN profit_loss END)::numeric, 2) AS sum_profit_loss_exec
FROM scored
GROUP BY period, trade_type, min_ev_r
ORDER BY period, trade_type, min_ev_r;

-- 2b) Recommend min_ev_r under constraints (>=50% realized win-rate and enough executions)
WITH sweep AS (
  SELECT * FROM (VALUES
    (0.00::double precision),
    (0.05::double precision),
    (0.10::double precision),
    (0.15::double precision),
    (0.20::double precision),
    (0.25::double precision),
    (0.30::double precision)
  ) v(min_ev_r)
),
scored AS (
  SELECT
    b.*,
    s.min_ev_r,
    (b.win_prob * b.reward_rr) - ((1 - b.win_prob) * 1.0) - b.cost_r AS expected_value_r,
    (b.cost_r <= b.max_cost_r) AS cost_ok,
    CASE
      WHEN (b.cost_r <= b.max_cost_r)
      AND b.win_prob >= GREATEST(b.winprob_floor, b.client_min_win_prob)
      AND ((b.win_prob * b.reward_rr) - ((1 - b.win_prob) * 1.0) - b.cost_r) >= s.min_ev_r
      THEN 1 ELSE 0
    END AS would_execute
  FROM ev_sweep_base b
  CROSS JOIN sweep s
),
agg AS (
  SELECT
    period,
    CASE WHEN is_virtual THEN 'virtual' ELSE 'real' END AS trade_type,
    min_ev_r,
    MIN(min_exec_n) AS min_exec_n,
    MIN(min_realized_win_rate) AS min_realized_win_rate,
    COUNT(*) AS n_total,
    SUM(would_execute) AS n_execute,
    ROUND((SUM(would_execute)::double precision / NULLIF(COUNT(*),0))::numeric, 4) AS execute_rate,
    ROUND(AVG(CASE WHEN would_execute=1 THEN realized_win::double precision END)::numeric, 4) AS realized_win_rate_exec,
    ROUND(AVG(CASE WHEN would_execute=1 THEN profit_loss END)::numeric, 2) AS avg_profit_loss_exec,
    ROUND(SUM(CASE WHEN would_execute=1 THEN profit_loss END)::numeric, 2) AS sum_profit_loss_exec
  FROM scored
  GROUP BY period, trade_type, min_ev_r
)
SELECT
  period,
  trade_type,
  min_ev_r,
  n_execute,
  execute_rate,
  realized_win_rate_exec,
  avg_profit_loss_exec,
  sum_profit_loss_exec,
  min_exec_n,
  min_realized_win_rate
FROM agg
WHERE
  n_execute >= min_exec_n
  AND realized_win_rate_exec >= min_realized_win_rate
ORDER BY
  period,
  trade_type,
  sum_profit_loss_exec DESC NULLS LAST,
  execute_rate DESC,
  realized_win_rate_exec DESC;

-- 3) Optional: Break down by regime/strategy for the chosen min_ev_r (edit this value as needed)
-- Example: set min_ev_r=0.10 to match default.
WITH picked AS (
  SELECT 0.10::double precision AS min_ev_r
),
scored AS (
  SELECT
    b.*,
    p.min_ev_r,
    LEAST(0.90, GREATEST(0.00, (1 + b.cost_r + p.min_ev_r) / (b.reward_rr + 1))) AS ev_gate_min_p,
    GREATEST(b.winprob_floor, b.client_min_win_prob) AS action_gate_min_p,
    (b.win_prob * b.reward_rr) - ((1 - b.win_prob) * 1.0) - b.cost_r AS expected_value_r,
    CASE
      WHEN (b.cost_r <= b.max_cost_r)
      AND b.win_prob >= GREATEST(b.winprob_floor, b.client_min_win_prob)
      AND ((b.win_prob * b.reward_rr) - ((1 - b.win_prob) * 1.0) - b.cost_r) >= p.min_ev_r
      THEN 1 ELSE 0
    END AS would_execute
  FROM ev_sweep_base b
  CROSS JOIN picked p
)
SELECT
  period,
  regime,
  strategy,
  COUNT(*) AS n,
  SUM(would_execute) AS n_execute,
  ROUND(AVG(CASE WHEN would_execute=1 THEN profit_loss END)::numeric, 2) AS avg_profit_loss_exec,
  ROUND(SUM(CASE WHEN would_execute=1 THEN profit_loss END)::numeric, 2) AS sum_profit_loss_exec
FROM scored
GROUP BY period, regime, strategy
HAVING COUNT(*) >= 20
ORDER BY sum_profit_loss_exec ASC;
