-- ============================================================================
-- Migration: Remove Unused Views
-- Date: 2025-10-19
-- Description: Remove 8 unused database views to simplify database structure
--              and improve performance. Only keep cron_ml_training_history.
-- ============================================================================

-- Reason for removal:
-- 1. All Edge Functions query tables directly (not using views)
-- 2. Views add unnecessary performance overhead
-- 3. Manual monitoring can be done with direct SQL queries
-- 4. Reduces maintenance complexity

-- ============================================================================
-- Step 1: Drop ea_log related views (2 views)
-- ============================================================================

-- Drop ea_log_summary (created in 20250105_001_enhance_ea_log_table.sql)
-- Purpose: User-friendly view of EA logs in English
-- Usage: ❌ Not used by any Edge Function
DROP VIEW IF EXISTS public.ea_log_summary;

-- Drop ea_log_monitor (created in 20250107_001_simplify_ea_log_table.sql)
-- Purpose: User-friendly view of EA logs in Japanese
-- Usage: ❌ Not used by any Edge Function (duplicate of ea_log_summary)
DROP VIEW IF EXISTS public.ea_log_monitor;

-- ============================================================================
-- Step 2: Drop ai_signals related views (3 views)
-- ============================================================================

-- Drop ai_signals_training_complete (created in 20250108_001_optimize_ai_signals_table.sql)
-- Purpose: Complete training data for ML
-- Usage: ❌ ml-training queries ai_signals table directly
DROP VIEW IF EXISTS public.ai_signals_training_complete;

-- Drop ai_signals_quality (created in 20250108_001_optimize_ai_signals_table.sql)
-- Purpose: Monitor data quality by actual_result
-- Usage: ❌ Not used for monitoring
DROP VIEW IF EXISTS public.ai_signals_quality;

-- Drop ai_signals_stats (created in 20250108_001_optimize_ai_signals_table.sql)
-- Purpose: Trading statistics by symbol and timeframe
-- Usage: ❌ Not used by any Edge Function
DROP VIEW IF EXISTS public.ai_signals_stats;

-- ============================================================================
-- Step 3: Drop ML learning related views (3 views)
-- ============================================================================

-- Drop ml_active_patterns (created in 20251111_001_create_ml_learning_tables.sql)
-- Purpose: Active ML patterns with minimum sample size
-- Usage: ❌ ai-trader queries ml_patterns table directly
DROP VIEW IF EXISTS public.ml_active_patterns;

-- Drop ml_latest_training (created in 20251111_001_create_ml_learning_tables.sql)
-- Purpose: Latest 10 training history records
-- Usage: ❌ Not used for monitoring
DROP VIEW IF EXISTS public.ml_latest_training;

-- Drop ml_active_recommendations (created in 20251111_001_create_ml_learning_tables.sql)
-- Purpose: Active recommendations with pattern details
-- Usage: ❌ ai-trader queries ml_recommendations table directly
DROP VIEW IF EXISTS public.ml_active_recommendations;

-- ============================================================================
-- Step 4: Keep cron_ml_training_history (DO NOT DROP)
-- ============================================================================

-- ✅ KEEP: cron_ml_training_history (created in 20250112_001_setup_ml_training_cron.sql)
-- Purpose: Monitor cron job execution history
-- Usage: ✅ Used by check_ml_cron_status() function
-- Status: ACTIVE - DO NOT DROP

-- ============================================================================
-- Verification
-- ============================================================================

-- Success message
DO $$ 
BEGIN 
  RAISE NOTICE '✅ Successfully removed 8 unused views';
  RAISE NOTICE '';
  RAISE NOTICE '📊 Removed views:';
  RAISE NOTICE '  • ea_log_summary';
  RAISE NOTICE '  • ea_log_monitor';
  RAISE NOTICE '  • ai_signals_training_complete';
  RAISE NOTICE '  • ai_signals_quality';
  RAISE NOTICE '  • ai_signals_stats';
  RAISE NOTICE '  • ml_active_patterns';
  RAISE NOTICE '  • ml_latest_training';
  RAISE NOTICE '  • ml_active_recommendations';
  RAISE NOTICE '';
  RAISE NOTICE '✅ Kept views:';
  RAISE NOTICE '  • cron_ml_training_history (used by check_ml_cron_status)';
  RAISE NOTICE '';
  RAISE NOTICE '💡 Impact: None - All Edge Functions use direct table queries';
  RAISE NOTICE '📈 Benefits: Improved performance, reduced complexity';
END $$;
