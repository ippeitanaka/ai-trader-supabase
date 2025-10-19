# OpenAI API設定ガイド（GitHub Codespaces Secret使用）

## 概要

このプロジェクトでは、OpenAI APIを使用してAIトレーディングの判断を行います。
APIキーは**GitHub Codespaces Secret**として設定することを推奨します。

## ステップ1: GitHub Codespaces SecretにAPIキーを設定

### 1.1 OpenAI APIキーを取得

まだお持ちでない場合:
1. https://platform.openai.com/ にアクセス
2. サインイン/サインアップ
3. 左メニューの「API keys」をクリック
4. 「Create new secret key」をクリック
5. キーをコピー（**一度しか表示されません**）

### 1.2 GitHub Codespaces Secretに設定

1. **このリポジトリをGitHubで開く**
   ```
   https://github.com/ippeitanaka/ai-trader-supabase
   ```

2. **Settings > Secrets and variables > Codespaces** に移動

3. **「New repository secret」** をクリック

4. 以下の情報を入力:
   - **Name**: `OPENAI_API_KEY`
   - **Value**: あなたのOpenAI APIキー（`sk-proj-...` で始まる）

5. **「Add secret」** をクリック

6. **Codespacesを再起動**
   - 現在のCodespaceを閉じる
   - 再度Codespaceを開く
   - または、ターミナルで: `source ~/.bashrc`（一部の環境変数には再起動が必要）

## ステップ2: 接続テストを実行

### 2.1 環境変数の確認

```bash
# APIキーが設定されているか確認
env | grep OPENAI_API_KEY

# 設定されていれば、マスクされたキーが表示されます
```

### 2.2 OpenAI API直接テスト

```bash
cd /workspaces/ai-trader-supabase

# テストスクリプトを実行
./run_openai_test.sh
```

**期待される出力:**
```
✅ OPENAI_API_KEY が設定されています: sk-proj...xxxx
📡 テスト1: OpenAI API直接接続テスト
✅ 接続成功！
✅ gpt-4o-mini が利用可能
💬 テスト2: 簡単なチャットテスト
✅ チャットAPI成功！
📊 テスト3: トレード分析テスト
✅ トレード分析成功！
✅ すべてのテストが成功しました！
```

## ステップ3: Supabase Edge Functionでテスト

### 3.1 Edge Functionを起動

**ターミナル1:**
```bash
cd /workspaces/ai-trader-supabase

# test-openai Functionを起動
supabase functions serve test-openai --no-verify-jwt
```

### 3.2 テストを実行

**ターミナル2（新しいターミナル）:**

```bash
# テスト1: 接続テスト
curl -X POST http://127.0.0.1:54321/functions/v1/test-openai \
  -H "Content-Type: application/json" \
  -d '{"test_type": "connection"}'

# テスト2: チャットテスト
curl -X POST http://127.0.0.1:54321/functions/v1/test-openai \
  -H "Content-Type: application/json" \
  -d '{"test_type": "chat", "message": "こんにちは！"}'

# テスト3: トレード分析テスト
curl -X POST http://127.0.0.1:54321/functions/v1/test-openai \
  -H "Content-Type: application/json" \
  -d '{"test_type": "trade_analysis"}'
```

### 3.3 期待される結果

**接続テスト成功:**
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

**チャットテスト成功:**
```json
{
  "success": true,
  "test": "chat",
  "ai_response": "こんにちは！",
  "usage": {
    "prompt_tokens": 30,
    "completion_tokens": 5,
    "total_tokens": 35
  }
}
```

**トレード分析テスト成功:**
```json
{
  "success": true,
  "test": "trade_analysis",
  "ai_analysis": {
    "action": "BUY",
    "win_prob": 0.65,
    "reasoning": "RSIが中立圏にあり、価格がEMA25を上回っている..."
  }
}
```

## ステップ4: 本番ai-trader Functionのテスト

```bash
# ターミナル1: ai-trader Functionを起動
supabase functions serve ai-trader --no-verify-jwt

# ターミナル2: テストリクエストを送信
curl -X POST http://127.0.0.1:54321/functions/v1/ai-trader \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sb_secret_N7UND0UgjKTVK-Uodkm0Hg_xSvEMPvz" \
  -d '{
    "symbol": "XAUUSD",
    "timeframe": "M15",
    "price": 2650.50,
    "bid": 2650.30,
    "ask": 2650.70,
    "rsi": 65.5,
    "atr": 15.2,
    "ema_25": 2645.30,
    "sma_100": 2640.10,
    "ma_cross": 1,
    "macd": {
      "main": 2.5,
      "signal": 1.8,
      "histogram": 0.7,
      "cross": 1
    },
    "ichimoku": {
      "tenkan": 2648.50,
      "kijun": 2642.30,
      "senkou_a": 2645.40,
      "senkou_b": 2638.20,
      "chikou": 2655.10,
      "tk_cross": 1,
      "cloud_color": 1,
      "price_vs_cloud": 1
    },
    "ea_suggestion": {
      "dir": 1,
      "reason": "ゴールデンクロス発生",
      "ichimoku_score": 0.75
    }
  }'
```

## トラブルシューティング

### エラー: "OPENAI_API_KEY is not set"

**原因:** 環境変数が設定されていない

**解決方法:**
1. GitHub Codespaces Secretを確認
2. Codespacesを再起動
3. または一時的に設定: `export OPENAI_API_KEY='sk-proj-...'`

### エラー: "401 Unauthorized"

**原因:** APIキーが無効

**解決方法:**
1. OpenAIダッシュボードでキーを確認
2. キーが正しくコピーされているか確認
3. 必要に応じて新しいキーを作成

### エラー: "429 Rate Limit Exceeded"

**原因:** APIの使用量制限に達した

**解決方法:**
1. 少し待ってから再試行
2. OpenAIダッシュボードで使用量を確認
3. 必要に応じてプランをアップグレード

### エラー: "500 Internal Server Error" (Edge Function)

**原因:** Function内でエラーが発生

**解決方法:**
```bash
# ログを確認
supabase functions logs test-openai

# デバッグモードで起動
supabase functions serve test-openai --no-verify-jwt --debug
```

## セキュリティに関する注意事項

✅ **推奨:**
- GitHub Codespaces Secretを使用
- 本番環境ではSupabase Project Secretsを使用

❌ **避けるべき:**
- APIキーをコードに直接記述
- APIキーをGitにコミット
- APIキーを公開リポジトリに含める

## 次のステップ

1. ✅ OpenAI API接続テスト完了
2. ⬜ MT5 EAとの統合テスト
3. ⬜ リアルタイムトレーディングテスト
4. ⬜ 本番環境へのデプロイ
