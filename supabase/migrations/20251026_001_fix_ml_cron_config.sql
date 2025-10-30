-- ============================================================================
-- Fix ML Training Cron Job Configuration
-- ============================================================================
-- 説明: app.settings パラメータの代わりに環境変数を使用するよう修正
-- 日付: 2025-10-26
-- ============================================================================

-- 既存のジョブを削除
SELECT cron.unschedule('ml-training-daily') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'ml-training-daily'
);

-- ⚠️ 注意: Supabase Hosted環境ではpg_cronが利用できない場合があります
-- その場合は、Supabase Dashboard > Database > Cron Jobs から手動設定してください

-- ML Training Cron Jobを再作成（環境変数を直接参照）
-- 毎日 UTC 3:00 (JST 12:00) に実行
DO $$
DECLARE
  supabase_url TEXT;
  service_role_key TEXT;
BEGIN
  -- 環境変数から取得（Supabase Hosted環境では利用不可の可能性あり）
  -- ローカル開発では supabase/.env.local から読み込まれる
  supabase_url := current_setting('app.settings.supabase_url', true);
  service_role_key := current_setting('app.settings.service_role_key', true);
  
  -- 環境変数が設定されていない場合は警告を出してスキップ
  IF supabase_url IS NULL OR service_role_key IS NULL THEN
    RAISE NOTICE '⚠️  Cron Job設定をスキップ: 環境変数が未設定です';
    RAISE NOTICE '   本番環境では Supabase Dashboard からCron Jobを手動設定してください';
    RAISE NOTICE '   URL: https://supabase.com/dashboard/project/YOUR_PROJECT/database/cron-jobs';
    RAISE NOTICE '   スケジュール: 0 3 * * * (毎日 UTC 3:00)';
    RAISE NOTICE '   HTTP POST: /functions/v1/ml-training';
    RETURN;
  END IF;
  
  -- Cron Jobを設定
  PERFORM cron.schedule(
    'ml-training-daily',
    '0 3 * * *',
    format(
      'SELECT net.http_post(url := %L || ''/functions/v1/ml-training'', headers := jsonb_build_object(''Content-Type'', ''application/json'', ''Authorization'', ''Bearer '' || %L), body := jsonb_build_object(''triggered_by'', ''cron'', ''scheduled_at'', now())) AS request_id;',
      supabase_url,
      service_role_key
    )
  );
  
  RAISE NOTICE '✅ ML Training Cron Job設定完了';
END;
$$;

-- ============================================================================
-- 代替案: Supabase Dashboard での手動設定手順
-- ============================================================================

COMMENT ON EXTENSION pg_cron IS 
'⚠️  本番環境でCron Jobが動作しない場合の対処法:

1. Supabase Dashboard にアクセス
   https://supabase.com/dashboard/project/nebphrnnpmuqbkymwefs/database/cron-jobs

2. 「Create a new cron job」をクリック

3. 以下の設定を入力:
   • Name: ml-training-daily
   • Schedule: 0 3 * * * (毎日 UTC 3:00 = JST 12:00)
   • SQL Query:
     ```sql
     SELECT
       net.http_post(
         url := ''https://nebphrnnpmuqbkymwefs.supabase.co/functions/v1/ml-training'',
         headers := jsonb_build_object(
           ''Content-Type'', ''application/json'',
           ''Authorization'', ''Bearer YOUR_SERVICE_ROLE_KEY_HERE''
         ),
         body := jsonb_build_object(
           ''triggered_by'', ''cron'',
           ''scheduled_at'', now()
         )
       ) AS request_id;
     ```

4. 「Create cron job」をクリック

5. 動作確認:
   SELECT * FROM cron_ml_training_history;
';
