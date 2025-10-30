-- Complete ai_signals table schema definition
-- This is a consolidated view of all migrations applied to ai_signals
-- Date: 2025-10-29

-- Main table creation (if not exists)
CREATE TABLE IF NOT EXISTS public.ai_signals (
  id bigserial NOT NULL,
  created_at timestamp with time zone NULL DEFAULT now(),
  
  -- Basic signal info
  symbol text NULL,
  timeframe text NULL,
  dir integer NULL,
  win_prob double precision NULL,
  price double precision NULL,
  reason text NULL,
  instance text NULL,
  model_version text NULL,
  
  -- Technical indicators
  atr double precision NULL,
  rsi double precision NULL,
  bid numeric(20, 5) NULL,
  ask numeric(20, 5) NULL,
  
  -- Moving averages
  ema_25 numeric(20, 5) NULL,
  sma_100 numeric(20, 5) NULL,
  ma_cross integer NULL,
  
  -- MACD
  macd_main numeric(20, 5) NULL,
  macd_signal numeric(20, 5) NULL,
  macd_histogram numeric(20, 5) NULL,
  macd_cross integer NULL,
  
  -- Ichimoku
  ichimoku_tenkan numeric(20, 5) NULL,
  ichimoku_kijun numeric(20, 5) NULL,
  ichimoku_senkou_a numeric(20, 5) NULL,
  ichimoku_senkou_b numeric(20, 5) NULL,
  ichimoku_chikou numeric(20, 5) NULL,
  ichimoku_tk_cross integer NULL,
  ichimoku_cloud_color integer NULL,
  ichimoku_price_vs_cloud integer NULL,
  
  -- EA suggestion (reference)
  ea_dir integer NULL,
  ea_reason text NULL,
  ea_ichimoku_score numeric(5, 2) NULL,
  
  -- Trade execution
  order_ticket bigint NULL,
  entry_price double precision NULL,
  exit_price double precision NULL,
  profit_loss double precision NULL,
  closed_at timestamp with time zone NULL,
  hold_duration_minutes integer NULL,
  actual_result text NULL,
  cancelled_reason text NULL,
  sl_hit boolean NULL DEFAULT false,
  tp_hit boolean NULL DEFAULT false,
  
  -- Entry method (Hybrid Entry System)
  entry_method text NULL,
  entry_params jsonb NULL,
  method_selected_by text NULL,
  method_confidence numeric NULL,
  method_reason text NULL,
  
  -- ML pattern tracking (added 2025-10-28)
  ml_pattern_used boolean NULL DEFAULT false,
  ml_pattern_id bigint NULL,
  ml_pattern_name text NULL,
  ml_pattern_confidence numeric(5, 2) NULL,
  
  CONSTRAINT ai_signals_pkey PRIMARY KEY (id)
) TABLESPACE pg_default;

-- Create indexes (all IF NOT EXISTS for safety)
CREATE INDEX IF NOT EXISTS idx_ai_signals_created_at ON public.ai_signals USING btree (created_at DESC) TABLESPACE pg_default;
CREATE INDEX IF NOT EXISTS idx_ai_signals_symbol ON public.ai_signals USING btree (symbol) TABLESPACE pg_default;
CREATE INDEX IF NOT EXISTS idx_ai_signals_order_ticket ON public.ai_signals USING btree (order_ticket) TABLESPACE pg_default;
CREATE INDEX IF NOT EXISTS idx_ai_signals_ticket ON public.ai_signals USING btree (order_ticket) TABLESPACE pg_default;
CREATE INDEX IF NOT EXISTS idx_ai_signals_actual_result ON public.ai_signals USING btree (actual_result) TABLESPACE pg_default;
CREATE INDEX IF NOT EXISTS idx_ai_signals_result ON public.ai_signals USING btree (actual_result) TABLESPACE pg_default;
CREATE INDEX IF NOT EXISTS idx_ai_signals_instance ON public.ai_signals USING btree (instance) TABLESPACE pg_default;
CREATE INDEX IF NOT EXISTS idx_ai_signals_win_prob ON public.ai_signals USING btree (win_prob DESC) TABLESPACE pg_default;
CREATE INDEX IF NOT EXISTS idx_ai_signals_ma_cross ON public.ai_signals USING btree (ma_cross) TABLESPACE pg_default;
CREATE INDEX IF NOT EXISTS idx_ai_signals_macd_cross ON public.ai_signals USING btree (macd_cross) TABLESPACE pg_default;
CREATE INDEX IF NOT EXISTS idx_ai_signals_entry_method ON public.ai_signals USING btree (entry_method) TABLESPACE pg_default;
CREATE INDEX IF NOT EXISTS idx_ai_signals_method_selected_by ON public.ai_signals USING btree (method_selected_by) TABLESPACE pg_default;
CREATE INDEX IF NOT EXISTS idx_ai_signals_ml_pattern_used ON public.ai_signals USING btree (ml_pattern_used) TABLESPACE pg_default;
CREATE INDEX IF NOT EXISTS idx_ai_signals_ml_pattern_id ON public.ai_signals USING btree (ml_pattern_id) TABLESPACE pg_default;

-- Conditional indexes
CREATE INDEX IF NOT EXISTS idx_ai_signals_closed_at ON public.ai_signals USING btree (closed_at DESC) TABLESPACE pg_default
  WHERE (closed_at IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_ai_signals_training ON public.ai_signals USING btree (actual_result, symbol, timeframe) TABLESPACE pg_default
  WHERE (actual_result = ANY (ARRAY['WIN'::text, 'LOSS'::text]));

-- Column comments
COMMENT ON TABLE public.ai_signals IS 'AI取引シグナルと結果の詳細記録（ML学習のメインデータソース）';
COMMENT ON COLUMN public.ai_signals.ml_pattern_used IS 'MLパターンが使用されたか（2025-10-28追加）';
COMMENT ON COLUMN public.ai_signals.ml_pattern_id IS '使用されたMLパターンのID（ml_patternsテーブルへの参照、2025-10-28追加）';
COMMENT ON COLUMN public.ai_signals.ml_pattern_name IS 'MLパターン名（例: BUY_RSI30-40_ATR0.001、2025-10-28追加）';
COMMENT ON COLUMN public.ai_signals.ml_pattern_confidence IS 'MLパターンの信頼度（%、例: 75.50、2025-10-28追加）';
