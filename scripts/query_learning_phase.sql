-- 簡易チェック: 学習フェーズの確認
SELECT 
    COUNT(*) as completed_trades,
    CASE 
        WHEN COUNT(*) < 80 THEN 'PHASE 1: テクニカル判定のみ'
        WHEN COUNT(*) < 1000 THEN 'PHASE 2: ハイブリッド'
        ELSE 'PHASE 3: 完全ML'
    END as learning_phase
FROM ai_signals
WHERE actual_result IN ('WIN', 'LOSS');
