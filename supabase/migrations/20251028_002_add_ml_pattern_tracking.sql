-- Migration: Add ML pattern tracking columns to ai_signals
-- Purpose: Track when ML patterns are used in decision making
-- Created: 2025-10-28

ALTER TABLE public.ai_signals
ADD COLUMN IF NOT EXISTS ml_pattern_used boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS ml_pattern_id bigint REFERENCES ml_patterns(id),
ADD COLUMN IF NOT EXISTS ml_pattern_name text,
ADD COLUMN IF NOT EXISTS ml_pattern_confidence numeric(5,2);

-- Add index for ML pattern queries
CREATE INDEX IF NOT EXISTS idx_ai_signals_ml_pattern_used ON public.ai_signals (ml_pattern_used);
CREATE INDEX IF NOT EXISTS idx_ai_signals_ml_pattern_id ON public.ai_signals (ml_pattern_id);

-- Add comments
COMMENT ON COLUMN public.ai_signals.ml_pattern_used IS 'MLパターンが判断に使用されたか';
COMMENT ON COLUMN public.ai_signals.ml_pattern_id IS '使用されたMLパターンのID（ml_patternsテーブル参照）';
COMMENT ON COLUMN public.ai_signals.ml_pattern_name IS '使用されたMLパターンの名前';
COMMENT ON COLUMN public.ai_signals.ml_pattern_confidence IS 'MLパターンの信頼度（0-100%）';
