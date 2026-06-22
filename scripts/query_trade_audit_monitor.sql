-- Trade audit monitor report
-- Purpose: Review what the EA decided, why it traded or skipped, and how executed trades turned out.
--
-- Recommended usage:
-- 1) Supabase SQL Editor: paste sections as needed
-- 2) Local psql:
--    psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -f scripts/query_trade_audit_monitor.sql
--
-- Notes:
-- - Requires public.trade_audit_monitor view
-- - Column names are Japanese because this view is meant for direct operator use

-- 0) Latest overall audit trail
SELECT
  "判断日時",
  "銘柄",
  "TF",
  "取引判定",
  "実行結果",
  "最終方向",
  "判定勝率%",
  "手法",
  "判定要約",
  "注文番号"
FROM public.trade_audit_monitor
ORDER BY "判断日時" DESC
LIMIT 100;

-- 1) Latest executed trades with rationale and result
SELECT
  "判断日時",
  "銘柄",
  "最終方向",
  "判定勝率%",
  "推奨最小勝率%",
  "期待値R",
  "手法",
  "手法の理由",
  "判定要約",
  "実施根拠",
  "実行結果",
  "約定価格",
  "決済価格",
  "損益",
  "保有分数",
  "注文番号"
FROM public.trade_audit_monitor
WHERE "取引判定" = '実行'
ORDER BY "判断日時" DESC
LIMIT 50;

-- 2) Latest skipped trades: what was rejected and why
SELECT
  "判断日時",
  "銘柄",
  "TF",
  "最終方向",
  "AI推奨方向",
  "判定勝率%",
  "推奨最小勝率%",
  "期待値R",
  "EA判定コード",
  "見送り理由コード",
  "判定要約",
  "実施根拠"
FROM public.trade_audit_monitor
WHERE "取引判定" = '見送り'
ORDER BY "判断日時" DESC
LIMIT 50;

-- 3) Today's executed trades only
SELECT
  "判断日時",
  "銘柄",
  "最終方向",
  "判定勝率%",
  "期待値R",
  "手法",
  "判定要約",
  "実行結果",
  "損益",
  "保有分数",
  "注文番号"
FROM public.trade_audit_monitor
WHERE "取引判定" = '実行'
  AND "判断日時" >= date_trunc('day', now())
ORDER BY "判断日時" DESC;

-- 4) Recent execution summary by method (last 14 days)
SELECT
  COALESCE("手法", 'unknown') AS method,
  COUNT(*) AS n,
  ROUND(AVG("判定勝率%")::numeric, 1) AS avg_judged_win_prob_pct,
  ROUND(AVG("期待値R")::numeric, 3) AS avg_expected_value_r,
  COUNT(*) FILTER (WHERE "実行結果" = 'WIN') AS wins,
  COUNT(*) FILTER (WHERE "実行結果" = 'LOSS') AS losses,
  COUNT(*) FILTER (WHERE "実行結果" = 'BREAK_EVEN') AS break_even,
  ROUND(
    100.0 * COUNT(*) FILTER (WHERE "実行結果" = 'WIN')
    / NULLIF(COUNT(*) FILTER (WHERE "実行結果" IN ('WIN', 'LOSS', 'BREAK_EVEN')), 0),
    1
  ) AS realized_win_rate_pct,
  ROUND(SUM(COALESCE("損益", 0))::numeric, 2) AS sum_profit_loss,
  ROUND(AVG("損益")::numeric, 2) AS avg_profit_loss
FROM public.trade_audit_monitor
WHERE "取引判定" = '実行'
  AND "判断日時" >= now() - interval '14 days'
GROUP BY COALESCE("手法", 'unknown')
ORDER BY sum_profit_loss DESC NULLS LAST, n DESC;

-- 5) Recent execution summary by judged win-probability band (last 14 days)
SELECT
  CASE
    WHEN "判定勝率%" >= 80 THEN '>=80%'
    WHEN "判定勝率%" >= 75 THEN '75-79.9%'
    WHEN "判定勝率%" >= 70 THEN '70-74.9%'
    WHEN "判定勝率%" >= 60 THEN '60-69.9%'
    ELSE '<60%'
  END AS prob_band,
  COUNT(*) AS n,
  COUNT(*) FILTER (WHERE "実行結果" = 'WIN') AS wins,
  COUNT(*) FILTER (WHERE "実行結果" = 'LOSS') AS losses,
  ROUND(
    100.0 * COUNT(*) FILTER (WHERE "実行結果" = 'WIN')
    / NULLIF(COUNT(*) FILTER (WHERE "実行結果" IN ('WIN', 'LOSS', 'BREAK_EVEN')), 0),
    1
  ) AS realized_win_rate_pct,
  ROUND(AVG("期待値R")::numeric, 3) AS avg_expected_value_r,
  ROUND(SUM(COALESCE("損益", 0))::numeric, 2) AS sum_profit_loss
FROM public.trade_audit_monitor
WHERE "取引判定" = '実行'
  AND "判断日時" >= now() - interval '14 days'
GROUP BY 1
ORDER BY 1;

-- 6) Skip reason aggregation (last 7 days)
SELECT
  COALESCE("EA判定コード", 'UNKNOWN') AS decision_code,
  COALESCE("見送り理由コード", '(none)') AS skip_reason_code,
  COUNT(*) AS n,
  ROUND(AVG("判定勝率%")::numeric, 1) AS avg_judged_win_prob_pct,
  ROUND(AVG("期待値R")::numeric, 3) AS avg_expected_value_r
FROM public.trade_audit_monitor
WHERE "取引判定" = '見送り'
  AND "判断日時" >= now() - interval '7 days'
GROUP BY COALESCE("EA判定コード", 'UNKNOWN'), COALESCE("見送り理由コード", '(none)')
ORDER BY n DESC, decision_code, skip_reason_code;