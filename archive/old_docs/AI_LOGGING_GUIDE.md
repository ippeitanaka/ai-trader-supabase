# AI-Trader ログ出力ガイド

## 📊 ログ出力一覧

### ✅ 成功時のログ

```
[ai-trader] Using OpenAI GPT for prediction
[AI] OpenAI prediction: 78.5% (high) - RSI oversold + MA trend aligned
[ai-trader] XAUUSD M15 dir=1 win=0.785 (AI)
```

### ⚠️ OpenAI API失敗時のログ

#### 1. HTTPエラー（401, 429, 500など）
```
[AI] OpenAI API error: 401 - {"error": {"message": "Invalid API key"}}
[AI] Falling back to rule-based calculation
[ai-trader] XAUUSD M15 dir=1 win=0.720 (Fallback)
```

#### 2. JSON解析失敗
```
[AI] No JSON in response. Raw content: "I cannot provide trading advice..."
[AI] Falling back to rule-based calculation
[ai-trader] XAUUSD M15 dir=1 win=0.680 (Fallback)
```

#### 3. 不正な勝率値
```
[AI] Invalid win_prob: 1.5 from AI response: {"win_prob":1.5,"confidence":"high"}
[AI] Falling back to rule-based calculation
[ai-trader] XAUUSD M15 dir=1 win=0.750 (Fallback)
```

#### 4. ネットワークエラー
```
[AI] OpenAI exception: fetch failed
[AI] Stack trace: Error: fetch failed at...
[AI] Falling back to rule-based calculation
[ai-trader] XAUUSD M15 dir=1 win=0.700 (Fallback)
```

### 🔑 APIキー未設定時
```
[ai-trader] OPENAI_API_KEY not set - using rule-based fallback
[ai-trader] XAUUSD M15 dir=1 win=0.720 (Fallback)
```

---

## 🔍 ログの確認方法

### Supabase Dashboardで確認

1. **Supabase Dashboard** にアクセス
2. 左メニュー → **Edge Functions**
3. **ai-trader** をクリック
4. **Logs** タブを開く
5. リアルタイムでログが流れる

### コマンドラインで確認（Supabase CLI）

```bash
# リアルタイムでログを監視
supabase functions logs ai-trader --tail

# 最近のログを取得
supabase functions logs ai-trader --limit 100
```

### MT5から確認

MT5のエキスパートログでは、**勝率のみ**が表示されます：

```
[M15] set dir=1 prob=78%    ← OpenAI成功
[M15] skip prob=68% < thr=70%    ← フォールバック使用
```

---

## 🚨 エラーの種類と対処法

### エラー1: OpenAI API error: 401

**原因**: APIキーが無効または未設定

**対処法**:
```bash
# 正しいAPIキーを設定
supabase secrets set OPENAI_API_KEY=sk-proj-YOUR_VALID_KEY

# Edge Functionを再デプロイ
supabase functions deploy ai-trader
```

### エラー2: OpenAI API error: 429

**原因**: レート制限（1分間のリクエスト数超過）

**対処法**:
- 無料枠: 3 RPM (Requests Per Minute)
- 有料枠: 500+ RPM
- MT5のLogCooldownSecを増やしてリクエスト頻度を下げる

### エラー3: OpenAI API error: 500/503

**原因**: OpenAIサーバー側の問題

**対処法**:
- 自動的にフォールバックに切り替わります
- 数分待ってから再試行
- OpenAI Status確認: https://status.openai.com/

### エラー4: fetch failed

**原因**: ネットワーク接続の問題

**対処法**:
- Supabaseのネットワーク設定を確認
- ファイアウォール設定を確認
- 自動的にフォールバックに切り替わります

---

## 📈 ログ分析

### OpenAI使用率の確認

Supabase Logsで以下を検索：

```
# 成功したAI予測
[AI] OpenAI prediction

# フォールバック使用
[AI] Falling back
```

### 勝率の比較

```bash
# AI予測の勝率分布
grep "OpenAI prediction" logs.txt | grep -oP '\d+\.\d+%'

# フォールバックの勝率分布
grep "Fallback" logs.txt | grep -oP 'win=\d+\.\d+'
```

---

## 🎯 期待される動作

### 正常時
1. OpenAI APIに予測リクエスト
2. AIが市場分析
3. 勝率を返答
4. ログに`[AI] OpenAI prediction: XX%`と表示
5. MT5で注文実行

### エラー時
1. OpenAI APIがエラー
2. ログに`[AI] OpenAI API error`と表示
3. **自動的にフォールバックに切り替え**
4. ルールベース計算で勝率算出
5. ログに`[AI] Falling back`と表示
6. MT5で注文実行（継続）

### 重要：完全に停止することはない

**どんなエラーが発生しても、EAは動作し続けます。**
- OpenAI失敗 → フォールバック使用
- フォールバック失敗 → デフォルト値（win_prob=0.70）
- 完全停止はしない

---

## 🔧 デバッグ用コマンド

### APIキーの確認
```bash
# Supabase secrets確認
supabase secrets list

# OPENAI_API_KEYが表示されるか確認
```

### 手動テスト
```bash
# Edge Functionを直接呼び出し
curl -X POST https://YOUR_PROJECT.functions.supabase.co/ai-trader \
  -H "Authorization: Bearer YOUR_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"symbol":"XAUUSD","timeframe":"M15","dir":1,"rsi":45,"atr":0.0015,"price":2650.5,"reason":"MA↑"}'

# レスポンス確認
{"win_prob":0.785,"action":1,"offset_factor":0.25,"expiry_minutes":90}
```

### ヘルスチェック
```bash
# GET リクエストでステータス確認
curl https://YOUR_PROJECT.functions.supabase.co/ai-trader

# レスポンス
{"ok":true,"service":"ai-trader with OpenAI","version":"2.0.0","ai_enabled":true,"fallback_available":true}
```

---

## 📊 ログの見方

### 正常なログフロー

```
[ai-trader] Using OpenAI GPT for prediction          ← OpenAI使用開始
[AI] OpenAI prediction: 78.5% (high) - ...          ← AI予測成功
[ai-trader] XAUUSD M15 dir=1 win=0.785 (AI)         ← 最終結果
```

### エラー発生時のログフロー

```
[ai-trader] Using OpenAI GPT for prediction          ← OpenAI使用開始
[AI] OpenAI API error: 429 - Rate limit exceeded    ← エラー発生
[AI] Falling back to rule-based calculation         ← フォールバック切り替え
[ai-trader] XAUUSD M15 dir=1 win=0.720 (Fallback)   ← フォールバックで継続
```

---

## 💡 まとめ

### ✅ 改善されたログ機能
1. ✅ **詳細なエラーメッセージ** - HTTPステータス、エラー内容を表示
2. ✅ **フォールバック通知** - 自動切り替え時に明確に表示
3. ✅ **スタックトレース** - デバッグ用の詳細情報
4. ✅ **AI/Fallback識別** - どちらを使用したか明示
5. ✅ **APIキー状態** - 設定有無を起動時に表示

### 🛡️ フォールバック機能
- OpenAI失敗時も**必ず動作継続**
- 自動的にルールベース計算に切り替え
- トレード機会を逃さない

これで安心してOpenAI版を運用できます！🎉
