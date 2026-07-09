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

# 現在相性の良いペアの選定結果を確認
curl "$SUPABASE_URL/functions/v1/pair-selector" \
	-H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY"

# ブラウザでローカル専用ビューアを開く
echo "docs/pair-selector.html"
```

## 🧹 月次クリーンアップ（ea-logのみ）

- GitHub Actions: `.github/workflows/ea-log-monthly-cleanup.yml`
- 既定: 毎月1日 UTC 02:15（JST 11:15）に `public."ea-log"` の120日超のみ削除
- `ai_signals` は対象外（ML学習・確定申告用の実取引データを保持）

## 📌 推奨ペア選定

- GitHub Actions: `.github/workflows/pair-selection-daily.yml`
- 毎日 UTC 22:00（JST 07:00）に `pair-selector` 関数を実行し、最新の推奨ペアを `pair_selection_reports` に保存
- GET `/functions/v1/pair-selector` で最新レポートを確認可能
- POST/GET の応答には `digest_text` / `digest_lines` / `digest` が含まれ、通知や転記に使える要約を取得可能
- 日次レポートには `trade_plan` が含まれ、銘柄ごとの許可方向、戦略、稼働セッション、イベント回避時間、勝率/コストゲートを `ai-trader` とWebダッシュボードで共有
- `supabase/migrations/20260709_001_add_daily_trade_plan.sql` 適用後、EAが送信する上位足コンテキスト、主要レベル距離、スイング構造、相対ボラティリティ、コスト文脈、日次計画との整合性を `ai_signals` / `ea-log` に保存
- ブラウザ表示用: `docs/pair-selector.html` をブラウザで開く
- 補足: Supabase Edge Functionの公開ゲートウェイではHTMLが `text/plain` 扱いになるため、表示ビューはローカルHTML + 公開JSON APIで構成
- 新しい根拠: 直近の実トレード実績に加えて、外部ニュース見出し、ドル指数、米10年金利、VIX、各銘柄の5日/1時間スナップショットを取り込み、現在の市場反応も選定理由に反映
- 任意強化: `FINNHUB_API_KEY` を Supabase secret / GitHub secret に設定すると、経済イベントの `actual` を取り込み、recent event の surprise 判定を強化可能
- GitHub Actions の任意通知: `PAIR_SELECTOR_SLACK_WEBHOOK_URL` を GitHub Secret に設定すると、日次 workflow が `digest_lines` を Slack Block Kit 形式で Slack Incoming Webhook に送信

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

- GPT-4.1-mini市場分析
- 複数時間足テクニカル分析（M5/M15/M30/H1/H4/D1）
- 移動平均トレンド判断（SMA5/25/75/200/800）
- ハイブリッド学習システム（現在PHASE 2: 31-1000取引）
- 自動パターン認識と学習
