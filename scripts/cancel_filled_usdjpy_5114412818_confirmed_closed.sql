-- Confirmed-safe cleanup: cancel FILLED row for a ticket verified as CLOSED in MT5
--
-- Preconditions (you confirmed): this order_ticket is not currently held (already closed).
--
-- Safety guards in WHERE:
-- - is_virtual=false
-- - actual_result='FILLED'
-- - closed_at IS NULL
-- - exit_price/profit_loss IS NULL (avoid touching rows that look partially closed)
-- - order_ticket is the single confirmed ticket
--
-- IMPORTANT:
-- - Run the WHOLE script (avoid "selection run"), so BEGIN..COMMIT executes.

BEGIN;

SELECT COUNT(*) AS will_cancel_count
FROM public.ai_signals
WHERE COALESCE(is_virtual,false)=false
  AND actual_result='FILLED'
  AND closed_at IS NULL
  AND exit_price IS NULL
  AND profit_loss IS NULL
  AND order_ticket IN (5114412818);

SELECT
  id, created_at, symbol, timeframe, dir, win_prob,
  order_ticket, entry_price, exit_price, profit_loss, actual_result, closed_at
FROM public.ai_signals
WHERE COALESCE(is_virtual,false)=false
  AND actual_result='FILLED'
  AND closed_at IS NULL
  AND exit_price IS NULL
  AND profit_loss IS NULL
  AND order_ticket IN (5114412818)
ORDER BY created_at DESC;

UPDATE public.ai_signals
SET
  actual_result='CANCELLED',
  cancelled_reason=COALESCE(cancelled_reason,'stale_cleanup:filled_confirmed_not_open'),
  closed_at=COALESCE(closed_at,NOW()),
  hold_duration_minutes=COALESCE(
    hold_duration_minutes,
    GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (NOW()-created_at))/60))::int
  )
WHERE COALESCE(is_virtual,false)=false
  AND actual_result='FILLED'
  AND closed_at IS NULL
  AND exit_price IS NULL
  AND profit_loss IS NULL
  AND order_ticket IN (5114412818)
RETURNING id, created_at, symbol, timeframe, order_ticket;

SELECT COUNT(*) AS remaining_filled_count
FROM public.ai_signals
WHERE COALESCE(is_virtual,false)=false
  AND actual_result='FILLED'
  AND closed_at IS NULL
  AND order_ticket IN (5114412818);

COMMIT;
