# 日次チェックリスト 📋

## 毎日の確認事項

### 1️⃣ ML学習の実行確認(毎日UTC 3:00 = JST 12:00)
```bash
# GitHub Actions でML Training Dailyが成功しているか確認
# https://github.com/ippeitanaka/ai-trader-supabase/actions
```

**確認ポイント:**
- ✅ ジョブが緑色(成功)
- ✅ "X patterns discovered/updated" のログ
- ✅ "Y complete trades analyzed" のログ

### 2️⃣ MLパターンの進化確認
```sql
-- Supabase SQL Editorで実行
SELECT 
    pattern_key,
    win_rate,
    total_trades,
    wins,
    losses,
    avg_profit_pct,
    updated_at
FROM ml_patterns 
WHERE total_trades >= 10  -- 信頼性のあるパターン
ORDER BY win_rate DESC 
LIMIT 20;
```

**注目ポイント:**
- 🎯 win_rate >= 0.75 のパターンが増えているか
- 📈 total_trades が増加しているか
- 💰 avg_profit_pct が改善しているか

### 3️⃣ トレード実績の確認
```sql
-- 直近24時間のトレード結果
SELECT 
    symbol,
    timeframe,
    side,
    status,
    win_prob,
    profit_pct,
    lot_multiplier,
    created_at
FROM ai_signals 
WHERE created_at >= NOW() - INTERVAL '24 hours'
    AND status IN ('WIN', 'LOSS')
ORDER BY created_at DESC;
```

**健全性チェック:**
- ✅ WIN/LOSS バランス
- ✅ profit_pct の平均値
- ✅ lot_multiplierの分布

### 4️⃣ フィルターされた信号の確認
```sql
-- スキップされた低品質信号
SELECT 
    COUNT(*) as skipped_count,
    AVG(win_prob) as avg_win_prob
FROM ea_log 
WHERE created_at >= NOW() - INTERVAL '24 hours'
    AND (ai_log LIKE '%SKIPPED_LOW_PROB%' 
         OR ai_log LIKE '%SKIPPED_BREAKOUT_DISABLED%');
```

**期待される動作:**
- 📊 win_prob < 0.75 の信号が正しくフィルターされている
- 🚫 breakout信号がブロックされている

### 5️⃣ エラーチェック
```sql
-- エラーや異常な値の確認
SELECT 
    created_at,
    ai_log
FROM ea_log 
WHERE created_at >= NOW() - INTERVAL '24 hours'
    AND (ai_log LIKE '%ERROR%' 
         OR ai_log LIKE '%FAILED%'
         OR ai_log LIKE '%4.6e+%')  -- 極端な値のチェック
ORDER BY created_at DESC
LIMIT 50;
```

### 6️⃣ 滞留(PENDING / FILLED no-close)の監視

市場成行(Market-only)運用では、`PENDING` が長時間滞留するのは通常異常です。
また `FILLED` で `closed_at` が入らないケースは「保有中」の可能性があるため、自動で更新せず MT5 側で未保有確認ができたものだけを整理します。

```bash
# REST経由で滞留を検知（詳細を表示）
python3 scripts/check_stuck_ai_signals.py \
    --pending-max-age-hours 24 \
    --filled-max-age-hours 24 \
    --limit 50
```

**確認ポイント:**
- ✅ `PENDING >24h` が 0（または例外が説明可能）
- ✅ `FILLED & closed_at NULL` は「現在保有中」の件数と一致
- ⚠️ `FILLED no-close` が増え続ける場合は EA のクローズ反映/追跡を優先調査

**正常であれば:**
- ✅ ERRORなし
- ✅ 極端なentry_paramsなし
- ✅ 正常なスキップログのみ

---

## 週次確認事項(毎週日曜日)

### 📊 週間パフォーマンスレビュー
```sql
-- 過去7日間の集計
SELECT 
    COUNT(*) FILTER (WHERE status = 'WIN') as wins,
    COUNT(*) FILTER (WHERE status = 'LOSS') as losses,
    COUNT(*) FILTER (WHERE status = 'WIN')::float / 
        NULLIF(COUNT(*) FILTER (WHERE status IN ('WIN', 'LOSS')), 0) as win_rate,
    AVG(profit_pct) FILTER (WHERE status = 'WIN') as avg_win_pct,
    AVG(profit_pct) FILTER (WHERE status = 'LOSS') as avg_loss_pct,
    SUM(profit_pct) as total_profit_pct
FROM ai_signals 
WHERE created_at >= NOW() - INTERVAL '7 days'
    AND status IN ('WIN', 'LOSS');
```

### 🎯 目標と改善
- **短期目標(1-2週間)**: Win率 55%以上、総利益率 +5%以上
- **中期目標(1ヶ月)**: Win率 60%以上、総利益率 +15%以上
- **長期目標(3ヶ月)**: Win率 65%以上、安定した月次収益

---

## 緊急時の対応

### 🚨 Win率が30%以下に落ちた場合
1. MT5 EAを一時停止
2. 直近のトレードログを確認
3. MLパターンの異常値チェック
4. 必要に応じてMinWinProbを0.80に引き上げ

### 🚨 極端な損失が発生した場合
1. 即座にEAを停止
2. エントリー価格の異常値チェック
3. リスク管理パラメータの見直し
4. バックテストで検証後に再開

---

## 📈 成功の指標

**システムが健全に機能している証拠:**
1. ✅ MLパターンが毎日更新されている
2. ✅ Win率が50%以上を維持
3. ✅ 極端なentry_paramsが出現しない
4. ✅ 低品質信号が正しくフィルターされている
5. ✅ lot_multiplierが適切に機能している(1.0x-3.0x)

**成長の証拠:**
1. 📈 Win率が徐々に上昇
2. 📈 高勝率パターン(>=75%)が増加
3. 📈 取引頻度が自然に増加
4. 📈 総利益率がプラス成長

---

## 💡 最適化のタイミング

### いつMinWinProbを調整するか
- **引き下げ(0.75→0.70)**: 
  - ML学習が十分進んだ(500+ complete trades)
  - Win率が60%以上で安定
  - 取引機会を増やしたい
  
- **引き上げ(0.75→0.80)**:
  - Win率が50%を下回る
  - 損失が連続している
  - より慎重な運用が必要

### ブレイクアウト戦略の再開
- Win率が安定して60%以上
- MLパターンのデータが十分(1000+ trades)
- ブレイクアウト専用のML学習が完了

---

**最終更新**: 2026-01-26
**システムバージョン**: EA v1.5.1, ML Training v1.2
