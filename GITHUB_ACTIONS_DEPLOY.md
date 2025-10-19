# GitHub Actionsを使った自動デプロイ設定

## 🚀 自動デプロイの設定手順

### 前提条件
- GitHubリポジトリが作成済み
- Supabaseプロジェクトが作成済み
- OpenAI API Key取得済み

---

## ステップ 1: GitHub Secretsの設定

GitHubリポジトリの設定ページでSecretsを追加します。

### 設定場所
```
https://github.com/ippeitanaka/ai-trader-supabase/settings/secrets/actions
```

### 必要なSecrets

#### 1. SUPABASE_ACCESS_TOKEN
**取得方法:**
1. https://supabase.com/dashboard/account/tokens にアクセス
2. "Generate New Token" をクリック
3. Name: "GitHub Actions Deploy"
4. トークンをコピー

**設定:**
- Name: `SUPABASE_ACCESS_TOKEN`
- Value: `sbp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`

#### 2. SUPABASE_PROJECT_REF
**取得方法:**
1. https://supabase.com/dashboard/project/_/settings/general にアクセス
2. "Reference ID" をコピー

**設定:**
- Name: `SUPABASE_PROJECT_REF`
- Value: `abcdefghijklmnop` (プロジェクトID)

#### 3. OPENAI_API_KEY
**設定:**
- Name: `OPENAI_API_KEY`
- Value: `sk-proj-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`

---

## ステップ 2: ワークフローファイルの確認

`.github/workflows/deploy.yml` が作成されています。

**ワークフローの動作:**
1. `main` ブランチへのプッシュで自動実行
2. 手動実行も可能（GitHub Actions → Deploy to Supabase → Run workflow）
3. すべてのEdge Functionsをデプロイ
4. Secretsを設定

---

## ステップ 3: デプロイの実行

### 自動デプロイ（推奨）

```bash
# コードをコミット＆プッシュ
git add .
git commit -m "Setup production deployment"
git push origin main
```

GitHubリポジトリの "Actions" タブで進行状況を確認できます。

### 手動デプロイ

1. GitHubリポジトリの "Actions" タブを開く
2. "Deploy to Supabase" ワークフローを選択
3. "Run workflow" をクリック
4. ブランチを選択（通常は `main`）
5. "Run workflow" を実行

---

## ステップ 4: データベースマイグレーション

**⚠️ 注意: データベースマイグレーションは手動実行推奨**

マイグレーションはGitHub Actionsではなく、ローカルから実行することを推奨します：

```bash
# Supabaseにログイン
supabase login --token YOUR_ACCESS_TOKEN

# プロジェクトをリンク
supabase link --project-ref YOUR_PROJECT_REF

# マイグレーション実行
supabase db push
```

**理由:**
- データベース変更は重要な操作
- 実行前に確認が必要
- ロールバックの準備

---

## ステップ 5: デプロイ確認

### Edge Functions確認

```bash
# プロジェクトURL設定
export SUPABASE_URL="https://YOUR_PROJECT_REF.supabase.co"
export SUPABASE_ANON_KEY="YOUR_ANON_KEY"

# ai-trader関数テスト
curl -i "$SUPABASE_URL/functions/v1/ai-trader" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $SUPABASE_ANON_KEY" \
  -d @test_trade_request.json
```

### Supabase Dashboardで確認

**Edge Functions:**
```
https://supabase.com/dashboard/project/YOUR_PROJECT_REF/functions
```

デプロイされた関数が表示されることを確認：
- ai-trader
- ea-log
- ai-signals
- ai-signals-update
- ai-reason
- ai-config
- ml-training

**Secrets:**
```
https://supabase.com/dashboard/project/YOUR_PROJECT_REF/settings/vault
```

設定されたSecretsを確認：
- OPENAI_API_KEY
- OPENAI_MODEL

---

## トラブルシューティング

### デプロイが失敗する

**GitHub Actionsログを確認:**
1. "Actions" タブ → 失敗したワークフロー → 詳細ログ
2. エラーメッセージを確認

**一般的な原因:**
- `SUPABASE_ACCESS_TOKEN` が無効
- `SUPABASE_PROJECT_REF` が間違っている
- Edge Functionのコードにエラー

**解決方法:**
```bash
# ローカルで事前テスト
cd /workspaces/ai-trader-supabase
supabase functions serve ai-trader --env-file supabase/.env.local

# エラーがないことを確認してからプッシュ
```

### Secretsが設定されない

**手動で設定:**
```bash
supabase login --token YOUR_ACCESS_TOKEN
supabase secrets set OPENAI_API_KEY="sk-proj-xxx" --project-ref YOUR_PROJECT_REF
supabase secrets set OPENAI_MODEL="gpt-4o-mini" --project-ref YOUR_PROJECT_REF
```

---

## 開発ワークフロー

### 推奨フロー

1. **ローカル開発:**
   ```bash
   # ローカルでテスト
   supabase start
   supabase functions serve ai-trader --env-file supabase/.env.local
   
   # テスト実行
   ./test_openai_interactive.sh
   ```

2. **コミット＆プッシュ:**
   ```bash
   git add .
   git commit -m "Update AI trader logic"
   git push origin main
   ```

3. **自動デプロイ:**
   - GitHub Actionsが自動実行
   - デプロイ完了を確認

4. **本番テスト:**
   ```bash
   # 本番環境でテスト
   curl -i "https://YOUR_PROJECT_REF.supabase.co/functions/v1/ai-trader" \
     -H "Content-Type: application/json" \
     -H "Authorization: Bearer $SUPABASE_ANON_KEY" \
     -d @test_trade_request.json
   ```

---

## セキュリティベストプラクティス

### GitHub Secrets
- ✅ Secretsは暗号化されて保存
- ✅ ログには表示されない（`***` でマスク）
- ✅ プルリクエストからはアクセス不可（デフォルト）

### Supabase Secrets
- ✅ 環境変数として安全に保存
- ✅ Edge Function実行時のみアクセス可能
- ✅ ダッシュボードでは値が隠される

### ベストプラクティス
1. **Service Role Keyはコードに含めない**
2. **`.env` ファイルは `.gitignore` に追加**
3. **定期的にトークンをローテーション**
4. **最小権限の原則（必要な権限のみ付与）**

---

## 次のステップ

✅ GitHub Actions設定完了後:
1. コードをプッシュして自動デプロイをテスト
2. Supabase Dashboardで動作確認
3. MT5 EAを本番URLに接続
4. 小規模トレードで動作確認
5. モニタリング体制確立

---

## 参考リンク

**GitHub Actions:**
- Docs: https://docs.github.com/actions

**Supabase CLI:**
- Docs: https://supabase.com/docs/guides/cli

**Deno Deploy:**
- Docs: https://deno.com/deploy/docs
