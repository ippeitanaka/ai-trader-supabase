-- Apply missing columns to production ai_signals table
-- This fixes the "entry_method does not exist" error

-- 1. Entry Method columns (fixes existing 500 error)
ALTER TABLE public.ai_signals
ADD COLUMN IF NOT EXISTS entry_method text,
ADD COLUMN IF NOT EXISTS entry_params jsonb,
ADD COLUMN IF NOT EXISTS method_selected_by text,
ADD COLUMN IF NOT EXISTS method_confidence numeric,
ADD COLUMN IF NOT EXISTS method_reason text;

-- 2. ML Pattern Tracking columns (new feature)
ALTER TABLE public.ai_signals
ADD COLUMN IF NOT EXISTS ml_pattern_used boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS ml_pattern_id bigint,
ADD COLUMN IF NOT EXISTS ml_pattern_name text,
ADD COLUMN IF NOT EXISTS ml_pattern_confidence numeric(5,2);

-- 3. Indexes for performance
CREATE INDEX IF NOT EXISTS idx_ai_signals_entry_method ON public.ai_signals (entry_method);
CREATE INDEX IF NOT EXISTS idx_ai_signals_method_selected_by ON public.ai_signals (method_selected_by);
CREATE INDEX IF NOT EXISTS idx_ai_signals_ml_pattern_used ON public.ai_signals (ml_pattern_used);
CREATE INDEX IF NOT EXISTS idx_ai_signals_ml_pattern_id ON public.ai_signals (ml_pattern_id);
