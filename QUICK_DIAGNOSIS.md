# 🚨 AI接続問題 - クイック診断チートシート

## ⚡ 30秒で確認（毎日推奨）

```bash
./health_check.sh
```

または

```bash
curl https://nebphrnnpmuqbkymwefs.functions.supabase.co/ai-trader
```

### ✅ 正常
```json
{"ai_enabled":true,"openai_key_status":"configured (164 chars)"}
```

### ❌ 異常
```json
{"ai_enabled":false,"openai_key_status":"NOT SET"}
```

---

## 🔍 症状別の確認箇所

### 症状: 勝率が65%ばかり

**確認1**: MT5 エキスパートログ
```
[QueryAI] Response:
  Win Probability: 65.0%
                         ← "Confidence" がない = 問題あり
```

**確認2**: Supabase Dashboard ログ
```
https://supabase.com/dashboard/project/nebphrnnpmuqbkymwefs/functions/ai-trader/logs
```
探すキーワード: `method=Fallback-NoKey`

**確認3**: 診断エンドポイント
```bash
curl https://nebphrnnpmuqbkymwefs.functions.supabase.co/ai-trader
```

---

### 症状: "Confidence" と "Reasoning" がない

**原因**: フォールバック計算のみが動作

**確認**: Supabaseログで以下を探す
```
⚠️ OPENAI_API_KEY not properly configured
method=Fallback-NoKey
```

**対処**:
```bash
supabase secrets list  # キーを確認
supabase secrets set OPENAI_API_KEY=sk-proj-YOUR_KEY  # 設定
supabase functions deploy ai-trader  # 再デプロイ
```

---

### 症状: エラーが頻発

**確認**: Supabaseログで HTTPエラーコードを探す
```
[AI] OpenAI API error: 401  ← キーが無効
[AI] OpenAI API error: 429  ← Rate Limit
[AI] OpenAI API error: 500  ← OpenAI側の問題
```

**対処**:
- **401**: 新しいAPI Keyを取得・設定
- **429**: OpenAI使用量を確認、プランをアップグレード
- **500**: OpenAI Status (https://status.openai.com/) を確認

---

## 📱 ブックマーク推奨URL

### 毎日チェック
- **診断**: https://nebphrnnpmuqbkymwefs.functions.supabase.co/ai-trader
- **ログ**: https://supabase.com/dashboard/project/nebphrnnpmuqbkymwefs/functions/ai-trader/logs

### 週次チェック
- **OpenAI使用量**: https://platform.openai.com/usage
- **OpenAI Status**: https://status.openai.com/

---

## 🔧 トラブル時の対処コマンド

```bash
# 1. OpenAI API Keyを確認
supabase secrets list

# 2. OpenAI API Keyを再設定
supabase secrets set OPENAI_API_KEY=sk-proj-NEW_KEY_HERE

# 3. 再デプロイ
supabase functions deploy ai-trader

# 4. 確認
./health_check.sh
```

---

## 📊 正常 vs 異常の比較表

| 項目 | 正常（OpenAI使用） | 異常（フォールバックのみ） |
|------|-------------------|-------------------------|
| **診断エンドポイント** | `ai_enabled: true` | `ai_enabled: false` |
| **勝率の範囲** | 40-95% | 60-75% |
| **勝率の典型値** | 柔軟に変動 | 65%付近に集中 |
| **Confidence** | あり (high/medium/low) | なし |
| **Reasoning** | あり（日本語の理由） | なし |
| **ログの method** | `OpenAI-GPT` | `Fallback-NoKey` |
| **ログの警告** | なし | ⚠️マーク頻出 |

---

## 💡 プロアクティブな監視

### 毎朝のルーチン（30秒）
```bash
cd /workspaces/ai-trader-supabase
./health_check.sh
```

### 週次レビュー（5分）
1. Supabase Dashboard でログ確認
2. OpenAI 使用量確認
3. MT5 トレード履歴の勝率分布を確認

### アラート設定（推奨）
MT5 EA に以下を追加可能:
```mql5
// 連続5回 Confidence なしなら警告
if(no_confidence_count >= 5) {
    Alert("⚠️ AI接続に問題の可能性");
}
```

---

## 📚 詳細ドキュメント

- **CHECK_AI_STATUS.md** - 詳細な確認方法
- **OPENAI_TROUBLESHOOTING.md** - トラブルシューティング
- **DEPLOYMENT_CHECKLIST.md** - デプロイ手順

---

**最後に確認したのはいつ？今すぐ確認！**
```bash
./health_check.sh
```
