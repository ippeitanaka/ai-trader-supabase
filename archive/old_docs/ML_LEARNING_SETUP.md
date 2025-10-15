# AI機械学習機能セットアップガイド

## 概要

このシステムは、EAの取引履歴を`ai_signals`テーブルに記録し、AIに学習させて予測精度を向上させる機能を提供します。

## アーキテクチャ

```
MT5 EA (v1.2.3)
    ↓
    ├─ AI判定時: ai_signalsへ記録 (POST)
    ├─ 約定時: エントリー価格を更新 (PUT)
    ├─ 決済時: 結果を更新 (PUT)
    └─ キャンセル時: キャンセル理由を記録 (PUT)
    
Supabase
    ├─ ai_signals テーブル (取引データ蓄積)
    └─ ai-signals Edge Function (データ記録API)
```

## フェーズ1: データ収集 (✅ 完了)

### 1. データベース拡張

```sql
-- マイグレーション実行
supabase/migrations/20251013_004_enhance_ai_signals_table.sql
```

**追加されたカラム:**
- `order_ticket`: MT5オーダーチケット番号
- `entry_price`: 実際の約定価格
- `exit_price`: 決済価格
- `profit_loss`: 損益（口座通貨）
- `closed_at`: 決済日時
- `hold_duration_minutes`: 保有時間（分）
- `actual_result`: 結果 ('WIN', 'LOSS', 'BREAK_EVEN', 'PENDING', 'CANCELLED')
- `cancelled_reason`: キャンセル理由
- `sl_hit`: ストップロスで決済されたか
- `tp_hit`: テイクプロフィットで決済されたか

### 2. Edge Function

**エンドポイント:** `https://[your-project].supabase.co/functions/v1/ai-signals`

**機能:**
- `POST`: 新規シグナル記録
- `PUT`: 取引結果の更新

### 3. EA機能

**v1.2.3の新機能:**
- AI判定時に自動的に`ai_signals`へ記録
- ペンディングオーダー約定時にエントリー価格を更新
- ポジション決済時に結果（WIN/LOSS/BREAK_EVEN）と損益を記録
- SL/TP到達の記録
- キャンセル時の理由記録

## セットアップ手順

### 1. マイグレーション実行

Supabase Dashboard → SQL Editor で実行:

```sql
-- 20251013_004_enhance_ai_signals_table.sql の内容を実行
```

または、Supabase CLIで:

```bash
supabase db push
```

### 2. Edge Functionデプロイ

```bash
supabase functions deploy ai-signals
```

### 3. EAの設定

MT5のEAプロパティで以下を設定:

```
AI_Signals_URL = https://[your-project].supabase.co/functions/v1/ai-signals
AI_Bearer_Token = [your-service-role-key]
```

### 4. 動作確認

1. EAを起動
2. AI判定が実行されると`ai_signals`テーブルにレコードが追加される
3. オーダーが約定すると`entry_price`が更新される
4. ポジションが決済されると`actual_result`, `profit_loss`などが更新される

## データ構造

### ai_signals テーブル例

```
| id | created_at | symbol  | timeframe | dir | win_prob | rsi  | atr    | price   | order_ticket | entry_price | exit_price | profit_loss | actual_result | sl_hit | tp_hit | hold_duration_minutes |
|----|------------|---------|-----------|-----|----------|------|--------|---------|--------------|-------------|------------|-------------|---------------|--------|--------|-----------------------|
| 1  | 2025-10-13 | USDJPY  | M15       | 1   | 78.5     | 45.2 | 0.0150 | 150.000 | 123456       | 149.980     | 150.120    | 14.00       | WIN           | false  | true   | 45                    |
| 2  | 2025-10-13 | EURUSD  | M15       | -1  | 72.3     | 68.5 | 0.0012 | 1.0850  | 123457       | 1.0852      | 1.0862     | -10.00      | LOSS          | true   | false  | 30                    |
```

## フェーズ2: AI学習機能 (🔨 実装予定)

### 実装予定の機能

1. **学習用Edge Function**
   - 過去の取引データから学習
   - 勝率予測モデルの改善
   - パターン認識

2. **予測精度の向上**
   - 市場状況に応じた動的な勝率計算
   - RSI、ATRなどの指標との相関分析
   - 時間帯・曜日による成績の分析

3. **バックテスト機能**
   - 蓄積データでのシミュレーション
   - パラメータ最適化提案

### 学習データの活用例

```sql
-- 勝率が高いパターンの分析
SELECT 
  timeframe,
  ROUND(AVG(win_prob), 2) as avg_predicted_prob,
  ROUND(AVG(CASE WHEN actual_result = 'WIN' THEN 100 ELSE 0 END), 2) as actual_win_rate,
  COUNT(*) as total_trades,
  SUM(CASE WHEN actual_result = 'WIN' THEN 1 ELSE 0 END) as wins
FROM ai_signals
WHERE actual_result IN ('WIN', 'LOSS')
GROUP BY timeframe;

-- RSI範囲別の成績
SELECT 
  CASE 
    WHEN rsi < 30 THEN 'Oversold'
    WHEN rsi > 70 THEN 'Overbought'
    ELSE 'Neutral'
  END as rsi_zone,
  COUNT(*) as trades,
  ROUND(AVG(CASE WHEN actual_result = 'WIN' THEN 100 ELSE 0 END), 2) as win_rate,
  ROUND(AVG(profit_loss), 2) as avg_profit
FROM ai_signals
WHERE actual_result IN ('WIN', 'LOSS')
GROUP BY rsi_zone;
```

## トラブルシューティング

### データが記録されない

1. `AI_Signals_URL`が正しく設定されているか確認
2. `AI_Bearer_Token`がservice_role_keyであることを確認
3. MT5のログでHTTPエラーを確認
4. Supabase Functionsのログを確認

### 結果が更新されない

1. `CheckPositionStatus()`が実行されているか確認（OnTick内）
2. ポジション履歴が正しく取得できているか確認
3. `g_trackedPositionTicket`が正しく設定されているか確認

## 今後の拡張案

1. **リアルタイムダッシュボード**
   - 勝率の推移グラフ
   - パフォーマンス指標
   - 予測精度の可視化

2. **自動パラメータ調整**
   - 学習結果に基づいてMinWinProbを自動調整
   - 市場環境に応じた動的な設定変更

3. **マルチインスタンス対応**
   - 複数のEAインスタンスのデータを統合して学習
   - インスタンス間での知見共有

## 参考リンク

- [Supabase Documentation](https://supabase.com/docs)
- [MQL5 Reference](https://www.mql5.com/en/docs)
- [Machine Learning for Trading](https://www.coursera.org/learn/machine-learning-trading)
