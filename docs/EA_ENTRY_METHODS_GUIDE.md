# EA 実装ガイド: ハイブリッド・エントリー方式

本ガイドは、Edge Function `ai-trader` が返すエントリー方式情報を用いて、MQL5 EAで3つの方式を切り替えて発注するための実装ポイントをまとめたものです。

## 返却フィールド（ai-trader のレスポンス）
- entry_method: `pullback` | `breakout` | `mtf_confirm` | `none`
- entry_params: JSON（方式ごとのパラメータ）
- method_selected_by: `OpenAI` | `Fallback`
- method_confidence: 0.0-1.0
- method_reason: 文字列（方式選択の簡易理由）

## 共通: 有効期限（expiry_bars）
- 2～3本（M15バー基準）を推奨。
- EA側でシグナル時刻（MQL5のTimeCurrent/バー時刻）を保持し、expiry_bars 経過で未約定なら発注をキャンセル。

## 1) pullback（押し目/戻り）
- BUY: 指値 = 現値 − k×ATR
- SELL: 指値 = 現値 + k×ATR
- パラメータ例: `{ "k": 0.3, "anchor_type": "ema25", "expiry_bars": 2 }`
- anchor_type がある場合、EMA25/一目の転換線/基準線との距離で価格を微調整。

## 2) breakout（ブレイクアウト確認）
- BUY STOP: 直近高値 + o×ATR
- SELL STOP: 直近安値 − o×ATR
- パラメータ例: `{ "o": 0.2, "confirm_tf": "M5", "confirm_rule": "close_break", "expiry_bars": 2 }`
- confirm_rule:
  - `close_break`: M5終値で直近高値/安値を明確にブレイク
  - `macd_flip`: M5のMACDヒストグラムが反転

## 3) mtf_confirm（マルチタイムフレーム）
- M15方向が出た後、M5のミニ条件成立で成行 or 小オフセット成行
- パラメータ例: `{ "m5_rules": ["swing", "rsi_back_50"], "order_type": "market", "expiry_bars": 3 }`
- m5_rules:
  - `swing`: 直近の押し安値/戻り高値の切り上げ/切り下げ
  - `rsi_back_50`: RSIが50ラインを再び跨いで方向一致

## 実装Tips（MQL5）
- JSONパース: `CJAVal` 等の軽量JSONライブラリの利用を推奨
- 価格計算:
  - ATRはEA側でも計算して整合性チェック（任意）
  - スプレッド/最小ステップ（SYMBOL_TRADE_TICK_SIZE）を考慮
- エラー処理:
  - 価格変動で指値が無効になった場合は再計算 or キャンセル
  - 方式=none の場合はエントリー見送り
- 記録:
  - `ai_signals.entry_method/entry_params` と合致する形でEAログに出力

## 検証フロー
1. BTCUSD M15 限定で有効化（feature flag）
2. 2日程度の検証で方式別の約定率・勝率・平均PLを比較
3. 良好なら XAUUSD/JPY に段階展開

