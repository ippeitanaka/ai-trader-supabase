# 📱 スマホでAI接続状況を確認する方法

## 🚀 最も簡単な方法：ブラウザで開く

スマホのブラウザ（Safari、Chrome など）で以下のURLを開くだけ：

```
https://nebphrnnpmuqbkymwefs.functions.supabase.co/ai-trader
```

### ✅ 正常時の表示
```json
{
  "ok": true,
  "service": "ai-trader with OpenAI + Ichimoku",
  "version": "2.2.0",
  "ai_enabled": true,
  "openai_key_status": "configured (164 chars)",
  "fallback_available": true,
  "features": [
    "ichimoku_score",
    "openai_gpt",
    "ml_learning",
    "detailed_logging"
  ]
}
```

### ❌ 問題がある時の表示
```json
{
  "ok": true,
  "ai_enabled": false,
  "openai_key_status": "NOT SET"
}
```

---

## 📲 推奨：ブックマークまたはホーム画面に追加

### iPhone (Safari)
1. 上記URLをSafariで開く
2. 画面下部の **共有ボタン** (□に↑) をタップ
3. **ホーム画面に追加** を選択
4. 名前を「AI Health Check」にして **追加**

### Android (Chrome)
1. 上記URLをChromeで開く
2. 右上の **メニュー** (⋮) をタップ
3. **ホーム画面に追加** を選択
4. 名前を「AI Health Check」にして **追加**

これで、アプリのようにワンタップで確認できます！

---

## 🔔 LINE等への通知設定（応用編）

### 方法1: IFTTT を使用

1. **IFTTT** アプリをインストール
2. 新しいアプレット作成:
   - **IF**: Webhooks - Receive a web request
   - **THEN**: LINE - Send message

3. スクリプト例（サーバーで定期実行）:
```bash
#!/bin/bash
# 毎時チェックして、問題があればLINEに通知
RESPONSE=$(curl -s https://nebphrnnpmuqbkymwefs.functions.supabase.co/ai-trader)
if echo "$RESPONSE" | grep -q '"ai_enabled":false'; then
    # IFTTTのWebhook URLを呼び出し
    curl -X POST https://maker.ifttt.com/trigger/ai_alert/with/key/YOUR_KEY
fi
```

### 方法2: Zapier を使用

1. **Zapier** でScheduled Webhookを設定
2. 診断URLを定期的にチェック
3. `ai_enabled: false` の場合、LINEやメールに通知

### 方法3: Supabase Dashboard のアラート

Supabase Dashboard で設定:
- **Settings** → **Edge Functions** → **ai-trader** → **Alerts**
- エラー率が10%を超えたらメール通知

---

## 🌐 外出先からSupabaseログを確認

### Supabase Dashboard（推奨）

スマホのブラウザで以下にアクセス:
```
https://supabase.com/dashboard
```

1. **MT5 AI Project** を選択
2. **Edge Functions** → **ai-trader** → **Logs**
3. 最新のログをリアルタイムで確認

**確認ポイント**:
- `method=OpenAI-GPT` が出ていれば正常
- `method=Fallback-NoKey` が多ければ問題あり
- ⚠️マークが頻出していないか

---

## 📊 勝率チェック（MT5 Mobile）

MT5のモバイルアプリでも確認可能:

1. **MT5 Mobile** アプリを開く
2. **ターミナル** → **履歴** タブ
3. 最近のトレードの勝率を確認

**パターン**:
- 勝率が 40-95% の範囲で変動 → 正常（OpenAI使用）
- 勝率が 65% 付近ばかり → 問題（フォールバックのみ）

---

## ⏰ 毎朝のルーチン（30秒）

### スマホで確認する場合
1. **朝食時やコーヒータイム**に
2. ホーム画面の「AI Health Check」をタップ
3. `"ai_enabled": true` を確認
4. 異常があればSupabase Dashboardでログ確認

### チェック頻度
- **毎朝**: ブラウザで診断URL確認（10秒）
- **週次**: Supabase Dashboard でログ確認（5分）
- **月次**: OpenAI 使用量確認（PC推奨）

---

## 🔗 便利なブックマーク集（スマホ用）

以下をブックマークフォルダ「AI Trader」に保存:

### 1. ヘルスチェック
```
https://nebphrnnpmuqbkymwefs.functions.supabase.co/ai-trader
```
**用途**: 毎日の健康チェック

### 2. Supabase Dashboard
```
https://supabase.com/dashboard/project/nebphrnnpmuqbkymwefs/functions/ai-trader/logs
```
**用途**: ログの詳細確認

### 3. OpenAI 使用量
```
https://platform.openai.com/usage
```
**用途**: 月次のコスト確認

### 4. OpenAI Status
```
https://status.openai.com/
```
**用途**: OpenAI側の障害確認

### 5. GitHub リポジトリ
```
https://github.com/ippeitanaka/ai-trader-supabase
```
**用途**: ドキュメント参照

---

## 📧 メール通知の設定（推奨）

### GitHub Actions でヘルスチェック

`.github/workflows/health-check.yml`:
```yaml
name: Daily Health Check

on:
  schedule:
    - cron: '0 0 * * *'  # 毎日 9:00 JST (0:00 UTC)
  workflow_dispatch:

jobs:
  health-check:
    runs-on: ubuntu-latest
    steps:
      - name: Check AI Status
        run: |
          RESPONSE=$(curl -s https://nebphrnnpmuqbkymwefs.functions.supabase.co/ai-trader)
          echo "Response: $RESPONSE"
          
          if echo "$RESPONSE" | grep -q '"ai_enabled":false'; then
            echo "❌ AI is NOT enabled!"
            exit 1
          else
            echo "✅ AI is enabled"
          fi
```

**設定後**:
- 毎日自動チェック
- 問題があればGitHubからメール通知
- スマホのGitHubアプリでも確認可能

---

## 🎯 クイックリファレンス（スマホ版）

| 確認項目 | 方法 | 所要時間 |
|---------|------|---------|
| **日次チェック** | ブラウザでURL開く | 10秒 |
| **ログ確認** | Supabase Dashboard | 2分 |
| **詳細調査** | PC推奨 | 5-10分 |

---

## 💡 スマホでの確認のコツ

### 1. ブックマークを整理
- 「AI Trader」フォルダを作成
- よく使うURLを保存

### 2. 通知を活用
- Supabaseのメール通知を有効化
- GitHub Actionsで自動チェック

### 3. 外出先では概要のみ確認
- 診断エンドポイントで `ai_enabled` をチェック
- 詳細な対処はPC環境で行う

### 4. 定期的な習慣化
- 毎朝の通勤時間に確認
- 週末にログをレビュー

---

## 🚨 問題発見時の対応（スマホ）

### ステップ1: 診断URLで確認
`ai_enabled: false` なら問題あり

### ステップ2: Supabase Dashboardでログ確認
エラーメッセージを確認

### ステップ3: 一時的な対応
- MT5 EAを一時停止（必要に応じて）
- 問題の記録（スクリーンショット）

### ステップ4: PC環境での本格対応
- OpenAI API Keyを確認・再設定
- Edge Functionを再デプロイ
- 詳細なトラブルシューティング

---

## ✅ まとめ

### 最も簡単な方法
```
https://nebphrnnpmuqbkymwefs.functions.supabase.co/ai-trader
```
をスマホのブラウザで開くだけ！

### 推奨設定
1. ブックマークまたはホーム画面に追加
2. Supabase Dashboard もブックマーク
3. 毎朝10秒の習慣にする

### 重要なポイント
- スマホで確認：日次の健康チェック
- PCで対応：問題発見時の詳細調査と修正

---

**今すぐ試してみてください！**
スマホのブラウザで https://nebphrnnpmuqbkymwefs.functions.supabase.co/ai-trader を開いて、ブックマークしましょう！
