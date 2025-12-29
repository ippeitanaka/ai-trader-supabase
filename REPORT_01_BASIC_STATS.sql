-- 1. 基本統計サマリー
SELECT 
    COUNT(*) as 総取引数,
    COUNT(CASE WHEN actual_result = 'WIN' THEN 1 END) as 勝ち数,
    COUNT(CASE WHEN actual_result = 'LOSS' THEN 1 END) as 負け数,
    COUNT(CASE WHEN actual_result = 'PENDING' THEN 1 END) as 保留中,
    COUNT(CASE WHEN actual_result = 'CANCELLED' THEN 1 END) as キャンセル済み,
    ROUND(
        COUNT(CASE WHEN actual_result = 'WIN' THEN 1 END)::numeric / 
        NULLIF(COUNT(CASE WHEN actual_result IN ('WIN', 'LOSS') THEN 1 END), 0) * 100, 
        2
    ) as 勝率パーセント,
    ROUND(SUM(profit_loss)::numeric, 2) as 総損益,
    MIN(created_at) as 運用開始日,
    MAX(created_at) as 最終取引日,
    EXTRACT(DAY FROM (MAX(created_at) - MIN(created_at))) as 運用日数
FROM ai_signals;
