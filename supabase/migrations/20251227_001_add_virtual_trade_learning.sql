-- Add virtual (paper/shadow) trade tracking to prevent learning blind spots
-- Created: 2025-12-27

-- 1) ai_signals: mark virtual signals and store planned TP/SL so EA can later backfill outcomes
ALTER TABLE public.ai_signals
ADD COLUMN IF NOT EXISTS is_virtual boolean NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS planned_entry_price double precision,
ADD COLUMN IF NOT EXISTS planned_sl double precision,
ADD COLUMN IF NOT EXISTS planned_tp double precision,
ADD COLUMN IF NOT EXISTS planned_order_type integer,
ADD COLUMN IF NOT EXISTS virtual_filled_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_ai_signals_is_virtual ON public.ai_signals (is_virtual);

COMMENT ON COLUMN public.ai_signals.is_virtual IS 'true when this row represents a shadow/paper (non-executed) trade for learning';
COMMENT ON COLUMN public.ai_signals.planned_entry_price IS 'EA planned entry price (used for virtual/pending simulation)';
COMMENT ON COLUMN public.ai_signals.planned_sl IS 'EA planned stop loss price (used for virtual simulation)';
COMMENT ON COLUMN public.ai_signals.planned_tp IS 'EA planned take profit price (used for virtual simulation)';
COMMENT ON COLUMN public.ai_signals.planned_order_type IS 'MT5 order type integer (pending/market) for virtual simulation';
COMMENT ON COLUMN public.ai_signals.virtual_filled_at IS 'virtual/paper trade fill time (when planned entry price is reached)';

-- 2) ml_patterns: track real vs virtual sample sizes
ALTER TABLE public.ml_patterns
ADD COLUMN IF NOT EXISTS real_trades integer NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS virtual_trades integer NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS effective_trades double precision NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_ml_patterns_real_trades ON public.ml_patterns (real_trades DESC);
COMMENT ON COLUMN public.ml_patterns.real_trades IS 'count of real (executed) trades included in this pattern';
COMMENT ON COLUMN public.ml_patterns.virtual_trades IS 'count of virtual/paper trades included in this pattern';
COMMENT ON COLUMN public.ml_patterns.effective_trades IS 'effective sample size after weighting virtual trades';

-- Backfill for existing patterns so PHASE2/3 keeps working until next training run.
UPDATE public.ml_patterns
SET
	real_trades = COALESCE(NULLIF(real_trades, 0), COALESCE(total_trades, 0)),
	virtual_trades = COALESCE(virtual_trades, 0),
	effective_trades = COALESCE(NULLIF(effective_trades, 0), COALESCE(total_trades, 0))
WHERE
	(real_trades = 0 OR effective_trades = 0);
