-- ========================================
-- 本日以降: 自動(EA) / 手動(Manual) を分離してタグ付け
-- ========================================
-- 方針（ユーザー要望: 本日以降は自動と手動を分けたい）:
-- - ai_signals の order_ticket が "ea-log" に存在すれば「EA自動トレード」
-- - 存在しなければ「手動トレード」
--
-- 注意:
-- - ea-log 側にログが残っていないと、EAトレードでも手動扱いになる可能性があります。
-- - 逆に、手動トレードのチケットがea-logに紛れ込む運用なら誤判定します（通常は起きにくい想定）。
-- - virtual（paper/shadow）は除外。
--
-- 実行方法: Supabase Dashboard > SQL Editor
-- ========================================

-- ★「本日以降」の基準日
-- Supabase DBは通常UTCで運用されるため、JST基準にしたい場合は手動で日付を指定してください。
-- 例: JSTの2025-12-28開始にしたい → DATE '2025-12-27' ではなく DATE '2025-12-28'
WITH params AS (
  SELECT CURRENT_DATE::date AS from_date
)

-- 1) PREVIEW: 本日以降の WIN/LOSS を、EAログ有無で分けて件数確認
SELECT
  'PREVIEW' AS section,
  CASE
    WHEN EXISTS (
      SELECT 1
      FROM "ea-log" el
      WHERE el.order_ticket = s.order_ticket
    ) THEN 'EA_AUTO'
    ELSE 'MANUAL'
  END AS classified_as,
  COUNT(*) AS trades,
  ROUND((AVG(CASE WHEN s.actual_result='WIN' THEN 1 ELSE 0 END)*100)::numeric, 2) AS win_rate_pct,
  ROUND(SUM(s.profit_loss)::numeric, 2) AS total_pnl
FROM ai_signals s
CROSS JOIN params p
WHERE (s.is_virtual = false OR s.is_virtual IS NULL)
  AND s.actual_result IN ('WIN','LOSS')
  AND s.order_ticket IS NOT NULL
  AND s.created_at >= p.from_date
GROUP BY 1,2
ORDER BY classified_as;

-- 2) UPDATE: 本日以降の is_manual_trade をEAログ有無に合わせて同期
--    - EAログがあれば is_manual_trade=false
--    - EAログがなければ is_manual_trade=true
WITH params AS (
  SELECT CURRENT_DATE::date AS from_date
), ea_tickets AS (
  SELECT DISTINCT el.order_ticket
  FROM "ea-log" el
  WHERE el.order_ticket IS NOT NULL
), targets AS (
  SELECT s.id,
         s.order_ticket,
         CASE WHEN ea_tickets.order_ticket IS NULL THEN true ELSE false END AS should_be_manual
  FROM ai_signals s
  CROSS JOIN params p
  LEFT JOIN ea_tickets
    ON ea_tickets.order_ticket = s.order_ticket
  WHERE (s.is_virtual = false OR s.is_virtual IS NULL)
    AND s.actual_result IN ('WIN','LOSS')
    AND s.order_ticket IS NOT NULL
    AND s.created_at >= p.from_date
)
UPDATE ai_signals s
SET is_manual_trade = t.should_be_manual
FROM targets t
WHERE s.id = t.id
  AND COALESCE(s.is_manual_trade,false) IS DISTINCT FROM t.should_be_manual;

-- 3) 確認: 更新後の件数
WITH params AS (
  SELECT CURRENT_DATE::date AS from_date
)
SELECT
  'AFTER_UPDATE' AS section,
  COALESCE(is_manual_trade,false) AS is_manual_trade,
  COUNT(*) AS trades,
  ROUND(SUM(profit_loss)::numeric, 2) AS total_pnl
FROM ai_signals s
CROSS JOIN params p
WHERE (s.is_virtual = false OR s.is_virtual IS NULL)
  AND s.actual_result IN ('WIN','LOSS')
  AND s.order_ticket IS NOT NULL
  AND s.created_at >= p.from_date
GROUP BY 1,2
ORDER BY is_manual_trade;
