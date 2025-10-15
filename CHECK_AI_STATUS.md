# 🔍 AI接続状況の確認方法

## 📊 問題を発見する5つの方法

### 1. Supabase Dashboard でログ監視 ⭐最も確実

**URL**: https://supabase.com/dashboard/project/nebphrnnpmuqbkymwefs/functions/ai-trader/logs

#### ✅ 正常時のログパターン
```
[ai-trader] ✓ OpenAI API KEY configured (length=164)
[ai-trader] 🤖 Attempting OpenAI GPT prediction...
[ai-trader] ✓ OpenAI prediction successful
[ai-trader] 📊 RESULT: ... method=OpenAI-GPT
```

#### ⚠️ 異常時のログパターン（フォールバックのみ）
```
[ai-trader] ⚠️ OPENAI_API_KEY not properly configured!
[ai-trader] Key status: NOT SET
[ai-trader] ⚠️ Using rule-based FALLBACK (no OpenAI key)
[ai-trader] 📊 RESULT: ... method=Fallback-NoKey
[ai-trader] ⚠️ WARNING: Using fallback calculation!
```

**確認ポイント**:
- ⚠️マークが頻出していないか
- `method=OpenAI-GPT` が出ているか
- `method=Fallback-NoKey` が出ていたら問題あり

---

### 2. 診断エンドポイントで即座に確認 ⭐最も簡単

**毎朝の健康チェック** または **デプロイ後の確認** に使用:

#### コマンドライン
```bash
curl https://nebphrnnpmuqbkymwefs.functions.supabase.co/ai-trader | python3 -m json.tool
```

#### ブラウザ
```
https://nebphrnnpmuqbkymwefs.functions.supabase.co/ai-trader
```

#### ✅ 正常な応答
```json
{
    "ok": true,
    "service": "ai-trader with OpenAI + Ichimoku",
    "version": "2.2.0",
    "ai_enabled": true,                           ← ここをチェック！
    "openai_key_status": "configured (164 chars)", ← ここをチェック！
    "fallback_available": true
}
```

#### ❌ 問題がある応答
```json
{
    "ok": true,
    "ai_enabled": false,                 ← false なら問題あり！
    "openai_key_status": "NOT SET"       ← NOT SET なら問題あり！
}
```

---

### 3. MT5 EA のエキスパートログを確認

#### ✅ OpenAI使用時の特徴
```
[QueryAI] Response received:
  Win Probability: 85.0%
  Confidence: high                           ← これがあればOK
  Reasoning: 一目均衡表が強い買いシグナル    ← これがあればOK
  Action: 1
```

#### ❌ フォールバックのみの特徴
```
[QueryAI] Response received:
  Win Probability: 65.0%    ← 常に似たような値
  Action: 1
                            ← Confidence なし
                            ← Reasoning なし
```

**確認方法**:
- MT5のエキスパートタブでログを見る
- "Confidence" と "Reasoning" があるか確認

---

### 4. 勝率の分布パターンを観察

#### ✅ OpenAI使用時の勝率分布
```
シグナル品質         勝率範囲
─────────────────────────────
最強（一目1.0）    → 85-95%
強い（一目0.7-0.9）→ 75-85%
中程度（一目0.5）  → 65-75%
弱い（一目0.3）    → 55-65%
矛盾（一目0.0）    → 40-55%
```
**特徴**: 広い範囲（40-95%）で柔軟に変動

#### ❌ フォールバックのみの勝率分布
```
ほぼ全てのシグナル → 60-75%の狭い範囲
特に多い値        → 65%付近に集中
```
**特徴**: 狭い範囲（60-75%）に固定され、柔軟性がない

**確認方法**:
- 1日のトレード履歴を見る
- 勝率が65%ばかりなら問題あり
- 勝率が40-95%の範囲で変動していればOK

---

### 5. Supabase のメトリクス監視（プロアクティブ）

**Edge Functions メトリクス**:
https://supabase.com/dashboard/project/nebphrnnpmuqbkymwefs/functions

#### 確認ポイント
- **エラー率**: 急増していないか
- **レスポンス時間**: 
  - OpenAI使用: 1-3秒（正常）
  - フォールバックのみ: <100ms（問題の可能性）
- **リクエスト数**: 異常に少なくないか

---

## 🚨 問題発見時のチェックリスト

問題を発見したら、以下の順で確認:

### ステップ1: 診断エンドポイントで確認
```bash
curl https://nebphrnnpmuqbkymwefs.functions.supabase.co/ai-trader | python3 -m json.tool
```
- `ai_enabled: false` → OpenAI API Key の問題
- `ai_enabled: true` → OpenAI API自体の問題

### ステップ2: Supabase Secrets を確認
```bash
supabase secrets list
```
- `OPENAI_API_KEY` が存在するか確認

### ステップ3: OpenAI API Keyを検証
```bash
# OpenAI APIに直接アクセスしてキーを検証
curl https://api.openai.com/v1/models \
  -H "Authorization: Bearer YOUR_OPENAI_API_KEY"
```
- 成功: キーは有効
- 401 Unauthorized: キーが無効または期限切れ

### ステップ4: OpenAI 使用量を確認
https://platform.openai.com/usage
- Rate Limitに達していないか
- 残高が十分か

### ステップ5: Supabase ログで詳細を確認
https://supabase.com/dashboard/project/nebphrnnpmuqbkymwefs/functions/ai-trader/logs
- エラーメッセージを確認
- HTTP ステータスコードを確認（401, 429, 500など）

---

## 📋 毎日の健康チェックルーチン

### 朝のチェック（30秒）
```bash
# 1. 診断エンドポイントで確認
curl https://nebphrnnpmuqbkymwefs.functions.supabase.co/ai-trader

# 2. 期待される出力
# {"ai_enabled":true,"openai_key_status":"configured (164 chars)"}
```

### 週次チェック（5分）
1. **Supabase Dashboard でログ確認**
   - ⚠️マークが多くないか
   - `method=OpenAI-GPT` が出ているか

2. **OpenAI 使用量確認**
   - https://platform.openai.com/usage
   - コストが予想内か

3. **MT5 トレード履歴を見る**
   - 勝率が柔軟に変動しているか
   - 65%ばかりになっていないか

---

## 🔔 アラート設定（推奨）

### 方法1: Supabase Edge Function のアラート
Supabase Dashboard → Functions → ai-trader → Settings
- エラー率が10%を超えたらアラート
- レスポンス時間が5秒を超えたらアラート

### 方法2: 定期的な自動チェック（cron）
```bash
# 毎時、診断エンドポイントをチェックするスクリプト
*/60 * * * * curl -s https://nebphrnnpmuqbkymwefs.functions.supabase.co/ai-trader | \
  grep -q '"ai_enabled":true' || \
  echo "⚠️ AI is NOT enabled!" | mail -s "AI Trader Alert" your-email@example.com
```

### 方法3: MT5 EA からの通知
EA内で以下を実装可能:
```mql5
// Confidence と Reasoning がないレスポンスが連続したら警告
if(consecutive_fallback_count > 5) {
    Alert("⚠️ AI接続に問題の可能性！フォールバックが5回連続");
}
```

---

## 🎯 クイックリファレンス

| 症状 | 確認方法 | 期待される結果 |
|------|----------|---------------|
| **勝率が65%付近ばかり** | MT5ログ + ダッシュボードログ | `method=Fallback-NoKey` が見つかる |
| **Confidenceなし** | MT5ログ | OpenAI未使用の証拠 |
| **エラー頻発** | Supabaseログ | HTTPエラーコード確認 |
| **動作確認** | 診断エンドポイント | `ai_enabled: true` |

---

## 📞 トラブルシューティングガイド

詳細な対処方法は以下を参照:
- **OPENAI_TROUBLESHOOTING.md** - OpenAI API関連の問題
- **DEPLOYMENT_CHECKLIST.md** - デプロイ前後の確認事項
- **DIAGNOSTIC_CHANGES.md** - 診断機能の詳細

---

## ✅ まとめ

### 最も簡単な方法（毎日推奨）
```bash
curl https://nebphrnnpmuqbkymwefs.functions.supabase.co/ai-trader
```
↓
`"ai_enabled":true` ならOK、`false` なら問題あり

### 最も確実な方法（問題発生時）
https://supabase.com/dashboard/project/nebphrnnpmuqbkymwefs/functions/ai-trader/logs
↓
`method=OpenAI-GPT` が出ていればOK、`method=Fallback-*` が多ければ問題あり

---

**重要**: 今回追加した診断機能により、問題を**事前に**または**即座に**発見できるようになりました！
