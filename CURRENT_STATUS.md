# OpenAI API接続テスト - 現状と次のステップ

## 現在の状況

### ✅ 完了した準備

1. **Supabase CLIのインストールと設定**
   - バージョン: 2.51.0
   - ローカル環境が正常に起動中

2. **データベースのセットアップ**
   - 全12個のマイグレーションを適用
   - テーブル作成完了:
     - `ea-log` - EA取引ログ
     - `ai_config` - AI設定
     - `ai_signals` - AIシグナルと取引結果
     - `ml_patterns` - MLパターン
     - `ml_training_history` - ML学習履歴
     - `ml_recommendations` - ML推奨事項

3. **テストツールの作成**
   - `test_openai.sh` - 基本的な接続テスト
   - `test_openai_interactive.sh` - 対話型テスト
   - `run_openai_test.sh` - 環境変数を使用した簡易テスト
   - `test-openai` Edge Function - Supabase統合テスト

4. **ドキュメントの作成**
   - `OPENAI_TEST_GUIDE.md` - 詳細なテストガイド
   - `SETUP_OPENAI_SECRET.md` - Secret設定ガイド

### ⚠️ 次に必要なアクション

**OPENAI_API_KEYの設定が必要です**

現在、環境変数として設定されていません。以下のいずれかの方法で設定してください。

## 🎯 推奨: GitHub Codespaces Secretに設定

### 手順:

1. **GitHubでこのリポジトリを開く**
   ```
   https://github.com/ippeitanaka/ai-trader-supabase
   ```

2. **Settings タブをクリック**

3. **左メニューから「Secrets and variables」→「Codespaces」を選択**

4. **「New repository secret」をクリック**

5. **以下を入力:**
   - Name: `OPENAI_API_KEY`
   - Value: あなたのOpenAI APIキー（例: `sk-proj-abc123...`）

6. **「Add secret」をクリック**

7. **このCodespaceを再起動**
   - VSCodeの左下の「Codespaces」をクリック
   - 「Stop Current Codespace」を選択
   - 再度Codespaceを開く

8. **環境変数を確認**
   ```bash
   env | grep OPENAI_API_KEY
   ```

## 🔄 代替案: 一時的に環境変数として設定

Codespaceを再起動せずにすぐテストしたい場合:

```bash
# ターミナルで実行（このセッションのみ有効）
export OPENAI_API_KEY='sk-proj-your-actual-key-here'

# 確認
echo $OPENAI_API_KEY

# テストを実行
./run_openai_test.sh
```

**注意:** この方法は一時的で、ターミナルを閉じると消えます。

## 📋 テスト実行手順（APIキー設定後）

### テスト1: 直接API接続テスト

```bash
cd /workspaces/ai-trader-supabase
./run_openai_test.sh
```

**期待される出力:**
```
✅ OPENAI_API_KEY が設定されています: sk-proj...xxxx
📡 テスト1: OpenAI API直接接続テスト
✅ 接続成功！
✅ gpt-4o-mini が利用可能
✅ gpt-4o が利用可能
💬 テスト2: 簡単なチャットテスト
✅ チャットAPI成功！
   AIの応答: OK
📊 テスト3: トレード分析テスト
✅ トレード分析成功！
✅ すべてのテストが成功しました！
```

### テスト2: Edge Function統合テスト

**ターミナル1（Edge Function起動）:**
```bash
cd /workspaces/ai-trader-supabase
supabase functions serve test-openai --no-verify-jwt
```

**ターミナル2（テスト実行）:**
```bash
# 接続テスト
curl -X POST http://127.0.0.1:54321/functions/v1/test-openai \
  -H "Content-Type: application/json" \
  -d '{"test_type": "connection"}' | jq

# チャットテスト
curl -X POST http://127.0.0.1:54321/functions/v1/test-openai \
  -H "Content-Type: application/json" \
  -d '{"test_type": "chat"}' | jq

# トレード分析テスト
curl -X POST http://127.0.0.1:54321/functions/v1/test-openai \
  -H "Content-Type: application/json" \
  -d '{"test_type": "trade_analysis"}' | jq
```

### テスト3: 本番ai-trader Functionテスト

**ターミナル1:**
```bash
supabase functions serve ai-trader --no-verify-jwt
```

**ターミナル2:**
```bash
curl -X POST http://127.0.0.1:54321/functions/v1/ai-trader \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sb_secret_N7UND0UgjKTVK-Uodkm0Hg_xSvEMPvz" \
  -d @test_trade_request.json | jq
```

## 📊 利用可能なリソース

### Supabaseローカル環境

- **API URL**: http://127.0.0.1:54321
- **Database URL**: postgresql://postgres:postgres@127.0.0.1:54322/postgres
- **Studio URL**: http://127.0.0.1:54323
- **Service Role Key**: `sb_secret_N7UND0UgjKTVK-Uodkm0Hg_xSvEMPvz`

### ドキュメント

- `SETUP_OPENAI_SECRET.md` - Secret設定の詳細ガイド
- `OPENAI_TEST_GUIDE.md` - テスト方法の詳細

### テストスクリプト

- `run_openai_test.sh` - 簡易APIテスト
- `test_openai_interactive.sh` - 対話型テスト

### Edge Functions

- `test-openai` - OpenAI接続テスト専用
- `ai-trader` - 本番トレード判断Function

## ❓ 質問がある場合

1. OpenAI APIキーの取得方法は？
   → https://platform.openai.com/api-keys

2. GitHub Codespaces Secretの設定方法は？
   → `SETUP_OPENAI_SECRET.md` を参照

3. テストが失敗する場合は？
   → エラーメッセージを確認し、`OPENAI_TEST_GUIDE.md`のトラブルシューティングを参照

## 🚀 次のステップ

1. [ ] OPENAI_API_KEYをGitHub Codespaces Secretに設定
2. [ ] Codespaceを再起動
3. [ ] `./run_openai_test.sh` を実行してAPI接続を確認
4. [ ] `test-openai` Edge Functionをテスト
5. [ ] `ai-trader` Edge Functionをテスト
6. [ ] MT5 EAとの統合テスト

---

**準備が整いました！OPENAI_API_KEYを設定してテストを開始してください。**
