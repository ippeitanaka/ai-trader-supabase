-- Migration: Enhance ea-log table for better AI decision tracking
-- Adds columns to display AI judgment and trade execution status
-- Created: 2025-10-14

-- Add new columns for AI judgment and trade status
ALTER TABLE public."ea-log" 
ADD COLUMN IF NOT EXISTS ai_confidence TEXT,           -- 'high', 'medium', 'low'
ADD COLUMN IF NOT EXISTS ai_reasoning TEXT,            -- AI判断理由（日本語）
ADD COLUMN IF NOT EXISTS trade_decision TEXT,          -- 'EXECUTED', 'SKIPPED_LOW_PROB', 'SKIPPED_MAX_POS', 'HOLD'
ADD COLUMN IF NOT EXISTS threshold_met BOOLEAN,        -- 閾値をクリアしたか
ADD COLUMN IF NOT EXISTS current_positions INTEGER,    -- 現在のポジション数
ADD COLUMN IF NOT EXISTS order_ticket BIGINT;          -- 実行された注文のチケット番号

-- Create additional indexes for new columns
CREATE INDEX IF NOT EXISTS idx_ea_log_trade_decision ON public."ea-log" (trade_decision);
CREATE INDEX IF NOT EXISTS idx_ea_log_ai_confidence ON public."ea-log" (ai_confidence);
CREATE INDEX IF NOT EXISTS idx_ea_log_threshold_met ON public."ea-log" (threshold_met);

-- Add comments
COMMENT ON COLUMN public."ea-log".ai_confidence IS 'AI confidence level: high (>=75%), medium (60-74%), low (<60%)';
COMMENT ON COLUMN public."ea-log".ai_reasoning IS 'AI reasoning in Japanese from GPT response';
COMMENT ON COLUMN public."ea-log".trade_decision IS 'Trade execution status: EXECUTED, SKIPPED_LOW_PROB, SKIPPED_MAX_POS, HOLD';
COMMENT ON COLUMN public."ea-log".threshold_met IS 'Whether win_prob met the MinWinProb threshold';
COMMENT ON COLUMN public."ea-log".current_positions IS 'Number of open positions at the time of signal';
COMMENT ON COLUMN public."ea-log".order_ticket IS 'MT5 order ticket number if trade was executed';

-- Create a view for easy monitoring
CREATE OR REPLACE VIEW public.ea_log_summary AS
SELECT 
  id,
  at,
  sym AS symbol,
  tf AS timeframe,
  action AS direction,
  ROUND(win_prob * 100, 1) || '%' AS win_rate,
  ai_confidence AS confidence,
  trade_decision AS trade_status,
  CASE 
    WHEN threshold_met THEN '✓'
    ELSE '✗'
  END AS threshold,
  current_positions AS positions,
  order_ticket AS ticket,
  ai_reasoning AS reasoning,
  reason AS technical_reason,
  instance,
  version
FROM public."ea-log"
ORDER BY at DESC;

COMMENT ON VIEW public.ea_log_summary IS 'User-friendly view of EA logs showing AI decisions and trade execution status';
