# MT5 EA統合テストガイド

## 📋 ステップ1: MT5 EA設定

### 1.1 EA設定パラメータの確認

**現在のEA設定（mt5/AI_QuadFusion_EA.mq5）:**

```mql5
// 重要な設定パラメータ
input string AI_Endpoint_URL = "https://nebphrnnpmuqbkymwefs.functions.supabase.co/ai-trader";
input string AI_Bearer_Token = "YOUR_SERVICE_ROLE_KEY";
```

### 1.2 ローカル環境での設定

**開発環境でテストする場合:**

1. **EA設定を変更**（MT5でEAをチャートに適用時）:
   ```
   AI_Endpoint_URL: http://127.0.0.1:54321/functions/v1/ai-trader
   AI_Bearer_Token: sb_secret_N7UND0UgjKTVK-Uodkm0Hg_xSvEMPvz
   ```

2. **または、EAファイルを一時的に編集**:
   ```mql5
   // 開発環境用設定
   input string AI_Endpoint_URL = "http://127.0.0.1:54321/functions/v1/ai-trader";
   input string AI_Bearer_Token = "sb_secret_N7UND0UgjKTVK-Uodkm0Hg_xSvEMPvz";
   ```

### 1.3 必要なパラメータ

| パラメータ | ローカル開発 | 本番環境 |
|-----------|-------------|---------|
| AI_Endpoint_URL | `http://127.0.0.1:54321/functions/v1/ai-trader` | `https://your-project.functions.supabase.co/ai-trader` |
| AI_Bearer_Token | `sb_secret_N7UND0UgjKTVK-Uodkm0Hg_xSvEMPvz` | 本番のService Role Key |
| AI_Timeout_ms | 5000 | 5000 |

---

## 🧪 ステップ2: テスト準備

### 2.1 Edge Functionの起動

```bash
# ターミナル1: Edge Functionを起動
source /workspaces/ai-trader-supabase/load_env.sh
supabase functions serve ai-trader --env-file supabase/.env.local --no-verify-jwt
```

### 2.2 モニタリング用ターミナルの準備

```bash
# ターミナル2: ログをリアルタイム監視
watch -n 2 'docker exec supabase_db_ai-trader-supabase psql -U postgres -c "SELECT id, created_at, sym, action, win_prob, reasoning FROM \"ea-log\" ORDER BY created_at DESC LIMIT 5;"'
```

### 2.3 Supabase Studioを開く

```bash
# ブラウザで開く
http://127.0.0.1:54323
```

---

## 🚀 ステップ3: MT5からのテスト

### 方法A: MT5を使用する場合（推奨）

1. **MT5を起動**

2. **EAファイルを配置**
   ```
   MT5データフォルダ/MQL5/Experts/AI_QuadFusion_EA.mq5
   ```

3. **EAをコンパイル**
   - MetaEditor で開く
   - F7キーでコンパイル

4. **チャートにEAを適用**
   - チャート: XAUUSD M15
   - EAをドラッグ＆ドロップ
   - パラメータを設定:
     - AI_Endpoint_URL: `http://127.0.0.1:54321/functions/v1/ai-trader`
     - AI_Bearer_Token: `sb_secret_N7UND0UgjKTVK-Uodkm0Hg_xSvEMPvz`
     - DebugLogs: true

5. **Expert タブでログを確認**

### 方法B: curlで手動テスト（MT5なしでテスト）

```bash
# テストリクエストを送信（MT5の代わり）
curl -X POST http://127.0.0.1:54321/functions/v1/ai-trader \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sb_secret_N7UND0UgjKTVK-Uodkm0Hg_xSvEMPvz" \
  -d '{
    "symbol": "XAUUSD",
    "timeframe": "M15",
    "price": 2650.50,
    "bid": 2650.30,
    "ask": 2650.70,
    "ema_25": 2645.30,
    "sma_100": 2640.10,
    "ma_cross": 1,
    "rsi": 65.5,
    "atr": 15.2,
    "macd": {
      "main": 2.5,
      "signal": 1.8,
      "histogram": 0.7,
      "cross": 1
    },
    "ichimoku": {
      "tenkan": 2648.50,
      "kijun": 2642.30,
      "senkou_a": 2645.40,
      "senkou_b": 2638.20,
      "chikou": 2655.10,
      "tk_cross": 1,
      "cloud_color": 1,
      "price_vs_cloud": 1
    },
    "ea_suggestion": {
      "dir": 1,
      "reason": "テスト: ゴールデンクロス + 一目強気",
      "ichimoku_score": 0.75
    }
  }' | jq
```

---

## 📊 ステップ4: 結果の確認

### 4.1 API レスポンスの確認

**期待されるレスポンス:**
```json
{
  "win_prob": 0.85,
  "action": 1,
  "offset_factor": 0.25,
  "expiry_minutes": 90,
  "confidence": "high",
  "reasoning": "強い一目均衡表と高RSI"
}
```

### 4.2 データベースの確認

```bash
# ea-log テーブル
docker exec supabase_db_ai-trader-supabase psql -U postgres -c \
  "SELECT * FROM \"ea-log\" ORDER BY created_at DESC LIMIT 5;"

# ai_signals テーブル
docker exec supabase_db_ai-trader-supabase psql -U postgres -c \
  "SELECT * FROM ai_signals ORDER BY created_at DESC LIMIT 5;"
```

### 4.3 Supabase Studio で確認

1. http://127.0.0.1:54323 を開く
2. Table Editor → ea-log を選択
3. 最新のレコードを確認

---

## 🔧 トラブルシューティング

### エラー: "Connection refused"

**原因**: Edge Functionが起動していない

**解決策**:
```bash
# Edge Functionを起動
source load_env.sh
supabase functions serve ai-trader --env-file supabase/.env.local --no-verify-jwt
```

### エラー: "401 Unauthorized"

**原因**: Bearer Tokenが正しくない

**解決策**:
```bash
# 正しいTokenを確認
supabase status | grep "service_role key"
```

### エラー: MT5から接続できない

**原因1**: MT5のWebRequest許可設定

**解決策**:
```
MT5 → ツール → オプション → エキスパートアドバイザー
→ WebRequestを許可するURLのリストに追加:
  http://127.0.0.1
  http://localhost
```

**原因2**: ファイアウォール

**解決策**: ローカルファイアウォールで 54321 ポートを許可

---

## ✅ 成功確認チェックリスト

- [ ] Edge Functionが起動している
- [ ] curlテストでレスポンスが返る
- [ ] データベースにレコードが保存される
- [ ] MT5のExpertタブにログが表示される
- [ ] MT5からAPIコールが成功する
- [ ] ai-signals テーブルに記録される

---

## 📝 次のステップ

テストが成功したら:
1. リアルタイムモニタリングの設定
2. パフォーマンスダッシュボードの作成
3. 本番環境へのデプロイ

---

**準備が整ったら、テストを開始してください！** 🚀
