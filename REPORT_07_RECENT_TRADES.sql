-- 7. 最近10件の取引詳細
SELECT 
    created_at as 日時,
    symbol as ペア,
    CASE WHEN dir = 1 THEN 'BUY' ELSE 'SELL' END as 方向,
    ROUND((win_prob * 100)::numeric, 2) as AI勝率予測,
    actual_result as 結果,
    profit_loss as 損益,
    entry_method as エントリー方式,
    CASE WHEN ml_pattern_used THEN 'YES' ELSE 'NO' END as ML使用,
    reason as 理由
FROM ai_signals
WHERE actual_result IN ('WIN', 'LOSS')
ORDER BY created_at DESC
LIMIT 10;
