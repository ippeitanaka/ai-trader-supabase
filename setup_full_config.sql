-- ========================================
-- 全パラメータ管理のための完全セットアップSQL
-- 実行順序: このファイルを1回実行するだけでOK
-- ========================================

-- STEP 0: 既存のai_configテーブルを削除して再作成（データは消えます）
-- 注意: 既存データを保持したい場合はこのステップをスキップしてください
DROP TABLE IF EXISTS public.ai_config CASCADE;

-- STEP 1: ai_configテーブルを作成（全カラム含む）
CREATE TABLE public.ai_config (
  id BIGSERIAL PRIMARY KEY,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  instance TEXT NOT NULL UNIQUE,
  min_win_prob NUMERIC DEFAULT 70.0,
  risk_atr_mult NUMERIC DEFAULT 2.0,
  reward_rr NUMERIC DEFAULT 2.0,
  pending_offset_atr NUMERIC DEFAULT 1.5,
  pending_expiry_min INTEGER DEFAULT 120,
  lots NUMERIC DEFAULT 0.01,
  slippage_points INTEGER DEFAULT 30,
  magic INTEGER DEFAULT 123456,
  max_positions INTEGER DEFAULT 1,
  lock_to_chart_symbol BOOLEAN DEFAULT false,
  tf_entry TEXT DEFAULT 'PERIOD_M15',
  tf_recheck TEXT DEFAULT 'PERIOD_H1',
  debug_logs BOOLEAN DEFAULT false,
  log_cooldown_sec INTEGER DEFAULT 10
);

-- STEP 2: インデックスを作成（既に作成済み）

-- STEP 3: インデックスを作成
CREATE UNIQUE INDEX idx_ai_config_instance ON public.ai_config (instance);
CREATE INDEX idx_ai_config_updated_at ON public.ai_config (updated_at DESC);

-- STEP 4: コメント追加
COMMENT ON TABLE public.ai_config IS 'Dynamic configuration for EA instances - Full parameter management';

-- STEP 5: RLS (Row Level Security) を有効化（オプション）
ALTER TABLE public.ai_config ENABLE ROW LEVEL SECURITY;

-- 全ユーザーが読み取り可能
CREATE POLICY "Allow read access for all users" ON public.ai_config
  FOR SELECT USING (true);

-- 認証済みユーザーが更新可能
CREATE POLICY "Allow update for authenticated users" ON public.ai_config
  FOR UPDATE USING (auth.role() = 'authenticated');

-- STEP 6: デフォルト設定を挿入（3つのプリセット）

-- メインインスタンス（バランス型）
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

-- 保守的インスタンス
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

-- アグレッシブインスタンス
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

-- STEP 7: 結果を確認
SELECT 
  instance,
  min_win_prob,
  risk_atr_mult,
  reward_rr,
  lots,
  max_positions,
  pending_offset_atr,
  pending_expiry_min,
  updated_at
FROM public.ai_config
ORDER BY instance;
