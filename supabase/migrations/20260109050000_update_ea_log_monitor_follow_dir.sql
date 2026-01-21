-- Migration: Make ea_log_monitor show follow direction
-- Purpose:
-- - Disambiguate what "trend_follow" means in practice by explicitly showing the
--   direction that would be followed (derived from AI recommendation).

DROP VIEW IF EXISTS public.ea_log_monitor;

DO $do$
DECLARE
  col_regime text;
  col_strategy text;
  col_suggested_action text;
  col_suggested_dir text;
  col_action text;
  col_tech_action text;
  col_win_prob text;
  col_buy_win_prob text;
  col_sell_win_prob text;
  col_trade_decision text;
  col_ai_reasoning text;
  col_order_ticket text;
BEGIN
  col_regime := CASE WHEN EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'ea-log' AND column_name = 'regime'
  ) THEN '"regime"' ELSE 'NULL::text' END;

  col_strategy := CASE WHEN EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'ea-log' AND column_name = 'strategy'
  ) THEN '"strategy"' ELSE 'NULL::text' END;

  col_suggested_action := CASE WHEN EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'ea-log' AND column_name = 'suggested_action'
  ) THEN '"suggested_action"' ELSE 'NULL::text' END;

  col_suggested_dir := CASE WHEN EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'ea-log' AND column_name = 'suggested_dir'
  ) THEN '"suggested_dir"' ELSE 'NULL::integer' END;

  col_action := CASE WHEN EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'ea-log' AND column_name = 'action'
  ) THEN '"action"' ELSE 'NULL::text' END;

  col_tech_action := CASE WHEN EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'ea-log' AND column_name = 'tech_action'
  ) THEN '"tech_action"' ELSE 'NULL::text' END;

  col_win_prob := CASE WHEN EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'ea-log' AND column_name = 'win_prob'
  ) THEN '"win_prob"' ELSE 'NULL::double precision' END;

  col_buy_win_prob := CASE WHEN EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'ea-log' AND column_name = 'buy_win_prob'
  ) THEN '"buy_win_prob"' ELSE 'NULL::double precision' END;

  col_sell_win_prob := CASE WHEN EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'ea-log' AND column_name = 'sell_win_prob'
  ) THEN '"sell_win_prob"' ELSE 'NULL::double precision' END;

  col_trade_decision := CASE WHEN EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'ea-log' AND column_name = 'trade_decision'
  ) THEN '"trade_decision"' ELSE 'NULL::text' END;

  col_ai_reasoning := CASE WHEN EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'ea-log' AND column_name = 'ai_reasoning'
  ) THEN '"ai_reasoning"' ELSE 'NULL::text' END;

  col_order_ticket := CASE WHEN EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'ea-log' AND column_name = 'order_ticket'
  ) THEN '"order_ticket"' ELSE 'NULL::bigint' END;

  EXECUTE format($view$
    CREATE OR REPLACE VIEW public.ea_log_monitor AS
    SELECT
      at AS "判断日時",
      sym AS "銘柄",
      tf AS "TF",
      %s AS "相場状態",
      %s AS "戦略",
      CASE
        WHEN %s = 'trend_follow' THEN
          COALESCE(
            %s,
            CASE
              WHEN %s = 1 THEN 'BUY'
              WHEN %s = -1 THEN 'SELL'
              WHEN %s = 0 THEN 'HOLD'
              ELSE NULL
            END
          )
        ELSE NULL
      END AS "フォロー方向",
      %s AS "方向",
      %s AS "Tech方向",
      COALESCE(
        %s,
        CASE
          WHEN %s = 1 THEN 'BUY'
          WHEN %s = -1 THEN 'SELL'
          WHEN %s = 0 THEN 'HOLD'
          ELSE NULL
        END
      ) AS "AI推奨",
      CASE WHEN %s IS NULL THEN NULL ELSE ROUND(CAST(%s * 100 AS NUMERIC), 1) || '%%' END AS "勝率",
      CASE
        WHEN %s >= 0.75 THEN '🟢 高'
        WHEN %s >= 0.60 THEN '🟡 中'
        WHEN %s IS NULL THEN NULL
        ELSE '🔴 低'
      END AS "信頼度",
      CASE WHEN %s IS NULL THEN NULL ELSE ROUND(CAST(%s * 100 AS NUMERIC), 1) || '%%' END AS "BUY勝率",
      CASE WHEN %s IS NULL THEN NULL ELSE ROUND(CAST(%s * 100 AS NUMERIC), 1) || '%%' END AS "SELL勝率",
      %s AS "実行状況",
      %s AS "AI判断根拠",
      %s AS "注文番号",
      created_at AS "記録日時"
    FROM public."ea-log"
    ORDER BY at DESC;
  $view$,
    col_regime,
    col_strategy,
    col_strategy,
    col_suggested_action,
    col_suggested_dir,
    col_suggested_dir,
    col_suggested_dir,
    col_action,
    col_tech_action,
    col_suggested_action,
    col_suggested_dir,
    col_suggested_dir,
    col_suggested_dir,
    col_win_prob,
    col_win_prob,
    col_win_prob,
    col_win_prob,
    col_win_prob,
    col_buy_win_prob,
    col_buy_win_prob,
    col_sell_win_prob,
    col_sell_win_prob,
    col_trade_decision,
    col_ai_reasoning,
    col_order_ticket
  );
END $do$;

COMMENT ON VIEW public.ea_log_monitor IS 'EAログ（相場状態/戦略/フォロー方向/方向/勝率/AI推奨・BUY/SELL比較）を見やすく表示';

GRANT SELECT ON public.ea_log_monitor TO authenticated, service_role;
