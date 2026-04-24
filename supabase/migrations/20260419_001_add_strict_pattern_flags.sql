-- Migration: Add strict pattern flags for deterministic chart-pattern learning
-- Created: 2026-04-19

ALTER TABLE public.ai_signals
ADD COLUMN IF NOT EXISTS bull_engulfing smallint,
ADD COLUMN IF NOT EXISTS bear_engulfing smallint,
ADD COLUMN IF NOT EXISTS inside_bar smallint,
ADD COLUMN IF NOT EXISTS inside_break_dir integer,
ADD COLUMN IF NOT EXISTS strict_macd_rsi_setup boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS strict_ma_rsi_setup boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS strict_ichimoku_tk_rsi_setup boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS strict_cloud_macd_setup boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS strict_engulfing_setup boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS strict_inside_breakout_setup boolean DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_ai_signals_strict_macd_rsi_setup
  ON public.ai_signals (created_at DESC)
  WHERE strict_macd_rsi_setup = true;

CREATE INDEX IF NOT EXISTS idx_ai_signals_strict_ma_rsi_setup
  ON public.ai_signals (created_at DESC)
  WHERE strict_ma_rsi_setup = true;

CREATE INDEX IF NOT EXISTS idx_ai_signals_strict_ichimoku_tk_rsi_setup
  ON public.ai_signals (created_at DESC)
  WHERE strict_ichimoku_tk_rsi_setup = true;

CREATE INDEX IF NOT EXISTS idx_ai_signals_strict_cloud_macd_setup
  ON public.ai_signals (created_at DESC)
  WHERE strict_cloud_macd_setup = true;

CREATE INDEX IF NOT EXISTS idx_ai_signals_strict_engulfing_setup
  ON public.ai_signals (created_at DESC)
  WHERE strict_engulfing_setup = true;

CREATE INDEX IF NOT EXISTS idx_ai_signals_strict_inside_breakout_setup
  ON public.ai_signals (created_at DESC)
  WHERE strict_inside_breakout_setup = true;

COMMENT ON COLUMN public.ai_signals.bull_engulfing IS 'Strict bullish engulfing flag on decision candle';
COMMENT ON COLUMN public.ai_signals.bear_engulfing IS 'Strict bearish engulfing flag on decision candle';
COMMENT ON COLUMN public.ai_signals.inside_bar IS 'Inside-bar context detected (mother bar + inside bar)';
COMMENT ON COLUMN public.ai_signals.inside_break_dir IS 'Strict inside-bar breakout direction: 1=up, -1=down';
COMMENT ON COLUMN public.ai_signals.strict_macd_rsi_setup IS 'Strict MACD cross x RSI setup aligned with trade direction';
COMMENT ON COLUMN public.ai_signals.strict_ma_rsi_setup IS 'Strict MA cross x RSI setup aligned with trade direction';
COMMENT ON COLUMN public.ai_signals.strict_ichimoku_tk_rsi_setup IS 'Strict Ichimoku TK cross x RSI setup aligned with trade direction';
COMMENT ON COLUMN public.ai_signals.strict_cloud_macd_setup IS 'Strict cloud color x MACD setup aligned with trade direction';
COMMENT ON COLUMN public.ai_signals.strict_engulfing_setup IS 'Strict engulfing reversal setup aligned with trade direction';
COMMENT ON COLUMN public.ai_signals.strict_inside_breakout_setup IS 'Strict inside-bar breakout setup aligned with trade direction';