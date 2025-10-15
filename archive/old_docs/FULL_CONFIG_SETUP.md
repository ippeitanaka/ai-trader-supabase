# 全パラメータSupabase管理セットアップガイド

## 概要
EAの全パラメータをSupabaseで一元管理し、MT5のプロパティ設定なしで動的に制御できるようにします。

## セットアップ手順

### 1. データベーステーブルの拡張

ai_configテーブルに新しいカラムを追加します：

```bash
# Supabase SQL Editorで実行
cat expand_ai_config_table.sql
```

または、Supabase Dashboardから直接実行：

```sql
-- ai_configテーブルに全パラメータカラムを追加
ALTER TABLE ai_config
ADD COLUMN IF NOT EXISTS risk_atr_mult NUMERIC DEFAULT 2.0,
ADD COLUMN IF NOT EXISTS reward_rr NUMERIC DEFAULT 2.0,
ADD COLUMN IF NOT EXISTS lots NUMERIC DEFAULT 0.01,
ADD COLUMN IF NOT EXISTS slippage_points INTEGER DEFAULT 30,
ADD COLUMN IF NOT EXISTS magic INTEGER DEFAULT 123456,
ADD COLUMN IF NOT EXISTS max_positions INTEGER DEFAULT 1,
ADD COLUMN IF NOT EXISTS lock_to_chart_symbol BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS tf_entry TEXT DEFAULT 'PERIOD_M15',
ADD COLUMN IF NOT EXISTS tf_recheck TEXT DEFAULT 'PERIOD_H1',
ADD COLUMN IF NOT EXISTS debug_logs BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS log_cooldown_sec INTEGER DEFAULT 10;
```

### 2. デフォルト設定の挿入

```bash
# insert_default_config.sqlを実行
```

これにより3つのプリセットが作成されます：
- **main**: バランス型（70%勝率閾値、2ATRリスク）
- **conservative**: 保守的（75%勝率閾値、1.5ATRリスク）
- **aggressive**: アグレッシブ（65%勝率閾値、2.5ATRリスク）

### 3. Edge Functionのデプロイ

ai-config Edge Functionを再デプロイします：

```bash
cd /workspaces/ai-trader-supabase
supabase functions deploy ai-config
```

### 4. EAの再コンパイルと起動

1. MT5で `AI_TripleFusion_EA.mq5` を再コンパイル
2. チャートに適用
3. プロパティで `AI_EA_Instance` を設定（例：`main`）
4. 他のパラメータはSupabaseで管理されるため変更不要

## 管理されるパラメータ一覧

| パラメータ | 説明 | デフォルト値 |
|-----------|------|------------|
| min_win_prob | 最低勝率閾値 (%) | 70.0 |
| risk_atr_mult | SL距離 (ATR倍率) | 2.0 |
| reward_rr | リスクリワード比率 | 2.0 |
| pending_offset_atr | 指値オフセット (ATR倍率) | 1.5 |
| pending_expiry_min | 指値有効期限 (分) | 120 |
| lots | ロットサイズ | 0.01 |
| slippage_points | スリッページ許容 (ポイント) | 30 |
| magic | マジックナンバー | 123456 |
| max_positions | 最大同時ポジション数 | 1 |
| lock_to_chart_symbol | チャートシンボル限定 | false |
| tf_entry | エントリー時間軸 | PERIOD_M15 |
| tf_recheck | 再確認時間軸 | PERIOD_H1 |
| debug_logs | デバッグログ | false |
| log_cooldown_sec | ログクールダウン (秒) | 10 |

## 運用時の設定変更

### Supabase Dashboardから変更

1. Supabase Dashboard → Table Editor
2. `ai_config` テーブルを開く
3. `main` レコードを編集
4. 変更を保存

### SQLで変更

```sql
-- 最低勝率を75%に変更
UPDATE ai_config 
SET min_win_prob = 75.0, updated_at = NOW() 
WHERE instance = 'main';

-- ロットサイズを0.02に変更
UPDATE ai_config 
SET lots = 0.02, updated_at = NOW() 
WHERE instance = 'main';

-- 最大ポジション数を2に変更
UPDATE ai_config 
SET max_positions = 2, updated_at = NOW() 
WHERE instance = 'main';
```

### 変更の反映タイミング

- EAはH1の新しいバーで設定を自動再同期します
- 即座に反映させたい場合はEAを再起動してください

## 動作確認

### ログでの確認

EAのログで設定が正しく同期されているか確認：

```
[CONFIG] sync -> MinWinProb=70.00, Risk=2.00, RR=2.00, Offset=1.50, Expiry=120, Lots=0.01, Slip=30, MaxPos=1
```

### 設定の確認

```sql
-- 現在の設定を確認
SELECT * FROM ai_config WHERE instance = 'main';
```

## トラブルシューティング

### 設定が反映されない

1. Edge Functionが正しくデプロイされているか確認
2. EA_Config_URLが正しいか確認
3. instanceパラメータがai_configテーブルのレコードと一致しているか確認
4. EAログで[CONFIG] syncメッセージを確認

### 意図しない値が使用される

- ai_configテーブルに該当instanceのレコードがない場合、EAはinputパラメータの値を使用します
- insert_default_config.sqlが正しく実行されたか確認してください

## 利点

1. **リアルタイム変更**: EA再起動なしでパラメータ変更可能（H1バーで自動同期）
2. **一元管理**: 複数のEAインスタンスを一箇所から管理
3. **履歴追跡**: updated_atカラムで変更履歴を追跡
4. **プリセット**: 複数の戦略プリセットを簡単に切り替え
5. **バックアップ**: データベースでパラメータ設定をバックアップ

## 次のステップ

1. SQLファイルを実行してテーブルを拡張
2. Edge Functionを再デプロイ
3. EAを再コンパイル・再起動
4. ログで設定同期を確認
5. 運用開始

これで全パラメータがSupabaseで管理されます！
