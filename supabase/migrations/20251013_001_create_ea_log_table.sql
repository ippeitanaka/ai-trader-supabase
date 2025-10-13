-- Migration: Create ea-log table for EA v1.2.2
-- Stores logs from MT5 EA including trade signals, indicators, and AI decisions
-- Created: 2025-10-13

-- Create ea-log table
CREATE TABLE IF NOT EXISTS public."ea-log" (
  id BIGSERIAL PRIMARY KEY,
  at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sym TEXT,
  tf TEXT,
  rsi DOUBLE PRECISION,
  atr DOUBLE PRECISION,
  price DOUBLE PRECISION,
  action TEXT,
  win_prob DOUBLE PRECISION,
  offset_factor DOUBLE PRECISION,
  expiry_minutes INTEGER,
  reason TEXT,
  instance TEXT,
  version TEXT,
  caller TEXT
);

-- Add columns if they don't exist (for migrations from older versions)
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_schema = 'public' 
                 AND table_name = 'ea-log' 
                 AND column_name = 'offset_factor') THEN
    ALTER TABLE public."ea-log" ADD COLUMN offset_factor DOUBLE PRECISION NULL;
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_schema = 'public' 
                 AND table_name = 'ea-log' 
                 AND column_name = 'expiry_minutes') THEN
    ALTER TABLE public."ea-log" ADD COLUMN expiry_minutes INTEGER NULL;
  END IF;
END $$;

-- Create indexes for common queries
CREATE INDEX IF NOT EXISTS idx_ea_log_at ON public."ea-log" (at DESC);
CREATE INDEX IF NOT EXISTS idx_ea_log_sym ON public."ea-log" (sym);
CREATE INDEX IF NOT EXISTS idx_ea_log_instance ON public."ea-log" (instance);
CREATE INDEX IF NOT EXISTS idx_ea_log_caller ON public."ea-log" (caller);

-- Add comment
COMMENT ON TABLE public."ea-log" IS 'EA trading logs from MT5 including signals and AI decisions';
