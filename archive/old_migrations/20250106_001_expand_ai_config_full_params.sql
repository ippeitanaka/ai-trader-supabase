-- Migration: Expand ai_config table to match all MT5 EA input properties
-- Created: 2025-10-14

ALTER TABLE public.ai_config
  ADD COLUMN IF NOT EXISTS lock_to_chart_symbol BOOLEAN,
  ADD COLUMN IF NOT EXISTS tf_entry TEXT,
  ADD COLUMN IF NOT EXISTS tf_recheck TEXT,
  ADD COLUMN IF NOT EXISTS min_win_prob DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS risk_atr_mult DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS reward_rr DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS pending_offset_atr DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS pending_expiry_min INTEGER,
  ADD COLUMN IF NOT EXISTS lots DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS slippage_points INTEGER,
  ADD COLUMN IF NOT EXISTS magic BIGINT,
  ADD COLUMN IF NOT EXISTS max_positions INTEGER,
  ADD COLUMN IF NOT EXISTS debug_logs BOOLEAN,
  ADD COLUMN IF NOT EXISTS log_cooldown_sec INTEGER,
  ADD COLUMN IF NOT EXISTS ai_endpoint_url TEXT,
  ADD COLUMN IF NOT EXISTS ea_log_url TEXT,
  ADD COLUMN IF NOT EXISTS ai_config_url TEXT,
  ADD COLUMN IF NOT EXISTS ai_signals_url TEXT,
  ADD COLUMN IF NOT EXISTS ai_bearer_token TEXT,
  ADD COLUMN IF NOT EXISTS ai_ea_instance TEXT,
  ADD COLUMN IF NOT EXISTS ai_ea_version TEXT,
  ADD COLUMN IF NOT EXISTS ai_timeout_ms INTEGER;

-- Optional: Add comments for clarity
COMMENT ON COLUMN public.ai_config.lock_to_chart_symbol IS 'LockToChartSymbol (bool)';
COMMENT ON COLUMN public.ai_config.tf_entry IS 'TF_Entry (ENUM_TIMEFRAMES as text)';
COMMENT ON COLUMN public.ai_config.tf_recheck IS 'TF_Recheck (ENUM_TIMEFRAMES as text)';
COMMENT ON COLUMN public.ai_config.min_win_prob IS 'MinWinProb (double)';
COMMENT ON COLUMN public.ai_config.risk_atr_mult IS 'RiskATRmult (double)';
COMMENT ON COLUMN public.ai_config.reward_rr IS 'RewardRR (double)';
COMMENT ON COLUMN public.ai_config.pending_offset_atr IS 'PendingOffsetATR (double)';
COMMENT ON COLUMN public.ai_config.pending_expiry_min IS 'PendingExpiryMin (int)';
COMMENT ON COLUMN public.ai_config.lots IS 'Lots (double)';
COMMENT ON COLUMN public.ai_config.slippage_points IS 'SlippagePoints (int)';
COMMENT ON COLUMN public.ai_config.magic IS 'Magic (long)';
COMMENT ON COLUMN public.ai_config.max_positions IS 'MaxPositions (int)';
COMMENT ON COLUMN public.ai_config.debug_logs IS 'DebugLogs (bool)';
COMMENT ON COLUMN public.ai_config.log_cooldown_sec IS 'LogCooldownSec (int)';
COMMENT ON COLUMN public.ai_config.ai_endpoint_url IS 'AI_Endpoint_URL (string)';
COMMENT ON COLUMN public.ai_config.ea_log_url IS 'EA_Log_URL (string)';
COMMENT ON COLUMN public.ai_config.ai_config_url IS 'AI_Config_URL (string)';
COMMENT ON COLUMN public.ai_config.ai_signals_url IS 'AI_Signals_URL (string)';
COMMENT ON COLUMN public.ai_config.ai_bearer_token IS 'AI_Bearer_Token (string)';
COMMENT ON COLUMN public.ai_config.ai_ea_instance IS 'AI_EA_Instance (string)';
COMMENT ON COLUMN public.ai_config.ai_ea_version IS 'AI_EA_Version (string)';
COMMENT ON COLUMN public.ai_config.ai_timeout_ms IS 'AI_Timeout_ms (int)';
