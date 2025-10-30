-- Remove unused EA judgment columns (not used in ML training)
-- Add technical indicator columns for advanced ML pattern discovery

-- 1. Remove EA judgment columns (reference data only, not used in ML)
ALTER TABLE public.ai_signals
DROP COLUMN IF EXISTS ea_dir,
DROP COLUMN IF EXISTS ea_reason,
DROP COLUMN IF EXISTS ea_ichimoku_score;

-- 2. Add MACD columns (if not exists)
ALTER TABLE public.ai_signals
ADD COLUMN IF NOT EXISTS macd_main numeric,
ADD COLUMN IF NOT EXISTS macd_signal numeric,
ADD COLUMN IF NOT EXISTS macd_histogram numeric,
ADD COLUMN IF NOT EXISTS macd_cross integer; -- 1=bullish cross, -1=bearish cross

-- 3. Add Ichimoku columns (if not exists)
ALTER TABLE public.ai_signals
ADD COLUMN IF NOT EXISTS ichimoku_tenkan numeric,
ADD COLUMN IF NOT EXISTS ichimoku_kijun numeric,
ADD COLUMN IF NOT EXISTS ichimoku_senkou_a numeric,
ADD COLUMN IF NOT EXISTS ichimoku_senkou_b numeric,
ADD COLUMN IF NOT EXISTS ichimoku_chikou numeric,
ADD COLUMN IF NOT EXISTS ichimoku_tk_cross integer, -- 1=tenkan > kijun, -1=tenkan < kijun
ADD COLUMN IF NOT EXISTS ichimoku_cloud_color integer, -- 1=bullish (senkou_a > senkou_b), -1=bearish
ADD COLUMN IF NOT EXISTS ichimoku_price_vs_cloud integer; -- 1=above cloud, -1=below cloud, 0=in cloud

-- 4. Add Moving Average columns (if not exists)
ALTER TABLE public.ai_signals
ADD COLUMN IF NOT EXISTS bid numeric,
ADD COLUMN IF NOT EXISTS ask numeric,
ADD COLUMN IF NOT EXISTS ema_25 numeric,
ADD COLUMN IF NOT EXISTS sma_100 numeric,
ADD COLUMN IF NOT EXISTS ma_cross integer; -- 1=bullish (ema > sma), -1=bearish

-- 5. Create indexes for ML pattern queries
CREATE INDEX IF NOT EXISTS idx_ai_signals_macd_cross ON public.ai_signals (macd_cross) WHERE macd_cross IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ai_signals_ichimoku_tk_cross ON public.ai_signals (ichimoku_tk_cross) WHERE ichimoku_tk_cross IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ai_signals_ichimoku_cloud_color ON public.ai_signals (ichimoku_cloud_color) WHERE ichimoku_cloud_color IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ai_signals_ma_cross ON public.ai_signals (ma_cross) WHERE ma_cross IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ai_signals_rsi_atr ON public.ai_signals (rsi, atr) WHERE rsi IS NOT NULL AND atr IS NOT NULL;

-- 6. Add composite index for complex pattern queries
CREATE INDEX IF NOT EXISTS idx_ai_signals_pattern_analysis 
ON public.ai_signals (symbol, timeframe, dir, actual_result, rsi, macd_cross, ichimoku_tk_cross) 
WHERE actual_result IN ('WIN', 'LOSS');

COMMENT ON COLUMN public.ai_signals.macd_main IS 'MACD main line value';
COMMENT ON COLUMN public.ai_signals.macd_signal IS 'MACD signal line value';
COMMENT ON COLUMN public.ai_signals.macd_histogram IS 'MACD histogram value';
COMMENT ON COLUMN public.ai_signals.macd_cross IS 'MACD cross state: 1=bullish, -1=bearish';
COMMENT ON COLUMN public.ai_signals.ichimoku_tk_cross IS 'Ichimoku TK cross: 1=tenkan>kijun, -1=tenkan<kijun';
COMMENT ON COLUMN public.ai_signals.ichimoku_cloud_color IS 'Ichimoku cloud: 1=bullish, -1=bearish';
COMMENT ON COLUMN public.ai_signals.ma_cross IS 'MA cross: 1=ema>sma (bullish), -1=ema<sma (bearish)';
