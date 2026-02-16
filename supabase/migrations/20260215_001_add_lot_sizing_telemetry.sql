-- Migration: Persist dynamic lot sizing telemetry for auditability
--
-- Purpose:
-- - Make it possible to verify whether confidence-based lot scaling was actually applied.
-- - Store both suggested lot metadata and executed lot size.

ALTER TABLE public.ai_signals
  ADD COLUMN IF NOT EXISTS lot_multiplier NUMERIC(5,2) NULL,
  ADD COLUMN IF NOT EXISTS lot_level TEXT NULL,
  ADD COLUMN IF NOT EXISTS lot_reason TEXT NULL,
  ADD COLUMN IF NOT EXISTS executed_lot NUMERIC(10,2) NULL;

COMMENT ON COLUMN public.ai_signals.lot_multiplier IS 'AI/ML suggested lot multiplier (1.00-3.00)';
COMMENT ON COLUMN public.ai_signals.lot_level IS 'Lot sizing level label (e.g. Level 1-4)';
COMMENT ON COLUMN public.ai_signals.lot_reason IS 'Reason text for selected lot multiplier';
COMMENT ON COLUMN public.ai_signals.executed_lot IS 'Lot size actually sent to broker after normalization/caps';

CREATE INDEX IF NOT EXISTS idx_ai_signals_lot_multiplier
  ON public.ai_signals (lot_multiplier)
  WHERE lot_multiplier IS NOT NULL;

ALTER TABLE public."ea-log"
  ADD COLUMN IF NOT EXISTS lot_multiplier NUMERIC(5,2) NULL,
  ADD COLUMN IF NOT EXISTS lot_level TEXT NULL,
  ADD COLUMN IF NOT EXISTS lot_reason TEXT NULL,
  ADD COLUMN IF NOT EXISTS executed_lot NUMERIC(10,2) NULL;

COMMENT ON COLUMN public."ea-log".lot_multiplier IS 'AI/ML suggested lot multiplier (1.00-3.00)';
COMMENT ON COLUMN public."ea-log".lot_level IS 'Lot sizing level label (e.g. Level 1-4)';
COMMENT ON COLUMN public."ea-log".lot_reason IS 'Reason text for selected lot multiplier';
COMMENT ON COLUMN public."ea-log".executed_lot IS 'Lot size actually sent to broker after normalization/caps';

CREATE INDEX IF NOT EXISTS idx_ea_log_lot_multiplier
  ON public."ea-log" (lot_multiplier)
  WHERE lot_multiplier IS NOT NULL;
