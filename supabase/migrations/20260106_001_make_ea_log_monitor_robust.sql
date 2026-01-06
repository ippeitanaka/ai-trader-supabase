-- Migration: Make ea_log_monitor view more robust
--
-- Problem:
-- - Some columns in ea_log_monitor can appear as NULL depending on which client fields were sent
--   (e.g., suggested_action may be omitted even when suggested_dir exists).
--
-- Fix:
-- - Derive "AI推奨" from suggested_dir when suggested_action is NULL.

CREATE OR REPLACE VIEW public.ea_log_monitor AS
SELECT 
  at AS "判断日時",
  sym AS "銘柄",
  tf AS "TF",
  action AS "方向",
  tech_action AS "Tech方向",
  COALESCE(
    suggested_action,
    CASE
      WHEN suggested_dir = 1 THEN 'BUY'
      WHEN suggested_dir = -1 THEN 'SELL'
      WHEN suggested_dir = 0 THEN 'HOLD'
      ELSE NULL
    END
  ) AS "AI推奨",
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

COMMENT ON VIEW public.ea_log_monitor IS 'EAログ（方向/勝率/AI推奨・BUY/SELL比較）を見やすく表示（AI推奨はsuggested_dirから補完）';
