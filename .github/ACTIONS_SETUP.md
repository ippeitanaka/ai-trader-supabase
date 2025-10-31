# GitHub Actions Setup Guide

## Required GitHub Secrets

このリポジトリのGitHub Actionsを正常に動作させるには、以下のシークレットを設定する必要があります。

### 設定場所
GitHub Repository → Settings → Secrets and variables → Actions → New repository secret

---

## 必須シークレット

### 1. `SUPABASE_ACCESS_TOKEN`
**説明**: Supabase CLIがプロジェクトにアクセスするためのトークン

**取得方法**:
1. [Supabase Dashboard](https://supabase.com/dashboard/account/tokens) にアクセス
2. "Generate new token" をクリック
3. トークン名を入力（例: "GitHub Actions Deploy"）
4. 生成されたトークンをコピー

**設定値の例**: `sbp_1234567890abcdefghijklmnopqrstuvwxyz`

---

### 2. `SUPABASE_PROJECT_REF`
**説明**: Supabaseプロジェクトの参照ID

**取得方法**:
1. [Supabase Dashboard](https://supabase.com/dashboard) でプロジェクトを選択
2. Settings → General → Reference ID をコピー

**設定値の例**: `nebphrnnpmuqbkymwefs`

---

### 3. `SUPABASE_URL`
**説明**: SupabaseプロジェクトのURL

**取得方法**:
1. [Supabase Dashboard](https://supabase.com/dashboard) でプロジェクトを選択
2. Settings → API → Project URL をコピー

**設定値の例**: `https://nebphrnnpmuqbkymwefs.supabase.co`

---

### 4. `SUPABASE_SERVICE_ROLE_KEY`
**説明**: Supabase Service Role Key（管理者権限）

**取得方法**:
1. [Supabase Dashboard](https://supabase.com/dashboard) でプロジェクトを選択
2. Settings → API → Project API keys → `service_role` の値をコピー

⚠️ **警告**: このキーは公開しないでください。サーバーサイドでのみ使用してください。

**設定値の例**: `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...`

---

### 5. `OPENAI_API_KEY` (オプション)
**説明**: OpenAI APIキー（AI機能を使用する場合に必要）

**取得方法**:
1. [OpenAI Platform](https://platform.openai.com/api-keys) にアクセス
2. "Create new secret key" をクリック
3. 生成されたキーをコピー

**設定値の例**: `sk-proj-1234567890abcdefghijklmnopqrstuvwxyz...`

---

## Actionsワークフロー

### 1. Deploy to Supabase (`.github/workflows/deploy.yml`)
- **トリガー**: `main`ブランチへのpush、または手動実行
- **機能**: Edge Functionsを自動デプロイ
- **必要なシークレット**: `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF`, `OPENAI_API_KEY`

### 2. Trade System Check (`.github/workflows/trade-system-check.yml`)
- **トリガー**: 6時間ごと（UTC 0:00, 6:00, 12:00, 18:00）、または手動実行
- **機能**: システム稼働状況の確認
- **必要なシークレット**: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`

### 3. ML Training Daily (`.github/workflows/ml-training-daily.yml`)
- **トリガー**: 毎日 UTC 3:00（JST 12:00）、または手動実行
- **機能**: ML学習の自動実行
- **必要なシークレット**: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`

---

## トラブルシューティング

### Actionsが失敗する場合

1. **"Unauthorized" エラー**
   - `SUPABASE_ACCESS_TOKEN` が正しく設定されているか確認
   - トークンの有効期限が切れていないか確認

2. **"Project not found" エラー**
   - `SUPABASE_PROJECT_REF` が正しいか確認
   - プロジェクトIDではなく、Reference IDを使用しているか確認

3. **デプロイが失敗する**
   - Supabase CLIのバージョンを確認
   - ワークフローログで詳細なエラーメッセージを確認

### 手動でActionsを実行する方法

1. GitHubリポジトリの "Actions" タブに移動
2. 実行したいワークフローを選択
3. "Run workflow" ボタンをクリック
4. ブランチを選択して実行

---

## セキュリティのベストプラクティス

✅ **DO**:
- シークレットは必ずGitHub Secretsに保存する
- 最小権限の原則に従う
- 定期的にトークンをローテーションする

❌ **DON'T**:
- コードにシークレットを直接記述しない
- シークレットをログに出力しない
- シークレットを公開リポジトリにコミットしない

---

## 参考リンク

- [GitHub Actions Documentation](https://docs.github.com/en/actions)
- [Supabase CLI Documentation](https://supabase.com/docs/reference/cli/introduction)
- [Supabase Edge Functions](https://supabase.com/docs/guides/functions)
