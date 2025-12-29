-- 5. ML学習の進捗状況
SELECT 
    CASE 
        WHEN COUNT(CASE WHEN actual_result IN ('WIN', 'LOSS') THEN 1 END) < 80 THEN 'PHASE 1: テクニカル分析のみ（ML未使用）'
        WHEN COUNT(CASE WHEN actual_result IN ('WIN', 'LOSS') THEN 1 END) < 1000 THEN 'PHASE 2: ハイブリッド（テクニカル + ML）'
        ELSE 'PHASE 3: フルML（高精度AI判定）'
    END as 現在のフェーズ,
    COUNT(CASE WHEN actual_result IN ('WIN', 'LOSS') THEN 1 END) as 完了取引数,
    CASE 
        WHEN COUNT(CASE WHEN actual_result IN ('WIN', 'LOSS') THEN 1 END) < 80 THEN 80 - COUNT(CASE WHEN actual_result IN ('WIN', 'LOSS') THEN 1 END)
        WHEN COUNT(CASE WHEN actual_result IN ('WIN', 'LOSS') THEN 1 END) < 1000 THEN 1000 - COUNT(CASE WHEN actual_result IN ('WIN', 'LOSS') THEN 1 END)
        ELSE 0
    END as 次のフェーズまで残り,
    ROUND(
        COUNT(CASE WHEN actual_result IN ('WIN', 'LOSS') THEN 1 END)::numeric / 
        CASE 
            WHEN COUNT(CASE WHEN actual_result IN ('WIN', 'LOSS') THEN 1 END) < 80 THEN 80
            WHEN COUNT(CASE WHEN actual_result IN ('WIN', 'LOSS') THEN 1 END) < 1000 THEN 1000
            ELSE 1000
        END * 100,
        2
    ) as 進捗率
FROM ai_signals;
