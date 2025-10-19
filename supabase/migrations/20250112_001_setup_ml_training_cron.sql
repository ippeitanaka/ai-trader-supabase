-- ============================================================================
-- ML Training Cron Job Setup
-- ============================================================================
-- 説明: 毎日自動的にML学習を実行するCron Jobを設定
-- スケジュール: 毎日 UTC 3:00 (JST 12:00)
-- ============================================================================

-- pg_cron拡張機能を有効化
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- 既存のジョブを削除（再実行可能にするため）
SELECT cron.unschedule('ml-training-daily') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'ml-training-daily'
);

-- ML Training Cron Jobを作成
-- 毎日 UTC 3:00 (JST 12:00) に実行
SELECT cron.schedule(
  'ml-training-daily',           -- ジョブ名
  '0 3 * * *',                   -- スケジュール: 毎日3:00 UTC
  $$
  SELECT
    net.http_post(
      url := current_setting('app.settings.supabase_url') || '/functions/v1/ml-training',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key')
      ),
      body := jsonb_build_object(
        'triggered_by', 'cron',
        'scheduled_at', now()
      )
    ) AS request_id;
  $$
);

-- ============================================================================
-- Cron Job履歴確認用ビュー
-- ============================================================================

CREATE OR REPLACE VIEW cron_ml_training_history 
WITH (security_invoker = true)
AS
SELECT 
  runid,
  jobid,
  job_pid,
  database,
  username,
  command,
  status,
  return_message,
  start_time,
  end_time,
  end_time - start_time AS duration
FROM cron.job_run_details
WHERE command LIKE '%ml-training%'
ORDER BY start_time DESC
LIMIT 100;

-- ============================================================================
-- 設定確認用の関数
-- ============================================================================

CREATE OR REPLACE FUNCTION check_ml_cron_status()
RETURNS TABLE (
  job_name TEXT,
  schedule TEXT,
  active BOOLEAN,
  last_run TIMESTAMPTZ,
  next_run TIMESTAMPTZ,
  total_runs BIGINT
) 
LANGUAGE plpgsql
SECURITY INVOKER
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

-- ============================================================================
-- コメント
-- ============================================================================

COMMENT ON FUNCTION check_ml_cron_status() IS 
'ML Training Cron Jobの状態を確認する関数。ジョブ名、スケジュール、最終実行時刻、次回実行予定時刻を返す。';

COMMENT ON VIEW cron_ml_training_history IS
'ML Training Cron Jobの実行履歴を表示するビュー。最新100件の実行ログを保持。';

-- ============================================================================
-- 実行確認
-- ============================================================================

-- Cron Job が正常に作成されたか確認
DO $$
DECLARE
  job_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO job_count
  FROM cron.job
  WHERE jobname = 'ml-training-daily';
  
  IF job_count > 0 THEN
    RAISE NOTICE '✅ Cron Job "ml-training-daily" が正常に作成されました';
    RAISE NOTICE '📅 スケジュール: 毎日 UTC 3:00 (JST 12:00)';
    RAISE NOTICE '🔍 確認コマンド: SELECT * FROM check_ml_cron_status();';
  ELSE
    RAISE WARNING '⚠️ Cron Job の作成に失敗しました';
  END IF;
END $$;
