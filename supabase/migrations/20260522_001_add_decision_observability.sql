-- Migration: add operator-facing decision observability

ALTER TABLE public."ea-log"
  ADD COLUMN IF NOT EXISTS decision_summary text,
  ADD COLUMN IF NOT EXISTS recommended_min_win_prob double precision,
  ADD COLUMN IF NOT EXISTS expected_value_r double precision,
  ADD COLUMN IF NOT EXISTS skip_reason text,
  ADD COLUMN IF NOT EXISTS threshold_met boolean,
  ADD COLUMN IF NOT EXISTS current_positions integer,
  ADD COLUMN IF NOT EXISTS entry_method text,
  ADD COLUMN IF NOT EXISTS method_selected_by text,
  ADD COLUMN IF NOT EXISTS method_reason text;

ALTER TABLE public.ai_signals
  ADD COLUMN IF NOT EXISTS decision_summary text;

-- NOTE:
-- CREATE OR REPLACE VIEW cannot rename existing view columns.
-- This migration changes the displayed column layout, so drop first.
DROP VIEW IF EXISTS public.ea_log_monitor;

CREATE OR REPLACE VIEW public.ea_log_monitor AS
SELECT
  at AS "判断日時",
  sym AS "銘柄",
  tf AS "TF",
  regime AS "相場状態",
  strategy AS "戦略",
  CASE
    WHEN strategy = 'trend_follow' THEN
      COALESCE(
        suggested_action,
        CASE
          WHEN suggested_dir = 1 THEN 'BUY'
          WHEN suggested_dir = -1 THEN 'SELL'
          WHEN suggested_dir = 0 THEN 'HOLD'
          ELSE NULL
        END
      )
    ELSE NULL
  END AS "フォロー方向",
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
  CASE WHEN win_prob IS NULL THEN NULL ELSE ROUND(CAST(win_prob * 100 AS numeric), 1) || '%' END AS "勝率",
  CASE
    WHEN win_prob >= 0.75 THEN '🟢 高'
    WHEN win_prob >= 0.60 THEN '🟡 中'
    WHEN win_prob IS NULL THEN NULL
    ELSE '🔴 低'
  END AS "信頼度",
  CASE WHEN buy_win_prob IS NULL THEN NULL ELSE ROUND(CAST(buy_win_prob * 100 AS numeric), 1) || '%' END AS "BUY勝率",
  CASE WHEN sell_win_prob IS NULL THEN NULL ELSE ROUND(CAST(sell_win_prob * 100 AS numeric), 1) || '%' END AS "SELL勝率",
  trade_decision AS "実行状況",
  decision_summary AS "判定要約",
  skip_reason AS "見送り理由",
  expected_value_r AS "期待値R",
  recommended_min_win_prob AS "推奨最小勝率",
  ai_reasoning AS "AI判断根拠",
  order_ticket AS "注文番号",
  created_at AS "記録日時"
FROM public."ea-log"
ORDER BY at DESC;

COMMENT ON VIEW public.ea_log_monitor IS 'EAログ（相場状態/戦略/フォロー方向/方向/勝率/AI推奨・BUY/SELL比較・判定要約）を見やすく表示';

GRANT SELECT ON public.ea_log_monitor TO authenticated, service_role;
