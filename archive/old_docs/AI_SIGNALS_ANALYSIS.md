# ai_signals データ分析レポート

## データサマリー（18件）

### トレード結果
| 結果 | 件数 | 割合 |
|------|------|------|
| WIN | 4件 | 22% |
| LOSS | 4件 | 22% |
| FILLED | 4件 | 22% (未決済) |
| CANCELLED | 6件 | 33% |

### 銘柄別
| 銘柄 | 件数 |
|------|------|
| XAUUSD (金) | 15件 |
| BTCUSD | 3件 |

### 勝率データ
- すべてのトレードで `win_prob = 0.72` (72%)
- 実際の勝率: 4勝4敗 = **50%**
- **AIの予測(72%)と実績(50%)に乖離あり**

### 損益
- WIN: +70,182 (4件)
- LOSS: -43,979 (4件)
- 純利益: **+26,203**
- 平均勝ち: +17,545.5
- 平均負け: -10,994.75

### トレード詳細
```
WIN事例:
- XAUUSD M15 BUY: RSI=66.85, 利益=+18,830 (55分保持)
- XAUUSD M15 BUY: RSI=63.38, 利益=+13,784 (10分保持) ★短期で利確
- XAUUSD M15 BUY: RSI=69.41, 利益=+15,282 (23分保持)
- XAUUSD M15 BUY: RSI=67.46, 利益=+22,286 (55分保持) ★最大利益

LOSS事例:
- BTCUSD M15 SELL: RSI=41.09, 損失=-13,270 (67分保持, SL hit)
- XAUUSD M15 BUY: RSI=63.38, 損失=-16,750 (128分保持, SL hit)
- BTCUSD M15 BUY: RSI=63.76, 損失=-8,626 (239分保持, SL hit)
- BTCUSD M15 BUY: RSI=26.46, 損失=-5,333 (21分保持, SL hit)
```

### パターン
1. **XAUUSD (金)** の勝率が高い (4勝1敗)
2. **BTCUSD** は不調 (0勝3敗)
3. すべて **SL** でカット、**TP** で利確
4. 保持時間: 10分～239分 (平均86分)

## 🤖 AI学習の現状

### ❌ まだ学習していない理由

1. **現在のai-trader関数は固定ロジック**
   ```typescript
   function calculateSignal(req: TradeRequest): TradeResponse {
     // ← ハードコードされたルール
     if (rsi > 70) {
       win_prob += (dir < 0) ? 0.15 : -0.10;
     }
     // ← 機械学習モデルは使っていない
   }
   ```

2. **データは収集中だが未活用**
   - ai_signals テーブルにデータは蓄積
   - しかし学習パイプラインが未構築

3. **学習には最低1000件以上必要**
   - 現在18件 → 不十分
   - 目標: 1000～10000件

## 🎯 AI学習を実装するには

### Phase 1: データ収集（現在ここ）
- ✅ ai_signals テーブル作成済み
- ✅ EA からデータ送信中
- ✅ トレード結果も記録中
- 🎯 目標: 1000件以上

### Phase 2: 学習パイプライン構築
```python
# Python で機械学習モデルを訓練
import pandas as pd
from sklearn.ensemble import RandomForestClassifier

# Supabase からデータ取得
data = supabase.table('ai_signals').select('*').execute()
df = pd.DataFrame(data.data)

# 特徴量: RSI, ATR, dir, symbol, timeframe
X = df[['rsi', 'atr', 'dir', 'symbol_encoded', 'tf_encoded']]

# ラベル: WIN/LOSS
y = df['actual_result'] == 'WIN'

# モデル訓練
model = RandomForestClassifier()
model.fit(X, y)

# モデルを保存
joblib.dump(model, 'ai_trader_model.pkl')
```

### Phase 3: モデルデプロイ
```typescript
// Supabase Edge Function で学習済みモデルを使用
import * as onnx from 'onnxruntime-node';

serve(async (req: Request) => {
  const { rsi, atr, dir, symbol, timeframe } = await req.json();
  
  // 学習済みモデルで予測
  const session = await onnx.InferenceSession.create('model.onnx');
  const input = new onnx.Tensor('float32', [rsi, atr, dir, ...]);
  const output = await session.run({ input });
  
  const win_prob = output.probability.data[0];
  
  return new Response(JSON.stringify({ win_prob, ... }));
});
```

### Phase 4: 継続学習
- 定期的に新しいデータで再訓練
- A/Bテスト: 固定ロジック vs AIモデル
- パフォーマンス比較

## 📊 データから見える改善点

### 1. BTCUSDは不調 → 除外検討
```
BTCUSD: 0勝3敗 (勝率0%)
推奨: 一旦トレード停止、データ収集のみ継続
```

### 2. win_prob=0.72 が固定値
```
すべてのトレードで72%
→ RSI/ATRに応じて動的に変えるべき

改善案:
- RSI > 70 かつ SELL → win_prob = 0.85
- RSI 50-60 → win_prob = 0.60
```

### 3. SL/TPの最適化
```
現在: すべてSLヒットで損切り
提案: ATRベースのSL距離を調整
  - ボラティリティ高: SL距離を広げる
  - ボラティリティ低: SL距離を狭める
```

## 🎯 次のステップ

### 短期（今すぐできる）
1. ✅ データ収集継続（目標1000件）
2. ⚠️ BTCUSD を一旦停止
3. ✅ XAUUSDに注力

### 中期（1-2週間後）
1. 📊 データ分析スクリプト作成
2. 🧪 勝ちパターン・負けパターンの特定
3. 🔧 ai-trader 関数のロジック改善

### 長期（1ヶ月後～）
1. 🤖 機械学習モデルの訓練
2. 🚀 AI予測モデルのデプロイ
3. 📈 パフォーマンス比較・改善

## 結論

**現在のAI**: 学習していない（固定ルール）
**収集データ**: 18件 → 1000件目標
**実績**: 勝率50%、純利益+26,203
**改善余地**: BTCUSD除外、win_prob動的化、SL/TP最適化

データは順調に蓄積中です！あと982件で機械学習の準備が整います 🚀
