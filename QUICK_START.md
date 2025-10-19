# AI Trader - クイックスタートガイド

## 🚀 セットアップ完了！

OpenAI APIとの接続テストが完了し、すべてのコンポーネントが正常に動作しています。

---

## 📋 現在の状態

### ✅ 完了済み
- [x] Supabase CLIインストール
- [x] ローカルデータベース起動
- [x] 全マイグレーション適用
- [x] OpenAI API接続確認
- [x] Edge Functions動作確認

### 利用可能なサービス
- **Database**: http://127.0.0.1:54322 (postgres/postgres)
- **API**: http://127.0.0.1:54321
- **Studio**: http://127.0.0.1:54323
- **Edge Functions**: http://127.0.0.1:54321/functions/v1/

---

## 🎯 よく使うコマンド

### 環境変数を読み込む
```bash
source /workspaces/ai-trader-supabase/load_env.sh
```

### Supabaseを起動/停止
```bash
# 起動
supabase start

# 停止
supabase stop

# 状態確認
supabase status
```

### Edge Functionを起動
```bash
# test-openai Function（テスト用）
supabase functions serve test-openai --env-file supabase/.env.local --no-verify-jwt

# ai-trader Function（本番）
supabase functions serve ai-trader --env-file supabase/.env.local --no-verify-jwt

# 全Functionを起動
supabase functions serve --env-file supabase/.env.local --no-verify-jwt
```

### テストを実行
```bash
# OpenAI API直接テスト
./run_openai_test.sh

# test-openai Functionテスト（接続）
curl -X POST http://127.0.0.1:54321/functions/v1/test-openai \
  -H "Content-Type: application/json" \
  -d '{"test_type": "connection"}' | jq

# ai-trader Functionテスト
curl -X POST http://127.0.0.1:54321/functions/v1/ai-trader \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sb_secret_N7UND0UgjKTVK-Uodkm0Hg_xSvEMPvz" \
  -d @test_trade_request.json | jq
```

### データベース操作
```bash
# データベースに接続
docker exec -it supabase_db_ai-trader-supabase psql -U postgres

# テーブル一覧
\dt

# データ確認
SELECT * FROM "ea-log" ORDER BY created_at DESC LIMIT 10;
SELECT * FROM ai_signals ORDER BY created_at DESC LIMIT 10;
```

---

## 📖 ドキュメント

### セットアップガイド
- `SETUP_OPENAI_SECRET.md` - OpenAI API設定方法
- `HOW_TO_CREATE_NEW_OPENAI_KEY.md` - 新しいAPIキーの作成方法
- `CURRENT_STATUS.md` - 現在の状態と次のステップ

### テストレポート
- `OPENAI_TEST_REPORT.md` - 完全なテスト結果レポート
- `OPENAI_TEST_GUIDE.md` - 詳細なテストガイド

### アーカイブ
- `archive/old_docs/` - 過去のドキュメント

---

## 🔧 トラブルシューティング

### Edge FunctionでAPIキーが認識されない
```bash
# 環境変数を再設定
source load_env.sh
echo "OPENAI_API_KEY=$OPENAI_API_KEY" > supabase/.env.local

# Functionを再起動
pkill -f "supabase functions serve"
supabase functions serve ai-trader --env-file supabase/.env.local --no-verify-jwt
```

### Supabaseが起動しない
```bash
# コンテナを全て停止
docker ps -a | grep supabase | awk '{print $1}' | xargs -r docker rm -f

# 再起動
supabase start
```

### マイグレーションエラー
```bash
# データベースをリセット
supabase db reset

# 特定のマイグレーションを確認
ls -la supabase/migrations/
```

---

## 🎯 次のステップ

### 1. MT5 EAとの接続テスト
1. MT5でEAを起動
2. EA設定でURLを設定:
   ```
   http://127.0.0.1:54321/functions/v1/ai-trader
   ```
3. Bearerトークンを設定:
   ```
   sb_secret_N7UND0UgjKTVK-Uodkm0Hg_xSvEMPvz
   ```

### 2. リアルタイムモニタリング
```bash
# ログをリアルタイムで確認
supabase functions logs ai-trader --follow

# データベースの変更を監視
watch -n 2 'docker exec supabase_db_ai-trader-supabase psql -U postgres -c "SELECT COUNT(*) FROM \"ea-log\""'
```

### 3. 本番環境へデプロイ
```bash
# Supabaseにログイン
supabase login

# プロジェクトにリンク
supabase link --project-ref your-project-ref

# Secretsを設定
supabase secrets set OPENAI_API_KEY=your-key-here

# デプロイ
supabase functions deploy ai-trader
supabase db push
```

---

## 📊 モニタリング

### OpenAI使用量
https://platform.openai.com/usage

### Supabase Dashboard
https://supabase.com/dashboard/project/your-project

### ローカルStudio
http://127.0.0.1:54323

---

## 💡 ヒント

### 開発効率化
```bash
# よく使うコマンドをエイリアスに
echo 'alias sbs="supabase start"' >> ~/.bashrc
echo 'alias sbf="source load_env.sh && supabase functions serve --env-file supabase/.env.local --no-verify-jwt"' >> ~/.bashrc
source ~/.bashrc
```

### デバッグモード
```bash
# 詳細なログを出力
supabase functions serve ai-trader --env-file supabase/.env.local --no-verify-jwt --debug
```

### パフォーマンス確認
```bash
# レスポンス時間を測定
time curl -X POST http://127.0.0.1:54321/functions/v1/ai-trader \
  -H "Content-Type: application/json" \
  -d @test_trade_request.json
```

---

## 🎉 成功！

すべての準備が整いました。AIトレーダーシステムが完全に動作しています！

質問や問題がある場合は、上記のドキュメントを参照するか、ログを確認してください。

**Happy Trading! 🚀📈**
