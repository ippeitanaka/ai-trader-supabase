-- Migration: Simplify ea-log table for better visibility
-- Removes unnecessary technical columns and keeps only essential trading decision data
-- AI learning data is preserved in ai_signals table
-- Created: 2025-10-15

-- Step 1: Create new simplified table
CREATE TABLE IF NOT EXISTS public."ea-log-new" (
  id BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  at TIMESTAMPTZ NOT NULL,                    -- トレード判断日時
  sym TEXT NOT NULL,                           -- 銘柄
  tf TEXT,                                     -- タイムフレーム（補足情報）
  action TEXT,                                 -- 売買の判断 (BUY/SELL/HOLD)
  trade_decision TEXT,                         -- 実際の取引 (EXECUTED/HOLD/SKIPPED_*)
  win_prob DOUBLE PRECISION,                   -- AIの算出した勝率 (0.0-1.0)
  ai_reasoning TEXT,                           -- AIの判断根拠
  order_ticket BIGINT                          -- 注文番号（トラッキング用）
);

-- Step 2: Copy existing data from old table (only essential columns)
INSERT INTO public."ea-log-new" (id, created_at, at, sym, tf, action, win_prob, ai_reasoning)
SELECT 
  id,
  at as created_at,
  at,
  sym,
  tf,
  action,
  win_prob,
  reason as ai_reasoning
FROM public."ea-log"
ON CONFLICT (id) DO NOTHING;

-- Step 3: Drop old table and rename new one
DROP TABLE IF EXISTS public."ea-log" CASCADE;
ALTER TABLE public."ea-log-new" RENAME TO "ea-log";

-- Step 4: Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_ea_log_at ON public."ea-log" (at DESC);
CREATE INDEX IF NOT EXISTS idx_ea_log_sym ON public."ea-log" (sym);
CREATE INDEX IF NOT EXISTS idx_ea_log_trade_decision ON public."ea-log" (trade_decision);
CREATE INDEX IF NOT EXISTS idx_ea_log_created_at ON public."ea-log" (created_at DESC);

-- Step 5: Add comments for clarity
COMMENT ON TABLE public."ea-log" IS 'Simplified EA trading logs for monitoring (AI learning data is in ai_signals table)';
COMMENT ON COLUMN public."ea-log".at IS 'Trade decision timestamp';
COMMENT ON COLUMN public."ea-log".sym IS 'Trading symbol (e.g., XAUUSD, BTCUSD)';
COMMENT ON COLUMN public."ea-log".tf IS 'Timeframe (e.g., M15, H1)';
COMMENT ON COLUMN public."ea-log".action IS 'Trade direction: BUY, SELL, or HOLD';
COMMENT ON COLUMN public."ea-log".trade_decision IS 'Execution status: EXECUTED, HOLD, SKIPPED_LOW_PROB, SKIPPED_MAX_POS, etc.';
COMMENT ON COLUMN public."ea-log".win_prob IS 'AI calculated win probability (0.0-1.0)';
COMMENT ON COLUMN public."ea-log".ai_reasoning IS 'AI reasoning in Japanese';
COMMENT ON COLUMN public."ea-log".order_ticket IS 'MT5 order ticket number if executed';

-- Step 6: Create user-friendly view for monitoring
CREATE OR REPLACE VIEW public.ea_log_monitor AS
SELECT 
  at AS "判断日時",
  sym AS "銘柄",
  tf AS "TF",
  action AS "方向",
  trade_decision AS "実行状況",
  ROUND(CAST(win_prob * 100 AS NUMERIC), 1) || '%' AS "勝率",
  CASE 
    WHEN win_prob >= 0.75 THEN '🟢 高'
    WHEN win_prob >= 0.60 THEN '🟡 中'
    ELSE '🔴 低'
  END AS "信頼度",
  ai_reasoning AS "AI判断根拠",
  order_ticket AS "注文番号",
  created_at AS "記録日時"
FROM public."ea-log"
ORDER BY at DESC;

COMMENT ON VIEW public.ea_log_monitor IS 'User-friendly view of EA logs in Japanese for easy monitoring';

-- Step 7: Enable RLS (Row Level Security) if not already enabled
ALTER TABLE public."ea-log" ENABLE ROW LEVEL SECURITY;

-- Step 8: Create policies for access
DROP POLICY IF EXISTS "Allow service role full access" ON public."ea-log";
CREATE POLICY "Allow service role full access" 
ON public."ea-log"
FOR ALL 
TO service_role
USING (true)
WITH CHECK (true);

DROP POLICY IF EXISTS "Allow authenticated read access" ON public."ea-log";
CREATE POLICY "Allow authenticated read access" 
ON public."ea-log"
FOR SELECT 
TO authenticated
USING (true);

-- Success message
DO $$ 
BEGIN 
  RAISE NOTICE 'ea-log table successfully simplified. Old columns removed, AI learning data preserved in ai_signals table.';
END $$;
