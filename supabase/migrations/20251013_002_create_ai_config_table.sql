-- Migration: Create ai_config table for EA v1.2.2
-- Stores dynamic configuration for EA instances
-- Created: 2025-10-13

-- Create ai_config table
CREATE TABLE IF NOT EXISTS public.ai_config (
  id BIGSERIAL PRIMARY KEY,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  instance TEXT,
  min_win_prob DOUBLE PRECISION,
  pending_offset_atr DOUBLE PRECISION,
  pending_expiry_min INTEGER
);

-- Add instance column if it doesn't exist (for existing tables)
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_schema = 'public' 
                 AND table_name = 'ai_config' 
                 AND column_name = 'instance') THEN
    ALTER TABLE public.ai_config ADD COLUMN instance TEXT;
  END IF;
END $$;

-- Create unique index on instance to prevent duplicates
CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_config_instance ON public.ai_config (instance);

-- Create index on updated_at for sorting
CREATE INDEX IF NOT EXISTS idx_ai_config_updated_at ON public.ai_config (updated_at DESC);

-- Add comment
COMMENT ON TABLE public.ai_config IS 'Dynamic configuration for EA instances';

-- Insert default configuration for "main" instance (with all required fields)
INSERT INTO public.ai_config (
  instance, 
  symbol, 
  timeframe,
  min_win_prob, 
  pending_offset_atr, 
  pending_expiry_min, 
  updated_at
)
VALUES ('main', 'ANY', 'M15', 0.70, 0.20, 90, NOW())
ON CONFLICT (instance) DO NOTHING;
