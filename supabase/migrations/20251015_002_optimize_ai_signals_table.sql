-- Migration: Optimize ai_signals table for ML learning
-- Adds indexes and constraints for better query performance
-- Created: 2025-10-15

-- Add index on order_ticket for fast updates
CREATE INDEX IF NOT EXISTS idx_ai_signals_order_ticket 
ON public.ai_signals (order_ticket);

-- Add index on actual_result for filtering training data
CREATE INDEX IF NOT EXISTS idx_ai_signals_actual_result 
ON public.ai_signals (actual_result);

-- Add composite index for ML training queries
CREATE INDEX IF NOT EXISTS idx_ai_signals_training 
ON public.ai_signals (actual_result, symbol, timeframe)
WHERE actual_result IN ('WIN', 'LOSS');

-- Add index on created_at for time-series analysis
CREATE INDEX IF NOT EXISTS idx_ai_signals_created_at 
ON public.ai_signals (created_at DESC);

-- Add index on closed_at for completed trades
CREATE INDEX IF NOT EXISTS idx_ai_signals_closed_at 
ON public.ai_signals (closed_at DESC)
WHERE closed_at IS NOT NULL;

-- Add comments
COMMENT ON INDEX idx_ai_signals_order_ticket IS 'Fast lookup for updating signal status';
COMMENT ON INDEX idx_ai_signals_actual_result IS 'Filter by trade outcome';
COMMENT ON INDEX idx_ai_signals_training IS 'Optimized for ML training data queries';
COMMENT ON INDEX idx_ai_signals_created_at IS 'Time-series analysis';
COMMENT ON INDEX idx_ai_signals_closed_at IS 'Completed trades analysis';

-- Create view for complete training data
CREATE OR REPLACE VIEW public.ai_signals_training_complete AS
SELECT 
  id,
  created_at,
  symbol,
  timeframe,
  dir,
  win_prob,
  atr,
  rsi,
  price,
  reason,
  order_ticket,
  entry_price,
  exit_price,
  profit_loss,
  closed_at,
  hold_duration_minutes,
  actual_result,
  sl_hit,
  tp_hit,
  -- Success flag for binary classification
  CASE 
    WHEN actual_result = 'WIN' THEN 1
    WHEN actual_result = 'LOSS' THEN 0
    ELSE NULL
  END as success_flag,
  -- Price movement
  CASE 
    WHEN entry_price IS NOT NULL AND exit_price IS NOT NULL 
    THEN (exit_price - entry_price) / NULLIF(entry_price, 0) * 100
    ELSE NULL
  END as price_movement_pct
FROM public.ai_signals
WHERE actual_result IN ('WIN', 'LOSS')
  AND entry_price IS NOT NULL
  AND exit_price IS NOT NULL
  AND profit_loss IS NOT NULL;

COMMENT ON VIEW public.ai_signals_training_complete IS 'Complete and verified data ready for ML training';

-- Create view for data quality monitoring
CREATE OR REPLACE VIEW public.ai_signals_quality AS
SELECT 
  actual_result,
  COUNT(*) as total_count,
  COUNT(entry_price) as has_entry_price,
  COUNT(exit_price) as has_exit_price,
  COUNT(profit_loss) as has_profit_loss,
  COUNT(closed_at) as has_closed_at,
  ROUND(COUNT(entry_price)::NUMERIC / COUNT(*) * 100, 1) as entry_price_pct,
  ROUND(COUNT(exit_price)::NUMERIC / COUNT(*) * 100, 1) as exit_price_pct
FROM public.ai_signals
GROUP BY actual_result
ORDER BY 
  CASE actual_result
    WHEN 'WIN' THEN 1
    WHEN 'LOSS' THEN 2
    WHEN 'BREAK_EVEN' THEN 3
    WHEN 'FILLED' THEN 4
    WHEN 'PENDING' THEN 5
    WHEN 'CANCELLED' THEN 6
    ELSE 7
  END;

COMMENT ON VIEW public.ai_signals_quality IS 'Monitor data completeness for each trade status';

-- Statistics view
CREATE OR REPLACE VIEW public.ai_signals_stats AS
SELECT 
  symbol,
  timeframe,
  COUNT(*) as total_signals,
  COUNT(CASE WHEN actual_result = 'WIN' THEN 1 END) as wins,
  COUNT(CASE WHEN actual_result = 'LOSS' THEN 1 END) as losses,
  ROUND(
    COUNT(CASE WHEN actual_result = 'WIN' THEN 1 END)::NUMERIC / 
    NULLIF(COUNT(CASE WHEN actual_result IN ('WIN', 'LOSS') THEN 1 END), 0) * 100, 
    1
  ) as win_rate_pct,
  ROUND(CAST(AVG(CASE WHEN actual_result IN ('WIN', 'LOSS') THEN profit_loss END) AS NUMERIC), 2) as avg_profit_loss,
  ROUND(CAST(SUM(CASE WHEN actual_result IN ('WIN', 'LOSS') THEN profit_loss ELSE 0 END) AS NUMERIC), 2) as total_profit_loss,
  ROUND(CAST(AVG(win_prob * 100) AS NUMERIC), 1) as avg_ai_win_prob_pct,
  ROUND(CAST(AVG(CASE WHEN actual_result IN ('WIN', 'LOSS') THEN hold_duration_minutes END) AS NUMERIC), 0) as avg_duration_min
FROM public.ai_signals
GROUP BY symbol, timeframe
ORDER BY symbol, timeframe;

COMMENT ON VIEW public.ai_signals_stats IS 'Trading performance statistics by symbol and timeframe';

-- Success message
DO $$ 
BEGIN 
  RAISE NOTICE 'ai_signals table optimization complete';
  RAISE NOTICE 'Indexes added for faster queries';
  RAISE NOTICE 'Views created for ML training and monitoring';
END $$;
