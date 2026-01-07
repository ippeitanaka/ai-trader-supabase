-- MLパターン使用状況の簡易チェック
SELECT 
        COUNT(*) as total_ml_pattern_used,
        COUNT(*) FILTER (WHERE actual_result IN ('WIN','LOSS')) as completed_trades,
        COUNT(*) FILTER (WHERE actual_result = 'WIN') as wins,
        COUNT(*) FILTER (WHERE actual_result = 'LOSS') as losses,
        COUNT(*) FILTER (WHERE actual_result IS NULL OR actual_result NOT IN ('WIN','LOSS')) as unresolved,
        ROUND(
            COUNT(*) FILTER (WHERE actual_result = 'WIN')::numeric /
            NULLIF(COUNT(*) FILTER (WHERE actual_result IN ('WIN','LOSS')),0) * 100,
            2
        ) as win_rate_percent
FROM ai_signals
WHERE ml_pattern_used = true;
