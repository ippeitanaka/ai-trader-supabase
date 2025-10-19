# 🚀 デプロイ クイックリファレンス

## 📋 GitHub Secrets 設定リンク

### 必須の3つのSecrets

| Secret名 | 取得先 | 説明 |
|---------|--------|------|
| `SUPABASE_ACCESS_TOKEN` | [トークン取得](https://supabase.com/dashboard/account/tokens) | Supabase APIアクセストークン |
| `SUPABASE_PROJECT_REF` | [プロジェクト設定](https://supabase.com/dashboard/project/_/settings/general) | プロジェクトID (16文字) |
| `OPENAI_API_KEY` | Codespaces Secretsから | OpenAI APIキー |

**Secrets設定ページ:**  
👉 https://github.com/ippeitanaka/ai-trader-supabase/settings/secrets/actions

---

## 🔄 デプロイフロー

```
1. GitHub Secrets設定 (上記3つ)
   ↓
2. GitHub Actionsが自動実行
   ↓
3. Edge Functionsデプロイ
   ↓
4. Secretsを本番環境に設定
   ↓
5. デプロイ完了！
```

---

## 📊 デプロイ状況確認

**GitHub Actions:**  
👉 https://github.com/ippeitanaka/ai-trader-supabase/actions

**Supabase Dashboard:**  
👉 https://supabase.com/dashboard/project/_/functions

---

## ✅ チェックリスト

### デプロイ前
- [ ] GitHub Secretsを3つ設定
- [ ] Supabaseプロジェクト作成済み
- [ ] OpenAI API Key有効

### デプロイ後
- [ ] GitHub Actionsが成功（緑チェック）
- [ ] Supabase Dashboardで関数確認
- [ ] テストリクエスト送信

---

## 🧪 デプロイ後のテスト

```bash
# プロジェクトURL設定（YOUR_PROJECT_REFを置き換え）
export SUPABASE_URL="https://YOUR_PROJECT_REF.supabase.co"
export SUPABASE_ANON_KEY="YOUR_ANON_KEY"

# テスト実行
curl -i "$SUPABASE_URL/functions/v1/ai-trader" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $SUPABASE_ANON_KEY" \
  -d @test_trade_request.json
```

**期待される結果:**
```json
{
  "win_prob": 0.82,
  "action": 1,
  "confidence": "high",
  "reasoning": "強気シグナル..."
}
```

---

## 📖 詳細ドキュメント

| ドキュメント | 内容 |
|------------|------|
| `DEPLOYMENT_SUMMARY.md` | 完全サマリー |
| `GITHUB_ACTIONS_DEPLOY.md` | GitHub Actions詳細 |
| `PRODUCTION_DEPLOYMENT.md` | 本番デプロイ完全ガイド |

---

## 🆘 トラブルシューティング

### GitHub Actionsが失敗する

1. **Secretsを確認**
   - 3つすべて設定されているか
   - タイプミスがないか

2. **ログを確認**
   - Actions → 失敗したワークフロー → 詳細
   - エラーメッセージを確認

3. **再実行**
   - "Re-run all jobs" をクリック

### Supabaseプロジェクトが見つからない

- PROJECT_REFが正しいか確認
- Supabaseにログインしているか確認

---

## 📞 サポート

問題が解決しない場合:
1. GitHub Issues: https://github.com/ippeitanaka/ai-trader-supabase/issues
2. ドキュメント再確認: `PRODUCTION_DEPLOYMENT.md`

---

**作成日**: 2025年10月19日  
**最終更新**: プッシュ後
