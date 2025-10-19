# 📊 データベーステーブル構造ガイド

このドキュメントでは、AI Trader システムで使用される全てのSupabaseテーブルの役割と構造を説明します。

## 📑 目次

- [概要](#概要)
- [主要テーブル](#主要テーブル)
  - [1. ea_log (EA実行ログ)](#1-ea_log-ea実行ログ)
  - [2. ai_config (AI設定)](#2-ai_config-ai設定)
  - [3. ai_signals (AI取引記録)](#3-ai_signals-ai取引記録-最重要)
- [ML学習テーブル](#ml学習テーブル)
  - [4. ml_patterns (ML学習済みパターン)](#4-ml_patterns-ml学習済みパターン)
  - [5. ml_training_history (ML学習履歴)](#5-ml_training_history-ml学習履歴)
  - [6. ml_recommendations (ML推奨事項)](#6-ml_recommendations-ml推奨事項)
- [データフロー](#データフロー)
- [重要度ランキング](#重要度ランキング)

---

## 概要

システムには **6つのテーブル** があります：

- **主要テーブル（3つ）**: コアシステムの動作に必要
- **ML学習テーブル（3つ）**: 機械学習システムで使用

---

## 主要テーブル

### 1. ea_log (EA実行ログ)

**目的**: MT5 EA の動作ログとAI判断の詳細を記録

#### 主要カラム

| カラム名 | 型 | 説明 |
|---------|-----|------|
| `id` | bigint | 自動採番ID（主キー） |
| `at` | timestamptz | 記録日時 |
| `sym` | text | 通貨ペア（例: USDJPY） |
| `tf` | text | 時間足（例: M15, H1） |
| `rsi` | numeric | RSI値 |
| `atr` | numeric | ATR値（ボラティリティ） |
| `price` | numeric | 価格 |
| `action` | text | 判断（BUY / SELL / HOLD） |
| `win_prob` | numeric | AI予測勝率 |
| `ai_confidence` | text | AI信頼度（high / medium / low） |
| `ai_reasoning` | text | AI判断理由 |
| `trade_decision` | text | 取引決定（EXECUTED / SKIPPED / CANCELLED） |
| `threshold_met` | boolean | 閾値達成フラグ |
| `current_positions` | integer | 現在のポジション数 |
| `order_ticket` | bigint | 注文チケット番号 |
| `reason` | text | EA側の判断理由 |
| `instance` | text | EA インスタンス名 |
| `version` | text | EA バージョン |
| `caller` | text | 呼び出し元（M15 / H1） |

#### 使用シーン

- ✅ AI判断の履歴確認
- ✅ デバッグ・トラブルシューティング
- ✅ システム動作の監視
- ✅ 閾値を満たさなかった取引の記録

#### データ例

```json
{
  "at": "2025-10-17 13:00:00",
  "sym": "USDJPY",
  "tf": "M15",
  "rsi": 52.3,
  "action": "BUY",
  "win_prob": 0.85,
  "ai_reasoning": "MA↑+一目買, RSI中立",
  "trade_decision": "EXECUTED",
  "order_ticket": 123456789
}
```

---

### 2. ai_config (AI設定)

**目的**: AIトレーダーの設定を管理

> ⚠️ **注意**: 現在は使用停止。EAプロパティで直接設定する方式に移行済み。将来的に削除予定。

#### 主要カラム

| カラム名 | 型 | 説明 |
|---------|-----|------|
| `id` | bigint | 自動採番ID（主キー） |
| `instance` | text | インスタンス名 |
| `min_win_prob` | numeric | 最小勝率閾値 |
| `risk_atr_mult` | numeric | リスク倍率 |
| `reward_rr` | numeric | リスクリワード比 |
| `pending_offset_atr` | numeric | 待機注文オフセット |
| `pending_expiry_min` | integer | 待機注文有効期限（分） |
| `lots` | numeric | ロット数 |
| `slippage_points` | integer | スリッページ許容（ポイント） |
| `max_positions` | integer | 最大ポジション数 |
| `is_active` | boolean | 有効フラグ |
| `updated_at` | timestamptz | 更新日時 |

---

### 3. ai_signals (AI取引記録) ⭐**最重要**⭐

**目的**: 実際の取引とその結果を記録。ML学習の基礎データソース。

#### 主要カラム

##### シグナル情報

| カラム名 | 型 | 説明 |
|---------|-----|------|
| `id` | bigint | 自動採番ID（主キー） |
| `created_at` | timestamptz | シグナル発生日時 |
| `symbol` | text | 通貨ペア |
| `timeframe` | text | 時間足 |
| `dir` | integer | 方向（1=買い, -1=売り） |
| `win_prob` | numeric | AI予測勝率 |
| `rsi` | numeric | RSI値 |
| `atr` | numeric | ATR値 |
| `price` | numeric | 価格 |
| `reason` | text | 判断理由 |
| `instance` | text | EA インスタンス |
| `model_version` | text | AIモデルバージョン |

##### 取引情報

| カラム名 | 型 | 説明 |
|---------|-----|------|
| `order_ticket` | bigint | MT5注文チケット |
| `entry_price` | numeric | 約定価格 |
| `exit_price` | numeric | 決済価格 |
| `profit_loss` | numeric | 損益 |

##### 結果情報

| カラム名 | 型 | 説明 |
|---------|-----|------|
| `actual_result` | text | 実際の結果（WIN / LOSS / BREAK_EVEN / CANCELLED） |
| `closed_at` | timestamptz | 決済日時 |
| `hold_duration_minutes` | integer | 保有時間（分） |
| `sl_hit` | boolean | ストップロス達成フラグ |
| `tp_hit` | boolean | テイクプロフィット達成フラグ |
| `cancelled_reason` | text | キャンセル理由 |

##### テクニカル指標（拡張）

| カラム名 | 型 | 説明 |
|---------|-----|------|
| `ema_25` | numeric | EMA25 |
| `sma_100` | numeric | SMA100 |
| `macd_main` | numeric | MACD メイン |
| `macd_signal` | numeric | MACD シグナル |
| `macd_histogram` | numeric | MACD ヒストグラム |
| `ichimoku_tenkan` | numeric | 一目均衡表: 転換線 |
| `ichimoku_kijun` | numeric | 一目均衡表: 基準線 |
| `ichimoku_senkou_a` | numeric | 一目均衡表: 先行スパンA |
| `ichimoku_senkou_b` | numeric | 一目均衡表: 先行スパンB |
| `ichimoku_chikou` | numeric | 一目均衡表: 遅行スパン |

#### 使用シーン

- ✅ **ML学習の基礎データ**（最重要）
- ✅ 実際の取引結果分析
- ✅ 勝率計算
- ✅ パターン抽出
- ✅ 成功/失敗事例の特定
- ✅ ML強化機能のデータソース

#### データフロー

```
1. MT5 EA がシグナル発生 
   → ai_signals に INSERT
   
2. 注文約定 
   → entry_price を UPDATE
   
3. ポジションクローズ 
   → actual_result, profit_loss を UPDATE
   
4. ml-training が定期的に分析 
   → パターン抽出
```

#### データ例

```json
{
  "created_at": "2025-10-17 13:00:00",
  "symbol": "USDJPY",
  "dir": 1,
  "win_prob": 0.85,
  "rsi": 52.3,
  "reason": "MA↑+一目買",
  "order_ticket": 123456789,
  "entry_price": 150.250,
  "exit_price": 150.120,
  "actual_result": "LOSS",
  "profit_loss": -1.30,
  "sl_hit": true,
  "hold_duration_minutes": 45
}
```

---

## ML学習テーブル

### 4. ml_patterns (ML学習済みパターン)

**目的**: 過去の取引から抽出した統計的パターンを保存。AIがこのデータを参照して判断を改善。

#### 主要カラム

##### パターン識別

| カラム名 | 型 | 説明 |
|---------|-----|------|
| `id` | bigint | 自動採番ID（主キー） |
| `pattern_name` | text | パターン名（例: "USDJPY_M15_RSI_neutral_Ichimoku_good"） |
| `symbol` | text | 通貨ペア |
| `timeframe` | text | 時間足 |
| `rsi_range` | text | RSI範囲（oversold / neutral / overbought） |
| `ichimoku_range` | text | 一目スコア範囲（conflicting / weak / moderate / good / excellent） |

##### 統計データ

| カラム名 | 型 | 説明 |
|---------|-----|------|
| `win_rate` | numeric | 勝率（0.0～1.0） |
| `total_trades` | integer | 総取引数 |
| `win_count` | integer | 勝ち数 |
| `loss_count` | integer | 負け数 |
| `avg_profit` | numeric | 平均利益 |
| `avg_loss` | numeric | 平均損失 |
| `profit_factor` | numeric | 利益率（avg_profit / avg_loss） |
| `max_drawdown` | numeric | 最大ドローダウン |

##### 信頼性

| カラム名 | 型 | 説明 |
|---------|-----|------|
| `confidence_score` | numeric | 信頼度スコア（0.0～1.0） |
| `sample_size_adequate` | boolean | サンプル数が十分か |
| `last_updated` | timestamptz | 最終更新日時 |
| `created_at` | timestamptz | 作成日時 |

#### 使用シーン

- ✅ ai-trader がパターンマッチングで参照（TOP 3取得）
- ✅ 勝率ブースト/ペナルティの判断材料
- ✅ OpenAIプロンプトに含めて判断材料提供
- ✅ ml-training が毎日更新

#### データ例

```json
{
  "pattern_name": "USDJPY_M15_RSI_neutral_Ichimoku_good",
  "symbol": "USDJPY",
  "timeframe": "M15",
  "rsi_range": "neutral",
  "ichimoku_range": "good",
  "win_rate": 0.65,
  "total_trades": 30,
  "win_count": 19,
  "loss_count": 11,
  "avg_profit": 2.50,
  "avg_loss": -1.80,
  "profit_factor": 1.39,
  "confidence_score": 0.75,
  "sample_size_adequate": true
}
```

---

### 5. ml_training_history (ML学習履歴)

**目的**: ML学習の実行履歴を記録。どのパターンが発見・更新されたかを追跡。

#### 主要カラム

| カラム名 | 型 | 説明 |
|---------|-----|------|
| `id` | bigint | 自動採番ID（主キー） |
| `trained_at` | timestamptz | 学習実行日時 |
| `patterns_discovered` | integer | 発見されたパターン数 |
| `patterns_updated` | integer | 更新されたパターン数 |
| `overall_win_rate` | numeric | 全体の勝率 |
| `insights` | jsonb | 洞察（JSON） |
| `triggered_by` | text | トリガー元（cron / manual） |
| `created_at` | timestamptz | 作成日時 |

#### 使用シーン

- ✅ ML学習の実行状況監視
- ✅ パターン発見の履歴確認
- ✅ 学習効果の評価
- ✅ デバッグ

#### データ例

```json
{
  "trained_at": "2025-10-19 03:00:00",
  "patterns_discovered": 5,
  "patterns_updated": 12,
  "overall_win_rate": 0.58,
  "insights": {
    "best_pattern": "USDJPY_M15_RSI_oversold_Ichimoku_excellent",
    "worst_pattern": "USDJPY_M15_RSI_overbought_Ichimoku_conflicting",
    "symbol_performance": {...}
  },
  "triggered_by": "cron"
}
```

---

### 6. ml_recommendations (ML推奨事項)

**目的**: MLが分析した推奨事項を保存。「このパターンは避けるべき」「このパターンを優先すべき」等。

#### 主要カラム

| カラム名 | 型 | 説明 |
|---------|-----|------|
| `id` | bigint | 自動採番ID（主キー） |
| `recommendation_type` | text | タイプ（favor_pattern / avoid_pattern） |
| `pattern_name` | text | 対象パターン名 |
| `symbol` | text | 通貨ペア |
| `timeframe` | text | 時間足 |
| `priority` | text | 優先度（high / medium / low） |
| `reason` | text | 理由 |
| `expected_improvement` | numeric | 期待改善率 |
| `active` | boolean | 有効フラグ |
| `created_at` | timestamptz | 作成日時 |
| `expires_at` | timestamptz | 有効期限 |

#### 使用シーン

- ✅ ai-trader が推奨事項を参照
- ✅ OpenAIプロンプトに含めて判断材料提供
- ✅ avoid_pattern の場合は勝率を下げる
- ✅ favor_pattern の場合は優先的に採用

#### データ例

```json
{
  "recommendation_type": "avoid_pattern",
  "pattern_name": "USDJPY_M15_RSI_overbought_Ichimoku_conflicting",
  "symbol": "USDJPY",
  "timeframe": "M15",
  "priority": "high",
  "reason": "過去20件中15件が損切り (勝率25%)",
  "expected_improvement": 0.15,
  "active": true
}
```

---

## データフロー

### リアルタイム（トレード実行時）

```
1. MT5 EA → ai-trader Edge Function 呼び出し
   ↓
2. ai-trader が以下を実行:
   • ml_patterns からTOP 3パターン取得 ⭐
   • ml_recommendations から推奨事項取得 ⭐
   • ai_signals から過去30件の取引履歴取得 ⭐
   • 成功事例3件、失敗事例3件を抽出 ⭐
   • OpenAIに全てのコンテキストを提供
   ↓
3. OpenAI が判断（win_prob, reasoning）
   ↓
4. ai-trader が勝率調整:
   • ml_patterns の勝率に基づいてブースト/ペナルティ
   • ml_recommendations に基づいて調整
   ↓
5. MT5 EA が取引実行判断
   • ea_log にログ記録
   • ai_signals にシグナル記録
   ↓
6. 取引結果が確定
   • ai_signals を更新（actual_result, profit_loss）
```

### 定期実行（毎日 UTC 3:00）

```
1. Cron Job → ml-training Edge Function 実行
   ↓
2. ml-training が以下を実行:
   • ai_signals から全取引データを分析
   • パターンを抽出（RSI範囲 × 一目スコア）
   • 統計計算（勝率、利益率、Profit Factor）
   ↓
3. ml_patterns テーブルを更新
   • 新しいパターン追加
   • 既存パターン更新
   ↓
4. ml_recommendations テーブルを更新
   • favor_pattern 生成（高勝率パターン）
   • avoid_pattern 生成（低勝率パターン）
   ↓
5. ml_training_history に履歴記録
```

---

## 重要度ランキング

### ⭐⭐⭐ 最重要

1. **ai_signals** - 全ての取引データの源泉、ML学習の基礎
2. **ml_patterns** - AIが参照する学習済みパターン

### ⭐⭐ 重要

3. **ml_recommendations** - AI判断の推奨事項
4. **ea_log** - システム動作の監視・デバッグ

### ⭐ 参考

5. **ml_training_history** - ML学習の履歴
6. **ai_config** - 現在は非推奨（将来削除予定）

---

## ML強化機能での使用

2025年10月19日に実装したML学習強化機能では、以下のテーブルを活用しています：

### ai-trader Edge Function が参照

- ✅ **ml_patterns** → TOP 3パターン取得（勝率、統計）
- ✅ **ml_recommendations** → favor/avoid 推奨事項取得
- ✅ **ai_signals** → 過去30件の取引履歴取得
  - 成功事例3件（WIN）
  - 失敗事例3件（LOSS）

これら全てをOpenAIに提示することで、過去の失敗から学習し、同じミスを繰り返さないシステムを実現しています。

---

## 関連ドキュメント

- [システム検証ガイド](./SYSTEM_VERIFICATION_COMPLETE.md)
- [ML学習セットアップガイド](./ML_LEARNING_SETUP.md)
- [Edge Function デプロイガイド](./EDGE_FUNCTION_DEPLOY.md)

---

**最終更新**: 2025-10-19  
**バージョン**: 1.0.0
