-- ========================================
-- トレード履歴と学習状況レポート
-- ========================================
-- 実行方法: Supabase Dashboard > SQL Editor で実行
-- ========================================

-- 1. 基本統計サマリー
SELECT 
    '=== 基本統計 ===' as section,
    COUNT(*) as 総取引数,
    COUNT(CASE WHEN actual_result = 'WIN' THEN 1 END) as 勝ち数,
    COUNT(CASE WHEN actual_result = 'LOSS' THEN 1 END) as 負け数,
    COUNT(CASE WHEN actual_result = 'PENDING' THEN 1 END) as 保留中,
    COUNT(CASE WHEN actual_result = 'CANCELLED' THEN 1 END) as キャンセル済み,
    ROUND(
        COUNT(CASE WHEN actual_result = 'WIN' THEN 1 END)::numeric / 
        NULLIF(COUNT(CASE WHEN actual_result IN ('WIN', 'LOSS') THEN 1 END), 0) * 100, 
        2
    ) as 勝率パーセント,
    ROUND(SUM(profit_loss)::numeric, 2) as 総損益,
    MIN(created_at) as 運用開始日,
    MAX(created_at) as 最終取引日,
    EXTRACT(DAY FROM (MAX(created_at) - MIN(created_at))) as 運用日数
FROM ai_signals;

-- 1b. AIのみ（virtual除外）
SELECT
    '=== 基本統計（AIのみ / virtual除外）===' as section,
    COUNT(*) as 総取引数,
    COUNT(CASE WHEN actual_result = 'WIN' THEN 1 END) as 勝ち数,
    COUNT(CASE WHEN actual_result = 'LOSS' THEN 1 END) as 負け数,
    COUNT(CASE WHEN actual_result = 'PENDING' THEN 1 END) as 保留中,
    COUNT(CASE WHEN actual_result = 'CANCELLED' THEN 1 END) as キャンセル済み,
    ROUND(
        COUNT(CASE WHEN actual_result = 'WIN' THEN 1 END)::numeric /
        NULLIF(COUNT(CASE WHEN actual_result IN ('WIN', 'LOSS') THEN 1 END), 0) * 100,
        2
    ) as 勝率パーセント,
    ROUND(SUM(profit_loss)::numeric, 2) as 総損益,
    MIN(created_at) as 運用開始日,
    MAX(created_at) as 最終取引日,
    EXTRACT(DAY FROM (MAX(created_at) - MIN(created_at))) as 運用日数
FROM ai_signals
WHERE (is_manual_trade = false OR is_manual_trade IS NULL)
  AND (is_virtual = false OR is_virtual IS NULL);

-- 1c. 手動のみ（virtual除外）
SELECT
    '=== 基本統計（手動のみ / virtual除外）===' as section,
    COUNT(*) as 総取引数,
    COUNT(CASE WHEN actual_result = 'WIN' THEN 1 END) as 勝ち数,
    COUNT(CASE WHEN actual_result = 'LOSS' THEN 1 END) as 負け数,
    COUNT(CASE WHEN actual_result = 'PENDING' THEN 1 END) as 保留中,
    COUNT(CASE WHEN actual_result = 'CANCELLED' THEN 1 END) as キャンセル済み,
    ROUND(
        COUNT(CASE WHEN actual_result = 'WIN' THEN 1 END)::numeric /
        NULLIF(COUNT(CASE WHEN actual_result IN ('WIN', 'LOSS') THEN 1 END), 0) * 100,
        2
    ) as 勝率パーセント,
    ROUND(SUM(profit_loss)::numeric, 2) as 総損益,
    MIN(created_at) as 運用開始日,
    MAX(created_at) as 最終取引日,
    EXTRACT(DAY FROM (MAX(created_at) - MIN(created_at))) as 運用日数
FROM ai_signals
WHERE is_manual_trade = true
  AND (is_virtual = false OR is_virtual IS NULL);

-- 2. 通貨ペア別成績
SELECT 
    '=== 通貨ペア別成績 ===' as section,
    symbol as 通貨ペア,
    COUNT(*) as 取引数,
    COUNT(CASE WHEN actual_result = 'WIN' THEN 1 END) as 勝ち,
    COUNT(CASE WHEN actual_result = 'LOSS' THEN 1 END) as 負け,
    ROUND(
        COUNT(CASE WHEN actual_result = 'WIN' THEN 1 END)::numeric / 
        NULLIF(COUNT(CASE WHEN actual_result IN ('WIN', 'LOSS') THEN 1 END), 0) * 100, 
        2
    ) as 勝率,
    ROUND(SUM(profit_loss)::numeric, 2) as 損益,
    ROUND((AVG(win_prob) * 100)::numeric, 2) as 平均AI勝率予測
FROM ai_signals
WHERE actual_result IN ('WIN', 'LOSS')
    AND (is_manual_trade = false OR is_manual_trade IS NULL)
    AND (is_virtual = false OR is_virtual IS NULL)
GROUP BY symbol
ORDER BY 損益 DESC;

-- 3. エントリー方式別成績
SELECT 
    '=== エントリー方式別成績 ===' as section,
    COALESCE(entry_method, 'unknown') as エントリー方式,
    COUNT(*) as 取引数,
    COUNT(CASE WHEN actual_result = 'WIN' THEN 1 END) as 勝ち,
    COUNT(CASE WHEN actual_result = 'LOSS' THEN 1 END) as 負け,
    ROUND(
        COUNT(CASE WHEN actual_result = 'WIN' THEN 1 END)::numeric / 
        NULLIF(COUNT(CASE WHEN actual_result IN ('WIN', 'LOSS') THEN 1 END), 0) * 100, 
        2
    ) as 勝率,
    ROUND(SUM(profit_loss)::numeric, 2) as 損益
FROM ai_signals
WHERE actual_result IN ('WIN', 'LOSS')
    AND (is_manual_trade = false OR is_manual_trade IS NULL)
    AND (is_virtual = false OR is_virtual IS NULL)
GROUP BY entry_method
ORDER BY 損益 DESC;

-- 4. 月別パフォーマンス
SELECT 
    '=== 月別パフォーマンス ===' as section,
    TO_CHAR(created_at, 'YYYY-MM') as 年月,
    COUNT(*) as 取引数,
    COUNT(CASE WHEN actual_result = 'WIN' THEN 1 END) as 勝ち,
    COUNT(CASE WHEN actual_result = 'LOSS' THEN 1 END) as 負け,
    ROUND(
        COUNT(CASE WHEN actual_result = 'WIN' THEN 1 END)::numeric / 
        NULLIF(COUNT(CASE WHEN actual_result IN ('WIN', 'LOSS') THEN 1 END), 0) * 100, 
        2
    ) as 勝率,
    ROUND(SUM(profit_loss)::numeric, 2) as 月間損益
FROM ai_signals
WHERE actual_result IN ('WIN', 'LOSS')
    AND (is_manual_trade = false OR is_manual_trade IS NULL)
    AND (is_virtual = false OR is_virtual IS NULL)
GROUP BY TO_CHAR(created_at, 'YYYY-MM')
ORDER BY 年月 DESC;

-- 5. ML学習の進捗状況
SELECT 
    '=== ML学習フェーズ ===' as section,
    CASE 
        WHEN COUNT(CASE WHEN actual_result IN ('WIN', 'LOSS') THEN 1 END) < 80 THEN 'PHASE 1: テクニカル分析のみ（ML未使用）'
        WHEN COUNT(CASE WHEN actual_result IN ('WIN', 'LOSS') THEN 1 END) < 1000 THEN 'PHASE 2: ハイブリッド（テクニカル + ML）'
        ELSE 'PHASE 3: フルML（高精度AI判定）'
    END as 現在のフェーズ,
    COUNT(CASE WHEN actual_result IN ('WIN', 'LOSS') THEN 1 END) as 完了取引数,
    CASE 
        WHEN COUNT(CASE WHEN actual_result IN ('WIN', 'LOSS') THEN 1 END) < 80 THEN 80 - COUNT(CASE WHEN actual_result IN ('WIN', 'LOSS') THEN 1 END)
        WHEN COUNT(CASE WHEN actual_result IN ('WIN', 'LOSS') THEN 1 END) < 1000 THEN 1000 - COUNT(CASE WHEN actual_result IN ('WIN', 'LOSS') THEN 1 END)
        ELSE 0
    END as 次のフェーズまで残り,
    ROUND(
        COUNT(CASE WHEN actual_result IN ('WIN', 'LOSS') THEN 1 END)::numeric / 
        CASE 
            WHEN COUNT(CASE WHEN actual_result IN ('WIN', 'LOSS') THEN 1 END) < 80 THEN 80
            WHEN COUNT(CASE WHEN actual_result IN ('WIN', 'LOSS') THEN 1 END) < 1000 THEN 1000
            ELSE 1000
        END * 100,
        2
    ) as 進捗率
FROM ai_signals;

-- 6. ML学習パターンの状況
SELECT 
    '=== ML学習パターン ===' as section,
    COUNT(*) as 学習済みパターン数,
    COUNT(CASE WHEN total_trades >= 10 THEN 1 END) as 有効パターン数_10件以上,
    COUNT(CASE WHEN win_rate >= 0.7 THEN 1 END) as 高勝率パターン数_70以上,
    ROUND((AVG(win_rate) * 100)::numeric, 2) as 平均勝率,
    ROUND(AVG(total_trades)::numeric, 2) as 平均サンプル数
FROM ml_patterns;

-- 7. 最近10件の取引詳細
SELECT 
    '=== 最近の取引（直近10件） ===' as section,
    created_at as 日時,
    symbol as ペア,
    CASE WHEN dir = 1 THEN 'BUY' ELSE 'SELL' END as 方向,
    ROUND((win_prob * 100)::numeric, 2) as AI勝率予測,
    actual_result as 結果,
    profit_loss as 損益,
    entry_method as エントリー方式,
    CASE WHEN ml_pattern_used THEN 'YES' ELSE 'NO' END as ML使用,
    reason as 理由
FROM ai_signals
WHERE actual_result IN ('WIN', 'LOSS')
    AND (is_manual_trade = false OR is_manual_trade IS NULL)
    AND (is_virtual = false OR is_virtual IS NULL)
ORDER BY created_at DESC
LIMIT 10;

-- 8. AI予測精度の検証
SELECT 
    '=== AI予測精度 ===' as section,
    CASE 
        WHEN win_prob >= 0.80 THEN '80%以上'
        WHEN win_prob >= 0.70 THEN '70-80%'
        WHEN win_prob >= 0.60 THEN '60-70%'
        ELSE '60%未満'
    END as AI予測勝率範囲,
    COUNT(*) as 取引数,
    COUNT(CASE WHEN actual_result = 'WIN' THEN 1 END) as 実際の勝ち数,
    ROUND(
        COUNT(CASE WHEN actual_result = 'WIN' THEN 1 END)::numeric / 
        NULLIF(COUNT(*), 0) * 100, 
        2
    ) as 実際の勝率,
    ROUND((AVG(win_prob) * 100)::numeric, 2) as 平均予測勝率,
    ROUND(SUM(profit_loss)::numeric, 2) as 損益
FROM ai_signals
WHERE actual_result IN ('WIN', 'LOSS')
    AND (is_manual_trade = false OR is_manual_trade IS NULL)
    AND (is_virtual = false OR is_virtual IS NULL)
GROUP BY 
    CASE 
        WHEN win_prob >= 0.80 THEN '80%以上'
        WHEN win_prob >= 0.70 THEN '70-80%'
        WHEN win_prob >= 0.60 THEN '60-70%'
        ELSE '60%未満'
    END
ORDER BY 平均予測勝率 DESC;

-- 9. SL/TP到達状況
SELECT 
    '=== SL/TP到達状況 ===' as section,
    COUNT(CASE WHEN sl_hit = true THEN 1 END) as SL到達数,
    COUNT(CASE WHEN tp_hit = true THEN 1 END) as TP到達数,
    COUNT(CASE WHEN sl_hit = false AND tp_hit = false THEN 1 END) as 時間切れ数,
    ROUND(
        COUNT(CASE WHEN tp_hit = true THEN 1 END)::numeric / 
        NULLIF(COUNT(CASE WHEN sl_hit = true OR tp_hit = true THEN 1 END), 0) * 100,
        2
    ) as TP到達率,
    ROUND(AVG(CASE WHEN sl_hit = false AND tp_hit = false THEN hold_duration_minutes END)::numeric, 2) as 平均保有時間_分
FROM ai_signals
WHERE actual_result IN ('WIN', 'LOSS')
    AND (is_manual_trade = false OR is_manual_trade IS NULL)
    AND (is_virtual = false OR is_virtual IS NULL);

-- 10. 推奨アクション
SELECT 
    '=== 推奨アクション ===' as section,
    CASE 
        WHEN (SELECT COUNT(*) FROM ai_signals WHERE actual_result IN ('WIN', 'LOSS')) < 80 
        THEN '📊 データ収集フェーズ - あと' || (80 - (SELECT COUNT(*) FROM ai_signals WHERE actual_result IN ('WIN', 'LOSS'))) || '件でML学習が開始されます'
        WHEN (SELECT COUNT(*) FROM ai_signals WHERE actual_result IN ('WIN', 'LOSS')) < 1000 
        THEN '🤖 ML学習中 - あと' || (1000 - (SELECT COUNT(*) FROM ai_signals WHERE actual_result IN ('WIN', 'LOSS'))) || '件でフルML体制になります'
        ELSE '🚀 フルML稼働中 - 高精度AI判定が利用可能です'
    END as ステータス,
    CASE 
        WHEN (SELECT ROUND(COUNT(CASE WHEN actual_result = 'WIN' THEN 1 END)::numeric / NULLIF(COUNT(CASE WHEN actual_result IN ('WIN', 'LOSS') THEN 1 END), 0) * 100, 2) FROM ai_signals) < 50 
        THEN '⚠️ 勝率が低い - パラメータ調整またはEA一時停止を推奨'
        WHEN (SELECT ROUND(COUNT(CASE WHEN actual_result = 'WIN' THEN 1 END)::numeric / NULLIF(COUNT(CASE WHEN actual_result IN ('WIN', 'LOSS') THEN 1 END), 0) * 100, 2) FROM ai_signals) < 60 
        THEN '📈 勝率改善の余地あり - エントリー条件の見直しを推奨'
        ELSE '✅ 良好なパフォーマンス - 現在の設定を維持'
    END as パフォーマンス評価;
