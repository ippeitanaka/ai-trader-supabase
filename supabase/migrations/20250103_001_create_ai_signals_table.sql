-- Migration: Create ai_signals table for EA v1.2.2 (optional)
-- Stores AI trading signals and decisions for analysis
-- Created: 2025-10-13

-- Create ai_signals table
CREATE TABLE IF NOT EXISTS public.ai_signals (
  id BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  symbol TEXT,
  timeframe TEXT,
  dir INTEGER,
  win_prob DOUBLE PRECISION,
  atr DOUBLE PRECISION,
  rsi DOUBLE PRECISION,
  price DOUBLE PRECISION,
  reason TEXT,
  instance TEXT,
  model_version TEXT
);

-- Create indexes for common queries
CREATE INDEX IF NOT EXISTS idx_ai_signals_created_at ON public.ai_signals (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_signals_symbol ON public.ai_signals (symbol);
CREATE INDEX IF NOT EXISTS idx_ai_signals_instance ON public.ai_signals (instance);
CREATE INDEX IF NOT EXISTS idx_ai_signals_win_prob ON public.ai_signals (win_prob DESC);

-- Add comment
COMMENT ON TABLE public.ai_signals IS 'AI trading signals generated for EA (optional storage)';
