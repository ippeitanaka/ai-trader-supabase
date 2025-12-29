-- Migration: Enhance ai_signals table for ML training
-- Add columns to track actual trade results
-- Created: 2025-10-13

-- Add result tracking columns to ai_signals table
ALTER TABLE public.ai_signals
ADD COLUMN IF NOT EXISTS order_ticket BIGINT,
ADD COLUMN IF NOT EXISTS entry_price DOUBLE PRECISION,
ADD COLUMN IF NOT EXISTS exit_price DOUBLE PRECISION,
ADD COLUMN IF NOT EXISTS profit_loss DOUBLE PRECISION,
ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS hold_duration_minutes INTEGER,
ADD COLUMN IF NOT EXISTS actual_result TEXT, -- 'WIN', 'LOSS', 'BREAK_EVEN', 'PENDING', 'CANCELLED'
ADD COLUMN IF NOT EXISTS cancelled_reason TEXT,
ADD COLUMN IF NOT EXISTS sl_hit BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS tp_hit BOOLEAN DEFAULT false;

-- Add index for ML queries
CREATE INDEX IF NOT EXISTS idx_ai_signals_result ON public.ai_signals (actual_result);
CREATE INDEX IF NOT EXISTS idx_ai_signals_ticket ON public.ai_signals (order_ticket);

-- Add comments
COMMENT ON COLUMN public.ai_signals.order_ticket IS 'MT5 order ticket number';
COMMENT ON COLUMN public.ai_signals.entry_price IS 'Actual entry price when order was filled';
COMMENT ON COLUMN public.ai_signals.exit_price IS 'Exit price when position was closed';
COMMENT ON COLUMN public.ai_signals.profit_loss IS 'Profit or loss in account currency';
COMMENT ON COLUMN public.ai_signals.actual_result IS 'Actual trade outcome for ML training';
COMMENT ON COLUMN public.ai_signals.hold_duration_minutes IS 'How long the position was held';
