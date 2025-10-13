# MT5 Expert Advisor (EA)

このディレクトリにはMetaTrader 5用のExpert Advisor（自動売買プログラム）が格納されています。

## ファイル

- `AI_TripleFusion_EA.mq5` - AI統合型トレーディングEA（バージョン 1.2.2）

## 概要

このEAは以下の機能を持っています：

- **Supabase統合**: 
  - `ai-trader` - AIエンドポイントとの連携
  - `ai-config` - 動的設定の取得
  - `ea-log` - トレードログの記録

- **テクニカル分析**:
  - RSI指標
  - ATR（Average True Range）
  - 移動平均線（EMA/SMA）

- **トレード戦略**:
  - M15足でエントリーシグナルを検出
  - H1足で再検証
  - AI推論による勝率判定
  - 指値注文（Limit Order）による待機エントリー

## 設定パラメータ

主要な設定項目：

- `MinWinProb`: 最小勝率閾値（デフォルト: 0.75）
- `RiskATRmult`: リスク管理用ATR倍率（デフォルト: 1.5）
- `RewardRR`: リスクリワード比率（デフォルト: 1.2）
- `Lots`: ロットサイズ（デフォルト: 0.10）
- `Magic`: マジックナンバー（デフォルト: 26091501）

## セットアップ

1. MetaTrader 5を開く
2. `AI_TripleFusion_EA.mq5`をMetaEditorで開く
3. URLとBearer Tokenを自分のSupabaseプロジェクトに合わせて設定：
   ```mql5
   input string AI_Endpoint_URL = "https://YOUR_PROJECT.functions.supabase.co/ai-trader";
   input string EA_Log_URL = "https://YOUR_PROJECT.functions.supabase.co/ea-log";
   input string AI_Config_URL = "https://YOUR_PROJECT.functions.supabase.co/ai-config";
   input string AI_Bearer_Token = "YOUR_SERVICE_ROLE_KEY";
   ```
4. コンパイルしてチャートに適用

## 注意事項

- WebRequestを使用するため、MT5の設定でURLを許可リストに追加する必要があります
- リアル口座で使用する前に、必ずデモ口座で十分なテストを行ってください
- Bearer Tokenは秘密情報として厳重に管理してください

## バージョン履歴

- **1.2.2** - POST時の末尾NUL(0x00)除去対応
