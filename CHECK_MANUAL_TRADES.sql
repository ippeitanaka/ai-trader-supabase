-- ========================================
-- 手動トレードのタグ付け確認（安全版）
-- ========================================
-- 目的:
-- - ai_signals に混在する「手動トレード」を正しく is_manual_trade=true にする
-- - 誤ってAIトレードを手動にしないため、まず“候補を確認→明示リストで更新”を推奨
--
-- 実行方法: Supabase Dashboard > SQL Editor で実行
-- ========================================

-- 0) 全体の混在状況（virtualも併記）
SELECT
    '0) 混在状況' AS section,
    COALESCE(is_manual_trade,false) AS is_manual_trade,
    COALESCE(is_virtual,false) AS is_virtual,
    actual_result,
    COUNT(*) AS rows
FROM ai_signals
GROUP BY 1,2,3,4
ORDER BY is_manual_trade, is_virtual, rows DESC;

-- 1) instance / model_version の内訳（WIN/LOSSのみ、virtual除外）
SELECT
    '1) instance/model_version' AS section,
    COALESCE(instance,'(null)') AS instance,
    COALESCE(model_version,'(null)') AS model_version,
    COUNT(*) AS trades,
    ROUND((AVG(CASE WHEN actual_result = 'WIN' THEN 1 ELSE 0 END) * 100)::numeric, 2) AS win_rate_pct,
    ROUND(SUM(profit_loss)::numeric, 2) AS total_pnl
FROM ai_signals
WHERE actual_result IN ('WIN','LOSS')
    AND (is_virtual = false OR is_virtual IS NULL)
GROUP BY 1,2,3
ORDER BY trades DESC, total_pnl DESC;

-- 2) 手動候補を探す（例: 指標や理由が空…など）
-- ※ 現データでは「AIでも指標がNULL」などが起き得るので、ここだけで自動UPDATEしないこと
SELECT
    '2) 手動候補（確認用）' AS section,
    created_at,
    symbol,
    timeframe,
    order_ticket,
    COALESCE(instance,'(null)') AS instance,
    COALESCE(model_version,'(null)') AS model_version,
    COALESCE(entry_method,'(null)') AS entry_method,
    win_prob,
    actual_result,
    profit_loss,
    reason
FROM ai_signals
WHERE actual_result IN ('WIN','LOSS')
    AND (is_virtual = false OR is_virtual IS NULL)
    AND (is_manual_trade = false OR is_manual_trade IS NULL)
    AND (
        win_prob IS NULL
        OR reason IS NULL OR btrim(reason)=''
        OR instance IS NULL OR btrim(instance)=''
        OR model_version IS NULL OR btrim(model_version)=''
    )
ORDER BY created_at DESC
LIMIT 200;

-- 3) まずは“明示チケットリスト”で照合する（ここに手動チケットを貼る）
-- 使い方:
--  1) 下の VALUES に、手動で建てた注文のチケット番号を貼る
--  2) 実際に ai_signals に存在するか確認してから UPDATE を実行する
WITH manual_tickets(order_ticket) AS (
    VALUES
        -- (5096119463::bigint),
        -- (5095788323::bigint)
        (NULL::bigint)
), matched AS (
    SELECT s.*
    FROM ai_signals s
    JOIN manual_tickets t
        ON s.order_ticket = t.order_ticket
)
SELECT
    '3) チケット照合（一致した行）' AS section,
    created_at,
    symbol,
    timeframe,
    dir,
    order_ticket,
    win_prob,
    actual_result,
    profit_loss,
    COALESCE(is_manual_trade,false) AS is_manual_trade
FROM matched
ORDER BY created_at DESC;

-- 4) 逆に「貼ったチケットが ai_signals に存在しない」場合
WITH manual_tickets(order_ticket) AS (
    VALUES
        -- (5096119463::bigint),
        (NULL::bigint)
)
SELECT
    '4) 未一致チケット（ai_signalsに無い）' AS section,
    t.order_ticket
FROM manual_tickets t
LEFT JOIN ai_signals s
    ON s.order_ticket = t.order_ticket
WHERE t.order_ticket IS NOT NULL
    AND s.order_ticket IS NULL;

-- 5) 近道: 損益しきい値（-10万円以下）で手動候補を確認
--   ※ これで UPDATE する場合は UPDATE_MANUAL_TRADES.sql の「B) しきい値方式」を使用
SELECT
    '5) しきい値候補（profit_loss <= -100000）' AS section,
    COUNT(*) AS candidate_rows,
    ROUND(SUM(profit_loss)::numeric, 2) AS total_pnl
FROM ai_signals
WHERE (is_virtual = false OR is_virtual IS NULL)
    AND actual_result IN ('WIN','LOSS')
    AND (is_manual_trade = false OR is_manual_trade IS NULL)
    AND profit_loss <= -100000;

SELECT
    '5b) しきい値候補（銘柄別）' AS section,
    symbol,
    COUNT(*) AS trades,
    ROUND(SUM(profit_loss)::numeric, 2) AS total_pnl
FROM ai_signals
WHERE (is_virtual = false OR is_virtual IS NULL)
    AND actual_result IN ('WIN','LOSS')
    AND (is_manual_trade = false OR is_manual_trade IS NULL)
    AND profit_loss <= -100000
GROUP BY symbol
ORDER BY total_pnl ASC;

SELECT
    '5c) しきい値候補（一覧）' AS section,
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
    AND actual_result IN ('WIN','LOSS')
    AND (is_manual_trade = false OR is_manual_trade IS NULL)
    AND profit_loss <= -100000
ORDER BY created_at DESC;
