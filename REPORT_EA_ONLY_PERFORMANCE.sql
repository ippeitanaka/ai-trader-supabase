-- EA取引のみの成績レポート（マニュアル取引を除外）

-- 1. 基本統計（EA取引のみ）
SELECT 
    'EA取引のみ（マニュアル除外）' as レポート種類,
    COUNT(*) as 総取引数,
    COUNT(CASE WHEN actual_result = 'WIN' THEN 1 END) as 勝ち数,
    COUNT(CASE WHEN actual_result = 'LOSS' THEN 1 END) as 負け数,
    ROUND(
        COUNT(CASE WHEN actual_result = 'WIN' THEN 1 END)::numeric / 
        NULLIF(COUNT(CASE WHEN actual_result IN ('WIN', 'LOSS') THEN 1 END), 0) * 100, 
        2
    ) as 勝率パーセント,
    ROUND(SUM(profit_loss)::numeric, 2) as 総損益
FROM ai_signals
WHERE actual_result IN ('WIN', 'LOSS')
    AND (is_manual_trade = false OR is_manual_trade IS NULL);

-- 2. 月別パフォーマンス（EA取引のみ）
SELECT 
    TO_CHAR(created_at, 'YYYY-MM') as 年月,
    COUNT(*) as 取引数,
    COUNT(CASE WHEN actual_result = 'WIN' THEN 1 END) as 勝ち,
    COUNT(CASE WHEN actual_result = 'LOSS' THEN 1 END) as 負け,
    ROUND(
        COUNT(CASE WHEN actual_result = 'WIN' THEN 1 END)::numeric / 
        NULLIF(COUNT(CASE WHEN actual_result IN ('WIN', 'LOSS') THEN 1 END), 0) * 100, 
        2
    ) as 勝率,
    ROUND(SUM(profit_loss)::numeric, 2) as 月間損益
FROM ai_signals
WHERE actual_result IN ('WIN', 'LOSS')
    AND (is_manual_trade = false OR is_manual_trade IS NULL)
GROUP BY TO_CHAR(created_at, 'YYYY-MM')
ORDER BY 年月 DESC;

-- 3. 通貨ペア別成績（EA取引のみ）
SELECT 
    symbol as 通貨ペア,
    COUNT(*) as 取引数,
    COUNT(CASE WHEN actual_result = 'WIN' THEN 1 END) as 勝ち,
    COUNT(CASE WHEN actual_result = 'LOSS' THEN 1 END) as 負け,
    ROUND(
        COUNT(CASE WHEN actual_result = 'WIN' THEN 1 END)::numeric / 
        NULLIF(COUNT(CASE WHEN actual_result IN ('WIN', 'LOSS') THEN 1 END), 0) * 100, 
        2
    ) as 勝率,
    ROUND(SUM(profit_loss)::numeric, 2) as 損益
FROM ai_signals
WHERE actual_result IN ('WIN', 'LOSS')
    AND (is_manual_trade = false OR is_manual_trade IS NULL)
GROUP BY symbol
ORDER BY 損益 DESC;

-- 4. マニュアル取引の一覧（参考）
SELECT 
    'マニュアル取引一覧（参考）' as セクション,
    created_at,
    symbol,
    CASE WHEN dir = 1 THEN 'BUY' ELSE 'SELL' END as direction,
    lot_size,
    profit_loss,
    actual_result
FROM ai_signals
WHERE is_manual_trade = true
ORDER BY created_at DESC;
