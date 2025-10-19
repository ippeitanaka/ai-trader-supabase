# MT5 EA 設定ガイド

## 📋 必要な情報

### 1. Supabase認証情報の取得

Supabase Dashboard を開く:
👉 https://supabase.com/dashboard/project/nebphrnnpmuqbkymwefs/settings/api

#### Project URL
```
場所: Configuration → API Settings → Project URL
値: https://nebphrnnpmuqbkymwefs.supabase.co
```

#### Service Role Key
```
場所: Configuration → API Settings → Project API keys
     → service_role (secret) の右側の "Copy" をクリック

⚠️ 重要: anon (public) ではなく service_role を使用してください
```

---

## 🔧 MT5 EA設定手順

### ステップ1: EAファイルの取得

このワークスペースから MT5 EAファイルをダウンロード:

```
ファイルパス: mt5/AI_QuadFusion_EA.mq5
```

### ステップ2: MT5にファイルをコピー

MT5のExpertsフォルダにコピー:

```
C:\Users\[ユーザー名]\AppData\Roaming\MetaQuotes\Terminal\
[ターミナルID]\MQL5\Experts\AI_QuadFusion_EA.mq5
```

**簡単な方法:**
1. MT5を開く
2. ツール → オプション → ファイルを開く
3. MQL5 → Experts フォルダを開く
4. AI_QuadFusion_EA.mq5 をコピー

### ステップ3: EAファイルを編集

MetaEditorでファイルを開いて、以下の部分を編集:

#### 現在の設定（38-44行目付近）:
```mql5
// ★ URLは自分のプロジェクトに合わせて設定
input string AI_Endpoint_URL     = "https://nebphrnnpmuqbkymwefs.supabase.co/functions/v1/ai-trader";
input string EA_Log_URL          = "https://nebphrnnpmuqbkymwefs.supabase.co/functions/v1/ea-log";
input string AI_Config_URL       = "https://nebphrnnpmuqbkymwefs.supabase.co/functions/v1/ai-config";
input string AI_Signals_URL      = "https://nebphrnnpmuqbkymwefs.supabase.co/functions/v1/ai-signals";
input string AI_Signals_Update_URL = "https://nebphrnnpmuqbkymwefs.supabase.co/functions/v1/ai-signals-update";
input string AI_Bearer_Token     = "YOUR_SERVICE_ROLE_KEY_HERE";
```

#### 編集する箇所:

**AI_Bearer_Token** の値を Service Role Key に置き換える:

```mql5
input string AI_Bearer_Token     = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ...";
```

⚠️ **注意:** 
- URLはすでに正しく設定されています（変更不要）
- `AI_Bearer_Token` のみ変更してください
- Service Role Keyは `eyJ` で始まる長い文字列です

### ステップ4: コンパイル

1. MetaEditorで「保存」(Ctrl+S)
2. 「コンパイル」ボタンをクリック (F7)
3. エラーがないことを確認

成功メッセージ例:
```
0 error(s), 0 warning(s)
AI_QuadFusion_EA.ex5 successfully created
```

---

## 🧪 デモ口座でのテスト

### ステップ1: MT5でデモ口座を開設

1. MT5を開く
2. ファイル → 新規デモ口座を開く
3. ブローカーを選択（推奨: XMTrading, FXTM など）
4. アカウント情報を入力
5. デモ口座を開設

### ステップ2: EAをチャートにセット

1. 対象通貨ペア（例: USDJPY）のチャートを開く
2. ナビゲーター → エキスパートアドバイザー
3. AI_QuadFusion_EA をチャートにドラッグ&ドロップ

### ステップ3: EA設定パラメータ

推奨設定（デモテスト用）:

```
【基本設定】
LockToChartSymbol: true        # チャートの通貨ペアに固定
TF_Entry: M15                  # エントリー判断の時間足
TF_Recheck: H1                 # 再確認の時間足

【リスク管理】
MinWinProb: 0.70              # 最低勝率 70%
RiskATRmult: 1.5              # ATRの1.5倍で損切り
RewardRR: 1.2                 # リスクリワード比 1:1.2
Lots: 0.01                    # デモテストは最小ロット

【接続設定】
AI_Endpoint_URL: (変更不要)
EA_Log_URL: (変更不要)
AI_Bearer_Token: [Service Role Key] ← ここだけ設定

【その他】
DebugLogs: true               # デバッグログを表示
LogCooldownSec: 30            # ログ出力間隔（秒）
```

### ステップ4: 自動売買を有効化

1. ツール → オプション → エキスパートアドバイザー
2. 「自動売買を許可する」にチェック
3. 「DLLの使用を許可する」にチェック
4. 「WebRequestを許可するURLリスト」に追加:
   ```
   https://nebphrnnpmuqbkymwefs.supabase.co
   ```
5. OK をクリック

6. チャート右上の「自動売買」ボタンをクリック（緑色になればOK）

---

## 📊 動作確認

### ログの確認

1. **ターミナルウィンドウ** → **エキスパート** タブ
2. 以下のようなログが表示されればOK:

```
2025.01.19 12:00:00  AI_QuadFusion_EA (USDJPY,M15)  OnInit() completed. Magic=26091501
2025.01.19 12:00:00  AI_QuadFusion_EA (USDJPY,M15)  [DEBUG] Calling AI Endpoint...
2025.01.19 12:00:02  AI_QuadFusion_EA (USDJPY,M15)  [AI Response] action=WAIT, confidence=0.65
```

### Supabase Dashboardでログ確認

1. Database → Table Editor → ea_log
   👉 https://supabase.com/dashboard/project/nebphrnnpmuqbkymwefs/editor

2. 最新のログが記録されていることを確認

3. ai_signals テーブルも確認
   - AIの判断履歴が記録されている

---

## 🚨 トラブルシューティング

### エラー: "URLへの接続が拒否されました"

**原因:** WebRequestのURL許可設定が不足

**解決方法:**
1. ツール → オプション → エキスパートアドバイザー
2. 「WebRequestを許可するURLリスト」に以下を追加:
   ```
   https://nebphrnnpmuqbkymwefs.supabase.co
   ```
3. MT5を再起動

### エラー: "401 Unauthorized"

**原因:** Service Role Key が間違っている

**解決方法:**
1. Supabase Dashboard で Service Role Key を再確認
2. MT5 EAの `AI_Bearer_Token` を正しい値に修正
3. 再コンパイル

### エラー: "AI応答がありません"

**原因:** Edge Functionがデプロイされていない

**解決方法:**
1. Supabase Dashboard → Edge Functions で関数を確認
   👉 https://supabase.com/dashboard/project/nebphrnnpmuqbkymwefs/functions

2. ai-trader, ea-log が表示されていることを確認

3. 表示されていない場合は GitHub Actions でデプロイを確認

### ログが記録されない

**原因:** Supabase Secrets が設定されていない

**解決方法:**
1. Edge Functions → Manage secrets
2. 以下が設定されているか確認:
   - OPENAI_API_KEY
   - OPENAI_MODEL

---

## ✅ 成功の確認

以下が確認できればセットアップ完了:

- [x] MT5 ターミナルに AI判断ログが表示される
- [x] Supabase の ea_log テーブルにログが記録される
- [x] Supabase の ai_signals テーブルにAI判断が記録される
- [x] エラーログがない
- [x] 自動売買ボタンが緑色（有効）

---

## 📈 本番運用への移行

デモ口座で1週間以上テストして、以下を確認:

1. **AI判断の精度**
   - 勝率が設定値（MinWinProb）以上か
   - 不適切なエントリーがないか

2. **リスク管理**
   - 損切りが正しく機能しているか
   - ポジションサイズが適切か

3. **システムの安定性**
   - 接続エラーがないか
   - ログが正常に記録されているか

問題がなければ、本番口座に移行してください。

**本番口座の設定:**
- ロットサイズを適切に調整（Lots: 0.01 → 0.10 など）
- MaxPositions: 1-2 を推奨
- MinWinProb: 0.70-0.75 を推奨

---

## 📚 関連ドキュメント

- [MT5 統合ガイド](MT5_INTEGRATION_GUIDE.md)
- [デプロイクイックリファレンス](DEPLOY_QUICK_REFERENCE.md)
- [本番環境デプロイガイド](PRODUCTION_DEPLOYMENT.md)

---

## 🆘 サポート

問題が発生した場合:

1. MT5のエキスパートログを確認
2. Supabase Dashboard のログを確認
3. GitHub Actions の実行ログを確認

すべて確認しても解決しない場合は、エラーメッセージをコピーして質問してください。
