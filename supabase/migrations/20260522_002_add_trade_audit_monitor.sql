-- Migration: add unified operator-facing trade audit monitor

DROP VIEW IF EXISTS public.trade_audit_monitor;

DO $do$
DECLARE
  e_created_at text;
  e_tf text;
  e_trade_decision text;
  e_action text;
  e_tech_action text;
  e_suggested_action text;
  e_suggested_dir text;
  e_win_prob text;
  e_recommended_min_win_prob text;
  e_threshold_met text;
  e_expected_value_r text;
  e_current_positions text;
  e_entry_method text;
  e_method_selected_by text;
  e_method_reason text;
  e_executed_lot text;
  e_decision_summary text;
  e_skip_reason text;
  e_ai_reasoning text;
  e_order_ticket text;
  s_created_at text;
  s_actual_result text;
  s_entry_price text;
  s_exit_price text;
  s_profit_loss text;
  s_hold_duration_minutes text;
  s_closed_at text;
  s_order_ticket text;
  s_id text;
BEGIN
  e_created_at := CASE WHEN EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'ea-log' AND column_name = 'created_at'
  ) THEN 'e."created_at"' ELSE 'NULL::timestamptz' END;

  e_tf := CASE WHEN EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'ea-log' AND column_name = 'tf'
  ) THEN 'e."tf"' ELSE 'NULL::text' END;

  e_trade_decision := CASE WHEN EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'ea-log' AND column_name = 'trade_decision'
  ) THEN 'e."trade_decision"' ELSE 'NULL::text' END;

  e_action := CASE WHEN EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'ea-log' AND column_name = 'action'
  ) THEN 'e."action"' ELSE 'NULL::text' END;

  e_tech_action := CASE WHEN EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'ea-log' AND column_name = 'tech_action'
  ) THEN 'e."tech_action"' ELSE 'NULL::text' END;

  e_suggested_action := CASE WHEN EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'ea-log' AND column_name = 'suggested_action'
  ) THEN 'e."suggested_action"' ELSE 'NULL::text' END;

  e_suggested_dir := CASE WHEN EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'ea-log' AND column_name = 'suggested_dir'
  ) THEN 'e."suggested_dir"' ELSE 'NULL::integer' END;

  e_win_prob := CASE WHEN EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'ea-log' AND column_name = 'win_prob'
  ) THEN 'e."win_prob"' ELSE 'NULL::double precision' END;

  e_recommended_min_win_prob := CASE WHEN EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'ea-log' AND column_name = 'recommended_min_win_prob'
  ) THEN 'e."recommended_min_win_prob"' ELSE 'NULL::double precision' END;

  e_threshold_met := CASE WHEN EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'ea-log' AND column_name = 'threshold_met'
  ) THEN 'e."threshold_met"' ELSE 'NULL::boolean' END;

  e_expected_value_r := CASE WHEN EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'ea-log' AND column_name = 'expected_value_r'
  ) THEN 'e."expected_value_r"' ELSE 'NULL::double precision' END;

  e_current_positions := CASE WHEN EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'ea-log' AND column_name = 'current_positions'
  ) THEN 'e."current_positions"' ELSE 'NULL::integer' END;

  e_entry_method := CASE WHEN EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'ea-log' AND column_name = 'entry_method'
  ) THEN 'e."entry_method"' ELSE 'NULL::text' END;

  e_method_selected_by := CASE WHEN EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'ea-log' AND column_name = 'method_selected_by'
  ) THEN 'e."method_selected_by"' ELSE 'NULL::text' END;

  e_method_reason := CASE WHEN EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'ea-log' AND column_name = 'method_reason'
  ) THEN 'e."method_reason"' ELSE 'NULL::text' END;

  e_executed_lot := CASE WHEN EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'ea-log' AND column_name = 'executed_lot'
  ) THEN 'e."executed_lot"' ELSE 'NULL::double precision' END;

  e_decision_summary := CASE WHEN EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'ea-log' AND column_name = 'decision_summary'
  ) THEN 'e."decision_summary"' ELSE 'NULL::text' END;

  e_skip_reason := CASE WHEN EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'ea-log' AND column_name = 'skip_reason'
  ) THEN 'e."skip_reason"' ELSE 'NULL::text' END;

  e_ai_reasoning := CASE WHEN EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'ea-log' AND column_name = 'ai_reasoning'
  ) THEN 'e."ai_reasoning"' ELSE 'NULL::text' END;

  e_order_ticket := CASE WHEN EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'ea-log' AND column_name = 'order_ticket'
  ) THEN 'e."order_ticket"' ELSE 'NULL::bigint' END;

  s_created_at := CASE WHEN EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'ai_signals' AND column_name = 'created_at'
  ) THEN 's."created_at"' ELSE 'NULL::timestamptz' END;

  s_actual_result := CASE WHEN EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'ai_signals' AND column_name = 'actual_result'
  ) THEN 's."actual_result"' ELSE 'NULL::text' END;

  s_entry_price := CASE WHEN EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'ai_signals' AND column_name = 'entry_price'
  ) THEN 's."entry_price"' ELSE 'NULL::double precision' END;

  s_exit_price := CASE WHEN EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'ai_signals' AND column_name = 'exit_price'
  ) THEN 's."exit_price"' ELSE 'NULL::double precision' END;

  s_profit_loss := CASE WHEN EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'ai_signals' AND column_name = 'profit_loss'
  ) THEN 's."profit_loss"' ELSE 'NULL::double precision' END;

  s_hold_duration_minutes := CASE WHEN EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'ai_signals' AND column_name = 'hold_duration_minutes'
  ) THEN 's."hold_duration_minutes"' ELSE 'NULL::integer' END;

  s_closed_at := CASE WHEN EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'ai_signals' AND column_name = 'closed_at'
  ) THEN 's."closed_at"' ELSE 'NULL::timestamptz' END;

  s_order_ticket := CASE WHEN EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'ai_signals' AND column_name = 'order_ticket'
  ) THEN 's."order_ticket"' ELSE 'NULL::bigint' END;

  s_id := CASE WHEN EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'ai_signals' AND column_name = 'id'
  ) THEN 's."id"' ELSE 'NULL::bigint' END;

  EXECUTE format($view$
    CREATE VIEW public.trade_audit_monitor AS
    SELECT
      e.at AS "判断日時",
      %s AS "ログ記録日時",
      e.sym AS "銘柄",
      %s AS "TF",
      COALESCE(%s, 'UNKNOWN') AS "EA判定コード",
      CASE
        WHEN %s IN ('EXECUTED_MARKET', 'PLACED_PULLBACK') THEN '実行'
        WHEN %s LIKE 'SKIPPED_%%' THEN '見送り'
        WHEN %s LIKE 'CANCELLED_%%' THEN '取消'
        WHEN %s IN ('H1_PRECHECK_OK', 'RECHECK_OK') THEN '条件維持'
        ELSE COALESCE(%s, '不明')
      END AS "取引判定",
      COALESCE(sig.actual_result,
        CASE
          WHEN %s IN ('EXECUTED_MARKET', 'PLACED_PULLBACK') THEN 'FILLED_WAIT_RESULT'
          ELSE NULL
        END
      ) AS "実行結果",
      %s AS "最終方向",
      %s AS "Tech方向",
      COALESCE(
        %s,
        CASE
          WHEN %s = 1 THEN 'BUY'
          WHEN %s = -1 THEN 'SELL'
          WHEN %s = 0 THEN 'HOLD'
          ELSE NULL
        END
      ) AS "AI推奨方向",
      CASE WHEN %s IS NULL THEN NULL ELSE ROUND(CAST(%s * 100 AS numeric), 1) END AS "判定勝率%%",
      CASE WHEN %s IS NULL THEN NULL ELSE ROUND(CAST(%s * 100 AS numeric), 1) END AS "推奨最小勝率%%",
      %s AS "EAフロア通過",
      ROUND(CAST(%s AS numeric), 3) AS "期待値R",
      %s AS "判定時建玉数",
      %s AS "手法",
      %s AS "手法選択者",
      %s AS "手法の理由",
      ROUND(CAST(%s AS numeric), 2) AS "実行ロット",
      %s AS "判定要約",
      %s AS "見送り理由コード",
      %s AS "実施根拠",
      %s AS "注文番号",
      sig.created_at AS "signal記録日時",
      sig.entry_price AS "約定価格",
      sig.exit_price AS "決済価格",
      ROUND(CAST(sig.profit_loss AS numeric), 2) AS "損益",
      sig.hold_duration_minutes AS "保有分数",
      sig.closed_at AS "決済日時"
    FROM public."ea-log" e
    LEFT JOIN LATERAL (
      SELECT
        %s AS created_at,
        %s AS actual_result,
        %s AS entry_price,
        %s AS exit_price,
        %s AS profit_loss,
        %s AS hold_duration_minutes,
        %s AS closed_at
      FROM public.ai_signals s
      WHERE %s = %s
      ORDER BY %s DESC NULLS LAST, %s DESC NULLS LAST
      LIMIT 1
    ) sig ON true
    ORDER BY e.at DESC, %s DESC NULLS LAST;
  $view$,
    e_created_at,
    e_tf,
    e_trade_decision,
    e_trade_decision,
    e_trade_decision,
    e_trade_decision,
    e_trade_decision,
    e_trade_decision,
    e_trade_decision,
    e_action,
    e_tech_action,
    e_suggested_action,
    e_suggested_dir,
    e_suggested_dir,
    e_suggested_dir,
    e_win_prob,
    e_win_prob,
    e_recommended_min_win_prob,
    e_recommended_min_win_prob,
    e_threshold_met,
    e_expected_value_r,
    e_current_positions,
    e_entry_method,
    e_method_selected_by,
    e_method_reason,
    e_executed_lot,
    e_decision_summary,
    e_skip_reason,
    e_ai_reasoning,
    e_order_ticket,
    s_created_at,
    s_actual_result,
    s_entry_price,
    s_exit_price,
    s_profit_loss,
    s_hold_duration_minutes,
    s_closed_at,
    s_order_ticket,
    e_order_ticket,
    s_created_at,
    s_id,
    e_created_at
  );
END $do$;

COMMENT ON VIEW public.trade_audit_monitor IS 'SupabaseだけでEA判断から実行結果まで追える統合監視ビュー。勝率判断、手法、根拠、結果を1行で確認できる。';

GRANT SELECT ON public.trade_audit_monitor TO authenticated, service_role;