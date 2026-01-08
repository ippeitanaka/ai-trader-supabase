# EA 実装ガイド: market-only（成り行き一本）

本ガイドは、Edge Function `ai-trader` の判定結果を使って **常に成り行き（market）で発注**する前提の実装ポイントをまとめたものです。
（旧: pullback / breakout / mtf_confirm の方式分岐は廃止）

## 返却フィールド（ai-trader のレスポンス）
- entry_method: 常に `market`
- entry_params: 常に `null`
- method_selected_by: `OpenAI` | `Fallback` | `Manual`（予測ソースの識別用）
- method_reason: 文字列（market-onlyであること、ガード等の理由）

## 実装方針（MQL5）
- 発注は `trade.Buy()` / `trade.Sell()` のみ（指値/逆指値/確認待ちは行わない）
- SL/TP は ATR と RR から即時に設定
- Virtual（学習/検証）も market 前提で即時FILLEDとして記録し、SL/TP到達でWIN/LOSS更新

## 記録（Supabase）
- `ai_signals.entry_method` は `market` を保存
- `ai_signals.entry_params` は送らない/NULL
- `ea-log` には win_prob / reasoning / skip_reason 等の運用に必要な情報のみを保存

