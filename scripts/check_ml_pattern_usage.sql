-- MLパターンの使用状況を確認するクエリ
-- 2025-10-30

-- 1. MLパターンが使用された取引の総数
SELECT 
    COUNT(*) as total_trades_with_ml,
    COUNT(CASE WHEN actual_result = 'WIN' THEN 1 END) as wins,
    COUNT(CASE WHEN actual_result = 'LOSS' THEN 1 END) as losses,
    COUNT(CASE WHEN actual_result = 'PENDING' THEN 1 END) as pending,
    ROUND(
        COUNT(CASE WHEN actual_result = 'WIN' THEN 1 END)::numeric / 
        NULLIF(COUNT(CASE WHEN actual_result IN ('WIN', 'LOSS') THEN 1 END), 0) * 100, 
        2
    ) as win_rate_pct
FROM ai_signals
WHERE ml_pattern_used = true;

-- 2. MLパターン別の取引数と勝率
SELECT 
    ml_pattern_name,
    COUNT(*) as trades_count,
    COUNT(CASE WHEN actual_result = 'WIN' THEN 1 END) as wins,
    COUNT(CASE WHEN actual_result = 'LOSS' THEN 1 END) as losses,
    ROUND(
        COUNT(CASE WHEN actual_result = 'WIN' THEN 1 END)::numeric / 
        NULLIF(COUNT(CASE WHEN actual_result IN ('WIN', 'LOSS') THEN 1 END), 0) * 100, 
        2
    ) as win_rate_pct,
    AVG(ml_pattern_confidence) as avg_confidence
FROM ai_signals
WHERE ml_pattern_used = true
GROUP BY ml_pattern_name
ORDER BY trades_count DESC;

-- 3. 最近のMLパターン使用取引（直近10件）
SELECT 
    created_at,
    symbol,
    timeframe,
    dir,
    ml_pattern_name,
    ml_pattern_confidence,
    win_prob,
    actual_result,
    profit_loss,
    order_ticket
FROM ai_signals
WHERE ml_pattern_used = true
ORDER BY created_at DESC
LIMIT 10;

-- 4. MLパターン使用有無での勝率比較
SELECT 
    ml_pattern_used,
    COUNT(*) as total_trades,
    COUNT(CASE WHEN actual_result = 'WIN' THEN 1 END) as wins,
    COUNT(CASE WHEN actual_result = 'LOSS' THEN 1 END) as losses,
    ROUND(
        COUNT(CASE WHEN actual_result = 'WIN' THEN 1 END)::numeric / 
        NULLIF(COUNT(CASE WHEN actual_result IN ('WIN', 'LOSS') THEN 1 END), 0) * 100, 
        2
    ) as win_rate_pct
FROM ai_signals
WHERE actual_result IN ('WIN', 'LOSS')
GROUP BY ml_pattern_used
ORDER BY ml_pattern_used DESC;

-- 5. 現在のml_patternsテーブルの状態
SELECT 
    id,
    pattern_name,
    symbol,
    timeframe,
    direction,
    total_trades,
    win_rate,
    confidence_score,
    is_active,
    last_updated
FROM ml_patterns
WHERE is_active = true
ORDER BY confidence_score DESC
LIMIT 10;

-- 6. 学習フェーズの確認（完結した取引の総数）
SELECT 
    COUNT(*) as completed_trades,
    CASE 
        WHEN COUNT(*) < 80 THEN 'PHASE 1: テクニカル判定のみ (0-79件)'
        WHEN COUNT(*) < 1000 THEN 'PHASE 2: ハイブリッド (80-999件)'
        ELSE 'PHASE 3: 完全ML (1000件以上)'
    END as learning_phase
FROM ai_signals
WHERE actual_result IN ('WIN', 'LOSS');
