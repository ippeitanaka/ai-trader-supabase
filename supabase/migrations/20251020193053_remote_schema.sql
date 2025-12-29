SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;
CREATE EXTENSION IF NOT EXISTS "pg_cron" WITH SCHEMA "pg_catalog";
COMMENT ON SCHEMA "public" IS 'standard public schema';
CREATE EXTENSION IF NOT EXISTS "pg_graphql" WITH SCHEMA "graphql";
CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";
CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";
CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";
CREATE OR REPLACE FUNCTION "public"."check_ml_cron_status"() RETURNS TABLE("job_name" "text", "schedule" "text", "active" boolean, "last_run" timestamp with time zone, "next_run" timestamp with time zone, "total_runs" bigint)
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  RETURN QUERY
  SELECT 
    j.jobname::TEXT,
    j.schedule::TEXT,
    j.active,
    (SELECT MAX(start_time) FROM cron.job_run_details WHERE jobid = j.jobid) AS last_run,
    cron.schedule_next_run(j.schedule)::TIMESTAMPTZ AS next_run,
    (SELECT COUNT(*) FROM cron.job_run_details WHERE jobid = j.jobid) AS total_runs
  FROM cron.job j
  WHERE j.jobname = 'ml-training-daily';
END;
$$;
ALTER FUNCTION "public"."check_ml_cron_status"() OWNER TO "postgres";
COMMENT ON FUNCTION "public"."check_ml_cron_status"() IS 'ML Training Cron Jobの状態を確認する関数。ジョブ名、スケジュール、最終実行時刻、次回実行予定時刻を返す。';
CREATE OR REPLACE FUNCTION "public"."update_ml_pattern_timestamp"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;
ALTER FUNCTION "public"."update_ml_pattern_timestamp"() OWNER TO "postgres";
COMMENT ON FUNCTION "public"."update_ml_pattern_timestamp"() IS 'ml_patternsのupdated_atを自動更新';
SET default_tablespace = '';
SET default_table_access_method = "heap";
CREATE TABLE IF NOT EXISTS "public"."ai_signals" (
    "id" bigint NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "symbol" "text",
    "timeframe" "text",
    "dir" integer,
    "win_prob" double precision,
    "atr" double precision,
    "rsi" double precision,
    "price" double precision,
    "reason" "text",
    "instance" "text",
    "model_version" "text",
    "order_ticket" bigint,
    "entry_price" double precision,
    "exit_price" double precision,
    "profit_loss" double precision,
    "closed_at" timestamp with time zone,
    "hold_duration_minutes" integer,
    "actual_result" "text",
    "cancelled_reason" "text",
    "sl_hit" boolean DEFAULT false,
    "tp_hit" boolean DEFAULT false,
    "bid" numeric(20,5),
    "ask" numeric(20,5),
    "ema_25" numeric(20,5),
    "sma_100" numeric(20,5),
    "ma_cross" integer,
    "macd_main" numeric(20,5),
    "macd_signal" numeric(20,5),
    "macd_histogram" numeric(20,5),
    "macd_cross" integer,
    "ichimoku_tenkan" numeric(20,5),
    "ichimoku_kijun" numeric(20,5),
    "ichimoku_senkou_a" numeric(20,5),
    "ichimoku_senkou_b" numeric(20,5),
    "ichimoku_chikou" numeric(20,5),
    "ichimoku_tk_cross" integer,
    "ichimoku_cloud_color" integer,
    "ichimoku_price_vs_cloud" integer,
    "ea_dir" integer,
    "ea_reason" "text",
    "ea_ichimoku_score" numeric(5,2)
);
ALTER TABLE "public"."ai_signals" OWNER TO "postgres";
COMMENT ON TABLE "public"."ai_signals" IS 'RLS enabled - ML training data with security policies';
CREATE SEQUENCE IF NOT EXISTS "public"."ai_signals_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE "public"."ai_signals_id_seq" OWNER TO "postgres";
ALTER SEQUENCE "public"."ai_signals_id_seq" OWNED BY "public"."ai_signals"."id";
CREATE OR REPLACE VIEW "public"."cron_ml_training_history" WITH ("security_invoker"='true') AS
 SELECT "runid",
    "jobid",
    "job_pid",
    "database",
    "username",
    "command",
    "status",
    "return_message",
    "start_time",
    "end_time",
    ("end_time" - "start_time") AS "duration"
   FROM "cron"."job_run_details"
  WHERE ("command" ~~ '%ml-training%'::"text")
  ORDER BY "start_time" DESC
 LIMIT 100;
ALTER VIEW "public"."cron_ml_training_history" OWNER TO "postgres";
COMMENT ON VIEW "public"."cron_ml_training_history" IS 'ML Training Cron Jobの実行履歴を表示するビュー。最新100件の実行ログを保持。';
CREATE TABLE IF NOT EXISTS "public"."ea-log" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "at" timestamp with time zone NOT NULL,
    "sym" "text" NOT NULL,
    "tf" "text",
    "action" "text",
    "trade_decision" "text",
    "win_prob" double precision,
    "ai_reasoning" "text",
    "order_ticket" bigint
);
ALTER TABLE "public"."ea-log" OWNER TO "postgres";
COMMENT ON TABLE "public"."ea-log" IS 'Simplified EA trading logs for monitoring (AI learning data is in ai_signals table)';
COMMENT ON COLUMN "public"."ea-log"."at" IS 'Trade decision timestamp';
COMMENT ON COLUMN "public"."ea-log"."sym" IS 'Trading symbol (e.g., XAUUSD, BTCUSD)';
COMMENT ON COLUMN "public"."ea-log"."tf" IS 'Timeframe (e.g., M15, H1)';
COMMENT ON COLUMN "public"."ea-log"."action" IS 'Trade direction: BUY, SELL, or HOLD';
COMMENT ON COLUMN "public"."ea-log"."trade_decision" IS 'Execution status: EXECUTED, HOLD, SKIPPED_LOW_PROB, SKIPPED_MAX_POS, etc.';
COMMENT ON COLUMN "public"."ea-log"."win_prob" IS 'AI calculated win probability (0.0-1.0)';
COMMENT ON COLUMN "public"."ea-log"."ai_reasoning" IS 'AI reasoning in Japanese';
COMMENT ON COLUMN "public"."ea-log"."order_ticket" IS 'MT5 order ticket number if executed';
CREATE TABLE IF NOT EXISTS "public"."ml_patterns" (
    "id" bigint NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "pattern_name" "text" NOT NULL,
    "pattern_type" "text" NOT NULL,
    "symbol" "text",
    "timeframe" "text",
    "direction" integer,
    "rsi_min" double precision,
    "rsi_max" double precision,
    "atr_min" double precision,
    "atr_max" double precision,
    "ichimoku_score_min" double precision,
    "ichimoku_score_max" double precision,
    "total_trades" integer DEFAULT 0,
    "win_count" integer DEFAULT 0,
    "loss_count" integer DEFAULT 0,
    "win_rate" double precision DEFAULT 0.0,
    "avg_profit" double precision DEFAULT 0.0,
    "avg_loss" double precision DEFAULT 0.0,
    "profit_factor" double precision DEFAULT 0.0,
    "confidence_score" double precision DEFAULT 0.0,
    "sample_size_adequate" boolean DEFAULT false,
    "is_active" boolean DEFAULT true
);
ALTER TABLE "public"."ml_patterns" OWNER TO "postgres";
COMMENT ON TABLE "public"."ml_patterns" IS '機械学習で発見された取引パターン';
CREATE SEQUENCE IF NOT EXISTS "public"."ml_patterns_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE "public"."ml_patterns_id_seq" OWNER TO "postgres";
ALTER SEQUENCE "public"."ml_patterns_id_seq" OWNED BY "public"."ml_patterns"."id";
CREATE TABLE IF NOT EXISTS "public"."ml_recommendations" (
    "id" bigint NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "recommendation_type" "text" NOT NULL,
    "priority" "text" DEFAULT 'medium'::"text",
    "title" "text" NOT NULL,
    "description" "text",
    "based_on_pattern_id" bigint,
    "supporting_data" "jsonb",
    "expected_win_rate_improvement" double precision,
    "expected_profit_improvement" double precision,
    "status" "text" DEFAULT 'active'::"text",
    "applied_at" timestamp with time zone,
    "dismissed_at" timestamp with time zone,
    "training_history_id" bigint
);
ALTER TABLE "public"."ml_recommendations" OWNER TO "postgres";
COMMENT ON TABLE "public"."ml_recommendations" IS 'AIによるトレード改善提案';
CREATE SEQUENCE IF NOT EXISTS "public"."ml_recommendations_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE "public"."ml_recommendations_id_seq" OWNER TO "postgres";
ALTER SEQUENCE "public"."ml_recommendations_id_seq" OWNED BY "public"."ml_recommendations"."id";
CREATE TABLE IF NOT EXISTS "public"."ml_training_history" (
    "id" bigint NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "training_type" "text" NOT NULL,
    "duration_ms" integer,
    "total_signals_analyzed" integer DEFAULT 0,
    "complete_trades_count" integer DEFAULT 0,
    "patterns_discovered" integer DEFAULT 0,
    "patterns_updated" integer DEFAULT 0,
    "overall_win_rate" double precision,
    "best_pattern_win_rate" double precision,
    "worst_pattern_win_rate" double precision,
    "insights" "jsonb",
    "recommendations" "jsonb",
    "status" "text" DEFAULT 'completed'::"text",
    "error_message" "text",
    "version" "text",
    "triggered_by" "text"
);
ALTER TABLE "public"."ml_training_history" OWNER TO "postgres";
COMMENT ON TABLE "public"."ml_training_history" IS 'ML学習の実行履歴とサマリー';
CREATE SEQUENCE IF NOT EXISTS "public"."ml_training_history_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE "public"."ml_training_history_id_seq" OWNER TO "postgres";
ALTER SEQUENCE "public"."ml_training_history_id_seq" OWNED BY "public"."ml_training_history"."id";
ALTER TABLE ONLY "public"."ai_signals" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."ai_signals_id_seq"'::"regclass");
ALTER TABLE ONLY "public"."ml_patterns" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."ml_patterns_id_seq"'::"regclass");
ALTER TABLE ONLY "public"."ml_recommendations" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."ml_recommendations_id_seq"'::"regclass");
ALTER TABLE ONLY "public"."ml_training_history" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."ml_training_history_id_seq"'::"regclass");
ALTER TABLE ONLY "public"."ai_signals"
    ADD CONSTRAINT "ai_signals_pkey" PRIMARY KEY ("id");
ALTER TABLE ONLY "public"."ea-log"
    ADD CONSTRAINT "ea-log-new_pkey1" PRIMARY KEY ("id");
ALTER TABLE ONLY "public"."ml_patterns"
    ADD CONSTRAINT "ml_patterns_pattern_name_key" UNIQUE ("pattern_name");
ALTER TABLE ONLY "public"."ml_patterns"
    ADD CONSTRAINT "ml_patterns_pkey" PRIMARY KEY ("id");
ALTER TABLE ONLY "public"."ml_recommendations"
    ADD CONSTRAINT "ml_recommendations_pkey" PRIMARY KEY ("id");
ALTER TABLE ONLY "public"."ml_training_history"
    ADD CONSTRAINT "ml_training_history_pkey" PRIMARY KEY ("id");
CREATE INDEX "idx_ai_signals_actual_result" ON "public"."ai_signals" USING "btree" ("actual_result");
COMMENT ON INDEX "public"."idx_ai_signals_actual_result" IS 'Filter by trade outcome';
CREATE INDEX "idx_ai_signals_closed_at" ON "public"."ai_signals" USING "btree" ("closed_at" DESC) WHERE ("closed_at" IS NOT NULL);
COMMENT ON INDEX "public"."idx_ai_signals_closed_at" IS 'Completed trades analysis';
CREATE INDEX "idx_ai_signals_created_at" ON "public"."ai_signals" USING "btree" ("created_at" DESC);
COMMENT ON INDEX "public"."idx_ai_signals_created_at" IS 'Time-series analysis';
CREATE INDEX "idx_ai_signals_instance" ON "public"."ai_signals" USING "btree" ("instance");
CREATE INDEX "idx_ai_signals_ma_cross" ON "public"."ai_signals" USING "btree" ("ma_cross");
CREATE INDEX "idx_ai_signals_macd_cross" ON "public"."ai_signals" USING "btree" ("macd_cross");
CREATE INDEX "idx_ai_signals_order_ticket" ON "public"."ai_signals" USING "btree" ("order_ticket");
COMMENT ON INDEX "public"."idx_ai_signals_order_ticket" IS 'Fast lookup for updating signal status';
CREATE INDEX "idx_ai_signals_result" ON "public"."ai_signals" USING "btree" ("actual_result");
CREATE INDEX "idx_ai_signals_symbol" ON "public"."ai_signals" USING "btree" ("symbol");
CREATE INDEX "idx_ai_signals_ticket" ON "public"."ai_signals" USING "btree" ("order_ticket");
CREATE INDEX "idx_ai_signals_training" ON "public"."ai_signals" USING "btree" ("actual_result", "symbol", "timeframe") WHERE ("actual_result" = ANY (ARRAY['WIN'::"text", 'LOSS'::"text"]));
COMMENT ON INDEX "public"."idx_ai_signals_training" IS 'Optimized for ML training data queries';
CREATE INDEX "idx_ai_signals_win_prob" ON "public"."ai_signals" USING "btree" ("win_prob" DESC);
CREATE INDEX "idx_ea_log_at" ON "public"."ea-log" USING "btree" ("at" DESC);
CREATE INDEX "idx_ea_log_created_at" ON "public"."ea-log" USING "btree" ("created_at" DESC);
CREATE INDEX "idx_ea_log_sym" ON "public"."ea-log" USING "btree" ("sym");
CREATE INDEX "idx_ea_log_trade_decision" ON "public"."ea-log" USING "btree" ("trade_decision");
CREATE INDEX "idx_ml_patterns_active" ON "public"."ml_patterns" USING "btree" ("is_active");
CREATE INDEX "idx_ml_patterns_symbol" ON "public"."ml_patterns" USING "btree" ("symbol");
CREATE INDEX "idx_ml_patterns_updated_at" ON "public"."ml_patterns" USING "btree" ("updated_at" DESC);
CREATE INDEX "idx_ml_patterns_win_rate" ON "public"."ml_patterns" USING "btree" ("win_rate" DESC);
CREATE INDEX "idx_ml_recommendations_created_at" ON "public"."ml_recommendations" USING "btree" ("created_at" DESC);
CREATE INDEX "idx_ml_recommendations_priority" ON "public"."ml_recommendations" USING "btree" ("priority");
CREATE INDEX "idx_ml_recommendations_status" ON "public"."ml_recommendations" USING "btree" ("status");
CREATE INDEX "idx_ml_training_history_created_at" ON "public"."ml_training_history" USING "btree" ("created_at" DESC);
CREATE INDEX "idx_ml_training_history_status" ON "public"."ml_training_history" USING "btree" ("status");
CREATE OR REPLACE TRIGGER "trigger_ml_patterns_updated_at" BEFORE UPDATE ON "public"."ml_patterns" FOR EACH ROW EXECUTE FUNCTION "public"."update_ml_pattern_timestamp"();
ALTER TABLE ONLY "public"."ml_recommendations"
    ADD CONSTRAINT "ml_recommendations_based_on_pattern_id_fkey" FOREIGN KEY ("based_on_pattern_id") REFERENCES "public"."ml_patterns"("id");
ALTER TABLE ONLY "public"."ml_recommendations"
    ADD CONSTRAINT "ml_recommendations_training_history_id_fkey" FOREIGN KEY ("training_history_id") REFERENCES "public"."ml_training_history"("id");
CREATE POLICY "Allow authenticated read access" ON "public"."ea-log" FOR SELECT TO "authenticated" USING (true);
CREATE POLICY "Allow read access to ml_patterns" ON "public"."ml_patterns" FOR SELECT USING (true);
CREATE POLICY "Allow read access to ml_recommendations" ON "public"."ml_recommendations" FOR SELECT USING (true);
CREATE POLICY "Allow read access to ml_training_history" ON "public"."ml_training_history" FOR SELECT USING (true);
CREATE POLICY "Allow service role full access" ON "public"."ea-log" TO "service_role" USING (true) WITH CHECK (true);
CREATE POLICY "Allow service role full access to ml_patterns" ON "public"."ml_patterns" USING (("auth"."role"() = 'service_role'::"text"));
CREATE POLICY "Allow service role full access to ml_recommendations" ON "public"."ml_recommendations" USING (("auth"."role"() = 'service_role'::"text"));
CREATE POLICY "Allow service role full access to ml_training_history" ON "public"."ml_training_history" USING (("auth"."role"() = 'service_role'::"text"));
ALTER TABLE "public"."ai_signals" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated_read_ai_signals" ON "public"."ai_signals" FOR SELECT TO "authenticated" USING (true);
ALTER TABLE "public"."ea-log" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."ml_patterns" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."ml_recommendations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."ml_training_history" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_all_ai_signals" ON "public"."ai_signals" TO "service_role" USING (true) WITH CHECK (true);
ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";
GRANT ALL ON FUNCTION "public"."check_ml_cron_status"() TO "anon";
GRANT ALL ON FUNCTION "public"."check_ml_cron_status"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."check_ml_cron_status"() TO "service_role";
GRANT ALL ON FUNCTION "public"."update_ml_pattern_timestamp"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_ml_pattern_timestamp"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_ml_pattern_timestamp"() TO "service_role";
GRANT ALL ON TABLE "public"."ai_signals" TO "anon";
GRANT ALL ON TABLE "public"."ai_signals" TO "authenticated";
GRANT ALL ON TABLE "public"."ai_signals" TO "service_role";
GRANT ALL ON SEQUENCE "public"."ai_signals_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."ai_signals_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."ai_signals_id_seq" TO "service_role";
GRANT ALL ON TABLE "public"."cron_ml_training_history" TO "anon";
GRANT ALL ON TABLE "public"."cron_ml_training_history" TO "authenticated";
GRANT ALL ON TABLE "public"."cron_ml_training_history" TO "service_role";
GRANT ALL ON TABLE "public"."ea-log" TO "anon";
GRANT ALL ON TABLE "public"."ea-log" TO "authenticated";
GRANT ALL ON TABLE "public"."ea-log" TO "service_role";
GRANT ALL ON TABLE "public"."ml_patterns" TO "anon";
GRANT ALL ON TABLE "public"."ml_patterns" TO "authenticated";
GRANT ALL ON TABLE "public"."ml_patterns" TO "service_role";
GRANT ALL ON SEQUENCE "public"."ml_patterns_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."ml_patterns_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."ml_patterns_id_seq" TO "service_role";
GRANT ALL ON TABLE "public"."ml_recommendations" TO "anon";
GRANT ALL ON TABLE "public"."ml_recommendations" TO "authenticated";
GRANT ALL ON TABLE "public"."ml_recommendations" TO "service_role";
GRANT ALL ON SEQUENCE "public"."ml_recommendations_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."ml_recommendations_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."ml_recommendations_id_seq" TO "service_role";
GRANT ALL ON TABLE "public"."ml_training_history" TO "anon";
GRANT ALL ON TABLE "public"."ml_training_history" TO "authenticated";
GRANT ALL ON TABLE "public"."ml_training_history" TO "service_role";
GRANT ALL ON SEQUENCE "public"."ml_training_history_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."ml_training_history_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."ml_training_history_id_seq" TO "service_role";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";
RESET ALL;
