-- CHECK_POSTMORTEM_TAGS.sql
-- Postmortem tagging health check (LOSS/CANCELLED)
-- Created: 2025-12-28

-- NOTE:
-- クエリによっては対象データが0件だと「0行」になります（＝異常とは限りません）。
-- まずは 0) の診断で「直近にLOSS/CANCELLEDが存在するか」を確認してください。

-- 0) 診断: 直近30日で actual_result がどう分布しているか
SELECT
  COALESCE(actual_result, '(NULL)') AS actual_result,
  COUNT(*) AS cnt
FROM ai_signals
WHERE created_at >= NOW() - INTERVAL '30 days'
GROUP BY 1
ORDER BY cnt DESC, actual_result ASC;

-- 0b) 診断: 直近30日で LOSS/CANCELLED の総数（0でも必ず1行返す）
SELECT
  COUNT(*) FILTER (WHERE actual_result = 'LOSS') AS loss_total,
  COUNT(*) FILTER (WHERE actual_result = 'CANCELLED') AS cancelled_total
FROM ai_signals
WHERE created_at >= NOW() - INTERVAL '30 days';

-- 1) 直近7日: LOSS/CANCELLED 件数と postmortem 付与率（0でも必ず2行返す）
WITH statuses AS (
  SELECT * FROM (VALUES ('LOSS'::text), ('CANCELLED'::text)) AS v(actual_result)
),
base AS (
  SELECT actual_result, postmortem_generated_at
  FROM ai_signals
  WHERE created_at >= NOW() - INTERVAL '7 days'
    AND actual_result IN ('LOSS', 'CANCELLED')
)
SELECT
  s.actual_result,
  COUNT(b.*) AS total,
  COUNT(b.*) FILTER (WHERE b.postmortem_generated_at IS NOT NULL) AS tagged,
  ROUND(
    (COUNT(b.*) FILTER (WHERE b.postmortem_generated_at IS NOT NULL))::numeric
    / NULLIF(COUNT(b.*), 0)::numeric
    * 100,
    1
  ) AS tagged_pct
FROM statuses s
LEFT JOIN base b USING (actual_result)
GROUP BY s.actual_result
ORDER BY s.actual_result;

-- 2) 直近50件: タグ/要約の中身を確認
SELECT
  created_at,
  symbol,
  timeframe,
  dir,
  entry_method,
  actual_result,
  sl_hit,
  tp_hit,
  profit_loss,
  hold_duration_minutes,
  cancelled_reason,
  postmortem_tags,
  postmortem_summary,
  postmortem_model,
  postmortem_generated_at
FROM ai_signals
WHERE actual_result IN ('LOSS', 'CANCELLED')
ORDER BY created_at DESC
LIMIT 50;

-- 3) 取りこぼし検知: LOSS/CANCELLED なのに postmortem が未生成（直近30日）
SELECT
  id,
  created_at,
  symbol,
  timeframe,
  entry_method,
  actual_result,
  sl_hit,
  tp_hit,
  profit_loss,
  cancelled_reason
FROM ai_signals
WHERE created_at >= NOW() - INTERVAL '30 days'
  AND actual_result IN ('LOSS', 'CANCELLED')
  AND postmortem_generated_at IS NULL
ORDER BY created_at DESC
LIMIT 200;

-- 4) タグ集計: 直近30日で多いタグTop20
WITH recent AS (
  SELECT unnest(postmortem_tags) AS tag
  FROM ai_signals
  WHERE created_at >= NOW() - INTERVAL '30 days'
    AND actual_result IN ('LOSS', 'CANCELLED')
    AND postmortem_tags IS NOT NULL
)
SELECT
  tag,
  COUNT(*) AS cnt
FROM recent
GROUP BY tag
ORDER BY cnt DESC, tag ASC
LIMIT 20;
