# 一目均衡表統合クイックスタート

## 🚀 すぐに使える設定例

### 基本設定（推奨）

```
// MT5 EA パラメータ設定

// ===== 一目均衡表設定 =====
UseIchimoku = true        // 有効化
Ichimoku_Tenkan = 9       // 転換線（デフォルト）
Ichimoku_Kijun = 26       // 基準線（デフォルト）
Ichimoku_Senkou = 52      // 先行スパン（デフォルト）

// ===== その他のパラメータ =====
MinWinProb = 0.70         // 70%以上で取引
TF_Entry = PERIOD_M15     // 15分足でエントリー
TF_Recheck = PERIOD_H1    // 1時間足で再確認
```

## 📊 シグナル例

### ケース1: 最強の買いシグナル
```
[EAログ]
reason: "MA↑+一目買"
ichimoku_score: 1.0
win_prob: 0.85
action: BUY
```
**解説**: 移動平均線と一目均衡表の両方が買いシグナル → AI判断も高勝率

### ケース2: MAのみの買いシグナル
```
[EAログ]
reason: "MA↑"
ichimoku_score: 0.5
win_prob: 0.72
action: BUY
```
**解説**: 移動平均線は買い、一目は中立 → 通常の勝率

### ケース3: 一目のみの買いシグナル
```
[EAログ]
reason: "一目買"
ichimoku_score: 0.7
win_prob: 0.75
action: BUY
```
**解説**: 一目均衡表のみ買いシグナル → やや高い勝率

### ケース4: シグナル矛盾（見送り）
```
[EAログ]
reason: "シグナル矛盾"
ichimoku_score: 0.0
trade_decision: "SKIPPED_NO_SIGNAL"
```
**解説**: MAは買い、一目は売り（または逆）→ トレード見送り

## 🎯 市場タイプ別の推奨設定

### トレンド相場（強いトレンドがある）
```
UseIchimoku = true
Ichimoku_Tenkan = 9
Ichimoku_Kijun = 26
MinWinProb = 0.70
```
→ デフォルト設定で最適

### レンジ相場（横ばい）
```
UseIchimoku = false  // 一目を無効化
MinWinProb = 0.75     // より高い勝率を要求
```
→ シグナルが錯綜しやすいため一目を無効化

### ボラティリティ高（値動きが激しい）
```
UseIchimoku = true
Ichimoku_Tenkan = 12   // やや長期化
Ichimoku_Kijun = 36
MinWinProb = 0.72      // やや慎重に
```
→ ノイズを減らすためパラメータを長期化

### スキャルピング（短期売買）
```
UseIchimoku = true
Ichimoku_Tenkan = 7    // 短期化
Ichimoku_Kijun = 20
TF_Entry = PERIOD_M5   // 5分足
MinWinProb = 0.75      // 高勝率重視
```
→ より敏感に反応する設定

## 📈 MT5チャートでの確認方法

### 1. 一目均衡表を表示
1. MT5チャートを開く
2. メニュー: **挿入** → **インジケーター** → **トレンド** → **Ichimoku Kinko Hyo**
3. パラメータをEAと同じに設定（9/26/52）

### 2. 移動平均線を表示
1. **EMA(25)**: メニュー → 挿入 → インジケーター → トレンド → Moving Average
   - Period: 25
   - MA Method: Exponential
   - Color: 青
2. **SMA(100)**: 同様に追加
   - Period: 100
   - MA Method: Simple
   - Color: 赤

### 3. 視覚的な確認ポイント

#### 買いシグナル（MA↑+一目買）
- ✅ EMA(25/青) > SMA(100/赤)
- ✅ 転換線(赤) > 基準線(青)
- ✅ 価格が雲の上
- ✅ 雲が青色（先行スパンAが上）

#### 売りシグナル（MA↓+一目売）
- ✅ EMA(25/青) < SMA(100/赤)
- ✅ 転換線(赤) < 基準線(青)
- ✅ 価格が雲の下
- ✅ 雲が赤色（先行スパンBが上）

#### 見送り（シグナル矛盾）
- ❌ MAは買いだが、転換線<基準線
- ❌ MAは売りだが、価格が雲の上

## 🔍 ログでのモニタリング

### Supabase ea-logテーブルで確認

```sql
-- 最新のトレードシグナル
SELECT 
  at,
  sym,
  reason,
  win_prob,
  trade_decision,
  ai_reasoning
FROM "ea-log"
ORDER BY at DESC
LIMIT 20;

-- 一目スコア別の勝率分析
SELECT 
  CASE 
    WHEN reason LIKE '%一目%' THEN '一目強'
    WHEN reason LIKE '%MA%' THEN 'MA強'
    ELSE 'その他'
  END as signal_type,
  COUNT(*) as count,
  AVG(win_prob) as avg_win_prob,
  COUNT(CASE WHEN trade_decision LIKE 'EXECUTED%' THEN 1 END) as executed
FROM "ea-log"
WHERE action IN ('BUY','SELL')
  AND at > NOW() - INTERVAL '7 days'
GROUP BY signal_type
ORDER BY avg_win_prob DESC;
```

## 🎓 学習のヒント

### フェーズ1: デフォルト設定でテスト（1週間）
- UseIchimoku = true（デフォルトパラメータ）
- ログを毎日確認
- どのシグナルが多いか観察

### フェーズ2: ON/OFF比較（2週間目）
- 前半: UseIchimoku = true
- 後半: UseIchimoku = false
- 勝率とトレード回数を比較

### フェーズ3: パラメータ最適化（3週間目～）
- バックテストでベストな組み合わせを探す
- 市場特性に合わせて調整

## ⚠️ 注意事項

1. **デモ口座で十分にテスト**
   - 新機能のため、まずはデモで動作確認

2. **シグナル矛盾時は見送る**
   - "シグナル矛盾" が頻発する場合、相場が不安定な可能性

3. **過度な最適化は避ける**
   - パラメータをいじりすぎるとカーブフィッティングになる

4. **一目均衡表は日本時間ベース**
   - 元々は日本株用に開発されたため、日足以上で最も効果的
   - 短期足（M5/M15）では参考程度に

## 🆘 よくある質問

**Q: 一目を追加したらエントリーが減りました**
A: 正常です。より慎重な判定になるため、トレード回数は減りますが勝率は向上するはずです。

**Q: "シグナル矛盾" ばかり出ます**
A: レンジ相場の可能性。一時的に `UseIchimoku = false` に設定してください。

**Q: パラメータはいじるべきですか？**
A: まずデフォルト（9/26/52）で1ヶ月テスト。その後、バックテストで最適化を検討してください。

**Q: AIの予測精度は上がりますか？**
A: `ichimoku_score` により、OpenAI GPTがより多くの情報を元に判断できるため、理論上は精度向上が期待できます。

---

**次のステップ**: [ICHIMOKU_INTEGRATION.md](./ICHIMOKU_INTEGRATION.md) で詳細な仕様を確認
