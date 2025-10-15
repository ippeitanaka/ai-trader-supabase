# AI Signals Entry Price 記録機能 - 実装ガイド

## 📅 実施日: 2025-10-15

## 🎯 目的
MT5 EAがペンディング注文の約定時に`entry_price`を記録し、ML学習用データの完全性を向上させる。

---

## ✅ 実装内容

### 1. 新しいSupabase Edge Function

**`supabase/functions/ai-signals-update/index.ts`**

#### 機能
- `order_ticket`を指定してai_signalsレコードを更新
- `entry_price`（約定価格）を記録
- `actual_result`（FILLED等）を更新

#### エンドポイント
```
POST https://YOUR_PROJECT.supabase.co/ai-signals-update
```

#### リクエスト例
```json
{
  "order_ticket": 5071442525,
  "entry_price": 113184.29,
  "actual_result": "FILLED"
}
```

#### レスポンス例
```json
{
  "ok": true,
  "updated": 1,
  "data": { ... }
}
```

---

### 2. MT5 EA修正（v1.2.6）

#### 変更点

**① 新しいURL追加**
```mq5
input string AI_Signals_Update_URL = "https://nebphrnnpmuqbkymwefs.functions.supabase.co/ai-signals-update";
```

**② CheckPositionStatus()関数の修正**
```mq5
// 約定時の処理
if(PositionSelectByTicket(g_pendingTicket)){
   g_trackedPositionTicket=g_pendingTicket;
   g_trackedPositionOpenTime=PositionGetInteger(POSITION_TIME);
   g_trackedPositionEntryPrice=PositionGetDouble(POSITION_PRICE_OPEN);
   
   // ★ 新しいエンドポイントで約定価格を記録
   string payload="{\"order_ticket\":"+IntegerToString(g_trackedPositionTicket)+
                  ",\"entry_price\":"+DoubleToString(g_trackedPositionEntryPrice,_Digits)+
                  ",\"actual_result\":\"FILLED\"}";
   string resp;
   HttpPostJson(AI_Signals_Update_URL,AI_Bearer_Token,payload,resp,3000);
   
   SafePrint(StringFormat("[POSITION] Filled ticket=%d at %.5f",
             g_trackedPositionTicket,g_trackedPositionEntryPrice));
}
```

**③ バージョン更新**
```mq5
//| AI_TripleFusion_EA.mq5  (ver 1.2.6)
input string AI_EA_Version = "1.2.6";
```

---

### 3. データベース最適化

**`supabase/migrations/20251015_002_optimize_ai_signals_table.sql`**

#### 追加されたインデックス
```sql
-- order_ticketでの高速検索
CREATE INDEX idx_ai_signals_order_ticket ON ai_signals (order_ticket);

-- actual_resultでのフィルタリング
CREATE INDEX idx_ai_signals_actual_result ON ai_signals (actual_result);

-- ML学習用複合インデックス
CREATE INDEX idx_ai_signals_training 
ON ai_signals (actual_result, symbol, timeframe)
WHERE actual_result IN ('WIN', 'LOSS');
```

#### 新しいビュー

**① ai_signals_training_complete**
```sql
-- ML学習用の完全なデータのみ
SELECT * FROM ai_signals_training_complete;
```
- WIN/LOSSのみ
- entry_price, exit_price, profit_lossが全て存在
- success_flag (1=WIN, 0=LOSS)
- price_movement_pct (価格変動率)

**② ai_signals_quality**
```sql
-- データ品質のモニタリング
SELECT * FROM ai_signals_quality;
```
各ステータス別のデータ完全性を確認

**③ ai_signals_stats**
```sql
-- パフォーマンス統計
SELECT * FROM ai_signals_stats;
```
銘柄・タイムフレーム別の勝率、平均損益など

---

## 🚀 デプロイ手順

### ステップ1: データベースマイグレーション

Supabase Dashboard の **SQL Editor** で実行:

```sql
-- supabase/migrations/20251015_002_optimize_ai_signals_table.sql
-- の内容をコピー&ペースト
```

### ステップ2: Edge Functionデプロイ

Supabase Dashboard の **Edge Functions** で:

1. 新しい関数 `ai-signals-update` を作成
2. `supabase/functions/ai-signals-update/index.ts` の内容をコピー
3. Deploy

### ステップ3: MT5 EA更新

1. MT5を開く
2. MetaEditor で `AI_TripleFusion_EA.mq5` を開く
3. 修正済みのコードに更新
4. コンパイル (F7)
5. チャートにドラッグ&ドロップ
6. **AI_Signals_Update_URL** を設定:
   ```
   https://YOUR_PROJECT.supabase.co/ai-signals-update
   ```

---

## ✅ 動作確認

### 1. マイグレーション確認

```sql
-- インデックスが作成されたか確認
SELECT indexname, indexdef 
FROM pg_indexes 
WHERE tablename = 'ai_signals'
ORDER BY indexname;

-- ビューが作成されたか確認
SELECT * FROM ai_signals_training_complete LIMIT 5;
SELECT * FROM ai_signals_quality;
SELECT * FROM ai_signals_stats;
```

### 2. Edge Function確認

Supabase Dashboard → Edge Functions → `ai-signals-update` → **Logs**

### 3. MT5 EA確認

MT5 Expertsタブで以下のログを確認:
```
[INIT] EA 1.2.6 start (Entry price tracking for ML learning)
[POSITION] Filled ticket=XXXXXX at X.XXXXX
```

### 4. データ確認

次の約定後、データベースで確認:

```sql
-- 最新のFILLEDレコードを確認
SELECT 
  order_ticket,
  symbol,
  actual_result,
  entry_price,
  created_at
FROM ai_signals
WHERE actual_result = 'FILLED'
ORDER BY created_at DESC
LIMIT 5;

-- entry_priceがNULLのレコード数を確認（減少しているはず）
SELECT 
  actual_result,
  COUNT(*) as total,
  COUNT(entry_price) as with_entry_price,
  COUNT(*) - COUNT(entry_price) as missing_entry_price
FROM ai_signals
GROUP BY actual_result
ORDER BY missing_entry_price DESC;
```

---

## 📊 期待される改善効果

### Before（修正前）
```
FILLED状態: 約10件
  └─ entry_price NULL: 8件 (80%)
  └─ entry_price あり: 2件 (20%)
```

### After（修正後）
```
FILLED状態: 約10件
  └─ entry_price NULL: 0件 (0%)
  └─ entry_price あり: 10件 (100%)
```

### ML学習データ
```
修正前: WIN/LOSS約60%が完全データ
修正後: WIN/LOSS約95%が完全データ
```

---

## 🔍 トラブルシューティング

### 問題: entry_priceが記録されない

**確認事項:**
1. Edge Functionがデプロイされているか
2. MT5 EAの`AI_Signals_Update_URL`が正しいか
3. Edge Functionのログにエラーがないか

**SQLで確認:**
```sql
-- 最近のFILLEDレコードを確認
SELECT * FROM ai_signals
WHERE actual_result = 'FILLED'
  AND created_at >= NOW() - INTERVAL '1 hour'
ORDER BY created_at DESC;
```

### 問題: Edge Functionエラー

**Logs確認:**
```
Supabase Dashboard → Edge Functions → ai-signals-update → Logs
```

**手動テスト:**
Supabase SQL Editorで:
```sql
-- 手動更新テスト
UPDATE ai_signals
SET entry_price = 113184.29, actual_result = 'FILLED'
WHERE order_ticket = 5071442525;
```

---

## 📈 データ分析例

### 完全なML学習データを取得

```sql
-- Python/R等で使用するCSVエクスポート
SELECT * FROM ai_signals_training_complete
ORDER BY created_at DESC;
```

### パフォーマンス分析

```sql
-- AI予測 vs 実際の結果
SELECT 
  CASE 
    WHEN win_prob >= 0.75 THEN '高信頼度 (75%+)'
    WHEN win_prob >= 0.60 THEN '中信頼度 (60-74%)'
    ELSE '低信頼度 (<60%)'
  END as ai_confidence,
  COUNT(*) as total,
  COUNT(CASE WHEN actual_result = 'WIN' THEN 1 END) as wins,
  ROUND(
    COUNT(CASE WHEN actual_result = 'WIN' THEN 1 END)::NUMERIC / COUNT(*) * 100, 
    1
  ) as actual_win_rate
FROM ai_signals_training_complete
GROUP BY 1
ORDER BY 1;
```

---

## ✨ まとめ

### 実装完了項目
- ✅ Supabase Edge Function `ai-signals-update` 作成
- ✅ MT5 EA v1.2.6 に更新（約定価格記録機能追加）
- ✅ データベース最適化（インデックス、ビュー追加）
- ✅ ML学習用ビュー `ai_signals_training_complete` 作成
- ✅ データ品質モニタリングビュー作成

### 次のステップ
1. **デプロイ** - 上記の手順に従ってデプロイ
2. **動作確認** - 次の約定でentry_priceが記録されるか確認
3. **ML学習開始** - 完全なデータでモデル学習を開始

**これでML学習用データの完全性が大幅に向上します！** 🎉
