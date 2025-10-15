# Supabase Edge Functions - 一目均衡表対応アップデート

## 🎯 変更概要

**バージョン**: 2.0.0 → **2.1.0**  
**日付**: 2025年10月15日  
**対応EA**: AI_QuadFusion_EA v1.3.0

### 新機能: `ichimoku_score` パラメータ対応

## 📝 変更内容

### 1. ai-trader Edge Function

#### インターフェース更新

```typescript
interface TradeRequest {
  symbol: string;
  timeframe: string;
  dir: number;
  rsi: number;
  atr: number;
  price: number;
  reason: string;
  ichimoku_score?: number;  // ⭐ NEW
  instance?: string;
  version?: string;
}
```

#### フォールバック計算の強化

一目均衡表スコアに基づいて勝率を調整:

```typescript
// ichimoku_score: 1.0 = 両指標一致, 0.7 = 一目のみ, 0.5 = MAのみ, 0.0 = 矛盾

if (ichimoku_score >= 0.9) {
  win_prob += 0.15;  // +15% (最強シグナル)
} else if (ichimoku_score >= 0.6) {
  win_prob += 0.10;  // +10% (一目強)
} else if (ichimoku_score >= 0.4) {
  win_prob += 0.05;  // +5% (MA強)
}
// ichimoku_score = 0.0 の場合は加算なし
```

#### OpenAI プロンプト強化

GPTに一目均衡表の情報を提供:

```typescript
// プロンプトに追加される情報:
- ichimoku_score >= 0.9: "移動平均線と一目均衡表の両方が一致（最強シグナル）"
- ichimoku_score >= 0.6: "一目均衡表が強いシグナル"
- ichimoku_score >= 0.4: "移動平均線のみのシグナル"
- ichimoku_score = 0.0: "シグナル矛盾（逆方向）"
```

#### ログ出力強化

```typescript
// 新しいログ形式:
[ai-trader] BTCUSD M15 dir=1 win=0.825 ichimoku=1.00 reason="MA↑+一目買" (AI)
[ai-trader] EURUSD M15 dir=-1 win=0.705 ichimoku=0.50 reason="MA↓" (Fallback)
```

#### バージョン情報更新

```json
{
  "ok": true,
  "service": "ai-trader with OpenAI + Ichimoku",
  "version": "2.1.0",
  "ai_enabled": true,
  "fallback_available": true,
  "features": ["ichimoku_score", "openai_gpt", "ml_learning"]
}
```

## 🔄 リクエスト/レスポンス例

### リクエスト (EAから送信)

```json
{
  "symbol": "BTCUSD",
  "timeframe": "M15",
  "dir": 1,
  "rsi": 62.5,
  "atr": 0.00085,
  "price": 43250.50,
  "reason": "MA↑+一目買",
  "ichimoku_score": 1.0,
  "instance": "main",
  "version": "1.3.0"
}
```

### レスポンス

```json
{
  "win_prob": 0.825,
  "action": 1,
  "offset_factor": 0.250,
  "expiry_minutes": 90,
  "confidence": "high",
  "reasoning": "強いトレンドと複数指標の一致により高勝率"
}
```

## 📊 一目スコアの影響

### フォールバック計算での勝率ブースト

| ichimoku_score | 説明 | 勝率ブースト |
|---------------|------|------------|
| 1.0 | MA + 一目 両方一致 | **+15%** |
| 0.7 | 一目のみ強シグナル | **+10%** |
| 0.5 | MAのみシグナル | **+5%** |
| 0.0 | シグナル矛盾 | **±0%** |

### 勝率計算例

#### ケース1: 両指標一致
```
Base: 55%
RSI boost: +15%
Dir boost: +15%
Ichimoku boost: +15%
→ 合計: 100% → 上限95%に調整
```

#### ケース2: MAのみ
```
Base: 55%
RSI boost: +15%
Dir boost: +15%
Ichimoku boost: +5%
→ 合計: 90%
```

#### ケース3: シグナル矛盾
```
Base: 55%
RSI boost: +15%
Dir boost: +15%
Ichimoku boost: 0%
→ 合計: 85%
```

## 🧠 OpenAI GPT での活用

### プロンプト追加情報

GPTは以下の追加コンテキストを受け取ります:

```
【市場情報】
- 銘柄: BTCUSD
- 時間軸: M15
- 方向: 買い
- RSI: 62.50 (中立)
- ATR: 0.00085 (ボラティリティ)
- 現在価格: 43250.50
- テクニカル理由: MA↑+一目買
- 一目均衡表: 移動平均線と一目均衡表の両方が一致（最強シグナル）  ⭐ NEW
- 過去50件の取引での勝率: 68.0%
```

### 予測精度の向上

一目スコアにより、GPTは以下を判断できます:

1. **シグナルの信頼度**: 複数指標が一致しているか
2. **矛盾の検出**: 指標間で逆方向を示していないか
3. **エントリータイミング**: 強いシグナルなのか、弱いシグナルなのか

## 🚀 デプロイ方法

### 1. 現在のバージョン確認

```bash
curl https://YOUR_PROJECT.functions.supabase.co/ai-trader
```

**期待される出力**:
```json
{
  "ok": true,
  "service": "ai-trader with OpenAI + Ichimoku",
  "version": "2.1.0",
  "features": ["ichimoku_score", "openai_gpt", "ml_learning"]
}
```

### 2. デプロイ

```bash
cd /workspaces/ai-trader-supabase
supabase functions deploy ai-trader
```

### 3. テスト

```bash
curl -X POST https://YOUR_PROJECT.functions.supabase.co/ai-trader \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_SERVICE_ROLE_KEY" \
  -d '{
    "symbol": "BTCUSD",
    "timeframe": "M15",
    "dir": 1,
    "rsi": 62.5,
    "atr": 0.00085,
    "price": 43250.50,
    "reason": "MA↑+一目買",
    "ichimoku_score": 1.0,
    "instance": "main",
    "version": "1.3.0"
  }'
```

## 📈 期待される効果

### 1. 勝率予測の精度向上

- **複数指標の考慮**: MAだけでなく一目均衡表も評価
- **シグナル品質の定量化**: 0.0～1.0のスコアで明確化
- **矛盾の自動検出**: 逆方向シグナルを識別

### 2. ログの可読性向上

```
従来: [ai-trader] BTCUSD M15 dir=1 win=0.750 (AI)
新版: [ai-trader] BTCUSD M15 dir=1 win=0.825 ichimoku=1.00 reason="MA↑+一目買" (AI)
```

### 3. AI学習データの充実

`ichimoku_score` が記録されることで、将来的な機械学習での活用が可能に。

## 🔧 互換性

### 後方互換性

`ichimoku_score` は **オプショナル** なので、古いバージョンのEAからのリクエストも動作します:

```typescript
// v1.2.6 (一目なし) からのリクエスト
{
  "symbol": "BTCUSD",
  "timeframe": "M15",
  "dir": 1,
  "rsi": 62.5,
  "atr": 0.00085,
  "price": 43250.50,
  "reason": "MA↑",
  // ichimoku_score なし
  "instance": "main",
  "version": "1.2.6"
}

// → 正常に動作（ichimoku_scoreは未定義として扱われる）
```

## 📊 モニタリング

### Supabase ダッシュボードでのログ確認

1. Supabase プロジェクト → **Edge Functions** → **ai-trader**
2. **Logs** タブを開く
3. 以下のようなログが表示されます:

```
[ai-trader] BTCUSD M15 dir=1 win=0.825 ichimoku=1.00 reason="MA↑+一目買" (AI)
[AI] OpenAI prediction: 82.5% (high) - 強いトレンドと複数指標の一致により高勝率
[Fallback] Ichimoku boost: +15% (score=1.0)
```

### パフォーマンス比較

```sql
-- 一目スコア別の平均勝率
SELECT 
  CASE 
    WHEN reason LIKE '%一目%' THEN 'Ichimoku強'
    ELSE 'MA単独'
  END as signal_type,
  COUNT(*) as trades,
  AVG(win_prob) as avg_win_prob,
  COUNT(CASE WHEN trade_decision LIKE 'EXECUTED%' THEN 1 END) as executed
FROM "ea-log"
WHERE action IN ('BUY','SELL')
  AND at > NOW() - INTERVAL '7 days'
GROUP BY signal_type;
```

## ⚠️ 注意事項

### 1. OpenAI API制限

一目スコアの情報が追加されるため、プロンプトがやや長くなります:
- トークン数: 約200→250トークン（入力）
- コスト影響: 微増（1リクエスト当たり+0.00001ドル程度）

### 2. フォールバック動作

OpenAI APIが利用できない場合:
- ルールベース計算が一目スコアを考慮
- 勝率が+5%～+15%向上

### 3. バージョン管理

- EA v1.3.0 以降: `ichimoku_score` を送信
- EA v1.2.6 以前: `ichimoku_score` なし（互換性あり）

## 🎉 まとめ

### 変更されたファイル

- ✅ `/supabase/functions/ai-trader/index.ts` - 一目スコア対応

### 変更されていないファイル

- `/supabase/functions/ea-log/index.ts` - 変更不要（reasonフィールドで識別可能）
- `/supabase/functions/ai-config/index.ts` - 変更不要
- `/supabase/functions/ai-signals/index.ts` - 変更不要（reasonフィールドで識別可能）

### 次のステップ

1. **デプロイ**: `supabase functions deploy ai-trader`
2. **テスト**: MT5でEAを実行してログ確認
3. **モニタリング**: 1週間程度の勝率データを収集
4. **最適化**: 必要に応じてブースト値を調整

---

**アップデート完了**: Supabase Edge Functionsが一目均衡表に対応しました！🎊
