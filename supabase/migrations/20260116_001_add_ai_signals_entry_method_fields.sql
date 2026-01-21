-- Migration: Add missing ai_signals entry-method fields
-- Purpose:
-- - Some archived prod dumps (and docs) include these columns.
-- - Keep schema forward-compatible and enable local analysis imports.

ALTER TABLE public.ai_signals
  ADD COLUMN IF NOT EXISTS entry_method TEXT,
  ADD COLUMN IF NOT EXISTS entry_params JSONB,
  ADD COLUMN IF NOT EXISTS method_selected_by TEXT,
  ADD COLUMN IF NOT EXISTS method_confidence DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS method_reason TEXT;
