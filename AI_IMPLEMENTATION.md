# AI予測機能の実装について

## 現在の実装状況

### ❌ 現在：ルールベースの単純計算

`supabase/functions/ai-trader/index.ts`は**本物のAIを使用していません**。

```typescript
function calculateSignal(req: TradeRequest): TradeResponse {
  let win_prob = 0.55; // ベース55%
  
  // RSI条件
  if (rsi > 70) win_prob += (dir < 0) ? 0.20 : -0.05;
  // ... 単純なif文による計算
  
  return { win_prob, ... };
}
```

**これは固定ルールによるフォールバック実装です。**

---

## ✅ 本物のAIを使う方法

### オプション1: OpenAI GPT API（推奨）

**ファイル**: `index_with_openai.ts`（作成済み）

#### メリット
- ✅ すぐに使える
- ✅ 過去の取引データから学習
- ✅ 自然言語で市場分析
- ✅ コスト: ~$0.001/リクエスト（gpt-4o-mini）

#### セットアップ

1. **OpenAI APIキーを取得**
   - https://platform.openai.com/api-keys
   - 新しいAPIキーを作成

2. **Supabaseに環境変数を設定**
   ```bash
   supabase secrets set OPENAI_API_KEY=sk-proj-...
   ```

3. **Edge Functionを置き換え**
   ```bash
   # 現在のファイルをバックアップ
   mv supabase/functions/ai-trader/index.ts supabase/functions/ai-trader/index_fallback.ts
   
   # OpenAI版を使用
   mv supabase/functions/ai-trader/index_with_openai.ts supabase/functions/ai-trader/index.ts
   
   # デプロイ
   supabase functions deploy ai-trader
   ```

4. **動作確認**
   ```bash
   # ログで確認
   supabase functions logs ai-trader
   
   # 以下のようなログが表示されます：
   # [AI] OpenAI prediction: 78.5% (high) - RSI oversold + MA trend aligned
   ```

#### コスト試算
- gpt-4o-mini: $0.00015/1K tokens
- 1リクエスト ≈ 300 tokens
- **1リクエスト ≈ $0.00005 (約0.007円)**
- 月1000回実行 ≈ **$0.05 (約7円)**

---

### オプション2: TensorFlow/Scikit-learn（機械学習モデル）

#### メリット
- ✅ 完全にカスタマイズ可能
- ✅ 高速（推論のみ）
- ✅ コスト: 無料（推論時）

#### デメリット
- ❌ モデル訓練が必要
- ❌ データ収集期間が必要（最低100件以上）
- ❌ 実装が複雑

#### 実装手順

1. **データ収集**（現在進行中）
   - `ai_signals`テーブルに取引データが蓄積中
   - 最低100～1000件のデータが必要

2. **モデル訓練**
   ```python
   # Python スクリプト例
   import pandas as pd
   from sklearn.ensemble import RandomForestClassifier
   import joblib
   
   # Supabaseからデータ取得
   data = fetch_signals_from_supabase()
   
   # 特徴量エンジニアリング
   X = data[['rsi', 'atr', 'dir', 'ma_trend']]
   y = (data['actual_result'] == 'WIN').astype(int)
   
   # モデル訓練
   model = RandomForestClassifier()
   model.fit(X, y)
   
   # モデル保存
   joblib.dump(model, 'model.pkl')
   ```

3. **Deno/TypeScriptで推論**
   - TensorFlow.jsまたはONNX Runtime
   - モデルをEdge Functionに組み込み

---

### オプション3: Google Gemini API（低コスト）

#### メリット
- ✅ OpenAIより安い（15 RPM無料枠）
- ✅ セットアップ簡単

#### セットアップ
```typescript
// Gemini API使用例
const response = await fetch(
  `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${GEMINI_API_KEY}`,
  {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{
        parts: [{ text: prompt }]
      }]
    })
  }
);
```

---

## 📊 比較表

| 方法 | コスト | セットアップ時間 | 精度 | メンテナンス |
|------|--------|-----------------|------|-------------|
| **現在（ルールベース）** | 無料 | 完了 | 低 | 簡単 |
| **OpenAI GPT** | ~$0.05/月 | 10分 | 中～高 | 簡単 |
| **Google Gemini** | 無料枠あり | 10分 | 中 | 簡単 |
| **独自ML** | 無料 | 数週間 | 高（データ次第） | 複雑 |

---

## 🎯 推奨アプローチ

### フェーズ1: OpenAI GPTで開始（今すぐ）
1. `index_with_openai.ts`を使用
2. OpenAI APIキーを設定
3. デプロイして動作確認
4. 実際の市場で精度を検証

### フェーズ2: データ収集継続（1～3ヶ月）
1. `ai_signals`テーブルにデータ蓄積
2. 最低300～1000件の取引データを収集
3. WIN/LOSS比率を分析

### フェーズ3: 独自MLモデルへ移行（将来）
1. 収集データでモデル訓練
2. TensorFlow.jsで推論実装
3. OpenAIと比較テスト
4. 精度が良ければ切り替え

---

## 🚀 次のステップ

**今すぐ本物のAIを使いたい場合：**

```bash
# 1. OpenAI APIキー取得
# https://platform.openai.com/api-keys

# 2. Supabaseに設定
supabase secrets set OPENAI_API_KEY=sk-proj-YOUR_KEY_HERE

# 3. ファイル置き換え
cd /workspaces/ai-trader-supabase/supabase/functions/ai-trader
mv index.ts index_fallback.ts
mv index_with_openai.ts index.ts

# 4. デプロイ
supabase functions deploy ai-trader

# 5. 動作確認
supabase functions logs ai-trader --tail
```

**月$0.05（約7円）で本物のAI予測が使えます！** 🎉
