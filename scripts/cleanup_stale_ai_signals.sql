-- Cleanup stale ai_signals rows (real trades)
--
-- Goal: Reduce ML/monitoring noise caused by rows stuck in PENDING (and optionally FILLED)
-- without accidentally touching currently-open positions.
--
-- Recommended workflow:
-- 1) Run the PREVIEW queries (they return counts + samples).
-- 2) Run the UPDATE for PENDING (safe by default).
-- 3) Review FILLED-stuck list. Only run the optional FILLED UPDATE if you are sure those positions are not actually open.

-- =====================
-- PREVIEW (PENDING)
-- =====================
-- Criteria:
-- - real trades only (is_virtual=false)
-- - has broker key (order_ticket is not null)
-- - still PENDING
-- - older than 24 hours
--
-- NOTE: Market-only EA should never leave PENDING. This primarily targets legacy pending-order-era rows.
SELECT
  COUNT(*) AS pending_stale_count
FROM public.ai_signals
WHERE
  COALESCE(is_virtual, false) = false
  AND order_ticket IS NOT NULL
  AND actual_result = 'PENDING'
  AND created_at < NOW() - INTERVAL '24 hours';

-- Sample newest 50
SELECT
  id,
  created_at,
  symbol,
  timeframe,
  dir,
  win_prob,
  order_ticket,
  entry_price,
  actual_result,
  cancelled_reason,
  closed_at
FROM public.ai_signals
WHERE
  COALESCE(is_virtual, false) = false
  AND order_ticket IS NOT NULL
  AND actual_result = 'PENDING'
  AND created_at < NOW() - INTERVAL '24 hours'
ORDER BY created_at DESC
LIMIT 50;

-- =====================
-- UPDATE (PENDING) - SAFE DEFAULT
-- =====================
-- Marks stale PENDING as CANCELLED with a reason.
-- This helps keep learning/calibration slices clean.
UPDATE public.ai_signals
SET
  actual_result = 'CANCELLED',
  cancelled_reason = COALESCE(cancelled_reason, 'stale_cleanup:pending_24h'),
  closed_at = COALESCE(closed_at, NOW()),
  hold_duration_minutes = COALESCE(
    hold_duration_minutes,
    GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (NOW() - created_at)) / 60))::int
  )
WHERE
  COALESCE(is_virtual, false) = false
  AND order_ticket IS NOT NULL
  AND actual_result = 'PENDING'
  AND created_at < NOW() - INTERVAL '24 hours';

-- Post-run sanity: how many rows were touched recently (closed_at based)
SELECT
  COUNT(*) AS cancelled_by_cleanup_count_recent
FROM public.ai_signals
WHERE
  COALESCE(is_virtual, false) = false
  AND actual_result = 'CANCELLED'
  AND cancelled_reason = 'stale_cleanup:pending_24h'
  AND closed_at >= NOW() - INTERVAL '2 hours';

-- =====================
-- PREVIEW (FILLED but not closed)
-- =====================
-- WARNING:
-- FILLED rows with closed_at IS NULL can be legitimate when a position is still open.
-- The query below is just a review list.
SELECT
  COUNT(*) AS filled_open_or_stuck_count
FROM public.ai_signals
WHERE
  COALESCE(is_virtual, false) = false
  AND order_ticket IS NOT NULL
  AND actual_result = 'FILLED'
  AND closed_at IS NULL
  AND created_at < NOW() - INTERVAL '7 days';

-- Breakdown (helps decide whether this is just long-held positions or true staleness)
SELECT
  symbol,
  timeframe,
  COUNT(*) AS n,
  SUM(CASE WHEN entry_price IS NULL THEN 1 ELSE 0 END) AS entry_price_null,
  SUM(CASE WHEN exit_price IS NULL THEN 1 ELSE 0 END) AS exit_price_null,
  SUM(CASE WHEN profit_loss IS NULL THEN 1 ELSE 0 END) AS profit_loss_null,
  MIN(created_at) AS oldest_created_at,
  MAX(created_at) AS newest_created_at
FROM public.ai_signals
WHERE
  COALESCE(is_virtual, false) = false
  AND order_ticket IS NOT NULL
  AND actual_result = 'FILLED'
  AND closed_at IS NULL
  AND created_at < NOW() - INTERVAL '7 days'
GROUP BY symbol, timeframe
ORDER BY n DESC, symbol, timeframe;

-- Sample newest 50
SELECT
  id,
  created_at,
  symbol,
  timeframe,
  dir,
  win_prob,
  order_ticket,
  entry_price,
  exit_price,
  profit_loss,
  actual_result,
  closed_at,
  cancelled_reason
FROM public.ai_signals
WHERE
  COALESCE(is_virtual, false) = false
  AND order_ticket IS NOT NULL
  AND actual_result = 'FILLED'
  AND closed_at IS NULL
  AND created_at < NOW() - INTERVAL '7 days'
ORDER BY created_at DESC
LIMIT 50;

-- =====================
-- OPTIONAL UPDATE (FILLED) - RUN ONLY AFTER MANUAL CONFIRMATION
-- =====================
-- If you confirm these positions are NOT open anymore (e.g., via MT5 history),
-- you can cancel them to avoid permanent FILLED-stuck rows.
--
-- UPDATE public.ai_signals
-- SET
--   actual_result = 'CANCELLED',
--   cancelled_reason = COALESCE(cancelled_reason, 'stale_cleanup:filled_7d_no_close'),
--   closed_at = COALESCE(closed_at, NOW()),
--   hold_duration_minutes = COALESCE(
--     hold_duration_minutes,
--     GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (NOW() - created_at)) / 60))::int
--   )
-- WHERE
--   COALESCE(is_virtual, false) = false
--   AND order_ticket IS NOT NULL
--   AND actual_result = 'FILLED'
--   AND closed_at IS NULL
--   AND created_at < NOW() - INTERVAL '7 days'
--   AND profit_loss IS NULL
--   AND exit_price IS NULL;
