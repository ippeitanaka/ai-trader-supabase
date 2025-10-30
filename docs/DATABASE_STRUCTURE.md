# 📊 Supabase データベース構造

## テーブル一覧（5テーブル）

1. [ea-log](#1-ea-log---mt5-ea-ログテーブル) - MT5 EA ログ
2. [ai_signals](#2-ai_signals---aiシグナル詳細テーブル) - AIシグナル詳細（メインデータ）
3. [ml_patterns](#3-ml_patterns---ml学習パターンテーブル) - ML学習パターン
4. [ml_recommendations](#4-ml_recommendations---ml推奨テーブル) - ML推奨事項
5. [ml_training_history](#5-ml_training_history---ml学習履歴テーブル) - ML学習履歴

---

## 1. `ea-log` - MT5 EA ログテーブル

**役割**: MT5 EAから送られる取引判断とAI分析のログを記録

### カラム構成

| カラム | 型 | NULL | デフォルト | 説明 |
|--------|-----|------|-----------|------|
| `id` | bigint | NOT NULL | 自動採番 | 主キー |
| `created_at` | timestamptz | NOT NULL | `NOW()` | データベース登録日時（自動） |
| `at` | timestamptz | NOT NULL | - | イベント発生時刻（MT5側） |
| `sym` | text | NOT NULL | - | 通貨ペア（USDJPY, XAUUSD等） |
| `tf` | text | NULL | - | タイムフレーム（M15, H1等） |
| `action` | text | NULL | - | アクション（BUY/SELL/SKIP等） |
| `trade_decision` | text | NULL | - | 取引判断（ENTRY/SKIP等） |
| `win_prob` | double precision | NULL | - | AI予測勝率（0.0～1.0） |
| `ai_reasoning` | text | NULL | - | AI判断の理由 |
| `order_ticket` | bigint | NULL | - | MT5オーダーチケット番号 |

### インデックス

- `ea-log-new_pkey` (PRIMARY KEY): `id`
- `idx_ea_log_at`: `at DESC`
- `idx_ea_log_created_at`: `created_at DESC`
- `idx_ea_log_sym`: `sym`
- `idx_ea_log_trade_decision`: `trade_decision`

### 用途

- リアルタイム監視
- デバッグ
- AI判断の記録
- トレード履歴の追跡

### 注意点

**`created_at` vs `at` の違い**:
- `created_at`: データベースに保存された日時（システム管理用）
- `at`: 実際にMT5でイベントが発生した日時（**分析に使用**）

---

## 2. `ai_signals` - AIシグナル詳細テーブル

**役割**: AI取引シグナルと結果を詳細に記録（メインのデータソース、ML学習に使用）

### 基本情報

| カラム | 型 | 説明 |
|--------|-----|------|
| `id` | bigint | 主キー（自動採番） |
| `created_at` | timestamptz | シグナル作成日時 |
| `symbol` | text | 通貨ペア |
| `timeframe` | text | タイムフレーム |
| `dir` | integer | 方向（1=BUY, -1=SELL） |
| `win_prob` | double precision | AI予測勝率（0.0～1.0） |
| `price` | double precision | エントリー時の価格 |
| `reason` | text | エントリー理由 |
| `instance` | text | EAインスタンス名 |
| `model_version` | text | EAバージョン |

### テクニカル指標（生データ）

| カラム | 説明 |
|--------|------|
| `bid` | 買値 |
| `ask` | 売値 |
| `rsi` | RSI値 |
| `atr` | ATR（ボラティリティ） |
| `ema_25` | 25期間EMA |
| `sma_100` | 100期間SMA |
| `ma_cross` | MA交差状態（1/-1） |

### MACD指標

| カラム | 説明 |
|--------|------|
| `macd_main` | MACDメインライン |
| `macd_signal` | MACDシグナルライン |
| `macd_histogram` | MACDヒストグラム |
| `macd_cross` | MACDクロス状態（1/-1） |

### 一目均衡表（全ライン）

| カラム | 説明 |
|--------|------|
| `ichimoku_tenkan` | 転換線 |
| `ichimoku_kijun` | 基準線 |
| `ichimoku_senkou_a` | 先行スパンA |
| `ichimoku_senkou_b` | 先行スパンB |
| `ichimoku_chikou` | 遅行スパン |
| `ichimoku_tk_cross` | 転換線・基準線クロス（1/-1） |
| `ichimoku_cloud_color` | 雲の色（1=陽転, -1=陰転） |
| `ichimoku_price_vs_cloud` | 価格と雲の位置関係（1=上, -1=下, 0=中） |

### EA判断情報（参考）

| カラム | 説明 |
|--------|------|
| `ea_dir` | EA側の方向判断 |
| `ea_reason` | EA側の理由 |
| `ea_ichimoku_score` | EA側の一目スコア |

### 取引結果

| カラム | 説明 |
|--------|------|
| `order_ticket` | MT5チケット番号 |
| `entry_price` | エントリー価格 |
| `exit_price` | 決済価格 |
| `profit_loss` | 損益（USD/JPY等） |
| `closed_at` | 決済日時 |
| `hold_duration_minutes` | 保有時間（分） |
| `actual_result` | 実際の結果（WIN/LOSS/CANCELLED/FILLED） |
| `cancelled_reason` | キャンセル理由 |
| `sl_hit` | SLヒット（true/false） |
| `tp_hit` | TPヒット（true/false） |

### エントリー方法（Hybrid Entry System）

| カラム | 説明 |
|--------|------|
| `entry_method` | エントリー方式（pullback/breakout/mtf_confirm/none） |
| `entry_params` | エントリーパラメータ（JSON） |
| `method_selected_by` | 選択者（OpenAI/Fallback） |
| `method_confidence` | 信頼度（0.0～1.0） |
| `method_reason` | 選択理由 |

### MLパターントラッキング（2025-10-28追加）

| カラム | 型 | デフォルト | 説明 |
|--------|-----|-----------|------|
| `ml_pattern_used` | boolean | false | MLパターンが使用されたか |
| `ml_pattern_id` | bigint | NULL | 使用されたパターンID（`ml_patterns.id`への参照） |
| `ml_pattern_name` | text | NULL | パターン名（例: "BUY_RSI30-40_ATR0.001"） |
| `ml_pattern_confidence` | numeric(5,2) | NULL | パターン信頼度（%、例: 75.50） |

**挿入元**: 
- Edge Function `ai-trader` → AI判断時にMLパターンマッチング結果を返す
- Edge Function `ai-signals` → POSTリクエストでMLパターン情報を保存
- MT5 EA `AI_QuadFusion_EA.mq5` → `RecordSignal()`でMLパターン情報を送信

**関連テーブル**: `ml_patterns` テーブルと `ml_pattern_id` で連携

**使用例**:
```sql
-- MLパターンを使用したトレードの勝率
SELECT 
  ml_pattern_name,
  COUNT(*) as trades,
  AVG(CASE WHEN actual_result = 'WIN' THEN 1 ELSE 0 END) * 100 as win_rate,
  AVG(ml_pattern_confidence) as avg_confidence
FROM ai_signals
WHERE ml_pattern_used = true 
  AND actual_result IN ('WIN', 'LOSS')
GROUP BY ml_pattern_name
ORDER BY trades DESC;
```

### インデックス（パフォーマンス最適化）

- `ai_signals_pkey` (PRIMARY KEY): `id`
- `idx_ai_signals_created_at`: `created_at DESC`
- `idx_ai_signals_symbol`: `symbol`
- `idx_ai_signals_order_ticket`: `order_ticket`
- `idx_ai_signals_actual_result`: `actual_result`
- `idx_ai_signals_entry_method`: `entry_method`
- `idx_ai_signals_method_selected_by`: `method_selected_by`
- `idx_ai_signals_closed_at`: `closed_at DESC` (WHERE `closed_at IS NOT NULL`)
- `idx_ai_signals_training`: `actual_result, symbol, timeframe` (WHERE `actual_result IN ('WIN', 'LOSS')`)
- `idx_ai_signals_ml_pattern_used`: `ml_pattern_used` **(2025-10-28追加)**
- `idx_ai_signals_ml_pattern_id`: `ml_pattern_id` **(2025-10-28追加)**

### 用途

- **ML学習のメインデータソース**
- パフォーマンス分析
- パターン発見
- 勝率計算
- テクニカル指標の相関分析

---

## 3. `ml_patterns` - ML学習パターンテーブル

**役割**: 発見された取引パターンとその統計情報

### カラム構成

| カラム | 型 | デフォルト | 説明 |
|--------|-----|-----------|------|
| `id` | bigint | 自動採番 | 主キー |
| `created_at` | timestamptz | `NOW()` | 作成日時 |
| `updated_at` | timestamptz | `NOW()` | 更新日時（トリガーで自動更新） |
| `pattern_name` | text | - | パターン名（ユニーク） |
| `pattern_type` | text | - | パターンタイプ（trend/reversal/range等） |
| `symbol` | text | NULL | 通貨ペア（NULL=全通貨） |
| `timeframe` | text | NULL | タイムフレーム（NULL=全タイムフレーム） |
| `direction` | integer | NULL | 方向（1=BUY, -1=SELL, NULL=両方） |

### 条件範囲

| カラム | 説明 |
|--------|------|
| `rsi_min` | RSI最小値 |
| `rsi_max` | RSI最大値 |
| `atr_min` | ATR最小値 |
| `atr_max` | ATR最大値 |
| `ichimoku_score_min` | 一目スコア最小値 |
| `ichimoku_score_max` | 一目スコア最大値 |

### 統計情報

| カラム | 型 | デフォルト | 説明 |
|--------|-----|-----------|------|
| `total_trades` | integer | 0 | 総取引数 |
| `win_count` | integer | 0 | 勝ち数 |
| `loss_count` | integer | 0 | 負け数 |
| `win_rate` | double precision | 0.0 | 勝率（0.0～1.0） |
| `avg_profit` | double precision | 0.0 | 平均利益 |
| `avg_loss` | double precision | 0.0 | 平均損失 |
| `profit_factor` | double precision | 0.0 | プロフィットファクター |
| `confidence_score` | double precision | 0.0 | 信頼度スコア |
| `sample_size_adequate` | boolean | false | サンプル数十分フラグ |
| `is_active` | boolean | true | アクティブフラグ |

### インデックス

- `ml_patterns_pkey` (PRIMARY KEY): `id`
- `ml_patterns_pattern_name_key` (UNIQUE): `pattern_name`
- `idx_ml_patterns_symbol`: `symbol`
- `idx_ml_patterns_win_rate`: `win_rate DESC`
- `idx_ml_patterns_updated_at`: `updated_at DESC`
- `idx_ml_patterns_active`: `is_active`

### 用途

- パターン認識
- 自動最適化
- 高勝率パターンの発見
- リスク管理

---

## 4. `ml_recommendations` - ML推奨テーブル

**役割**: ML学習から生成された改善提案

### カラム構成

| カラム | 型 | デフォルト | 説明 |
|--------|-----|-----------|------|
| `id` | bigint | 自動採番 | 主キー |
| `created_at` | timestamptz | `NOW()` | 作成日時 |
| `recommendation_type` | text | - | 推奨タイプ（entry/exit/parameter/risk等） |
| `priority` | text | 'medium' | 優先度（high/medium/low） |
| `title` | text | - | 推奨タイトル |
| `description` | text | NULL | 詳細説明 |
| `based_on_pattern_id` | bigint | NULL | 基になったパターンID（外部キー） |
| `supporting_data` | jsonb | NULL | サポートデータ（JSON） |
| `expected_win_rate_improvement` | double precision | NULL | 期待勝率改善（%） |
| `expected_profit_improvement` | double precision | NULL | 期待利益改善（%） |
| `status` | text | 'active' | ステータス（active/applied/dismissed） |
| `applied_at` | timestamptz | NULL | 適用日時 |
| `dismissed_at` | timestamptz | NULL | 却下日時 |
| `training_history_id` | bigint | NULL | 学習履歴ID（外部キー） |

### インデックス

- `ml_recommendations_pkey` (PRIMARY KEY): `id`
- `idx_ml_recommendations_created_at`: `created_at DESC`
- `idx_ml_recommendations_priority`: `priority`
- `idx_ml_recommendations_status`: `status`

### 外部キー

- `based_on_pattern_id` → `ml_patterns(id)`
- `training_history_id` → `ml_training_history(id)`

### 用途

- 自動最適化提案
- パフォーマンス改善
- A/Bテスト候補の生成
- パラメータチューニング

---

## 5. `ml_training_history` - ML学習履歴テーブル

**役割**: ML学習の実行履歴とインサイト

### カラム構成

| カラム | 型 | デフォルト | 説明 |
|--------|-----|-----------|------|
| `id` | bigint | 自動採番 | 主キー |
| `created_at` | timestamptz | `NOW()` | 作成日時 |
| `training_type` | text | - | 学習タイプ（pattern_discovery/optimization等） |
| `duration_ms` | integer | NULL | 実行時間（ミリ秒） |
| `total_signals_analyzed` | integer | 0 | 分析したシグナル数 |
| `complete_trades_count` | integer | 0 | 完了取引数 |
| `patterns_discovered` | integer | 0 | 発見パターン数 |
| `patterns_updated` | integer | 0 | 更新パターン数 |
| `overall_win_rate` | double precision | NULL | 全体勝率 |
| `best_pattern_win_rate` | double precision | NULL | 最高パターン勝率 |
| `worst_pattern_win_rate` | double precision | NULL | 最低パターン勝率 |
| `insights` | jsonb | NULL | インサイト（JSON） |
| `recommendations` | jsonb | NULL | 推奨事項（JSON） |
| `status` | text | 'completed' | ステータス（completed/failed/running） |
| `error_message` | text | NULL | エラーメッセージ |
| `version` | text | NULL | バージョン |
| `triggered_by` | text | NULL | トリガー（cron/manual） |

### インデックス

- `ml_training_history_pkey` (PRIMARY KEY): `id`
- `idx_ml_training_history_created_at`: `created_at DESC`
- `idx_ml_training_history_status`: `status`

### 用途

- 学習進捗監視
- パフォーマンス追跡
- デバッグ
- 学習効果の分析

---

## 🔄 テーブル間の関係

```
MT5 EA
  ↓
ea-log (リアルタイムログ)
  ↓
ai_signals (詳細データ) ← ML学習のメインソース
  ↓
ml_training_history (学習実行) ← cronで定期実行
  ↓
ml_patterns (パターン発見) ← ai_signalsから統計生成
  ↓
ml_recommendations (改善提案) ← patternsから生成
  ↓
(手動/自動でEAパラメータに反映)
```

---

## 📈 データフロー

### 1. 取引発生時
```
MT5 EA
  ↓ (HTTP POST)
ea-log + ai_signals
  ↓
リアルタイム監視
```

### 2. 定期学習（cron: 6時間ごと）
```
ml_training_history (実行開始)
  ↓
ai_signals (完了取引を分析)
  ↓
ml_patterns (パターン更新/新規作成)
  ↓
ml_recommendations (改善提案生成)
  ↓
ml_training_history (結果記録)
```

### 3. パラメータ最適化
```
ml_recommendations
  ↓ (確認)
手動適用 or 自動適用
  ↓
MT5 EA パラメータ変更
  ↓
効果測定
```

---

## 🎯 よく使うクエリ

### 最新の取引を確認
```sql
SELECT 
  created_at,
  sym,
  action,
  win_prob,
  ai_reasoning
FROM "ea-log"
ORDER BY created_at DESC
LIMIT 10;
```

### 勝率を計算
```sql
SELECT 
  COUNT(*) as total,
  COUNT(*) FILTER (WHERE actual_result = 'WIN') as wins,
  ROUND(
    COUNT(*) FILTER (WHERE actual_result = 'WIN')::numeric / 
    COUNT(*) * 100, 2
  ) as win_rate
FROM ai_signals
WHERE actual_result IN ('WIN', 'LOSS');
```

### 高勝率パターンを取得
```sql
SELECT 
  pattern_name,
  win_rate,
  total_trades,
  profit_factor
FROM ml_patterns
WHERE sample_size_adequate = true
  AND is_active = true
ORDER BY win_rate DESC
LIMIT 10;
```

### 最新のML学習結果を確認
```sql
SELECT 
  created_at,
  training_type,
  duration_ms,
  patterns_discovered,
  overall_win_rate,
  status
FROM ml_training_history
ORDER BY created_at DESC
LIMIT 5;
```

### MLパターン使用状況の確認（2025-10-28追加）
```sql
-- MLパターン使用 vs 非使用の勝率比較
SELECT 
  CASE 
    WHEN ml_pattern_used THEN 'ML Pattern Used'
    ELSE 'Traditional'
  END as method,
  COUNT(*) as total_trades,
  ROUND(AVG(CASE WHEN actual_result = 'WIN' THEN 1 ELSE 0 END) * 100, 2) as win_rate,
  ROUND(AVG(profit_loss), 2) as avg_profit_loss,
  ROUND(SUM(profit_loss), 2) as total_profit_loss
FROM ai_signals
WHERE actual_result IN ('WIN', 'LOSS')
GROUP BY ml_pattern_used
ORDER BY win_rate DESC;
```

### パターン別パフォーマンス分析
```sql
-- 各MLパターンの詳細パフォーマンス
SELECT 
  s.ml_pattern_name,
  s.ml_pattern_confidence as expected_win_rate,
  COUNT(*) as trades,
  ROUND(AVG(CASE WHEN s.actual_result = 'WIN' THEN 1 ELSE 0 END) * 100, 2) as actual_win_rate,
  ROUND(AVG(s.profit_loss), 2) as avg_pl,
  ROUND(SUM(s.profit_loss), 2) as total_pl,
  p.total_trades as pattern_total_trades,
  p.win_rate * 100 as pattern_registered_win_rate
FROM ai_signals s
LEFT JOIN ml_patterns p ON s.ml_pattern_id = p.id
WHERE s.ml_pattern_used = true
  AND s.actual_result IN ('WIN', 'LOSS')
GROUP BY s.ml_pattern_name, s.ml_pattern_confidence, p.total_trades, p.win_rate
HAVING COUNT(*) >= 3
ORDER BY actual_win_rate DESC, trades DESC;
```

### MLパターンの信頼性検証
```sql
-- 期待勝率と実際の勝率の差分分析（過学習チェック）
SELECT 
  ml_pattern_name,
  ml_pattern_confidence as expected_win_rate,
  ROUND(AVG(CASE WHEN actual_result = 'WIN' THEN 1 ELSE 0 END) * 100, 2) as actual_win_rate,
  ROUND(
    AVG(CASE WHEN actual_result = 'WIN' THEN 1 ELSE 0 END) * 100 - ml_pattern_confidence,
    2
  ) as win_rate_diff,
  COUNT(*) as sample_size
FROM ai_signals
WHERE ml_pattern_used = true
  AND actual_result IN ('WIN', 'LOSS')
  AND ml_pattern_confidence IS NOT NULL
GROUP BY ml_pattern_name, ml_pattern_confidence
HAVING COUNT(*) >= 5
ORDER BY ABS(AVG(CASE WHEN actual_result = 'WIN' THEN 1 ELSE 0 END) * 100 - ml_pattern_confidence) ASC;
```


---

## 📝 メンテナンス

### パフォーマンス最適化
- 定期的に`VACUUM ANALYZE`を実行
- 古いログの`ea-log`は定期削除（例: 30日以上前）
- `ai_signals`は完了取引のみ保持（未完了は90日後削除）

### バックアップ
- 毎日自動バックアップ（Supabase標準機能）
- 重要なマイグレーション前は手動バックアップ

### モニタリング
- `ml_training_history`の`status='failed'`をチェック
- `ai_signals`の未完了取引（古いもの）をチェック
- インデックスの使用状況を確認
- **MLパターン使用率**をモニタリング（`ml_pattern_used`の割合）
- **MLパターンの精度**を定期確認（期待勝率 vs 実際の勝率）

### データ整合性チェック
```sql
-- MLパターンIDの整合性確認
SELECT COUNT(*) as orphaned_records
FROM ai_signals
WHERE ml_pattern_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM ml_patterns WHERE id = ai_signals.ml_pattern_id
  );
```

---

## 📚 関連ドキュメント

- [QUICK_START.md](QUICK_START.md) - セットアップガイド
- [ML_PATTERN_TRACKING.md](ML_PATTERN_TRACKING.md) - MLパターントラッキング機能詳細 **(NEW)**
- [DATABASE_TABLES_GUIDE.md](archive/old_docs/) - 旧ガイド（アーカイブ）
- [ML_LEARNING_SETUP.md](archive/old_docs/) - ML学習設定（アーカイブ）

---

**最終更新**: 2025年10月28日（MLパターントラッキング機能追加）
**データベースバージョン**: PostgreSQL 15.x (Supabase)
**テーブル数**: 5
**最新機能**: MLパターン使用状況トラッキング（`ml_pattern_used`, `ml_pattern_id`, `ml_pattern_name`, `ml_pattern_confidence`）
