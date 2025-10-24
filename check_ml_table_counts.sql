-- MLテーブルのデータ量確認クエリ
SELECT 
    'ml_patterns' as table_name, 
    COUNT(*) as row_count,
    CASE 
        WHEN COUNT(*) = 0 THEN '空 - ML学習が未実行の可能性'
        WHEN COUNT(*) < 10 THEN '少ない - データ蓄積中'
        WHEN COUNT(*) BETWEEN 10 AND 50 THEN '適切 - パターン集約済み'
        ELSE '多い - 長期運用中'
    END as status
FROM ml_patterns
UNION ALL
SELECT 
    'ml_recommendations', 
    COUNT(*),
    CASE 
        WHEN COUNT(*) = 0 THEN '空 - ML学習が未実行'
        WHEN COUNT(*) < 5 THEN '少ない - 初期段階'
        WHEN COUNT(*) BETWEEN 5 AND 20 THEN '適切 - レコメンド生成済み'
        ELSE '多い - 継続更新中'
    END
FROM ml_recommendations
UNION ALL
SELECT 
    'ml_training_history', 
    COUNT(*),
    CASE 
        WHEN COUNT(*) = 0 THEN '空 - ML学習が1度も実行されていない'
        WHEN COUNT(*) < 3 THEN '少ない - 学習開始直後'
        WHEN COUNT(*) BETWEEN 3 AND 30 THEN '適切 - 定期学習実行中'
        ELSE '多い - 長期運用（1ヶ月以上）'
    END
FROM ml_training_history
UNION ALL
SELECT 
    'ai_signals (参考)', 
    COUNT(*),
    CASE 
        WHEN COUNT(*) = 0 THEN '空 - トレード未実行'
        WHEN COUNT(*) < 50 THEN '少ない - 運用開始直後'
        WHEN COUNT(*) BETWEEN 50 AND 200 THEN '適切 - データ蓄積中'
        ELSE '多い - 十分なデータあり'
    END
FROM ai_signals
ORDER BY table_name;

-- 最新のML学習実行日時を確認
SELECT 
    'Last ML Training' as info,
    MAX(created_at) as last_execution,
    COUNT(*) as total_executions,
    CASE 
        WHEN MAX(created_at) IS NULL THEN 'ML学習が1度も実行されていません'
        WHEN MAX(created_at) < NOW() - INTERVAL '2 days' THEN '2日以上学習が実行されていません'
        WHEN MAX(created_at) < NOW() - INTERVAL '1 day' THEN '1日以上学習が実行されていません'
        ELSE '最近実行されました'
    END as status
FROM ml_training_history;

-- パターン別の内訳
SELECT 
    pattern_name,
    COUNT(*) as count,
    AVG(confidence_score) as avg_confidence
FROM ml_patterns
GROUP BY pattern_name
ORDER BY count DESC;
