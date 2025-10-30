-- Add entry method fields to ai_signals for hybrid entry selection
-- Safe to run multiple times: use IF NOT EXISTS where supported

ALTER TABLE ai_signals
  ADD COLUMN IF NOT EXISTS entry_method text,
  ADD COLUMN IF NOT EXISTS entry_params jsonb,
  ADD COLUMN IF NOT EXISTS method_selected_by text,
  ADD COLUMN IF NOT EXISTS method_confidence numeric,
  ADD COLUMN IF NOT EXISTS method_reason text;

-- Optional helper indexes (jsonb can be queried by keys later)
CREATE INDEX IF NOT EXISTS idx_ai_signals_entry_method ON ai_signals (entry_method);
CREATE INDEX IF NOT EXISTS idx_ai_signals_method_selected_by ON ai_signals (method_selected_by);
