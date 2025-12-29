-- 2. 通貨ペア別成績
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
    ROUND(SUM(profit_loss)::numeric, 2) as 損益,
    ROUND((AVG(win_prob) * 100)::numeric, 2) as 平均AI勝率予測
FROM ai_signals
WHERE actual_result IN ('WIN', 'LOSS')
GROUP BY symbol
ORDER BY 損益 DESC;
