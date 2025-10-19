# AIトレーダー - 本番環境デプロイガイド

## 🚀 本番環境デプロイ手順

### 前提条件
- ✅ ローカル環境でのテスト完了
- ✅ Supabaseプロジェクト作成済み
- ✅ OpenAI API Key取得済み

---

## ステップ 1: Supabaseプロジェクト情報の確認

### プロジェクトURL取得
Supabase Dashboard: https://supabase.com/dashboard/project/_/settings/api

**必要な情報:**
- Project URL (例: `https://xxxxx.supabase.co`)
- Project Reference ID (例: `xxxxx`)
- Anon/Public Key
- Service Role Key

---

## ステップ 2: Supabase CLI ログイン

```bash
# Supabaseにログイン
supabase login

# プロジェクトをリンク
supabase link --project-ref YOUR_PROJECT_REF
```

**例:**
```bash
supabase link --project-ref abcdefghijklmnop
```

---

## ステップ 3: データベースマイグレーション

### ローカルマイグレーションのプッシュ

```bash
# マイグレーション適用
supabase db push
```

これにより、以下のテーブルが本番環境に作成されます:
- `ea-log` - トレードログ
- `ai_config` - AI設定
- `ai_signals` - AIシグナル
- `ml_patterns` - 機械学習パターン
- `ml_training_history` - 学習履歴
- `ml_recommendations` - ML推奨事項

---

## ステップ 4: Secretsの設定

### OpenAI API Keyの設定

```bash
# GitHub Codespaces SecretsからAPI Keyを読み込み
source load_env.sh

# Supabase Secretsに設定
supabase secrets set OPENAI_API_KEY="$OPENAI_API_KEY"

# モデル設定
supabase secrets set OPENAI_MODEL="gpt-4o-mini"
```

### 設定確認

```bash
# Secrets一覧表示（値は隠される）
supabase secrets list
```

**期待される出力:**
```
OPENAI_API_KEY: sk-proj-***
OPENAI_MODEL: gpt-4o-mini
```

---

## ステップ 5: Edge Functionsのデプロイ

### 全関数を一括デプロイ

```bash
# すべてのEdge Functionsをデプロイ
supabase functions deploy
```

### 個別デプロイ（必要に応じて）

```bash
# ai-trader関数のみデプロイ
supabase functions deploy ai-trader

# ea-log関数のみデプロイ
supabase functions deploy ea-log

# ai-signals関数のみデプロイ
supabase functions deploy ai-signals
```

---

## ステップ 6: デプロイ確認

### Edge Function動作テスト

```bash
# プロジェクトURLを環境変数に設定
export SUPABASE_URL="https://YOUR_PROJECT_REF.supabase.co"
export SUPABASE_ANON_KEY="YOUR_ANON_KEY"

# ai-trader関数のテスト
curl -i "https://YOUR_PROJECT_REF.supabase.co/functions/v1/ai-trader" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $SUPABASE_ANON_KEY" \
  -d @test_trade_request.json
```

### データベース接続確認

```bash
# Supabase Studioにアクセス
echo "https://supabase.com/dashboard/project/YOUR_PROJECT_REF/editor"
```

---

## ステップ 7: MT5 EA設定の更新

### AI_QuadFusion_EA.mq5の設定変更

**修正箇所:**
```mql5
// ローカル環境（開発時）
// string SUPABASE_URL = "http://127.0.0.1:54321/functions/v1/ai-trader";

// 本番環境
string SUPABASE_URL = "https://YOUR_PROJECT_REF.supabase.co/functions/v1/ai-trader";
string SUPABASE_KEY = "YOUR_SERVICE_ROLE_KEY";  // Service Role Keyを使用
```

**変更手順:**
1. MT5を起動
2. MetaEditor を開く
3. `AI_QuadFusion_EA.mq5` を開く
4. URLとKeyを本番環境に変更
5. コンパイル (F7)
6. MT5に配置してアクティブ化

---

## ステップ 8: 監視・モニタリング設定

### Supabase Dashboardでの監視

**Edge Function Logs:**
```
https://supabase.com/dashboard/project/YOUR_PROJECT_REF/functions/ai-trader/logs
```

**Database Insights:**
```
https://supabase.com/dashboard/project/YOUR_PROJECT_REF/database/tables
```

### ローカルからの監視（本番DB接続）

```bash
# 本番DBに接続してモニタリング
supabase db remote set "postgresql://postgres:YOUR_PASSWORD@db.YOUR_PROJECT_REF.supabase.co:5432/postgres"

# テーブル確認
supabase db remote query "SELECT * FROM \"ea-log\" ORDER BY created_at DESC LIMIT 5;"
```

---

## ステップ 9: 初回トレードテスト

### テストトレードの実行

1. **MT5 EAをデモ口座で起動**
   - 小さなロットサイズ設定（0.01など）
   - 1つの通貨ペアのみ有効化
   - バックテストモードで動作確認

2. **ログ確認**
   ```bash
   # Supabase Logsで確認
   supabase functions logs ai-trader --tail
   ```

3. **データベース確認**
   - Supabase Studio → Table Editor → `ea-log`
   - リアルタイムでデータが入ってくることを確認

---

## ステップ 10: パフォーマンス監視

### 定期的な確認項目

**毎日:**
- [ ] Edge Function エラーログ確認
- [ ] 勝率統計確認（ai_signals テーブル）
- [ ] OpenAI API使用量確認

**毎週:**
- [ ] コスト分析（OpenAI + Supabase）
- [ ] パフォーマンス最適化検討
- [ ] ML学習データの更新

**毎月:**
- [ ] 包括的なパフォーマンスレビュー
- [ ] モデル精度の再評価
- [ ] システムアップデート検討

---

## 🚨 トラブルシューティング

### Edge Functionがデプロイできない

```bash
# ログを確認
supabase functions deploy ai-trader --debug

# 権限確認
supabase projects list
```

### Secretsが認識されない

```bash
# Secrets再設定
supabase secrets unset OPENAI_API_KEY
supabase secrets set OPENAI_API_KEY="sk-proj-..."

# Edge Function再デプロイ
supabase functions deploy ai-trader
```

### データベース接続エラー

```bash
# マイグレーション状態確認
supabase db remote status

# 強制プッシュ（注意: データが失われる可能性）
supabase db push --include-all
```

---

## 📊 デプロイ後のチェックリスト

- [ ] Supabase CLIログイン成功
- [ ] プロジェクトリンク成功
- [ ] データベースマイグレーション完了
- [ ] OpenAI API Key設定完了
- [ ] Edge Functions全デプロイ完了
- [ ] ai-trader 関数テスト成功
- [ ] ea-log 関数テスト成功
- [ ] MT5 EA本番URL設定完了
- [ ] 初回トレードテスト成功
- [ ] ログ監視体制確立

---

## 🔐 セキュリティベストプラクティス

1. **API Keys管理:**
   - Service Role Keyは絶対にコミットしない
   - Supabase Secretsで管理
   - 定期的にローテーション

2. **RLS (Row Level Security):**
   - すべてのテーブルでRLS有効化済み
   - Anon Keyからの直接アクセス制限

3. **Edge Function認証:**
   - Service Role Keyを使用
   - `--no-verify-jwt` は本番では使用しない

---

## 💰 コスト最適化

### 現在の設定でのコスト見積もり

**OpenAI API (gpt-4o-mini):**
- 月間1,000トレード: 約¥10
- 月間10,000トレード: 約¥97

**Supabase:**
- Freeプラン: 500MB DB + 50,000 MAU無料
- Proプラン ($25/月): トレード数無制限推奨

**推奨プラン:**
- 開発・テスト: Supabase Free + OpenAI従量課金
- 本番運用: Supabase Pro ($25/月) + OpenAI従量課金

---

## 次のステップ

✅ 本番環境デプロイ完了後:
1. 小規模トレードで1週間運用
2. データ分析とモデル精度検証
3. ML学習データの蓄積
4. パラメータチューニング
5. スケールアップ

---

## サポート情報

**Supabase:**
- Docs: https://supabase.com/docs
- Discord: https://discord.supabase.com

**OpenAI:**
- Docs: https://platform.openai.com/docs
- Status: https://status.openai.com

**このプロジェクト:**
- GitHub: https://github.com/ippeitanaka/ai-trader-supabase
- Issues: 問題があればIssueを作成
