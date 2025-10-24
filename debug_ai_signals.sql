-- ai_signalsテーブルの完結した取引データを確認

-- 1. 全体のデータ数
SELECT 
  COUNT(*) as total_signals,
  COUNT(CASE WHEN actual_result IN ('WIN', 'LOSS') THEN 1 END) as win_or_loss,
  COUNT(CASE WHEN actual_result = 'WIN' THEN 1 END) as wins,
  COUNT(CASE WHEN actual_result = 'LOSS' THEN 1 END) as losses,
  COUNT(CASE WHEN actual_result = 'FILLED' THEN 1 END) as filled_only,
  COUNT(CASE WHEN actual_result IS NULL THEN 1 END) as pending
FROM ai_signals;

-- 2. exit_price, profit_loss, closed_atの状況
SELECT 
  COUNT(*) as total,
  COUNT(CASE WHEN exit_price IS NOT NULL THEN 1 END) as has_exit_price,
  COUNT(CASE WHEN profit_loss IS NOT NULL THEN 1 END) as has_profit_loss,
  COUNT(CASE WHEN closed_at IS NOT NULL THEN 1 END) as has_closed_at,
  COUNT(CASE 
    WHEN actual_result IN ('WIN', 'LOSS') 
    AND exit_price IS NOT NULL 
    AND profit_loss IS NOT NULL 
    AND closed_at IS NOT NULL 
    THEN 1 
  END) as complete_trades
FROM ai_signals;

-- 3. 完結した取引の詳細（最新10件）
SELECT 
  order_ticket,
  symbol,
  timeframe,
  dir,
  actual_result,
  exit_price,
  profit_loss,
  closed_at,
  created_at
FROM ai_signals
WHERE actual_result IN ('WIN', 'LOSS')
  AND exit_price IS NOT NULL
  AND profit_loss IS NOT NULL
  AND closed_at IS NOT NULL
ORDER BY closed_at DESC
LIMIT 10;

-- 4. actual_resultの分布
SELECT 
  actual_result,
  COUNT(*) as count,
  COUNT(CASE WHEN exit_price IS NOT NULL THEN 1 END) as with_exit_price,
  COUNT(CASE WHEN profit_loss IS NOT NULL THEN 1 END) as with_profit_loss,
  COUNT(CASE WHEN closed_at IS NOT NULL THEN 1 END) as with_closed_at
FROM ai_signals
GROUP BY actual_result
ORDER BY count DESC;
