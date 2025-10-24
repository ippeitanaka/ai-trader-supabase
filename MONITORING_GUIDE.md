# AIトレーダー - モニタリングガイド

## 📊 リアルタイムモニタリングツール

### 1. 自動更新モニタリング（推奨）

```bash
./monitor_trades.sh
```

**表示内容:**
- 📊 最新のトレードログ (直近5件)
- 📈 AIシグナル統計 (24時間)
  - 総シグナル数
  - 平均勝率予測
  - 実績勝率
- 💰 損益サマリー (24時間)
  - 総損益
  - 平均利益
  - 平均損失
- 📋 アクティブポジション (最大3件)

**更新頻度:** 5秒ごと自動更新  
**終了方法:** Ctrl+C

---

## 🔍 個別テーブル確認

### ea-logテーブル（トレードログ）

```bash
docker exec -it supabase_db_ai-trader-supabase psql -U postgres -c "
SELECT 
  id,
  TO_CHAR(created_at, 'YYYY-MM-DD HH24:MI:SS') as time,
  sym as symbol,
  action,
  ROUND(win_prob * 100, 1) as win_prob_pct,
  LEFT(ai_reasoning, 50) as reasoning
FROM \"ea-log\"
ORDER BY created_at DESC
LIMIT 10;
"
```

### ai_signalsテーブル（AIシグナル）

```bash
docker exec -it supabase_db_ai-trader-supabase psql -U postgres -c "
SELECT 
  id,
  TO_CHAR(created_at, 'YYYY-MM-DD HH24:MI:SS') as time,
  symbol,
  CASE WHEN dir = 1 THEN 'BUY' ELSE 'SELL' END as direction,
  ROUND(win_prob * 100, 1) as win_prob_pct,
  actual_result,
  profit_loss
FROM ai_signals
ORDER BY created_at DESC
LIMIT 10;
"
```

### ml_patternsテーブル（学習パターン）

```bash
docker exec -it supabase_db_ai-trader-supabase psql -U postgres -c "
SELECT 
  id,
  symbol,
  timeframe,
  pattern_type,
  win_count,
  loss_count,
  ROUND(win_rate * 100, 1) as win_rate_pct,
  sample_count
FROM ml_patterns
ORDER BY updated_at DESC
LIMIT 10;
"
```

---

## entry_method の可視化（ハイブリッドエントリー）

ハイブリッドエントリー導入により、AI が選択したエントリー手法が `ai_signals` に保存され、モニタリングにも表示されます。

- 追加カラム（ai_signals）
  - `entry_method`: pullback | breakout | mtf_confirm | none
  - `entry_params` (jsonb): 例 `{ "k": 0.3, "o": 0.2, "expiry_bars": 2, "confirm_tf": "M5", "confirm_rule": "macd_flip", "order_type": "market" }`
  - `method_selected_by`: OpenAI | Fallback
  - `method_confidence`: 0.0–1.0
  - `method_reason`: AI の説明

- `monitor_trades.sh` の表示
  - アクティブな注文/ポジションに対し `entry_method` が表示されます
  - 直近24時間のメソッド別サマリー（件数・勝率など）を併記します

運用の観点では、以下を定期確認してください。

1) メソッド別の約定率（pullback で未約定が多すぎないか、breakout のダマシが多くないか）
2) メソッド別の勝率と平均損益（相対的に突出したメソッドがあるか）
3) `mtf_confirm` の確認ルール（macd_flip / close_break）で市場環境に合うほうに偏っていないか

改善のヒント:

- pullback の `k`（ATR 係数）や breakout の `o` は、銘柄やボラティリティに合わせて微調整するとフィル率/期待値が改善しやすいです
- `mtf_confirm` の `order_type: market` はスリッページ影響が出やすいため、勝率/損益を見ながら LIMIT とのバランスを調整してください

備考:

- サーバログ（`ea-log`）にも `entry_method` と `method_*` が記録されるため、異常時の原因究明が容易です
- `ai_signals` は学習用にも利用できるため、メソッド別の特徴量や結果を抽出して将来的な最適化に活用できます

---

## 📈 統計クエリ

### 勝率分析（シンボル別）

```bash
docker exec -it supabase_db_ai-trader-supabase psql -U postgres -c "
SELECT 
  symbol,
  COUNT(*) as total_trades,
  SUM(CASE WHEN actual_result = 'WIN' THEN 1 ELSE 0 END) as wins,
  ROUND(
    SUM(CASE WHEN actual_result = 'WIN' THEN 1 ELSE 0 END)::DECIMAL / 
    NULLIF(COUNT(*), 0) * 100, 
    1
  ) as win_rate_pct
FROM ai_signals
WHERE actual_result IN ('WIN', 'LOSS')
GROUP BY symbol
ORDER BY total_trades DESC;
"
```

### 損益レポート（日別）

```bash
docker exec -it supabase_db_ai-trader-supabase psql -U postgres -c "
SELECT 
  DATE(created_at) as trade_date,
  COUNT(*) as total_trades,
  ROUND(SUM(profit_loss), 2) as total_pl,
  ROUND(AVG(profit_loss), 2) as avg_pl,
  ROUND(MAX(profit_loss), 2) as max_profit,
  ROUND(MIN(profit_loss), 2) as max_loss
FROM ai_signals
WHERE profit_loss IS NOT NULL
GROUP BY DATE(created_at)
ORDER BY trade_date DESC
LIMIT 7;
"
```

### AI予測精度分析

```bash
docker exec -it supabase_db_ai-trader-supabase psql -U postgres -c "
SELECT 
  CASE 
    WHEN win_prob >= 0.8 THEN 'High (80%+)'
    WHEN win_prob >= 0.6 THEN 'Medium (60-80%)'
    ELSE 'Low (<60%)'
  END as confidence_level,
  COUNT(*) as predictions,
  SUM(CASE WHEN actual_result = 'WIN' THEN 1 ELSE 0 END) as actual_wins,
  ROUND(
    SUM(CASE WHEN actual_result = 'WIN' THEN 1 ELSE 0 END)::DECIMAL / 
    NULLIF(COUNT(*), 0) * 100, 
    1
  ) as actual_win_rate,
  ROUND(AVG(win_prob) * 100, 1) as avg_predicted_prob
FROM ai_signals
WHERE actual_result IN ('WIN', 'LOSS')
GROUP BY 
  CASE 
    WHEN win_prob >= 0.8 THEN 'High (80%+)'
    WHEN win_prob >= 0.6 THEN 'Medium (60-80%)'
    ELSE 'Low (<60%)'
  END
ORDER BY avg_predicted_prob DESC;
"
```

---

## 🖥️ Supabase Studioでの監視

### Studio起動

```bash
# Supabaseが起動している状態で
xdg-open http://127.0.0.1:54323
```

### Table Editorでの確認
1. 左メニュー: **Table Editor**
2. テーブル選択: `ea-log`, `ai_signals`, `ml_patterns`
3. フィルター機能で絞り込み可能

### SQL Editorでのカスタムクエリ
1. 左メニュー: **SQL Editor**
2. **New query** をクリック
3. 上記の統計クエリを実行可能

---

## 🚨 アラート設定（手動監視）

### 異常検知クエリ

**高損失アラート:**
```bash
docker exec -it supabase_db_ai-trader-supabase psql -U postgres -c "
SELECT 
  TO_CHAR(created_at, 'YYYY-MM-DD HH24:MI:SS') as time,
  symbol,
  profit_loss,
  order_ticket
FROM ai_signals
WHERE profit_loss < -100  -- 100ドル以上の損失
  AND created_at >= NOW() - INTERVAL '1 hour'
ORDER BY profit_loss ASC;
"
```

**低勝率アラート:**
```bash
docker exec -it supabase_db_ai-trader-supabase psql -U postgres -c "
SELECT 
  symbol,
  COUNT(*) as trades,
  ROUND(
    SUM(CASE WHEN actual_result = 'WIN' THEN 1 ELSE 0 END)::DECIMAL / 
    NULLIF(COUNT(*), 0) * 100, 
    1
  ) as win_rate
FROM ai_signals
WHERE created_at >= NOW() - INTERVAL '24 hours'
  AND actual_result IN ('WIN', 'LOSS')
GROUP BY symbol
HAVING ROUND(
    SUM(CASE WHEN actual_result = 'WIN' THEN 1 ELSE 0 END)::DECIMAL / 
    NULLIF(COUNT(*), 0) * 100, 
    1
  ) < 50  -- 勝率50%未満
ORDER BY win_rate ASC;
"
```

---

## 📝 ログファイル確認

### Edge Functionログ
```bash
# ai-traderのログを確認
docker logs supabase_edge_runtime_ai-trader-supabase -f
```

### データベースログ
```bash
# PostgreSQLログを確認
docker logs supabase_db_ai-trader-supabase -f
```

---

## 🔧 トラブルシューティング

### データが表示されない場合

1. **Supabaseが起動しているか確認:**
   ```bash
   supabase status
   ```

2. **データベース接続確認:**
   ```bash
   docker exec -it supabase_db_ai-trader-supabase psql -U postgres -c "SELECT version();"
   ```

3. **テーブル存在確認:**
   ```bash
   docker exec -it supabase_db_ai-trader-supabase psql -U postgres -c "\dt"
   ```

### モニタリングスクリプトがエラーになる場合

```bash
# スクリプト権限確認
ls -l monitor_trades.sh

# 実行権限付与（必要に応じて）
chmod +x monitor_trades.sh

# 直接実行
bash monitor_trades.sh
```

---

## 📊 推奨モニタリングワークフロー

### 開発・テスト時
```bash
# ターミナル1: Edge Function起動
source load_env.sh
supabase functions serve ai-trader --env-file supabase/.env.local --no-verify-jwt

# ターミナル2: リアルタイムモニタリング
./monitor_trades.sh

# ターミナル3: テスト実行
curl -s http://127.0.0.1:54321/functions/v1/ai-trader \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $(grep SUPABASE_SERVICE_ROLE_KEY supabase/.env.local | cut -d= -f2)" \
  -d @test_trade_request.json
```

### 本番環境監視
- Supabase Dashboard (https://supabase.com/dashboard)
- Edge Function Logs
- Database Insights
- Performance Metrics

---

## 次のステップ

✅ モニタリングツール準備完了  
⏭️ 次は本番環境デプロイの準備

詳細: `PRODUCTION_DEPLOYMENT.md` を参照
