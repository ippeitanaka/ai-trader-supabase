# OpenAI API接続テストガイド

## 前提条件

OpenAI APIキーが必要です。まだお持ちでない場合は、https://platform.openai.com/api-keys から取得してください。

## 1. 環境変数の設定

### ローカル環境の場合:

```bash
export OPENAI_API_KEY='sk-proj-...'
```

### GitHub Codespacesの場合:

1. GitHubリポジトリの Settings → Secrets and variables → Codespaces
2. "New repository secret" をクリック
3. Name: `OPENAI_API_KEY`
4. Value: あなたのAPIキー
5. Codespacesを再起動

### Supabase Edge Functionsの場合:

```bash
# ローカルテスト用
echo "OPENAI_API_KEY=sk-proj-..." >> supabase/.env.local

# 本番環境用（Supabaseダッシュボード）
# Project Settings → Edge Functions → Add secret
```

## 2. テスト方法

### 方法A: シェルスクリプトでテスト（簡単）

```bash
# APIキーを設定
export OPENAI_API_KEY='your-api-key-here'

# テストを実行
./test_openai.sh
```

### 方法B: Edge Functionでテスト（推奨）

```bash
# 1. APIキーを設定
export OPENAI_API_KEY='your-api-key-here'

# 2. Supabase Functionsを起動（別ターミナル）
supabase functions serve test-openai

# 3. テストを実行（このターミナル）

# 接続テスト
curl -X POST http://127.0.0.1:54321/functions/v1/test-openai \
  -H "Content-Type: application/json" \
  -d '{"test_type": "connection"}'

# チャットテスト
curl -X POST http://127.0.0.1:54321/functions/v1/test-openai \
  -H "Content-Type: application/json" \
  -d '{"test_type": "chat", "message": "こんにちは！"}'

# トレード分析テスト
curl -X POST http://127.0.0.1:54321/functions/v1/test-openai \
  -H "Content-Type: application/json" \
  -d '{"test_type": "trade_analysis"}'
```

### 方法C: curl で直接OpenAI APIをテスト

```bash
export OPENAI_API_KEY='your-api-key-here'

curl https://api.openai.com/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -d '{
    "model": "gpt-4o-mini",
    "messages": [
      {"role": "user", "content": "こんにちは"}
    ]
  }'
```

## 3. 期待される結果

### 接続テスト成功時:
```json
{
  "success": true,
  "test": "connection",
  "message": "OpenAI API connection successful",
  "available_models": ["gpt-4o", "gpt-4o-mini", ...],
  "has_gpt_4o_mini": true,
  "has_gpt_4o": true
}
```

### チャットテスト成功時:
```json
{
  "success": true,
  "test": "chat",
  "ai_response": "接続成功",
  "usage": {
    "prompt_tokens": 50,
    "completion_tokens": 10,
    "total_tokens": 60
  }
}
```

### トレード分析テスト成功時:
```json
{
  "success": true,
  "test": "trade_analysis",
  "ai_analysis": {
    "action": "BUY",
    "win_prob": 0.65,
    "reasoning": "RSIが中立圏で、価格がEMA25を上回り、MACDがプラス..."
  }
}
```

## 4. トラブルシューティング

### エラー: "OPENAI_API_KEY is not set"
→ 環境変数を設定してください

### エラー: "401 Unauthorized"
→ APIキーが無効です。正しいキーを確認してください

### エラー: "429 Rate Limit"
→ APIの使用量制限に達しました。少し待ってから再試行してください

### エラー: "500 Internal Server Error"
→ ログを確認してください: `supabase functions logs test-openai`

## 5. 次のステップ

テストが成功したら:
1. `ai-trader` Edge Functionをテスト
2. MT5 EAとの統合テスト
3. 実際のトレードシグナルでテスト
