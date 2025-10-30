# 🚀 ML学習強化：複合パターン発見機能の追加

## 📋 概要

MACD、一目均衡表、移動平均線を使った**複合パターン発見機能**を追加しました。
これにより、「MACDクロス時のRSI 30-40のBUYパターン」のような詳細な分析が可能になります。

## 🎯 追加される複合パターン

### 1. **MACD x RSI パターン**
例: `USDJPY_H1_BUY_MACD_bullish_RSI_oversold`
- MACDが強気クロス + RSI 30未満（買われすぎ）のパターン

### 2. **一目TKクロス x RSI パターン**
例: `XAUUSD_M15_SELL_ICHIMOKU_TK_bearish_tk_RSI_overbought`
- 一目の転換線が基準線を下抜け + RSI 70超（売られすぎ）

### 3. **一目雲 x MACDクロス パターン**
例: `USDJPY_H1_BUY_CLOUD_bullish_cloud_MACD_bullish`
- 一目の雲が陽転 + MACDが強気クロス

### 4. **移動平均クロス x RSI パターン**
例: `XAUUSD_M15_BUY_MA_bullish_ma_RSI_neutral_low`
- EMA25 > SMA100 + RSI 30-45

### 5. **トリプル確認パターン**
例: `USDJPY_H1_BUY_TRIPLE_bullish_bullish_tk_bullish_ma`
- MACD + 一目TK + MA の3つ全てが強気一致

## 📊 削除されたカラム

以下のカラムはML学習で使用されていないため削除されます：
- ❌ `ea_dir` - EA側の方向判断（参考情報、学習に不要）
- ❌ `ea_reason` - EA側の理由（参考情報、学習に不要）
- ❌ `ea_ichimoku_score` - EA側の一目スコア（参考情報、学習に不要）

## ✅ 追加されたカラム（テクニカル指標）

### 価格情報
- `bid` - 買値
- `ask` - 売値

### 移動平均線
- `ema_25` - 25期間EMA
- `sma_100` - 100期間SMA
- `ma_cross` - クロス状態（1=強気, -1=弱気）

### MACD指標
- `macd_main` - MACDメインライン
- `macd_signal` - MACDシグナルライン
- `macd_histogram` - MACDヒストグラム
- `macd_cross` - クロス状態（1=強気, -1=弱気）

### 一目均衡表
- `ichimoku_tenkan` - 転換線
- `ichimoku_kijun` - 基準線
- `ichimoku_senkou_a` - 先行スパンA
- `ichimoku_senkou_b` - 先行スパンB
- `ichimoku_chikou` - 遅行スパン
- `ichimoku_tk_cross` - TKクロス（1=強気, -1=弱気）
- `ichimoku_cloud_color` - 雲の色（1=陽転, -1=陰転）
- `ichimoku_price_vs_cloud` - 価格と雲の位置（1=上, -1=下, 0=中）

## 🔧 デプロイ手順

### 1. データベースマイグレーション実行

Supabase Dashboard SQL Editorで実行：
https://supabase.com/dashboard/project/nebphrnnpmuqbkymwefs/sql/new

```bash
cat supabase/migrations/20251029_002_optimize_ai_signals_columns.sql
```

### 2. Edge Functions再デプロイ

```bash
# ai-signals Edge Function（テクニカル指標保存）
cd /workspaces/ai-trader-supabase
supabase functions deploy ai-signals

# ml-training Edge Function（複合パターン学習）
supabase functions deploy ml-training
```

### 3. MT5 EAの再起動

MT5でEAを一度停止して再起動（コードは変更なし、次のトレードから新データが保存される）

## 📈 期待される効果

### 従来（シンプルパターン）:
- `USDJPY_H1_BUY_RSI_oversold` → RSI 30未満のBUYパターン
- 勝率: 55%、サンプル: 20件

### 新機能（複合パターン）:
- `USDJPY_H1_BUY_MACD_bullish_RSI_oversold` → MACDクロス + RSI 30未満
- 勝率: 72%、サンプル: 8件（より高精度、サンプルは少ない）

- `USDJPY_H1_BUY_TRIPLE_bullish_bullish_tk_bullish_ma` → 3つの指標が全て一致
- 勝率: 85%、サンプル: 5件（最も高精度、レア）

## 🧪 検証方法

次のML学習実行後、以下のクエリで複合パターンを確認：

```sql
-- 複合パターンの確認
SELECT 
  pattern_name,
  pattern_type,
  total_trades,
  win_rate,
  profit_factor,
  confidence_score
FROM ml_patterns
WHERE pattern_type LIKE 'composite%'
  AND sample_size_adequate = true
ORDER BY win_rate DESC, total_trades DESC
LIMIT 20;

-- 最も高精度なトリプル確認パターン
SELECT 
  pattern_name,
  win_rate,
  total_trades,
  avg_profit,
  profit_factor
FROM ml_patterns
WHERE pattern_type = 'composite_triple_confirm'
  AND win_rate > 0.70
ORDER BY win_rate DESC;
```

## 📚 関連ファイル

- `supabase/migrations/20251029_002_optimize_ai_signals_columns.sql` - スキーマ変更
- `supabase/functions/ai-signals/index.ts` - テクニカル指標保存
- `supabase/functions/ml-training/index.ts` - 複合パターン学習
- `DATABASE_STRUCTURE.md` - ドキュメント（要更新）

---

**作成日**: 2025年10月29日
**バージョン**: v2.0.0 (Composite Pattern Discovery)
