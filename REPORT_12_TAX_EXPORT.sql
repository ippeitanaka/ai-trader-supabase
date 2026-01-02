-- 12. 確定申告向けエクスポート（Supabase SQL Editor 用）
--
-- 目的:
-- - 申告用の「年次損益（合計）」と「取引一覧（CSVにしやすい）」を ai_signals から出す
-- - broker/MT5の年間取引報告書と突合できる形にする
--
-- 注意:
-- - これは税務アドバイスではありません。
-- - 実務では、最終的な根拠はブローカー/MT5の取引報告書（手数料・スワップ等含む）になることが多いです。
-- - ai_signals に手数料/スワップ/口座通貨/JPY換算レートが無い場合、このSQLだけで完結は難しいことがあります。
--
-- 使い方:
-- 1) params の year / include_manual / include_virtual を設定
-- 2) まず 1) 完全性チェック → 2) 年次サマリー → 3) 取引一覧 を順に実行

-- =========================================================
-- 1) 完全性チェック（申告用に足りない行があるか）
-- =========================================================
WITH params AS (
  SELECT
    2025::int AS year,
    false AS include_virtual,
    true AS include_manual
)
SELECT
  COUNT(*) AS total_rows,
  COUNT(*) FILTER (WHERE actual_result IN ('WIN','LOSS')) AS realized_trades,
  COUNT(*) FILTER (WHERE actual_result IN ('WIN','LOSS') AND closed_at IS NULL) AS missing_closed_at,
  COUNT(*) FILTER (WHERE actual_result IN ('WIN','LOSS') AND profit_loss IS NULL) AS missing_profit_loss,
  COUNT(*) FILTER (WHERE actual_result IN ('WIN','LOSS') AND order_ticket IS NULL) AS missing_order_ticket,
  COUNT(*) FILTER (WHERE COALESCE(is_virtual,false) = true) AS virtual_rows,
  COUNT(*) FILTER (WHERE COALESCE(is_manual_trade,false) = true) AS manual_rows
FROM ai_signals s
CROSS JOIN params p
WHERE (p.include_virtual OR COALESCE(s.is_virtual,false) = false)
  AND (p.include_manual  OR COALESCE(s.is_manual_trade,false) = false)
  AND (
    (s.closed_at IS NOT NULL AND EXTRACT(YEAR FROM (s.closed_at AT TIME ZONE 'Asia/Tokyo'))::int = p.year)
    OR
    (s.closed_at IS NULL AND EXTRACT(YEAR FROM (s.created_at AT TIME ZONE 'Asia/Tokyo'))::int = p.year)
  );

-- =========================================================
-- 2) 年次サマリー（確定申告のベース）
--   - 本来は closed_at ベース推奨（決済日基準）
-- =========================================================
WITH params AS (
  SELECT
    2025::int AS year,
    false AS include_virtual,
    true AS include_manual
), t AS (
  SELECT
    s.*
  FROM ai_signals s
  CROSS JOIN params p
  WHERE (p.include_virtual OR COALESCE(s.is_virtual,false) = false)
    AND (p.include_manual  OR COALESCE(s.is_manual_trade,false) = false)
    AND s.actual_result IN ('WIN','LOSS')
    AND s.closed_at IS NOT NULL
    AND EXTRACT(YEAR FROM (s.closed_at AT TIME ZONE 'Asia/Tokyo'))::int = p.year
)
SELECT
  (SELECT year FROM params) AS year,
  COUNT(*) AS trades,
  ROUND(SUM(profit_loss)::numeric, 2) AS total_profit_loss_account_ccy,
  ROUND(AVG(profit_loss)::numeric, 2) AS avg_profit_loss_account_ccy,
  ROUND(AVG(CASE WHEN actual_result='WIN' THEN 1 ELSE 0 END)::numeric * 100, 2) AS win_rate_pct
FROM t;

-- =========================================================
-- 2b) 月別サマリー（年内の推移確認）
-- =========================================================
WITH params AS (
  SELECT
    2025::int AS year,
    false AS include_virtual,
    true AS include_manual
), t AS (
  SELECT
    s.*,
    TO_CHAR((s.closed_at AT TIME ZONE 'Asia/Tokyo'), 'YYYY-MM') AS ym_jst
  FROM ai_signals s
  CROSS JOIN params p
  WHERE (p.include_virtual OR COALESCE(s.is_virtual,false) = false)
    AND (p.include_manual  OR COALESCE(s.is_manual_trade,false) = false)
    AND s.actual_result IN ('WIN','LOSS')
    AND s.closed_at IS NOT NULL
    AND EXTRACT(YEAR FROM (s.closed_at AT TIME ZONE 'Asia/Tokyo'))::int = p.year
)
SELECT
  ym_jst,
  COUNT(*) AS trades,
  ROUND(SUM(profit_loss)::numeric, 2) AS total_profit_loss_account_ccy,
  ROUND(AVG(CASE WHEN actual_result='WIN' THEN 1 ELSE 0 END)::numeric * 100, 2) AS win_rate_pct
FROM t
GROUP BY ym_jst
ORDER BY ym_jst;

-- =========================================================
-- 3) 取引一覧（CSV向け）
--   - 申告の根拠資料（ブローカー報告書）と突合しやすい列に絞る
-- =========================================================
WITH params AS (
  SELECT
    2025::int AS year,
    false AS include_virtual,
    true AS include_manual
), t AS (
  SELECT
    s.*,
    (s.created_at AT TIME ZONE 'Asia/Tokyo') AS created_jst,
    (s.closed_at  AT TIME ZONE 'Asia/Tokyo') AS closed_jst
  FROM ai_signals s
  CROSS JOIN params p
  WHERE (p.include_virtual OR COALESCE(s.is_virtual,false) = false)
    AND (p.include_manual  OR COALESCE(s.is_manual_trade,false) = false)
    AND s.actual_result IN ('WIN','LOSS')
    AND s.closed_at IS NOT NULL
    AND EXTRACT(YEAR FROM (s.closed_at AT TIME ZONE 'Asia/Tokyo'))::int = p.year
)
SELECT
  closed_jst,
  created_jst,
  symbol,
  timeframe,
  CASE WHEN dir=1 THEN 'BUY' WHEN dir=-1 THEN 'SELL' ELSE '0' END AS dir,
  order_ticket,
  entry_price,
  exit_price,
  ROUND(profit_loss::numeric, 2) AS profit_loss_account_ccy,
  hold_duration_minutes,
  COALESCE(entry_method,'(null)') AS entry_method,
  COALESCE(is_manual_trade,false) AS is_manual_trade,
  COALESCE(is_virtual,false) AS is_virtual
FROM t
ORDER BY closed_jst;
