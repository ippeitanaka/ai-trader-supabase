# 🔧 診断機能追加 - 変更サマリー（v2.2.0 → v2.2.1）

## 📋 概要

**問題**: 勝率が常に65%付近で固定され、OpenAI APIが呼び出されていない可能性

**対策**: 包括的な診断機能とロギングを追加し、問題の原因を特定可能にする

## 🛠️ コード変更詳細

### ファイル: `/supabase/functions/ai-trader/index.ts`

#### 1. OpenAI API Key バリデーション強化

**変更箇所**: Line 72-78 付近

**変更前**:
```typescript
const hasOpenAIKey = !!OPENAI_API_KEY;
```

**変更後**:
```typescript
// OpenAI API Key の徹底的なバリデーション
const hasOpenAIKey = OPENAI_API_KEY && 
                     OPENAI_API_KEY.length > 10 && 
                     !OPENAI_API_KEY.includes("YOUR_");

if (!hasOpenAIKey) {
  console.warn(`[ai-trader] ⚠️ OPENAI_API_KEY not properly configured!`);
  console.warn(`[ai-trader] Key status: ${OPENAI_API_KEY ? `exists (length=${OPENAI_API_KEY.length})` : "NOT SET"}`);
  console.warn(`[ai-trader] Using FALLBACK calculation only`);
} else {
  console.log(`[ai-trader] ✓ OpenAI API KEY configured (length=${OPENAI_API_KEY.length})`);
}
```

**効果**:
- プレースホルダー（"YOUR_OPENAI_KEY"）を検出
- キーの長さをチェック（最低10文字）
- 設定状況を明確にログ出力

---

#### 2. 予測方法のトラッキング

**変更箇所**: Line 420-438 付近

**変更前**:
```typescript
let response;

if (hasOpenAIKey) {
  try {
    response = await calculateSignalWithAI(tradeReq);
  } catch (aiError) {
    console.error(`[ai-trader] OpenAI error, using fallback:`, aiError);
    response = calculateSignalFallback(tradeReq);
  }
} else {
  console.warn(`[ai-trader] No OpenAI key, using fallback`);
  response = calculateSignalFallback(tradeReq);
}
```

**変更後**:
```typescript
let response;
let predictionMethod = "UNKNOWN";

if (hasOpenAIKey) {
  try {
    console.log(`[ai-trader] 🤖 Attempting OpenAI GPT prediction...`);
    response = await calculateSignalWithAI(tradeReq);
    predictionMethod = "OpenAI-GPT";
    console.log(`[ai-trader] ✓ OpenAI prediction successful`);
  } catch (aiError) {
    console.error(`[ai-trader] ❌ OpenAI prediction failed:`, aiError);
    console.warn(`[ai-trader] Switching to fallback calculation...`);
    response = calculateSignalFallback(tradeReq);
    predictionMethod = "Fallback-AfterAI-Error";
  }
} else {
  console.warn(`[ai-trader] ⚠️ Using rule-based FALLBACK (no OpenAI key)`);
  response = calculateSignalFallback(tradeReq);
  predictionMethod = "Fallback-NoKey";
}
```

**効果**:
- 予測方法を3つに分類: `OpenAI-GPT`, `Fallback-AfterAI-Error`, `Fallback-NoKey`
- 各ステップで詳細なログ出力
- エラーハンドリングを明確化

---

#### 3. 結果ログの強化

**変更箇所**: Line 442-450 付近

**変更前**:
```typescript
console.log(`[ai-trader] RESULT: ${symbol} ${timeframe} dir=${dir} win=${response.win_prob.toFixed(3)}`);
```

**変更後**:
```typescript
// 結果の詳細ログ（予測方法を含む）
console.log(`[ai-trader] 📊 RESULT: ${symbol} ${timeframe} dir=${dir} win=${response.win_prob.toFixed(3)} ichimoku=${req_ichimoku.toFixed(2)} reason="${reason}" method=${predictionMethod}`);

// フォールバック使用時に警告
if (predictionMethod.startsWith("Fallback")) {
  console.warn(`[ai-trader] ⚠️ WARNING: Using fallback calculation! Check OpenAI API key configuration.`);
}
```

**効果**:
- 勝率、一目スコア、シグナル理由、予測方法を1行で確認可能
- フォールバック使用時に明確な警告
- ログフィルタリングが容易（"method=OpenAI-GPT" で検索可能）

---

#### 4. 診断エンドポイントの強化（GET /ai-trader）

**変更箇所**: Line 80-95 付近

**変更前**:
```typescript
return new Response(JSON.stringify({
  ok: true,
  service: "ai-trader with OpenAI + Ichimoku",
  version: "2.2.0"
}), {
  headers: { ...corsHeaders, "Content-Type": "application/json" }
});
```

**変更後**:
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
  features: [
    "ichimoku_score",
    "openai_gpt",
    "ml_learning",
    "detailed_logging"
  ],
  diagnostic: {
    message: hasOpenAIKey 
      ? "OpenAI API is properly configured and ready" 
      : "⚠️ OpenAI API key is NOT configured - using fallback calculations only",
    recommendation: hasOpenAIKey 
      ? "System is ready for deployment" 
      : "Please set OPENAI_API_KEY secret before deployment"
  }
}), {
  headers: { ...corsHeaders, "Content-Type": "application/json" }
});
```

**効果**:
- `ai_enabled` フラグで即座にOpenAI状態を確認
- `openai_key_status` で設定状況とキー長を表示
- `diagnostic` で具体的な推奨事項を提示
- デプロイ前の健全性チェックが可能

## 📊 ログ出力例

### ✅ 正常動作（OpenAI使用）

```
[ai-trader] ✓ OpenAI API KEY configured (length=51)
[ai-trader] POST /ai-trader - symbol=BTCUSD timeframe=M15 dir=1 rsi=55.0 ichimoku_score=1.00
[ai-trader] 🤖 Attempting OpenAI GPT prediction...
[AI] OpenAI GPT-4 prediction: 85.0% (high) - MA+一目完全一致 | ichimoku=1.00 quality=excellent
[ai-trader] ✓ OpenAI prediction successful
[ai-trader] 📊 RESULT: BTCUSD M15 dir=1 win=0.850 ichimoku=1.00 reason="MA↑+一目買" method=OpenAI-GPT
```

### ❌ 異常動作（APIキー未設定）

```
[ai-trader] ⚠️ OPENAI_API_KEY not properly configured!
[ai-trader] Key status: NOT SET
[ai-trader] Using FALLBACK calculation only
[ai-trader] POST /ai-trader - symbol=BTCUSD timeframe=M15 dir=1 rsi=55.0 ichimoku_score=1.00
[ai-trader] ⚠️ Using rule-based FALLBACK (no OpenAI key)
[Fallback] Base: 55.0%, RSI: +5.0%, Dir: +15.0%, Ichimoku: +15.0% = 90.0%
[Fallback] Final calculation: win_prob=65.0% action=1 ichimoku_quality=excellent
[ai-trader] 📊 RESULT: BTCUSD M15 dir=1 win=0.650 ichimoku=1.00 reason="MA↑+一目買" method=Fallback-NoKey
[ai-trader] ⚠️ WARNING: Using fallback calculation! Check OpenAI API key configuration.
```

### ⚠️ OpenAI エラー後フォールバック

```
[ai-trader] ✓ OpenAI API KEY configured (length=51)
[ai-trader] POST /ai-trader - symbol=EURUSD timeframe=M15 dir=1 rsi=62.0 ichimoku_score=0.50
[ai-trader] 🤖 Attempting OpenAI GPT prediction...
[AI] ❌ OpenAI API request failed: HTTP 401 - Incorrect API key provided
[AI] Falling back to rule-based calculation
[ai-trader] ❌ OpenAI prediction failed: Error: HTTP 401 Unauthorized
[ai-trader] Switching to fallback calculation...
[Fallback] Final calculation: win_prob=65.0% action=1 ichimoku_quality=moderate
[ai-trader] 📊 RESULT: EURUSD M15 dir=1 win=0.650 ichimoku=0.50 reason="MA↑" method=Fallback-AfterAI-Error
[ai-trader] ⚠️ WARNING: Using fallback calculation! Check OpenAI API key configuration.
```

## 🔍 診断フロー

```
┌─────────────────────────────────────┐
│ GET /ai-trader                       │
│ (診断エンドポイント)                  │
└───────────┬─────────────────────────┘
            │
            ▼
┌─────────────────────────────────────┐
│ OpenAI API Key バリデーション         │
│ ・存在チェック                        │
│ ・長さチェック (>10)                  │
│ ・プレースホルダーチェック             │
└───────────┬─────────────────────────┘
            │
     ┌──────┴──────┐
     │             │
 ✓ OK          ✗ NG
     │             │
     ▼             ▼
 ai_enabled:   ai_enabled:
   true          false
     │             │
     │             ▼
     │    ┌─────────────────────┐
     │    │ WARNING メッセージ   │
     │    │ "API key NOT SET"   │
     │    └─────────────────────┘
     │
     ▼
┌─────────────────────────────────────┐
│ POST /ai-trader (予測リクエスト)      │
└───────────┬─────────────────────────┘
            │
            ▼
     ┌──────┴──────┐
     │             │
 hasOpenAIKey  hasOpenAIKey
   = true        = false
     │             │
     ▼             ▼
┌──────────┐  ┌──────────────┐
│ OpenAI   │  │ Fallback     │
│ API 呼出 │  │ 計算         │
└────┬─────┘  └──────┬───────┘
     │               │
 成功 │ 失敗          │
─────┴────┐          │
          ▼          ▼
     ┌────────────────────┐
     │ method=            │
     │ ・OpenAI-GPT       │
     │ ・Fallback-NoKey   │
     │ ・Fallback-...     │
     │   AfterAI-Error    │
     └─────────┬──────────┘
               │
               ▼
     ┌──────────────────────┐
     │ ログ出力 + レスポンス │
     │ ・win_prob           │
     │ ・confidence         │
     │ ・reasoning          │
     │ ・method (ログ)      │
     └──────────────────────┘
```

## 📈 期待される改善

### デプロイ前

1. **即座に問題を検出**
   - GET /ai-trader で `ai_enabled: false` なら即座に対応

2. **明確なエラーメッセージ**
   - "OPENAI_API_KEY not properly configured"
   - "Please set OPENAI_API_KEY secret before deployment"

### デプロイ後

1. **リアルタイム監視**
   - ログで `method=OpenAI-GPT` か `method=Fallback-*` か確認
   - フォールバック使用時に警告が出る

2. **問題の早期発見**
   - 勝率が65%付近に固定 → ログで `method=Fallback-NoKey` を確認
   - エラー頻発 → `method=Fallback-AfterAI-Error` と HTTP エラーコードを確認

3. **トラブルシューティングの効率化**
   - ログから問題箇所を即座に特定
   - OpenAI API の問題か、設定の問題かを明確に区別

## ✅ デプロイ準備完了

この変更により、以下が可能になりました：

- ✅ OpenAI API Key の設定状況を即座に確認
- ✅ 予測方法（OpenAI vs Fallback）を明確に追跡
- ✅ フォールバック使用時に警告を表示
- ✅ デプロイ前の健全性チェックが可能
- ✅ 問題の原因を特定しやすいログ出力

**次のアクション**:
1. OpenAI API Key を確認・設定
2. `supabase functions deploy ai-trader`
3. GET /ai-trader で `ai_enabled: true` を確認
4. テストリクエストで動作確認

---

**ドキュメント参照**:
- デプロイ手順: `DEPLOYMENT_CHECKLIST.md`
- トラブルシューティング: `OPENAI_TROUBLESHOOTING.md`
