-- Migration: Extend ea-log to store AI direction decision details
-- Adds columns needed to display: which side (BUY/SELL) AI preferred and the win probabilities

ALTER TABLE public."ea-log"
  ADD COLUMN IF NOT EXISTS tech_action TEXT,
  ADD COLUMN IF NOT EXISTS suggested_action TEXT,
  ADD COLUMN IF NOT EXISTS suggested_dir INTEGER,
  ADD COLUMN IF NOT EXISTS buy_win_prob DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS sell_win_prob DOUBLE PRECISION;

-- Update monitor view to show direction comparison when available
CREATE OR REPLACE VIEW public.ea_log_monitor AS
SELECT 
  at AS "判断日時",
  sym AS "銘柄",
  tf AS "TF",
  action AS "方向",
  tech_action AS "Tech方向",
  suggested_action AS "AI推奨",
  ROUND(CAST(win_prob * 100 AS NUMERIC), 1) || '%' AS "勝率",
  CASE 
    WHEN win_prob >= 0.75 THEN '🟢 高'
    WHEN win_prob >= 0.60 THEN '🟡 中'
    ELSE '🔴 低'
  END AS "信頼度",
  CASE WHEN buy_win_prob IS NULL THEN NULL ELSE ROUND(CAST(buy_win_prob * 100 AS NUMERIC), 1) || '%' END AS "BUY勝率",
  CASE WHEN sell_win_prob IS NULL THEN NULL ELSE ROUND(CAST(sell_win_prob * 100 AS NUMERIC), 1) || '%' END AS "SELL勝率",
  trade_decision AS "実行状況",
  ai_reasoning AS "AI判断根拠",
  order_ticket AS "注文番号",
  created_at AS "記録日時"
FROM public."ea-log"
ORDER BY at DESC;

COMMENT ON VIEW public.ea_log_monitor IS 'EAログ（方向/勝率/AI推奨・BUY/SELL比較）を見やすく表示';
