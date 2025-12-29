-- Migration: Add regime features (ADX/DI/BB width/normalized ATR) for learning
-- Created: 2025-12-27

-- 1) Store new technical/regime features on each signal
ALTER TABLE public.ai_signals
ADD COLUMN IF NOT EXISTS atr_norm double precision,
ADD COLUMN IF NOT EXISTS adx double precision,
ADD COLUMN IF NOT EXISTS di_plus double precision,
ADD COLUMN IF NOT EXISTS di_minus double precision,
ADD COLUMN IF NOT EXISTS bb_width double precision;

CREATE INDEX IF NOT EXISTS idx_ai_signals_adx ON public.ai_signals (adx) WHERE adx IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ai_signals_bb_width ON public.ai_signals (bb_width) WHERE bb_width IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ai_signals_atr_norm ON public.ai_signals (atr_norm) WHERE atr_norm IS NOT NULL;

COMMENT ON COLUMN public.ai_signals.atr_norm IS 'Normalized ATR (atr/price) at decision time';
COMMENT ON COLUMN public.ai_signals.adx IS 'ADX main value at decision time';
COMMENT ON COLUMN public.ai_signals.di_plus IS '+DI at decision time';
COMMENT ON COLUMN public.ai_signals.di_minus IS '-DI at decision time';
COMMENT ON COLUMN public.ai_signals.bb_width IS 'Bollinger Band width: (upper-lower)/middle at decision time';

-- 2) Add bucket fields to ml_patterns so ai-trader can match regimes
ALTER TABLE public.ml_patterns
ADD COLUMN IF NOT EXISTS adx_bucket text,
ADD COLUMN IF NOT EXISTS bb_width_bucket text,
ADD COLUMN IF NOT EXISTS atr_norm_bucket text;

CREATE INDEX IF NOT EXISTS idx_ml_patterns_regime_buckets
  ON public.ml_patterns (symbol, timeframe, direction, adx_bucket, bb_width_bucket, atr_norm_bucket)
  WHERE is_active = true;
