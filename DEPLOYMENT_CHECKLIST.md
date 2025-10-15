# 🚀 デプロイ前チェックリスト

## 現状分析

### 🔴 問題の症状
- **勝率が常に65%付近で固定**されている
- OpenAI APIが呼び出されず、フォールバック計算のみが動作している可能性が高い

### 🛠️ 実施した対策

#### 1. 診断機能の追加（v2.2.0）

**`/supabase/functions/ai-trader/index.ts`** に以下を追加:

##### a) OpenAI API Key バリデーション
```typescript
const hasOpenAIKey = OPENAI_API_KEY && 
                     OPENAI_API_KEY.length > 10 && 
                     !OPENAI_API_KEY.includes("YOUR_");
```

##### b) 予測方法のトラッキング
```typescript
let predictionMethod = "UNKNOWN";

if (hasOpenAIKey) {
  try {
    response = await calculateSignalWithAI(tradeReq);
    predictionMethod = "OpenAI-GPT";
  } catch (aiError) {
    response = calculateSignalFallback(tradeReq);
    predictionMethod = "Fallback-AfterAI-Error";
  }
} else {
  response = calculateSignalFallback(tradeReq);
  predictionMethod = "Fallback-NoKey";
}
```

##### c) 詳細ロギング
```typescript
console.log(`[ai-trader] 📊 RESULT: ${symbol} ${timeframe} dir=${dir} win=${response.win_prob.toFixed(3)} ichimoku=${req_ichimoku.toFixed(2)} reason="${reason}" method=${predictionMethod}`);

if (predictionMethod.startsWith("Fallback")) {
  console.warn(`[ai-trader] ⚠️ WARNING: Using fallback calculation! Check OpenAI API key configuration.`);
}
```

##### d) 診断エンドポイント（GET /ai-trader）
```typescript
return new Response(JSON.stringify({
  ok: true,
  service: "ai-trader with OpenAI + Ichimoku",
  version: "2.2.0",
  ai_enabled: hasOpenAIKey,
  openai_key_status: hasOpenAIKey 
    ? `configured (${OPENAI_API_KEY.length} chars)` 
    : "NOT SET",
  fallback_available: true,
  features: ["ichimoku_score", "openai_gpt", "ml_learning", "detailed_logging"]
}), {
  headers: { ...corsHeaders, "Content-Type": "application/json" }
});
```

## 📋 デプロイ前の必須確認事項

### ステップ1: Supabase CLI のインストール（未インストールの場合）

```bash
# Supabase CLIをインストール
npm install -g supabase

# またはbrewを使用（macOS）
# brew install supabase/tap/supabase

# インストール確認
supabase --version
```

### ステップ2: Supabase プロジェクトにログイン

```bash
# Supabaseにログイン
supabase login

# プロジェクトにリンク
cd /workspaces/ai-trader-supabase
supabase link --project-ref YOUR_PROJECT_REF
```

プロジェクトREFは以下で確認:
- Supabase Dashboard → Settings → General → Reference ID

### ステップ3: OpenAI API Key の確認と設定

#### 3-1. 現在の設定を確認
```bash
supabase secrets list
```

**期待される出力**:
```
OPENAI_API_KEY
SUPABASE_SERVICE_ROLE_KEY
SUPABASE_URL
```

#### 3-2. OpenAI API Key が設定されていない場合

1. **OpenAI API Keyを取得**
   - https://platform.openai.com/api-keys にアクセス
   - **Create new secret key** をクリック
   - 名前を入力（例: "ai-trader-supabase"）
   - キーをコピー（形式: `sk-proj-...` または `sk-...`）

2. **Supabaseに設定**
```bash
supabase secrets set OPENAI_API_KEY=sk-proj-YOUR_ACTUAL_KEY_HERE
```

3. **設定を確認**
```bash
supabase secrets list
# OPENAI_API_KEY が表示されることを確認
```

#### 3-3. OpenAI API Key が既に設定されている場合

**有効性を確認**:
```bash
# Supabase Dashboardから確認
# Settings → Edge Functions → Environment Variables
# OPENAI_API_KEY の値が "YOUR_..." などのプレースホルダーでないことを確認
```

または、OpenAI APIで直接テスト:
```bash
curl https://api.openai.com/v1/models \
  -H "Authorization: Bearer YOUR_OPENAI_API_KEY"
```

成功すれば、利用可能なモデル一覧が返る。

### ステップ4: Edge Function のデプロイ

```bash
# ai-trader Edge Functionをデプロイ
cd /workspaces/ai-trader-supabase
supabase functions deploy ai-trader

# デプロイ成功後、URLが表示される
# 例: https://abcdefghijk.functions.supabase.co/ai-trader
```

### ステップ5: 診断テスト

#### 5-1. バージョン情報の確認（GET）

```bash
curl https://YOUR_PROJECT.functions.supabase.co/ai-trader
```

**正常な応答例**:
```json
{
  "ok": true,
  "service": "ai-trader with OpenAI + Ichimoku",
  "version": "2.2.0",
  "ai_enabled": true,
  "openai_key_status": "configured (51 chars)",
  "fallback_available": true,
  "features": ["ichimoku_score", "openai_gpt", "ml_learning", "detailed_logging"]
}
```

**問題がある場合**:
```json
{
  "ai_enabled": false,
  "openai_key_status": "NOT SET"
}
```

#### 5-2. 実際の予測リクエスト（POST）

```bash
# テスト1: 最強シグナル（一目均衡表スコア 1.0）
curl -X POST https://YOUR_PROJECT.functions.supabase.co/ai-trader \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_SERVICE_ROLE_KEY" \
  -d '{
    "symbol": "BTCUSD",
    "timeframe": "M15",
    "dir": 1,
    "rsi": 55.0,
    "atr": 0.00085,
    "price": 43250.50,
    "reason": "MA↑+一目買",
    "ichimoku_score": 1.0,
    "instance": "main",
    "version": "1.3.0"
  }'
```

**OpenAI使用時の期待結果**:
```json
{
  "win_prob": 0.850,
  "action": 1,
  "confidence": "high",
  "reasoning": "MA+一目完全一致、強いトレンド傾向。RSI中立、ATR適正範囲。買いシグナルを支持。",
  "offset_factor": 0.350,
  "expiry_minutes": 90
}
```

**フォールバック時の結果（問題あり）**:
```json
{
  "win_prob": 0.700,
  "action": 1,
  "offset_factor": 0.250,
  "expiry_minutes": 90
}
```
※ `confidence` と `reasoning` がない = フォールバック

#### 5-3. Supabase ログの確認

**Supabase Dashboard** → **Edge Functions** → **ai-trader** → **Logs**

**正常なログ例**:
```
[ai-trader] ✓ OpenAI API KEY configured (length=51)
[ai-trader] 🤖 Attempting OpenAI GPT prediction...
[AI] OpenAI GPT-4 prediction: 85.0% (high) - MA+一目完全一致 | ichimoku=1.00 quality=excellent
[ai-trader] ✓ OpenAI prediction successful
[ai-trader] 📊 RESULT: BTCUSD M15 dir=1 win=0.850 ichimoku=1.00 reason="MA↑+一目買" method=OpenAI-GPT
```

**問題のあるログ例（フォールバックのみ）**:
```
[ai-trader] ⚠️ OPENAI_API_KEY not properly configured!
[ai-trader] Key status: NOT SET
[ai-trader] Using FALLBACK calculation only
[ai-trader] ⚠️ Using rule-based FALLBACK (no OpenAI key)
[Fallback] Final calculation: win_prob=65.0% action=1 ichimoku_quality=moderate
[ai-trader] 📊 RESULT: BTCUSD M15 dir=1 win=0.650 ichimoku=0.50 reason="MA↑" method=Fallback-NoKey
[ai-trader] ⚠️ WARNING: Using fallback calculation! Check OpenAI API key configuration.
```

## 🔍 問題のトラブルシューティング

### 問題1: `ai_enabled: false`

**原因**: OpenAI API Keyが設定されていない、または無効

**解決策**:
1. OpenAI API Keyを取得（https://platform.openai.com/api-keys）
2. Supabaseに設定:
   ```bash
   supabase secrets set OPENAI_API_KEY=sk-proj-YOUR_KEY
   ```
3. 再デプロイ:
   ```bash
   supabase functions deploy ai-trader
   ```

### 問題2: `method=Fallback-AfterAI-Error`

**原因**: OpenAI APIの呼び出しでエラーが発生

**確認事項**:
1. OpenAI API Keyの有効性（有効期限、権限）
2. OpenAI APIの制限（Rate Limit、残高）
3. ログのエラーメッセージを確認

**解決策**:
```bash
# OpenAI APIを直接テスト
curl https://api.openai.com/v1/models \
  -H "Authorization: Bearer YOUR_OPENAI_API_KEY"

# エラーが出る場合は新しいキーを生成
supabase secrets set OPENAI_API_KEY=sk-proj-NEW_KEY
supabase functions deploy ai-trader
```

### 問題3: 勝率が依然として65%付近

**原因**: フォールバック計算のロジックが動作している

**確認方法**:
1. レスポンスに `confidence` と `reasoning` フィールドがあるか確認
2. ログで `method=OpenAI-GPT` となっているか確認
3. 勝率の範囲が柔軟（40-95%）か確認

**解決策**:
- OpenAI API Key を正しく設定
- デプロイ後、数分待ってから再テスト
- Supabase Dashboard で Environment Variables を確認

## 📊 予測結果の違い

### フォールバック計算（現在の状態？）

```typescript
// 計算式
base_prob = 0.55 (固定)
rsi_boost = (rsi > 70 || rsi < 30) ? 0.15 : 0.05
dir_boost = 0.15
ichimoku_boost = 0.05 ~ 0.15 (score 0.0-1.0)
total = base_prob + rsi_boost + dir_boost + ichimoku_boost
// 結果: 0.60 ~ 0.75 の範囲（大体65%付近）
```

**特徴**:
- 勝率の範囲が狭い（60-75%）
- 常に似たような値になる
- `confidence` と `reasoning` なし

### OpenAI GPT予測（目標）

```typescript
// OpenAI GPT-4o-mini による動的予測
// 入力: 全テクニカル指標 + 市場状況 + 一目均衡表の詳細分析
// 出力: 40% ~ 95% の範囲で柔軟に予測
```

**特徴**:
- 勝率の範囲が広い（40-95%）
- シグナルの質により大きく変動
- `confidence`: "high", "medium", "low"
- `reasoning`: 判断理由の詳細説明

## ✅ デプロイ完了の確認

全てのチェックが✅になることを確認:

- [ ] Supabase CLI がインストールされている
- [ ] Supabase プロジェクトにリンク済み
- [ ] OpenAI API Key が設定されている（`supabase secrets list`）
- [ ] Edge Function がデプロイ済み（`supabase functions deploy ai-trader`）
- [ ] GET /ai-trader で `ai_enabled: true` が返る
- [ ] POST /ai-trader で `confidence` と `reasoning` が返る
- [ ] ログで `method=OpenAI-GPT` が確認できる
- [ ] 勝率が柔軟（40-95%の範囲）で予測される

## 🎯 次のアクション

### 1. 即座に実行すべきこと

```bash
# 1. Supabase CLIのインストール確認
supabase --version

# 2. OpenAI API Keyの確認
supabase secrets list

# 3. 必要に応じてAPI Keyを設定
supabase secrets set OPENAI_API_KEY=sk-proj-YOUR_KEY

# 4. デプロイ
supabase functions deploy ai-trader

# 5. 診断テスト
curl https://YOUR_PROJECT.functions.supabase.co/ai-trader
```

### 2. デプロイ後の監視

**最初の1時間**:
- Supabase Logs を常に確認
- `method=OpenAI-GPT` が表示されることを確認
- エラーが出ていないか確認

**最初の1日**:
- 勝率の分布を確認（40-95%の範囲内か）
- OpenAI APIの使用量を確認（https://platform.openai.com/usage）
- コストが予想内か確認

### 3. 問題が続く場合

詳細なトラブルシューティングガイド:
→ **`OPENAI_TROUBLESHOOTING.md`** を参照

---

**重要**: この診断機能により、問題の原因（OpenAI APIが呼び出されていない）を明確に特定できるようになりました。デプロイ前に必ず OpenAI API Key が正しく設定されていることを確認してください！
