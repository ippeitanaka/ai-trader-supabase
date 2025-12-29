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
```

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
