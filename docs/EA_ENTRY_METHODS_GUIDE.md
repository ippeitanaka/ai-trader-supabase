# EA 実装ガイド: pullback優先、marketフォールバック

本ガイドは、Edge Function `ai-trader` の判定結果を使って **浅い pullback 指値を優先し、必要時のみ成り行き（market）にフォールバック**する前提の実装ポイントをまとめたものです。

## 返却フィールド（ai-trader のレスポンス）
- entry_method: ai-trader は `market` を返すが、EA 側で `pullback` に切り替えて発注することがある
- entry_params: 常に `null`
- method_selected_by: `OpenAI` | `Fallback` | `Manual`（予測ソースの識別用）
- method_reason: 文字列（EA 側の pullback limit / market fallback を含む）

## 実装方針（MQL5）
- `UsePullbackEntry=true` のときは `PendingOffsetATR` 分だけ浅い押し/戻りを待つ `BuyLimit` / `SellLimit` を置く
- 指値が無効な場合や機能を無効化した場合は `trade.Buy()` / `trade.Sell()` にフォールバックする
- SL/TP は ATR と RR から算出し、指値ベースで設定する
- Virtual（学習/検証）は現状 market 前提で即時FILLEDとして記録する

## 記録（Supabase）
- `ai_signals.entry_method` は `pullback` または `market` を保存
- `ai_signals.entry_params` は送らない/NULL
- `ea-log` には win_prob / reasoning / skip_reason 等の運用に必要な情報のみを保存

