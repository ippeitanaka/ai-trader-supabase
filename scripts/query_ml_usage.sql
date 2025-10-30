-- MLパターン使用状況の簡易チェック
SELECT 
    COUNT(*) as total_ml_pattern_used,
    COUNT(CASE WHEN actual_result = 'WIN' THEN 1 END) as wins,
    COUNT(CASE WHEN actual_result = 'LOSS' THEN 1 END) as losses
FROM ai_signals
WHERE ml_pattern_used = true;
