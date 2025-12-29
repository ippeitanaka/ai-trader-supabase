-- 8. AI予測精度の検証
SELECT 
    CASE 
        WHEN win_prob >= 0.80 THEN '80%以上'
        WHEN win_prob >= 0.70 THEN '70-80%'
        WHEN win_prob >= 0.60 THEN '60-70%'
        ELSE '60%未満'
    END as AI予測勝率範囲,
    COUNT(*) as 取引数,
    COUNT(CASE WHEN actual_result = 'WIN' THEN 1 END) as 実際の勝ち数,
    ROUND(
        COUNT(CASE WHEN actual_result = 'WIN' THEN 1 END)::numeric / 
        NULLIF(COUNT(*), 0) * 100, 
        2
    ) as 実際の勝率,
    ROUND((AVG(win_prob) * 100)::numeric, 2) as 平均予測勝率,
    ROUND(SUM(profit_loss)::numeric, 2) as 損益
FROM ai_signals
WHERE actual_result IN ('WIN', 'LOSS')
GROUP BY 
    CASE 
        WHEN win_prob >= 0.80 THEN '80%以上'
        WHEN win_prob >= 0.70 THEN '70-80%'
        WHEN win_prob >= 0.60 THEN '60-70%'
        ELSE '60%未満'
    END
ORDER BY 平均予測勝率 DESC;
