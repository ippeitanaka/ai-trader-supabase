-- CHECK_VIRTUAL_LOW_BAND.sql
-- Low-band virtual (paper/shadow) tracking health check
-- Created: 2025-12-29

-- 実行方法メモ:
-- - SQLエディタでは「SELECT文だけ」を選択して実行するのが確実です。
-- - もし番号行を含めて実行する場合、その行は必ずコメント（"--"）で始まっている必要があります。
--   例: "- 2) ..." のようにハイフン1個だとSQL扱いになり構文エラーになります。

-- 1) 直近7日: 仮想トレード件数
SELECT
  COUNT(*) AS virtual_total,
  COUNT(*) FILTER (WHERE virtual_filled_at IS NOT NULL) AS virtual_filled,
  COUNT(*) FILTER (WHERE actual_result IN ('WIN','LOSS','BREAK_EVEN')) AS virtual_closed
FROM ai_signals
WHERE created_at >= NOW() - INTERVAL '7 days'
  AND is_virtual = true;

-- 2) 直近50件: 仮想トレードの中身（low-band を目視確認）
SELECT
  created_at,
  symbol,
  timeframe,
  dir,
  win_prob,
  entry_method,
  is_virtual,
  planned_order_type,
  planned_entry_price,
  planned_sl,
  planned_tp,
  virtual_filled_at,
  actual_result,
  profit_loss,
  cancelled_reason
FROM ai_signals
WHERE is_virtual = true
ORDER BY created_at DESC
LIMIT 50;

-- 3) 直近30日: 仮想トレードの勝敗サマリ（参考）
SELECT
  actual_result,
  COUNT(*) AS cnt
FROM ai_signals
WHERE created_at >= NOW() - INTERVAL '30 days'
  AND is_virtual = true
  AND actual_result IN ('WIN','LOSS','BREAK_EVEN','CANCELLED','PENDING','FILLED')
GROUP BY actual_result
ORDER BY cnt DESC, actual_result ASC;

-- 4) breakout仮想のみ: 直近30日サマリ（復活判断用）
SELECT
  COUNT(*) AS breakout_virtual_total,
  COUNT(*) FILTER (WHERE virtual_filled_at IS NOT NULL) AS breakout_virtual_filled,
  COUNT(*) FILTER (WHERE actual_result = 'WIN') AS breakout_win,
  COUNT(*) FILTER (WHERE actual_result = 'LOSS') AS breakout_loss,
  COUNT(*) FILTER (WHERE actual_result = 'CANCELLED') AS breakout_cancelled,
  COUNT(*) FILTER (WHERE cancelled_reason = 'virtual_expired') AS breakout_virtual_expired
FROM ai_signals
WHERE created_at >= NOW() - INTERVAL '30 days'
  AND is_virtual = true
  AND entry_method = 'breakout';
