-- ai_config テーブルにデフォルト設定を挿入（全パラメータ対応版）

-- メインインスタンス用のデフォルト設定
INSERT INTO public.ai_config (
    instance, min_win_prob, risk_atr_mult, reward_rr, 
    pending_offset_atr, pending_expiry_min, 
    lots, slippage_points, magic, max_positions,
    lock_to_chart_symbol, tf_entry, tf_recheck, 
    debug_logs, log_cooldown_sec, updated_at
)
VALUES (
    'main', 70.0, 2.0, 2.0,    -- 70%勝率閾値、リスク2ATR、RR 2:1
    1.5, 120,                  -- オフセット1.5ATR、有効期限120分
    0.01, 30, 123456, 1,       -- ロット0.01、スリップ30、マジック123456、最大1ポジション
    false, 'PERIOD_M15', 'PERIOD_H1',  -- チャートロックなし、M15エントリ、H1リチェック
    false, 10, NOW()           -- デバッグOFF、ログクールダウン10秒
)
ON CONFLICT (instance) DO UPDATE SET
  min_win_prob = EXCLUDED.min_win_prob,
  risk_atr_mult = EXCLUDED.risk_atr_mult,
  reward_rr = EXCLUDED.reward_rr,
  pending_offset_atr = EXCLUDED.pending_offset_atr,
  pending_expiry_min = EXCLUDED.pending_expiry_min,
  lots = EXCLUDED.lots,
  slippage_points = EXCLUDED.slippage_points,
  magic = EXCLUDED.magic,
  max_positions = EXCLUDED.max_positions,
  lock_to_chart_symbol = EXCLUDED.lock_to_chart_symbol,
  tf_entry = EXCLUDED.tf_entry,
  tf_recheck = EXCLUDED.tf_recheck,
  debug_logs = EXCLUDED.debug_logs,
  log_cooldown_sec = EXCLUDED.log_cooldown_sec,
  updated_at = NOW();

-- テスト用インスタンス（より保守的な設定）
INSERT INTO public.ai_config (
    instance, min_win_prob, risk_atr_mult, reward_rr, 
    pending_offset_atr, pending_expiry_min, 
    lots, slippage_points, magic, max_positions,
    lock_to_chart_symbol, tf_entry, tf_recheck, 
    debug_logs, log_cooldown_sec, updated_at
)
VALUES (
    'conservative', 75.0, 1.5, 2.5,  -- 75%勝率閾値、リスク低め、RR高め
    1.0, 60,
    0.01, 20, 123457, 1,
    false, 'PERIOD_M15', 'PERIOD_H1',
    false, 10, NOW()
)
ON CONFLICT (instance) DO NOTHING;

-- アグレッシブなインスタンス（リスク高め）
INSERT INTO public.ai_config (
    instance, min_win_prob, risk_atr_mult, reward_rr, 
    pending_offset_atr, pending_expiry_min, 
    lots, slippage_points, magic, max_positions,
    lock_to_chart_symbol, tf_entry, tf_recheck, 
    debug_logs, log_cooldown_sec, updated_at
)
VALUES (
    'aggressive', 65.0, 2.5, 1.5,  -- 65%勝率閾値、リスク高め、RR低め
    2.0, 180,
    0.02, 50, 123458, 2,  -- ロット2倍、最大2ポジション
    false, 'PERIOD_M15', 'PERIOD_H1',
    false, 10, NOW()
)
ON CONFLICT (instance) DO NOTHING;

-- 挿入結果を確認
SELECT 
  instance,
  min_win_prob,
  pending_offset_atr,
  pending_expiry_min,
  updated_at
FROM public.ai_config
ORDER BY instance;
