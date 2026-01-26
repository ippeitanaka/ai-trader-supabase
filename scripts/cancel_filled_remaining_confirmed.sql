-- Confirmed-safe cleanup: cancel FILLED rows for tickets verified as NOT OPEN in MT5
--
-- Preconditions (you confirmed): these order_ticket are not currently held.
--
-- Safety guards in WHERE:
-- - is_virtual=false
-- - actual_result='FILLED'
-- - closed_at IS NULL
-- - exit_price/profit_loss IS NULL (avoid touching rows that look partially closed)
-- - order_ticket IN (confirmed list)
--
-- Workflow:
-- 1) Run this whole script in Supabase SQL Editor.
-- 2) Check will_cancel_count and preview rows.
-- 3) If OK, run COMMIT.
--
-- IMPORTANT:
-- - SQL Editor の「選択範囲だけ実行」を避けて、必ずスクリプト全体を実行してください。
--   （BEGIN だけ実行されて COMMIT が走らないと、結果が反映されません）

BEGIN;

-- Preview: how many rows will be updated
SELECT COUNT(*) AS will_cancel_count
FROM public.ai_signals
WHERE COALESCE(is_virtual,false)=false
  AND actual_result='FILLED'
  AND closed_at IS NULL
  AND exit_price IS NULL
  AND profit_loss IS NULL
  AND order_ticket IN (5106191890, 5103463806);

-- Preview rows
SELECT
  id, created_at, symbol, timeframe, dir, win_prob,
  order_ticket, entry_price, exit_price, profit_loss, actual_result, closed_at
FROM public.ai_signals
WHERE COALESCE(is_virtual,false)=false
  AND actual_result='FILLED'
  AND closed_at IS NULL
  AND exit_price IS NULL
  AND profit_loss IS NULL
  AND order_ticket IN (5106191890, 5103463806)
ORDER BY created_at DESC;

-- Update (returns changed rows)
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
  AND order_ticket IN (5106191890, 5103463806)
RETURNING id, created_at, symbol, timeframe, order_ticket;

-- Post-check (still FILLED among these tickets?)
SELECT COUNT(*) AS remaining_filled_count
FROM public.ai_signals
WHERE COALESCE(is_virtual,false)=false
  AND actual_result='FILLED'
  AND closed_at IS NULL
  AND order_ticket IN (5106191890, 5103463806);

COMMIT;
