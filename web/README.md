# AI Trader Web Dashboard

Vercel に載せる前提の Next.js ダッシュボードです。以下を 1 画面で確認できます。

- 本日の推奨ペア / 非推奨ペア
- pair-selector の市場サマリーと digest
- 直近 5 件の EA ログ
- 直近の実トレードと保有中ポジション
- 指定期間の成績
- 総合成績

## ローカル起動

1. `web/.env.local` を作成して、少なくとも以下を設定します。

```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
```

`SUPABASE_URL` と `NEXT_PUBLIC_SUPABASE_URL` には Supabase プロジェクトのルート URL を入れてください。`https://...supabase.co/rest/v1` や `https://...supabase.co/functions/v1` のような API パス付き URL は付けません。

2. 依存関係を入れます。

```bash
cd web
npm install
```

3. 開発サーバーを起動します。

```bash
npm run dev
```

4. ブラウザで `http://localhost:3000` を開きます。

## API

- 画面用 API: `/api/dashboard?period=30`
- `period` は `7`, `30`, `90`, `365`, `all` を指定可能です。

## Vercel 接続手順

1. Vercel にログインします。
2. `Add New Project` を押します。
3. GitHub を連携して、このリポジトリ `ai-trader-supabase` を選択します。
4. `Root Directory` を `web` に設定します。
5. Framework Preset は `Next.js` を選びます。
6. Environment Variables に以下を登録します。

```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
```

ここでも URL は `https://your-project.supabase.co` を指定してください。

7. `Deploy` を押します。
8. 初回デプロイ後、Vercel の `Project Settings -> Domains` で独自ドメインを追加できます。

## 運用メモ

- `SUPABASE_SERVICE_ROLE_KEY` はサーバー側でのみ利用します。
- `NEXT_PUBLIC_` が付く値はブラウザから参照可能です。秘密鍵は入れないでください。
- pair-selector の digest や economic_events の日本語ラベルはこの画面でも利用されます。
