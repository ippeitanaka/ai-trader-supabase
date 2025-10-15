# 🔧 OpenAI API トラブルシューティング ガイド

## 🚨 症状: 勝率が常に65%前後になる

### 原因の特定

この症状は **OpenAI APIが呼び出されず、フォールバック計算のみが動作している** ことを示しています。

## 📋 診断手順

### 1. バージョン情報の確認

```bash
curl https://YOUR_PROJECT.functions.supabase.co/ai-trader
```

**正常な場合**:
```json
{
  "ok": true,
  "service": "ai-trader with OpenAI + Ichimoku",
  "version": "2.2.0",
  "ai_enabled": true,  // ← これが true
  "openai_key_status": "configured (51 chars)",  // ← キーが設定されている
  "fallback_available": true,
  "features": ["ichimoku_score", "openai_gpt", "ml_learning", "detailed_logging"]
}
```

**問題がある場合**:
```json
{
  "ai_enabled": false,  // ← これが false
  "openai_key_status": "NOT SET"  // ← キーが設定されていない
}
```

### 2. Supabase ログの確認

**Supabase Dashboard** → **Edge Functions** → **ai-trader** → **Logs**

#### 正常なログ（OpenAI使用）
```
[ai-trader] ✓ OpenAI API KEY configured (length=51)
[ai-trader] 🤖 Attempting OpenAI GPT prediction...
[AI] OpenAI GPT-4 prediction: 87.5% (high) - MA+一目完全一致 | ichimoku=1.00 quality=excellent
[ai-trader] ✓ OpenAI prediction successful
[ai-trader] 📊 RESULT: BTCUSD M15 dir=1 win=0.875 ichimoku=1.00 reason="MA↑+一目買" method=OpenAI-GPT
```

#### 問題のあるログ（フォールバックのみ）
```
[ai-trader] ⚠️ OPENAI_API_KEY not properly configured!
[ai-trader] Key status: NOT SET
[ai-trader] Using FALLBACK calculation only
[ai-trader] ⚠️ Using rule-based FALLBACK (no OpenAI key)
[Fallback] Final calculation: win_prob=65.0% action=1 ichimoku_quality=moderate
[ai-trader] 📊 RESULT: BTCUSD M15 dir=1 win=0.650 ichimoku=0.50 reason="MA↑" method=Fallback-NoKey
[ai-trader] ⚠️ WARNING: Using fallback calculation! Check OpenAI API key configuration.
```

#### OpenAI エラーのログ
```
[ai-trader] ✓ OpenAI API KEY configured (length=51)
[ai-trader] 🤖 Attempting OpenAI GPT prediction...
[AI] OpenAI API error: 401 - Incorrect API key provided
[AI] Falling back to rule-based calculation
[ai-trader] ❌ OpenAI prediction failed: Error: HTTP 401
[ai-trader] Switching to fallback calculation...
[Fallback] Final calculation: win_prob=65.0% action=1 ichimoku_quality=moderate
[ai-trader] 📊 RESULT: BTCUSD M15 dir=1 win=0.650 reason="MA↑" method=Fallback-AfterAI-Error
[ai-trader] ⚠️ WARNING: Using fallback calculation! Check OpenAI API key configuration.
```

## 🔑 OpenAI API Key の設定確認

### 1. Supabase Secrets の確認

```bash
cd /workspaces/ai-trader-supabase
supabase secrets list
```

**期待される出力**:
```
OPENAI_API_KEY
SUPABASE_SERVICE_ROLE_KEY
SUPABASE_URL
```

### 2. OpenAI API Key の取得

1. https://platform.openai.com/api-keys にアクセス
2. **Create new secret key** をクリック
3. キーをコピー（形式: `sk-proj-...` または `sk-...`）

### 3. Supabase に設定

```bash
# OpenAI API Keyを設定
supabase secrets set OPENAI_API_KEY=sk-proj-YOUR_ACTUAL_KEY_HERE

# 設定を確認
supabase secrets list
```

### 4. Edge Function を再デプロイ

```bash
# 設定を反映させるため再デプロイ
supabase functions deploy ai-trader
```

### 5. 動作確認

```bash
# バージョン情報を確認
curl https://YOUR_PROJECT.functions.supabase.co/ai-trader

# 期待される結果:
# {
#   "ai_enabled": true,
#   "openai_key_status": "configured (51 chars)"
# }
```

## 🧪 テストリクエスト

### テスト1: 最強シグナル

```bash
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
  "win_prob": 0.850,  // 85% (フォールバックなら70-75%)
  "action": 1,
  "confidence": "high",
  "reasoning": "MA+一目完全一致、強いトレンド"
}
```

**フォールバック時の結果**:
```json
{
  "win_prob": 0.700,  // 70% (計算式による固定値)
  "action": 1,
  "offset_factor": 0.250,
  "expiry_minutes": 90
  // confidence と reasoning がない
}
```

### テスト2: 通常シグナル

```bash
curl -X POST https://YOUR_PROJECT.functions.supabase.co/ai-trader \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_SERVICE_ROLE_KEY" \
  -d '{
    "symbol": "EURUSD",
    "timeframe": "M15",
    "dir": 1,
    "rsi": 62.0,
    "atr": 0.00055,
    "price": 1.0850,
    "reason": "MA↑",
    "ichimoku_score": 0.5,
    "instance": "main",
    "version": "1.3.0"
  }'
```

**OpenAI使用時の期待結果**:
```json
{
  "win_prob": 0.680,  // 68% (柔軟な予測)
  "confidence": "medium",
  "reasoning": "MA上昇も一目は中立、慎重"
}
```

**フォールバック時の結果**:
```json
{
  "win_prob": 0.650,  // 65% (常にこの付近)
  "action": 0  // 閾値未満でアクションなし
}
```

## 📊 フォールバック vs OpenAI の違い

| 項目 | フォールバック | OpenAI GPT |
|-----|-------------|------------|
| **勝率範囲** | 固定的（55-75%） | 柔軟（40-95%） |
| **最強シグナル** | 70-75% | 85-95% |
| **シグナル矛盾** | 65-70% | 40-55% |
| **confidence** | なし | high/medium/low |
| **reasoning** | なし | 判断理由あり |
| **一目活用** | スコア加算のみ | 詳細分析 |

## 🔍 よくある問題と解決策

### 問題1: "NOT SET"

**症状**: `openai_key_status: "NOT SET"`

**原因**: OpenAI API Keyが設定されていない

**解決策**:
```bash
supabase secrets set OPENAI_API_KEY=sk-proj-YOUR_KEY
supabase functions deploy ai-trader
```

### 問題2: "invalid or placeholder"

**症状**: `openai_key_status: "invalid or placeholder"`

**原因**: プレースホルダー値（例: `YOUR_OPENAI_KEY`）が設定されている

**解決策**:
```bash
# 正しいキーで上書き
supabase secrets set OPENAI_API_KEY=sk-proj-REAL_KEY_HERE
supabase functions deploy ai-trader
```

### 問題3: HTTP 401 Unauthorized

**症状**: ログに `OpenAI API error: 401`

**原因**: APIキーが無効または期限切れ

**解決策**:
1. https://platform.openai.com/api-keys で新しいキーを生成
2. 古いキーを削除
3. 新しいキーを設定
```bash
supabase secrets set OPENAI_API_KEY=sk-proj-NEW_KEY
supabase functions deploy ai-trader
```

### 問題4: HTTP 429 Rate Limit

**症状**: ログに `OpenAI API error: 429`

**原因**: APIの呼び出し制限に達した

**解決策**:
1. OpenAI ダッシュボードで使用状況を確認
2. プランをアップグレード（必要に応じて）
3. 一時的にフォールバックで運用

### 問題5: HTTP 500 Internal Server Error

**症状**: ログに `OpenAI API error: 500`

**原因**: OpenAI側のサーバーエラー

**解決策**:
- 一時的なエラーの可能性が高い
- 自動的にフォールバックに切り替わる
- OpenAI Status (https://status.openai.com/) を確認

## 💰 OpenAI コスト管理

### 使用量の確認

https://platform.openai.com/usage

### 推定コスト

**gpt-4o-mini** (推奨):
- 入力: $0.150 / 1M tokens
- 出力: $0.600 / 1M tokens

**1リクエストあたり**:
- 入力トークン: ~400
- 出力トークン: ~60
- コスト: **$0.00010** (0.01円)

**月間コスト推定**:
| リクエスト数/日 | 月間コスト |
|---------------|----------|
| 100回 | $0.30 |
| 500回 | $1.50 |
| 1,000回 | $3.00 |
| 5,000回 | $15.00 |

## 🎯 ベストプラクティス

### 1. デプロイ前チェックリスト

```bash
# 1. Secretsを確認
supabase secrets list

# 2. バージョン情報を確認（デプロイ後）
curl https://YOUR_PROJECT.functions.supabase.co/ai-trader | jq .

# 3. テストリクエスト（最強シグナル）
curl -X POST ... | jq .

# 4. ログを確認
# Supabase Dashboard → Edge Functions → ai-trader → Logs
```

### 2. 定期的な確認

```bash
# 毎日の健全性チェック
curl https://YOUR_PROJECT.functions.supabase.co/ai-trader | jq '.ai_enabled'
# 期待: true
```

### 3. アラート設定

Supabase Dashboardで以下をモニタリング:
- Edge Function のエラー率
- レスポンス時間
- ログに "WARNING" が頻出していないか

## 📝 まとめ

### チェックポイント

- ✅ `ai_enabled: true` であること
- ✅ `openai_key_status` が "configured" であること
- ✅ ログに `[ai-trader] ✓ OpenAI prediction successful` が出ること
- ✅ 勝率が柔軟（40-95%の範囲）であること
- ✅ `confidence` と `reasoning` フィールドがあること

### トラブル時の対応

1. **バージョン情報を確認** → `ai_enabled` をチェック
2. **ログを確認** → エラーメッセージを特定
3. **API Keyを再設定** → 新しいキーを生成・設定
4. **再デプロイ** → 設定を反映
5. **テスト** → 実際のリクエストで動作確認

---

**重要**: フォールバック計算は安全策ですが、OpenAI GPTを使用することで予測精度が大幅に向上します。必ず OpenAI API Key を正しく設定してください！
