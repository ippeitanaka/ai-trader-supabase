-- 6. ML学習パターンの状況
SELECT 
    COUNT(*) as 学習済みパターン数,
    COUNT(CASE WHEN total_trades >= 10 THEN 1 END) as 有効パターン数_10件以上,
    COUNT(CASE WHEN win_rate >= 0.7 THEN 1 END) as 高勝率パターン数_70以上,
    ROUND((AVG(win_rate) * 100)::numeric, 2) as 平均勝率,
    ROUND(AVG(total_trades)::numeric, 2) as 平均サンプル数
FROM ml_patterns;
