# AI Trader Supabase

AI駆動の自動トレーディングシステム（MT5 EA + Supabase Edge Functions）

## 🚀 クイックスタート

詳細は [QUICK_START.md](QUICK_START.md) を参照してください。

## 📊 現在の成績（2025年10月27日）

- **総取引**: 97回 | **勝率**: 50.52% (49勝48敗)
- **PF**: 1.51 | **RR**: 1.48x | **期待値**: 5,438円/取引
- **総利益**: 526,963円

## 🛠️ 便利なスクリプト

```bash
./health_check.sh              # システムチェック
./monitor_trades.sh            # 取引監視
./check_winrate_improvement.sh # 勝率確認
./verify_sma_working.sh        # SMA200/800確認
./ml_training.sh               # ML学習実行
DRY_RUN=true RETENTION_DAYS=120 SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... bash scripts/monthly_cleanup_ea_log.sh # ea-log月次削除の事前確認
```

## 🧹 月次クリーンアップ（ea-logのみ）

- GitHub Actions: `.github/workflows/ea-log-monthly-cleanup.yml`
- 既定: 毎月1日 UTC 02:15（JST 11:15）に `public."ea-log"` の120日超のみ削除
- `ai_signals` は対象外（ML学習・確定申告用の実取引データを保持）

## 🚨 緊急停止（新規ポジション停止/再開）

- GitHub Actions: `.github/workflows/emergency-stop.yml`
- 手動実行で `mode=stop` を選ぶと、新規発注判定を停止（`ai-trader` が `action=0` を返却）
- `mode=resume` で通常運用に復帰
- 注: 既存ポジションの強制クローズは対象外（新規停止専用）

## 📁 ディレクトリ構造

```
├── supabase/
│   ├── functions/    # Edge Functions (ai-trader, ai-signals, ea-log, ml-training)
│   └── migrations/   # DBマイグレーション
├── mt5/
│   └── AwajiSamurai_AI_2.0.mq5  # MT5 EA
└── *.sh              # 運用スクリプト
```

## 🎯 AI・ML機能

- GPT-4o-mini市場分析
- 複数時間足テクニカル分析（M5/M15/M30/H1/H4/D1）
- 移動平均トレンド判断（SMA5/25/75/200/800）
- ハイブリッド学習システム（現在PHASE 2: 31-1000取引）
- 自動パターン認識と学習
