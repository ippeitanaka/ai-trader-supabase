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
  -H "Authorization: Bearer <YOUR_SUPABASE_ANON_OR_SERVICE_ROLE_KEY>" \
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
2. MT5の「ツール → オプション → エキスパートアドバイザ」
  - 「WebRequestを許可するURL」に `https://nebphrnnpmuqbkymwefs.supabase.co` を追加
3. EA設定でURLを設定:
   ```
   http://127.0.0.1:54321/functions/v1/ai-trader
   ```
4. Bearerトークンを設定（運用方針に合わせて選択）:
  - `AI_Bearer_Token`: `anon key` または `service_role key`（どちらでも可）
  - `EA_Log_Bearer_Token`: `ea-log` 専用トークン（推奨）

  `ea-log` 専用トークンの作成例（本番プロジェクト）：
  ```bash
  supabase secrets set EA_LOG_BEARER_TOKEN="$(openssl rand -hex 24)" --project-ref nebphrnnpmuqbkymwefs
  ```
  その値をEAの `EA_Log_Bearer_Token` に設定してください（未設定だと `ea-log` は401になります）。

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

### EV（期待値）ベースのゲート調整
`ai-trader` は「勝率（win_prob）」だけでなく、$EV_R$（R倍率ベース期待値）でも実行可否を判定できます。

- `AI_TRADER_MIN_EV_R`：最小期待値（R）しきい値（例: `0.10`）
- `AI_TRADER_MIN_WIN_PROB_FLOOR`：安全のための勝率下限（例: `0.55`）
- `AI_TRADER_MAX_COST_R`：スプレッドが大きすぎる局面を強制見送り（例: `0.12`）
- `AI_TRADER_ASSUMED_COST_R`：bid/ask/atr が欠損している場合に使うコスト（R）の仮定値（例: `0.02`）
- `AI_TRADER_CALIBRATION_REQUIRED`：キャリブが適用できないなら実行しない（例: `on`）

ローカルでの例（`supabase/.env.local`）：
```bash
AI_TRADER_MIN_EV_R=0.10
AI_TRADER_MIN_WIN_PROB_FLOOR=0.55
AI_TRADER_MAX_COST_R=0.12
AI_TRADER_ASSUMED_COST_R=0.02
AI_TRADER_CALIBRATION_REQUIRED=off
```

「利大損小が徹底できていて、実現勝率は50%超で十分」という方針の場合は、まずは以下を推奨します（機会を増やしつつ、勝率判定の品質を担保）：

```bash
# まずは「勝率50%目標 + 機会を増やす」寄り
AI_TRADER_MIN_WIN_PROB_FLOOR=0.50
AI_TRADER_MIN_EV_R=0.05
AI_TRADER_MAX_COST_R=0.12

# キャリブが適用できない（学習データ不足など）場合は実行しない
AI_TRADER_CALIBRATION_REQUIRED=on

# キャリブを実運用で効かせるための推奨（データが少ないと calApplied=0 になりやすい）
AI_TRADER_CALIBRATION_LOOKBACK_DAYS=180
AI_TRADER_CALIBRATION_LIMIT=500
AI_TRADER_CALIBRATION_MIN_N=20
AI_TRADER_CALIBRATION_MIN_BIN_N=5
```

重要: 勝率キャリブレーションを有効化している場合、モデルの `win_prob` が過信（高め）だと、キャリブ後の値は大きく下がります。
その状態で `ai_config.min_win_prob` を `0.60`〜`0.70` に置くと、実行がほぼゼロになりやすいです。

目安（現在のローカル取り込みデータ 2025-10/11 の近似結果）:
- `AI_TRADER_MIN_WIN_PROB_FLOOR=0.55` のままなら、`ai_config.min_win_prob` は `0.55` 付近が現実的
- `0.60` 以上に上げる場合は、キャリブレーションの見直し（or 無効化）前提

補足: キャリブレーション有効時は、`ai_config.min_win_prob` のスケールも「キャリブ後」の値として扱う前提です。
そのため、`ai_config.min_win_prob` は `0.40`〜`0.75` の範囲で調整できるようにしています。

分析用SQL:
- [scripts/query_winprob_calibration.sql](scripts/query_winprob_calibration.sql)
- [scripts/query_ev_gate_sweep.sql](scripts/query_ev_gate_sweep.sql)
- [scripts/query_calibrated_gate_sweep.sql](scripts/query_calibrated_gate_sweep.sql)
- [scripts/query_oos_calibrated_gate_sweep.sql](scripts/query_oos_calibrated_gate_sweep.sql)

### 意味が分からなくてもOK：ワンショット最適化（推奨→反映）
「とにかく稼げたらいいので、設定は自動で良い感じにしてほしい」場合はこれだけ実行してください。

運用チェック（重要）:
- EA→サーバのリクエストに `bid` / `ask` / `atr` が入っていると、スプレッドコストを実測で見積もれます（利益に直結）。
- `ea_log_monitor` の「AI判断根拠」や `ai_reasoning` に `GATE(... costSrc=real ...)` が出ているか確認してください。
  - `costSrc=assumed` が頻発する場合は、EA側で tick/ATR が取れていない可能性があります。

やること：
- 過去データを TRAIN→TEST に分けて、勝率キャリブ込みで「勝率50%超 + ある程度の件数」を満たす設定を探す
- 良さそうな設定を `ai_config` に反映（`min_win_prob` を更新）
- Edge Functionに入れるべき env も表示

実行（ローカル）:
```bash
psql -X -P pager=off "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
  -f scripts/autotune_apply_50win.sql
```

オプション（コストや期間を変えたい時）:
```bash
psql -X -P pager=off "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
  -v instance_filter='main' \
  -v winprob_floor='0.50' -v assumed_cost_r='0.02' -v max_cost_r='0.12' \
  -v min_exec_n='20' -v min_realized_win_rate='0.50' \
  -f scripts/autotune_apply_50win.sql
```

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
