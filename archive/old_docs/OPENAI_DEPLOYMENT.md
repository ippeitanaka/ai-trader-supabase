# OpenAI版AI-Traderへの切り替え完了手順

## ✅ 完了した作業

1. ✅ 現在のindex.tsをバックアップ (`index_fallback_backup.ts`)
2. ✅ OpenAI版をindex.tsにコピー

## 🚀 次のステップ（Supabase Dashboardで実行）

### 方法1: Supabase Dashboard経由（推奨）

1. **Supabase Dashboardにアクセス**
   - https://supabase.com/dashboard
   - プロジェクトを選択

2. **Edge Functionsに移動**
   - 左メニュー → "Edge Functions"

3. **ai-traderを選択**
   - "ai-trader" Functionをクリック

4. **コードを更新**
   - "Deploy new version"ボタンをクリック
   - または、自動的に再デプロイされる場合があります

5. **環境変数を確認**
   - "Settings" タブ
   - `OPENAI_API_KEY` が設定されているか確認

### 方法2: GitHub連携（自動デプロイ）

Supabaseプロジェクトをリポジトリに連携している場合：

1. **変更をコミット＆プッシュ**
   ```bash
   git add supabase/functions/ai-trader/index.ts
   git commit -m "feat: OpenAI GPT APIを使用したAI予測に切り替え"
   git push origin main
   ```

2. **自動デプロイを待つ**
   - Supabaseが自動的にデプロイ

### 方法3: Supabase CLI（ローカルにCLIがある場合）

```bash
# Supabase CLIのインストール（必要な場合）
npm install -g supabase

# ログイン
supabase login

# デプロイ
supabase functions deploy ai-trader

# ログ確認
supabase functions logs ai-trader --tail
```

---

## 🧪 動作確認

デプロイ後、MT5のエキスパートログで以下を確認：

### 期待されるログ

```
[INIT] EA 1.2.3 start (ML tracking enabled, config from EA properties only)
[CONFIG] Using EA properties -> MinWinProb=70%, Risk=1.50, RR=1.20, Lots=0.10, MaxPos=1
[M15] set dir=1 prob=78%    ← OpenAIからの予測！
```

### Supabase Functionログで確認

Supabase Dashboard → Edge Functions → ai-trader → Logs:

```
[AI] OpenAI prediction: 78.5% (high) - RSI oversold + MA trend aligned
[ai-trader] XAUUSD M15 dir=1 win=0.785
```

このログが表示されれば **OpenAI GPTが正常に動作しています！** 🎉

---

## 🔄 元に戻す方法（必要な場合）

OpenAI版で問題が発生した場合：

```bash
cd /workspaces/ai-trader-supabase/supabase/functions/ai-trader
cp index_fallback_backup.ts index.ts
# Supabase Dashboardで再デプロイ
```

---

## 📊 コスト確認

Supabase Dashboardで使用状況を監視：
- Dashboard → Settings → Usage
- OpenAI APIの使用量も確認：https://platform.openai.com/usage

月1000回実行で約$0.05（約7円）なので、コストは非常に低いです。

---

## 🎯 次に確認すること

1. ✅ Supabase DashboardでFunctionをデプロイ
2. ✅ MT5でEAを再起動
3. ✅ ログで"[AI] OpenAI prediction"が表示されるか確認
4. ✅ 勝率が以前より正確になっているか検証

準備完了！次はデプロイしてテストしましょう！🚀
