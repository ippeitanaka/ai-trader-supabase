# 🚀 Edge Function デプロイ手順

## ea-log Edge Function の更新

### 📝 変更内容
- EA側から送信される全フィールドを受け付け（後方互換性）
- 必要な6つのカラムのみをデータベースに保存
- エラーハンドリング強化

---

## デプロイ方法

### 方法1: Supabase Dashboard（推奨）

1. **Supabase Dashboard** を開く
   - https://supabase.com/dashboard

2. **プロジェクトを選択**
   - ai-trader-supabase プロジェクト

3. **Edge Functions** セクションに移動
   - 左メニュー → Edge Functions

4. **ea-log 関数を選択**
   - 既存の `ea-log` 関数をクリック

5. **コードを更新**
   - `index.ts` の内容を以下のファイルからコピー&ペースト
   - `/workspaces/ai-trader-supabase/supabase/functions/ea-log/index.ts`

6. **Deploy** ボタンをクリック

---

### 方法2: Supabase CLI（ローカル環境がある場合）

```bash
# ディレクトリ移動
cd /workspaces/ai-trader-supabase

# Edge Function デプロイ
supabase functions deploy ea-log

# 確認
supabase functions list
```

---

## ✅ デプロイ後の確認

### 1. Edge Function のログを確認
```bash
# Supabase Dashboard > Edge Functions > ea-log > Logs
# または
supabase functions logs ea-log
```

### 2. テスト送信（オプション）
Supabase Dashboard の SQL Editor で:

```sql
-- テスト用ダミーデータを直接挿入
INSERT INTO public."ea-log" (
  at, sym, tf, action, trade_decision, win_prob, ai_reasoning, order_ticket
) VALUES (
  NOW(),
  'TEST_SYMBOL',
  'M15',
  'BUY',
  'TEST',
  0.75,
  'テスト用のAI判断根拠です',
  999999
);

-- 確認
SELECT * FROM ea_log_monitor WHERE "銘柄" = 'TEST_SYMBOL';

-- 削除
DELETE FROM public."ea-log" WHERE sym = 'TEST_SYMBOL';
```

### 3. MT5 EAからの実データ確認
MT5で実際にトレードシグナルが発生した時に:

```sql
-- 最新のログを確認
SELECT * FROM ea_log_monitor
ORDER BY "判断日時" DESC
LIMIT 5;

-- Edge Function のログで確認すべき内容:
-- [ea-log] XAUUSD M15 M15 BUY
-- または
-- [ea-log] BTCUSD M15 M15 SELL
```

---

## 🎯 期待される動作

### EA側（変更なし）
```mq5
// MT5 EA v1.2.5 は全フィールドを送信
LogAIDecision("M15", dir, rsi, atr, price, reason, ai, 
              "EXECUTED", threshold_met, current_pos, ticket);
```

### Edge Function（新）
```typescript
// 受信: 全フィールド（50+ fields）
// 保存: 必要な8フィールドのみ
const logEntry = {
  at, sym, tf, action, trade_decision, 
  win_prob, ai_reasoning, order_ticket
};
```

### データベース（簡素化）
```
ea-log テーブル
├── at ✅
├── sym ✅
├── action ✅
├── trade_decision ✅
├── win_prob ✅
├── ai_reasoning ✅
└── order_ticket ✅
```

---

## ❗ トラブルシューティング

### 問題: デプロイエラー
```
Error: Function failed to deploy
```
**解決策:**
1. Supabase Dashboard で直接コードを編集
2. シンタックスエラーがないか確認
3. 環境変数が設定されているか確認

### 問題: データが記録されない
```sql
-- RLSポリシー確認
SELECT * FROM pg_policies WHERE tablename = 'ea-log';

-- service_role の権限確認
GRANT ALL ON public."ea-log" TO service_role;
```

### 問題: 古いカラムのエラー
```
column "rsi" does not exist
```
**これは正常です！**
- Edge Function が不要なカラムを自動的にフィルタリング
- EA側はエラーを受け取らない

---

## 📊 動作確認用クエリ

```sql
-- 1. 最新のログ確認（日本語）
SELECT * FROM ea_log_monitor LIMIT 10;

-- 2. 本日の統計
SELECT 
  COUNT(*) as 総数,
  COUNT(CASE WHEN trade_decision = 'EXECUTED' THEN 1 END) as 実行数,
  ROUND(AVG(win_prob * 100), 1) as 平均勝率
FROM public."ea-log"
WHERE at >= CURRENT_DATE;

-- 3. Edge Function のパフォーマンス
SELECT 
  DATE_TRUNC('minute', created_at) as 分,
  COUNT(*) as 記録数
FROM public."ea-log"
WHERE created_at >= NOW() - INTERVAL '1 hour'
GROUP BY DATE_TRUNC('minute', created_at)
ORDER BY 分 DESC;
```

---

## ✨ まとめ

- ✅ **EA側の変更不要** - v1.2.5 そのまま動作
- ✅ **後方互換性** - 全フィールド受信、必要なもののみ保存
- ✅ **エラーハンドリング** - 詳細なログ出力
- ✅ **パフォーマンス向上** - 不要なデータを保存しない

**Edge Function をデプロイすれば完了です！** 🎉
