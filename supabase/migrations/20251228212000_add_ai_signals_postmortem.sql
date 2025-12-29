-- Migration: Add postmortem tagging fields to ai_signals
-- Created: 2025-12-28

ALTER TABLE public.ai_signals
  ADD COLUMN IF NOT EXISTS postmortem_tags text[] NULL,
  ADD COLUMN IF NOT EXISTS postmortem_summary text NULL,
  ADD COLUMN IF NOT EXISTS postmortem_generated_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS postmortem_model text NULL;

-- Helpful index for tag-based analytics
CREATE INDEX IF NOT EXISTS idx_ai_signals_postmortem_tags_gin
  ON public.ai_signals USING gin (postmortem_tags);
