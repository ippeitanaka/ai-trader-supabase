-- 4. 月別パフォーマンス
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
GROUP BY TO_CHAR(created_at, 'YYYY-MM')
ORDER BY 年月 DESC;
