# EA-LOG Enhanced - AI判断とトレード状況の可視化

## 概要

EA v1.2.5から、`ea-log`テーブルが大幅に強化され、AIの判断とトレード実行状況が一目で分かるようになりました。

## 新しいカラム

| カラム名 | 型 | 説明 |
|----------|-----|------|
| `ai_confidence` | TEXT | AI信頼度レベル: `high` (≥75%), `medium` (60-74%), `low` (<60%) |
| `ai_reasoning` | TEXT | AIが判断した理由（日本語）OpenAI GPTからの説明 |
| `trade_decision` | TEXT | トレード実行状態（後述） |
| `threshold_met` | BOOLEAN | MinWinProb閾値をクリアしたか |
| `current_positions` | INTEGER | シグナル発生時の現在ポジション数 |
| `order_ticket` | BIGINT | 実行されたMT5注文チケット番号 |

### trade_decision の値

| 値 | 意味 |
|----|------|
| `EXECUTED` | 注文が実行された（閾値クリア＆ポジション枠あり） |
| `SKIPPED_LOW_PROB` | 勝率が閾値未達でスキップ |
| `SKIPPED_MAX_POS` | 最大ポジション数に達しているためスキップ |
| `HOLD` | ニュートラル（方向なし）のためホールド |
| `RECHECK_OK` | H1再チェックで問題なし |
| `CANCELLED_REVERSAL` | H1再チェックでトレンド反転により注文キャンセル |

## 便利なビュー: ea_log_summary

わかりやすい形式で表示するビューが自動作成されます：

```sql
SELECT * FROM ea_log_summary 
ORDER BY at DESC 
LIMIT 20;
```

### 表示カラム

- `symbol` - 銘柄
- `timeframe` - 時間軸
- `direction` - BUY/SELL/HOLD
- `win_rate` - 勝率（%表示）
- `confidence` - AI信頼度
- `trade_status` - トレード状況
- `threshold` - 閾値クリア（✓/✗）
- `positions` - 現在のポジション数
- `ticket` - 注文チケット番号
- `reasoning` - AI判断理由
- `technical_reason` - テクニカル理由（MA↑など）

## 使用例

### 1. 最近のAI判断を確認

```sql
SELECT 
  at,
  sym,
  action AS direction,
  ROUND(win_prob * 100, 1) || '%' AS win_rate,
  ai_confidence,
  trade_decision,
  ai_reasoning
FROM "ea-log"
WHERE at > NOW() - INTERVAL '1 hour'
ORDER BY at DESC;
```

### 2. 実行されたトレードのみを表示

```sql
SELECT * FROM ea_log_summary
WHERE trade_status = 'EXECUTED'
ORDER BY at DESC
LIMIT 10;
```

### 3. スキップされた高勝率シグナルを確認

```sql
SELECT 
  at,
  sym,
  ROUND(win_prob * 100, 1) || '%' AS win_rate,
  trade_decision,
  ai_reasoning,
  current_positions
FROM "ea-log"
WHERE trade_decision IN ('SKIPPED_LOW_PROB', 'SKIPPED_MAX_POS')
  AND win_prob >= 0.65
ORDER BY at DESC
LIMIT 20;
```

### 4. AI信頼度別の統計

```sql
SELECT 
  ai_confidence,
  COUNT(*) as count,
  AVG(win_prob) as avg_win_prob,
  SUM(CASE WHEN trade_decision = 'EXECUTED' THEN 1 ELSE 0 END) as executed_count
FROM "ea-log"
WHERE at > NOW() - INTERVAL '24 hours'
GROUP BY ai_confidence
ORDER BY ai_confidence;
```

### 5. 銘柄別のAI判断サマリー

```sql
SELECT 
  sym,
  COUNT(*) as total_signals,
  AVG(win_prob) as avg_win_prob,
  COUNT(CASE WHEN trade_decision = 'EXECUTED' THEN 1 END) as executed,
  COUNT(CASE WHEN trade_decision = 'SKIPPED_LOW_PROB' THEN 1 END) as skipped_low_prob,
  COUNT(CASE WHEN trade_decision = 'SKIPPED_MAX_POS' THEN 1 END) as skipped_max_pos
FROM "ea-log"
WHERE at > NOW() - INTERVAL '24 hours'
GROUP BY sym
ORDER BY total_signals DESC;
```

## データベース マイグレーション

### 適用方法

1. Supabase Dashboard → SQL Editor
2. 以下のマイグレーションファイルを実行：
   ```
   supabase/migrations/20251014_002_enhance_ea_log_table.sql
   ```

または、Supabase CLIで：

```bash
supabase db push
```

## EA側の実装 (v1.2.5)

### 新機能

1. **AIレスポンスの拡張**
   - `confidence` - AI信頼度レベル
   - `reasoning` - AIの判断理由（日本語）

2. **詳細なログ記録**
   - `LogAIDecision()` 関数で全情報を記録
   - トレード判定理由も記録

3. **JSON文字列抽出**
   - `ExtractJsonString()` 関数を追加
   - AIからの日本語テキストを正しく抽出

### ログ記録のタイミング

- M15新バー → AI予測 → トレード判定 → **ea-logに記録**
- H1再チェック → AI予測 → 継続/キャンセル判定 → **ea-logに記録**

## Edge Function側の実装 (ai-trader v2.0.0)

### 応答形式

```json
{
  "win_prob": 0.75,
  "action": 1,
  "offset_factor": 0.25,
  "expiry_minutes": 90,
  "confidence": "high",
  "reasoning": "RSIが売られすぎであり、ボラティリティが高いためトレンドが明確である。"
}
```

### confidenceレベルの決定（OpenAI GPT）

- `high` - 勝率 ≥ 75%
- `medium` - 勝率 60-74%
- `low` - 勝率 < 60%

## 監視ダッシュボード例

Supabaseダッシュボードで以下のSQLをブックマーク：

```sql
-- リアルタイム監視
SELECT 
  TO_CHAR(at, 'HH24:MI:SS') as time,
  sym,
  tf,
  action,
  ROUND(win_prob * 100) || '%' as win,
  ai_confidence as conf,
  trade_decision as status,
  SUBSTRING(ai_reasoning, 1, 50) as reason
FROM "ea-log"
WHERE at > NOW() - INTERVAL '30 minutes'
ORDER BY at DESC;
```

## トラブルシューティング

### ai_reasoning が空

**原因**: OpenAI APIのレスポンスに`reasoning`フィールドがない

**対処**:
1. Edge Functionのログを確認
2. OpenAI APIキーが正しく設定されているか確認
3. フォールバック計算を使用している場合は`reasoning`が記録されない（仕様）

### confidence が "unknown"

**原因**: AI応答から`confidence`フィールドを抽出できない

**対処**: Edge Functionのログで生のAI応答を確認

### trade_decision が常に "SKIPPED_LOW_PROB"

**原因**: `MinWinProb`閾値が高すぎる

**対処**:
```sql
-- 最近の勝率分布を確認
SELECT 
  ROUND(win_prob * 100 / 5) * 5 as win_rate_bucket,
  COUNT(*) as count
FROM "ea-log"
WHERE at > NOW() - INTERVAL '24 hours'
GROUP BY win_rate_bucket
ORDER BY win_rate_bucket DESC;
```

## バージョン履歴

- **v1.2.5** (2025-10-14)
  - ea-logテーブル強化
  - AI判断とトレード状況の詳細記録
  - `LogAIDecision()` 関数追加
  - `ea_log_summary` ビュー作成

## 関連ドキュメント

- [AI_IMPLEMENTATION.md](./AI_IMPLEMENTATION.md) - AI実装の詳細
- [AI_LOGGING_GUIDE.md](./AI_LOGGING_GUIDE.md) - ログ出力ガイド
- [OPENAI_DEPLOYMENT.md](./OPENAI_DEPLOYMENT.md) - OpenAI統合のデプロイ手順
