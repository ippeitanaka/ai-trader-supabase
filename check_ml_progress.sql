-- ================================================
-- ML学習システムの成果確認クエリ (2025年12月1日)
-- ================================================

-- 1. 完了取引数の推移
SELECT 
  '完了取引数' as metric,
  COUNT(*) as total,
  COUNT(*) FILTER (WHERE created_at >= '2025-10-24') as after_ml,
  COUNT(*) FILTER (WHERE created_at < '2025-10-24') as before_ml
FROM ai_signals
WHERE actual_result IN ('WIN', 'LOSS')
  AND exit_price IS NOT NULL
  AND profit_loss IS NOT NULL
  AND closed_at IS NOT NULL;

-- 2. 勝率の比較（ML導入前 vs 後）
SELECT 
  'ML導入前 (10/24まで)' as period,
  COUNT(*) FILTER (WHERE actual_result = 'WIN') as wins,
  COUNT(*) FILTER (WHERE actual_result = 'LOSS') as losses,
  COUNT(*) as total,
  ROUND(COUNT(*) FILTER (WHERE actual_result = 'WIN')::numeric / 
        COUNT(*)::numeric * 100, 1) as win_rate_percent,
  ROUND(SUM(profit_loss)::numeric, 2) as total_profit
FROM ai_signals
WHERE created_at < '2025-10-24'
  AND actual_result IN ('WIN', 'LOSS')

UNION ALL

SELECT 
  'ML導入後 (10/24以降)' as period,
  COUNT(*) FILTER (WHERE actual_result = 'WIN') as wins,
  COUNT(*) FILTER (WHERE actual_result = 'LOSS') as losses,
  COUNT(*) as total,
  ROUND(COUNT(*) FILTER (WHERE actual_result = 'WIN')::numeric / 
        COUNT(*)::numeric * 100, 1) as win_rate_percent,
  ROUND(SUM(profit_loss)::numeric, 2) as total_profit
FROM ai_signals
WHERE created_at >= '2025-10-24'
  AND actual_result IN ('WIN', 'LOSS')

ORDER BY period;

-- 3. MLパターンの成長
SELECT 
  'MLパターン数' as metric,
  COUNT(*) as total,
  COUNT(*) FILTER (WHERE is_active = true) as active,
  COUNT(*) FILTER (WHERE total_trades >= 15) as level2_ready,
  COUNT(*) FILTER (WHERE total_trades >= 20 AND win_rate >= 0.80) as level3_ready,
  COUNT(*) FILTER (WHERE total_trades >= 30 AND win_rate >= 0.85) as level4_ready
FROM ml_patterns;

-- 4. トップ10の高勝率パターン
SELECT 
  pattern_name,
  win_rate,
  total_trades,
  win_count,
  loss_count,
  profit_factor,
  confidence_score,
  CASE 
    WHEN win_rate >= 0.85 AND total_trades >= 30 AND profit_factor >= 2.0 THEN 'Level 4 (3.0x)'
    WHEN win_rate >= 0.80 AND total_trades >= 20 AND profit_factor >= 1.5 THEN 'Level 3 (2.0x)'
    WHEN win_rate >= 0.70 AND total_trades >= 15 THEN 'Level 2 (1.5x)'
    ELSE 'Level 1 (1.0x)'
  END as lot_level
FROM ml_patterns
WHERE is_active = true
  AND total_trades >= 10
ORDER BY win_rate DESC, total_trades DESC
LIMIT 10;

-- 5. ML学習の実行履歴
SELECT 
  created_at,
  training_type,
  complete_trades_count,
  patterns_discovered,
  patterns_updated,
  overall_win_rate,
  best_pattern_win_rate,
  status
FROM ml_training_history
ORDER BY created_at DESC
LIMIT 10;

-- 6. 週次のパフォーマンス推移（ML導入後）
SELECT 
  DATE_TRUNC('week', created_at) as week,
  COUNT(*) as trades,
  COUNT(*) FILTER (WHERE actual_result = 'WIN') as wins,
  ROUND(COUNT(*) FILTER (WHERE actual_result = 'WIN')::numeric / 
        COUNT(*)::numeric * 100, 1) as win_rate,
  ROUND(SUM(profit_loss)::numeric, 2) as profit
FROM ai_signals
WHERE created_at >= '2025-10-24'
  AND actual_result IN ('WIN', 'LOSS')
GROUP BY DATE_TRUNC('week', created_at)
ORDER BY week;

-- 7. ロット倍率の実績確認（ea-logから推測）
SELECT 
  DATE(at) as date,
  COUNT(*) as total_trades,
  AVG(win_prob) as avg_win_prob,
  COUNT(*) FILTER (WHERE win_prob >= 0.80) as high_confidence_trades,
  COUNT(*) FILTER (WHERE trade_decision = 'EXECUTED' OR trade_decision = 'EXECUTED_MARKET') as executed
FROM ea_log
WHERE at >= '2025-10-24'
GROUP BY DATE(at)
ORDER BY date DESC
LIMIT 30;

-- 8. MLパターン使用シグナルの状態内訳（WIN/LOSS以外の滞留チェック）
SELECT
  actual_result,
  COUNT(*) AS signals,
  COUNT(*) FILTER (WHERE closed_at IS NOT NULL) AS with_closed_at,
  COUNT(*) FILTER (WHERE entry_price IS NOT NULL) AS with_entry_price,
  COUNT(*) FILTER (WHERE exit_price IS NOT NULL) AS with_exit_price,
  COUNT(*) FILTER (WHERE profit_loss IS NOT NULL) AS with_profit_loss,
  MIN(created_at) AS oldest,
  MAX(created_at) AS newest
FROM ai_signals
WHERE ml_pattern_used = true
GROUP BY actual_result
ORDER BY signals DESC;

-- 9. 古いPENDING（要調査: 期限切れキャンセル or 更新処理不具合の可能性）
SELECT
  symbol,
  timeframe,
  COUNT(*) AS pending_count,
  MIN(created_at) AS oldest_pending,
  MAX(created_at) AS newest_pending
FROM ai_signals
WHERE ml_pattern_used = true
  AND actual_result = 'PENDING'
  AND created_at < now() - interval '7 days'
GROUP BY symbol, timeframe
ORDER BY pending_count DESC;
