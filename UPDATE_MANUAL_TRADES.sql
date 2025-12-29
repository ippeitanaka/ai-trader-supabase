-- ========================================
-- 手動トレードを is_manual_trade=true にする（安全版）
-- ========================================
-- 方針:
-- - “推測でUPDATEしない”
-- - MT5の口座履歴から「手動で建てた注文のチケット番号」を拾い、明示リストでUPDATEする
--
-- 実行方法: Supabase Dashboard > SQL Editor
-- ========================================

-- =====================================================================
-- A) 推奨: MT5チケット明示リスト方式（誤判定しない）
-- =====================================================================

-- 1) ここに「手動トレードのチケット番号」と任意の lot_size を貼る
--    lot_size は不明なら NULL でOK
WITH manual_list(order_ticket, lot_size) AS (
    VALUES
        -- (5096119463::bigint, 0.50::numeric),
        -- (5095788323::bigint, 0.50::numeric),
        -- (5097830100::bigint, 0.50::numeric)
        (NULL::bigint, NULL::numeric)
), updated AS (
    UPDATE ai_signals s
    SET
        is_manual_trade = true,
        lot_size = COALESCE(ml.lot_size, s.lot_size)
    FROM manual_list ml
    WHERE ml.order_ticket IS NOT NULL
        AND s.order_ticket = ml.order_ticket
        AND (s.is_virtual = false OR s.is_virtual IS NULL)
    RETURNING s.id, s.created_at, s.symbol, s.timeframe, s.dir, s.order_ticket, s.actual_result, s.profit_loss, s.lot_size, s.is_manual_trade
)
SELECT
    'UPDATED' AS status,
    *
FROM updated
ORDER BY created_at DESC;

-- 確認: マニュアル取引としてマークされたレコード
SELECT 
    created_at,
    symbol,
    CASE WHEN dir = 1 THEN 'BUY' ELSE 'SELL' END as direction,
    profit_loss,
    lot_size,
    is_manual_trade,
    order_ticket
FROM ai_signals
WHERE is_manual_trade = true
ORDER BY created_at DESC;

-- 追加の確認: 直近の未タグ（WIN/LOSS）に手動が混じっていないか
SELECT
    created_at,
    symbol,
    timeframe,
    order_ticket,
    instance,
    model_version,
    win_prob,
    actual_result,
    profit_loss
FROM ai_signals
WHERE (is_virtual = false OR is_virtual IS NULL)
    AND (is_manual_trade = false OR is_manual_trade IS NULL)
    AND actual_result IN ('WIN','LOSS')
ORDER BY created_at DESC
LIMIT 50;

-- ロールバック（必要な時だけ）:
--  手動リストを同じにして is_manual_trade を戻す
-- WITH manual_list(order_ticket) AS (
--   VALUES
--     (5096119463::bigint),
--     (5095788323::bigint)
-- )
-- UPDATE ai_signals s
-- SET is_manual_trade = false
-- FROM manual_list ml
-- WHERE s.order_ticket = ml.order_ticket;

-- 確認: 12月のEA取引のみの成績
SELECT 
    COUNT(*) as EA取引数,
    COUNT(CASE WHEN actual_result = 'WIN' THEN 1 END) as 勝ち,
    COUNT(CASE WHEN actual_result = 'LOSS' THEN 1 END) as 負け,
    ROUND(
        COUNT(CASE WHEN actual_result = 'WIN' THEN 1 END)::numeric / 
        NULLIF(COUNT(CASE WHEN actual_result IN ('WIN', 'LOSS') THEN 1 END), 0) * 100, 
        2
    ) as 勝率,
    ROUND(SUM(profit_loss)::numeric, 2) as EA損益
FROM ai_signals
WHERE created_at >= '2025-12-01'
    AND actual_result IN ('WIN', 'LOSS')
    AND (is_manual_trade = false OR is_manual_trade IS NULL);

-- =====================================================================
-- B) 近道: 損益しきい値方式（ユーザー合意: -10万円以下は手動とみなす）
-- =====================================================================
-- 方針:
-- - profit_loss <= -100000 の行を is_manual_trade=true にする
-- - virtualは除外
-- - 既に手動タグ済みはそのまま
--
-- ⚠️ 注意: EA取引でも大損があれば巻き込む可能性があります。
-- まず PREVIEW を確認してから UPDATE を実行してください。

-- 1) PREVIEW（更新対象の一覧）
SELECT
    'PREVIEW_THRESHOLD' AS section,
    id,
    created_at,
    symbol,
    timeframe,
    dir,
    order_ticket,
    instance,
    model_version,
    win_prob,
    actual_result,
    profit_loss,
    COALESCE(is_manual_trade,false) AS is_manual_trade
FROM ai_signals
WHERE (is_virtual = false OR is_virtual IS NULL)
    AND actual_result IN ('WIN','LOSS')
    AND (is_manual_trade = false OR is_manual_trade IS NULL)
    AND profit_loss <= -100000
ORDER BY created_at DESC;

-- 2) UPDATE（トランザクション付き）
--    期待どおりの対象だけなら COMMIT、違えば ROLLBACK。
BEGIN;

-- 対象を固定（実行中に変動しないように）
CREATE TEMP TABLE tmp_manual_candidates AS
SELECT id
FROM ai_signals
WHERE (is_virtual = false OR is_virtual IS NULL)
    AND actual_result IN ('WIN','LOSS')
    AND (is_manual_trade = false OR is_manual_trade IS NULL)
    AND profit_loss <= -100000;

-- 影響件数の確認
SELECT 'CANDIDATE_COUNT' AS section, COUNT(*) AS rows FROM tmp_manual_candidates;

-- 実更新
UPDATE ai_signals s
SET is_manual_trade = true
FROM tmp_manual_candidates c
WHERE s.id = c.id;

-- 更新後の確認
SELECT
    'UPDATED_THRESHOLD' AS section,
    s.created_at,
    s.symbol,
    s.timeframe,
    s.order_ticket,
    s.actual_result,
    s.profit_loss,
    s.is_manual_trade
FROM ai_signals s
JOIN tmp_manual_candidates c
    ON s.id = c.id
ORDER BY s.created_at DESC;

-- OKなら COMMIT
COMMIT;

-- NGなら上の COMMIT の代わりに ROLLBACK にしてください:
-- ROLLBACK;
