-- LOSS deep-dive report
-- Purpose: Investigate why executed trades lost, where losses cluster, and whether
--          the model is overconfident in specific symbols, methods, or regimes.
--
-- Recommended usage:
-- 1) Supabase SQL Editor: run section by section
-- 2) Local psql:
--    psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -f scripts/query_trade_losses_deep_dive.sql
--
-- Requirements:
-- - public.trade_audit_monitor view
-- - public.ai_signals postmortem columns from 20251228212000_add_ai_signals_postmortem.sql

DROP VIEW IF EXISTS loss_base;

CREATE TEMP VIEW loss_base AS
SELECT
  t."判断日時",
  t."ログ記録日時",
  t."signal記録日時",
  t."決済日時",
  t."銘柄",
  t."TF",
  t."EA判定コード",
  t."取引判定",
  t."実行結果",
  t."最終方向",
  t."AI推奨方向",
  t."判定勝率%",
  t."推奨最小勝率%",
  t."期待値R",
  t."手法",
  t."手法選択者",
  t."手法の理由",
  t."実行ロット",
  t."判定要約",
  t."見送り理由コード",
  t."実施根拠",
  t."注文番号",
  t."約定価格",
  t."決済価格",
  t."損益",
  t."保有分数",
  s.regime,
  s.strategy,
  s.regime_confidence,
  s.win_prob AS raw_win_prob,
  s.entry_method AS raw_entry_method,
  s.method_reason AS raw_method_reason,
  s.decision_summary AS raw_decision_summary,
  s.postmortem_tags,
  s.postmortem_summary,
  s.postmortem_generated_at,
  s.postmortem_model,
  s.lot_multiplier,
  s.executed_lot,
  s.ml_pattern_used,
  s.ml_pattern_name,
  s.ml_pattern_confidence
FROM public.trade_audit_monitor t
LEFT JOIN LATERAL (
  SELECT
    s.regime,
    s.strategy,
    s.regime_confidence,
    s.win_prob,
    s.entry_method,
    s.method_reason,
    s.decision_summary,
    s.postmortem_tags,
    s.postmortem_summary,
    s.postmortem_generated_at,
    s.postmortem_model,
    s.lot_multiplier,
    s.executed_lot,
    s.ml_pattern_used,
    s.ml_pattern_name,
    s.ml_pattern_confidence
  FROM public.ai_signals s
  WHERE s.order_ticket = t."注文番号"
  ORDER BY s.created_at DESC, s.id DESC
  LIMIT 1
) s ON true
WHERE t."取引判定" = '実行'
  AND t."実行結果" = 'LOSS';

-- 1) Latest losses with full operator context
SELECT
  "判断日時",
  "銘柄",
  "TF",
  "最終方向",
  "判定勝率%",
  "推奨最小勝率%",
  "期待値R",
  COALESCE("手法", raw_entry_method, 'unknown') AS method,
  COALESCE("判定要約", raw_decision_summary) AS decision_summary,
  "実施根拠",
  regime,
  strategy,
  regime_confidence,
  "損益",
  "保有分数",
  postmortem_tags,
  postmortem_summary,
  "注文番号"
FROM loss_base
ORDER BY "判断日時" DESC
LIMIT 50;

-- 2) High-confidence losses: the most dangerous category
SELECT
  "判断日時",
  "銘柄",
  "TF",
  "最終方向",
  "判定勝率%",
  "期待値R",
  COALESCE("手法", raw_entry_method, 'unknown') AS method,
  COALESCE(strategy, '(unknown)') AS strategy,
  COALESCE(regime, '(unknown)') AS regime,
  "判定要約",
  "損益",
  postmortem_tags,
  postmortem_summary,
  "注文番号"
FROM loss_base
WHERE "判定勝率%" >= 70
ORDER BY "判定勝率%" DESC, "判断日時" DESC
LIMIT 50;

-- 3) Loss concentration by symbol/timeframe/direction
SELECT
  "銘柄",
  "TF",
  "最終方向",
  COUNT(*) AS loss_count,
  ROUND(AVG("判定勝率%")::numeric, 1) AS avg_judged_win_prob_pct,
  ROUND(AVG("期待値R")::numeric, 3) AS avg_expected_value_r,
  ROUND(SUM(COALESCE("損益", 0))::numeric, 2) AS sum_profit_loss,
  ROUND(AVG("損益")::numeric, 2) AS avg_profit_loss,
  ROUND(AVG("保有分数")::numeric, 0) AS avg_hold_minutes
FROM loss_base
WHERE "判断日時" >= now() - interval '30 days'
GROUP BY "銘柄", "TF", "最終方向"
HAVING COUNT(*) >= 3
ORDER BY sum_profit_loss ASC, loss_count DESC;

-- 4) Loss concentration by method / strategy / regime
SELECT
  COALESCE("手法", raw_entry_method, 'unknown') AS method,
  COALESCE(strategy, '(unknown)') AS strategy,
  COALESCE(regime, '(unknown)') AS regime,
  COUNT(*) AS loss_count,
  ROUND(AVG("判定勝率%")::numeric, 1) AS avg_judged_win_prob_pct,
  ROUND(AVG("期待値R")::numeric, 3) AS avg_expected_value_r,
  ROUND(SUM(COALESCE("損益", 0))::numeric, 2) AS sum_profit_loss,
  ROUND(AVG("損益")::numeric, 2) AS avg_profit_loss
FROM loss_base
WHERE "判断日時" >= now() - interval '30 days'
GROUP BY COALESCE("手法", raw_entry_method, 'unknown'), COALESCE(strategy, '(unknown)'), COALESCE(regime, '(unknown)')
HAVING COUNT(*) >= 2
ORDER BY sum_profit_loss ASC, loss_count DESC;

-- 5) Judged win-probability bands among losses
SELECT
  CASE
    WHEN "判定勝率%" >= 80 THEN '>=80%'
    WHEN "判定勝率%" >= 75 THEN '75-79.9%'
    WHEN "判定勝率%" >= 70 THEN '70-74.9%'
    WHEN "判定勝率%" >= 60 THEN '60-69.9%'
    ELSE '<60%'
  END AS prob_band,
  COUNT(*) AS loss_count,
  ROUND(AVG("期待値R")::numeric, 3) AS avg_expected_value_r,
  ROUND(SUM(COALESCE("損益", 0))::numeric, 2) AS sum_profit_loss,
  ROUND(AVG("損益")::numeric, 2) AS avg_profit_loss
FROM loss_base
WHERE "判断日時" >= now() - interval '30 days'
GROUP BY 1
ORDER BY 1;

-- 6) Postmortem tag breakdown: repeated failure patterns
SELECT
  tag,
  COUNT(*) AS n,
  ROUND(AVG("判定勝率%")::numeric, 1) AS avg_judged_win_prob_pct,
  ROUND(AVG("期待値R")::numeric, 3) AS avg_expected_value_r,
  ROUND(SUM(COALESCE("損益", 0))::numeric, 2) AS sum_profit_loss,
  ROUND(AVG("損益")::numeric, 2) AS avg_profit_loss
FROM (
  SELECT
    lb."判定勝率%",
    lb."期待値R",
    lb."損益",
    unnest(COALESCE(lb.postmortem_tags, ARRAY['(untagged)'])) AS tag
  FROM loss_base lb
  WHERE lb."判断日時" >= now() - interval '30 days'
) t
GROUP BY tag
ORDER BY n DESC, sum_profit_loss ASC;

-- 7) Postmortem summaries for recent losses
SELECT
  "判断日時",
  "銘柄",
  "TF",
  "最終方向",
  COALESCE("手法", raw_entry_method, 'unknown') AS method,
  "判定勝率%",
  "期待値R",
  "損益",
  postmortem_tags,
  postmortem_summary,
  postmortem_generated_at,
  postmortem_model,
  "注文番号"
FROM loss_base
WHERE postmortem_summary IS NOT NULL
ORDER BY "判断日時" DESC
LIMIT 50;

-- 8) Daily loss trend over the last 30 days
SELECT
  date_trunc('day', "判断日時")::date AS day,
  COUNT(*) AS loss_count,
  ROUND(AVG("判定勝率%")::numeric, 1) AS avg_judged_win_prob_pct,
  ROUND(SUM(COALESCE("損益", 0))::numeric, 2) AS sum_profit_loss,
  ROUND(AVG("損益")::numeric, 2) AS avg_profit_loss
FROM loss_base
WHERE "判断日時" >= now() - interval '30 days'
GROUP BY 1
ORDER BY day DESC;

-- 9) ML pattern involvement in losses
SELECT
  CASE WHEN ml_pattern_used THEN 'ml_pattern_used' ELSE 'no_ml_pattern' END AS ml_usage,
  COALESCE(ml_pattern_name, '(none)') AS ml_pattern_name,
  COUNT(*) AS loss_count,
  ROUND(AVG("判定勝率%")::numeric, 1) AS avg_judged_win_prob_pct,
  ROUND(SUM(COALESCE("損益", 0))::numeric, 2) AS sum_profit_loss,
  ROUND(AVG("損益")::numeric, 2) AS avg_profit_loss
FROM loss_base
WHERE "判断日時" >= now() - interval '30 days'
GROUP BY CASE WHEN ml_pattern_used THEN 'ml_pattern_used' ELSE 'no_ml_pattern' END, COALESCE(ml_pattern_name, '(none)')
ORDER BY sum_profit_loss ASC, loss_count DESC;