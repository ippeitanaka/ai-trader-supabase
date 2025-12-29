-- 9. SL/TP到達状況
SELECT 
    COUNT(CASE WHEN sl_hit = true THEN 1 END) as SL到達数,
    COUNT(CASE WHEN tp_hit = true THEN 1 END) as TP到達数,
    COUNT(CASE WHEN sl_hit = false AND tp_hit = false THEN 1 END) as 時間切れ数,
    ROUND(
        COUNT(CASE WHEN tp_hit = true THEN 1 END)::numeric / 
        NULLIF(COUNT(CASE WHEN sl_hit = true OR tp_hit = true THEN 1 END), 0) * 100,
        2
    ) as TP到達率,
    ROUND(AVG(CASE WHEN sl_hit = false AND tp_hit = false THEN hold_duration_minutes END)::numeric, 2) as 平均保有時間_分
FROM ai_signals
WHERE actual_result IN ('WIN', 'LOSS');
