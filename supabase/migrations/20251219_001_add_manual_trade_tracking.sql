-- マニュアル取引追跡機能の追加
-- 作成日: 2025-12-19
-- 目的: マニュアル取引とEA取引を区別し、ロットサイズを記録

-- 1. is_manual_trade カラムを追加
ALTER TABLE ai_signals 
ADD COLUMN IF NOT EXISTS is_manual_trade BOOLEAN DEFAULT false;

-- 2. lot_size カラムを追加
ALTER TABLE ai_signals 
ADD COLUMN IF NOT EXISTS lot_size NUMERIC(10, 2);

-- 3. 既知のマニュアル取引にフラグを立てる
-- 12/17の大きな損失取引（-452,060円）
UPDATE ai_signals 
SET is_manual_trade = true
WHERE order_ticket = '5096119463'
  AND created_at = '2025-12-17 14:15:05.464925+00'
  AND profit_loss = -452060;

-- 4. コメント追加
COMMENT ON COLUMN ai_signals.is_manual_trade IS 'マニュアル取引フラグ（true=手動、false=EA自動）';
COMMENT ON COLUMN ai_signals.lot_size IS '取引ロットサイズ（例: 0.01, 0.5）';

-- 5. インデックス追加（パフォーマンス向上）
CREATE INDEX IF NOT EXISTS idx_ai_signals_is_manual_trade 
ON ai_signals(is_manual_trade) 
WHERE is_manual_trade = true;

-- 6. EA取引のみを抽出するビュー作成
CREATE OR REPLACE VIEW ai_signals_ea_only AS
SELECT *
FROM ai_signals
WHERE is_manual_trade = false OR is_manual_trade IS NULL;

COMMENT ON VIEW ai_signals_ea_only IS 'EA自動取引のみのビュー（マニュアル取引を除外）';
