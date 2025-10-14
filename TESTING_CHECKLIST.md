# EA と Supabase の完璧な動作確認手順

## ✅ 確認完了項目

### 1. Edge Functions のデプロイ状態
- [x] **ai-trader**: デプロイ済み (60.63kB)
- [x] **ea-log**: デプロイ済み (60.75kB)
- [x] **ai-config**: デプロイ済み (60.63kB)

### 2. Edge Functions の稼働確認

#### ai-trader (GET リクエスト)
```bash
curl https://nebphrnnpmuqbkymwefs.supabase.co/functions/v1/ai-trader
```
**期待値**: `{"ok":true,"service":"ai-trader","version":"1.2.2"}`
**結果**: ✅ 正常

#### ai-trader (POST リクエスト - トレードシグナル計算)
```bash
curl -X POST https://nebphrnnpmuqbkymwefs.supabase.co/functions/v1/ai-trader \
  -H "Content-Type: application/json" \
  -d '{
    "symbol": "USDJPY",
    "timeframe": "M15",
    "dir": 1,
    "rsi": 35.5,
    "atr": 0.0008,
    "price": 149.850,
    "reason": "Test from curl",
    "instance": "Test-001",
    "version": "1.2.2"
  }'
```
**期待値**: `{"win_prob":0.52,"action":0,"offset_factor":0.2,"expiry_minutes":90}`
**結果**: ✅ 正常

#### ea-log (POST リクエスト - ログ保存)
```bash
curl -X POST https://nebphrnnpmuqbkymwefs.supabase.co/functions/v1/ea-log \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_ANON_KEY" \
  -d '{
    "at": "2025-10-13T04:30:00Z",
    "sym": "EURUSD",
    "tf": "H1",
    "rsi": 72.5,
    "atr": 0.0012,
    "price": 1.0850,
    "action": "SELL",
    "win_prob": 0.75,
    "offset_factor": 0.25,
    "expiry_minutes": 90,
    "reason": "RSI overbought",
    "instance": "Demo-EA-001",
    "version": "1.2.2",
    "caller": "OnH1NewBar"
  }'
```
**期待値**: `{"ok":true}`
**結果**: ✅ HTTP 200 (但しDBに未反映の可能性)

## ⚠️ 要確認項目

### 3. データベーステーブルの確認

#### テーブル存在確認
```bash
# ea-log テーブル
curl "https://nebphrnnpmuqbkymwefs.supabase.co/rest/v1/ea-log?limit=1" \
  -H "apikey: YOUR_ANON_KEY" \
  -H "Authorization: Bearer YOUR_ANON_KEY"

# ai_config テーブル
curl "https://nebphrnnpmuqbkymwefs.supabase.co/rest/v1/ai_config?limit=1" \
  -H "apikey: YOUR_ANON_KEY" \
  -H "Authorization: Bearer YOUR_ANON_KEY"

# ai_signals テーブル
curl "https://nebphrnnpmuqbkymwefs.supabase.co/rest/v1/ai_signals?limit=1" \
  -H "apikey: YOUR_ANON_KEY" \
  -H "Authorization: Bearer YOUR_ANON_KEY"
```
**現状**: ⚠️ テーブルは存在するが、データが空またはアクセス権限の問題

### 4. マイグレーション適用状態

#### マイグレーションファイル
- `20251013_001_create_ea_log_table.sql` - ea-log テーブル作成
- `20251013_002_create_ai_config_table.sql` - ai_config テーブル作成
- `20251013_003_create_ai_signals_table.sql` - ai_signals テーブル作成

**現状**: ⚠️ 既存テーブルと新しいマイグレーションでスキーマ不一致

#### マイグレーション適用コマンド
```bash
SUPABASE_ACCESS_TOKEN="YOUR_TOKEN" npx supabase db push
```
**結果**: ⚠️ カラム不一致エラー（pending_offset_atr等が存在しない）

## 🔧 必要な対応

### 1. Supabase Dashboard で直接確認
URL: https://supabase.com/dashboard/project/nebphrnnpmuqbkymwefs

#### Database → Tables で確認すべき項目:
- [ ] `ea-log` テーブルの存在とスキーマ
- [ ] `ai_config` テーブルの存在とスキーマ
- [ ] `ai_signals` テーブルの存在とスキーマ
- [ ] 各テーブルのRow Level Security (RLS) 設定
- [ ] anon ロールの権限設定

#### Database → Logs で確認すべき項目:
- [ ] ea-log関数からのINSERTクエリの実行状況
- [ ] エラーメッセージの有無
- [ ] RLS違反の有無

### 2. Row Level Security (RLS) の確認と設定

**問題の可能性**: ea-log テーブルにRLSが有効で、anonロールが書き込めない

**確認SQL**:
```sql
-- RLS設定を確認
SELECT tablename, rowsecurity 
FROM pg_tables 
WHERE schemaname = 'public' 
  AND tablename IN ('ea-log', 'ai_config', 'ai_signals');

-- ポリシーを確認
SELECT * FROM pg_policies 
WHERE tablename IN ('ea-log', 'ai_config', 'ai_signals');
```

**修正SQL** (Dashboard の SQL Editor で実行):
```sql
-- ea-log テーブルへの書き込みを許可
ALTER TABLE public."ea-log" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow anon insert to ea-log" 
ON public."ea-log"
FOR INSERT 
TO anon
WITH CHECK (true);

CREATE POLICY "Allow authenticated insert to ea-log" 
ON public."ea-log"
FOR INSERT 
TO authenticated
WITH CHECK (true);

CREATE POLICY "Allow service role full access to ea-log" 
ON public."ea-log"
FOR ALL 
TO service_role
USING (true);
```

### 3. MT5 EA からの実際のテスト

#### MT5の EA設定で以下を確認:
1. **EA Parameters**:
   - `UseTrading` = true
   - `UseOnlyM15` または `UseOnlyH1` = true（テスト用）
   - `DebugLog` = true
   
2. **EA の Experts タブで以下を確認**:
   - HTTPリクエストの送信ログ
   - レスポンスコードが 200 OK
   - JSON parse エラーが出ていないこと

3. **MT5 のログファイルを確認**:
   - `C:\Users\...\AppData\Roaming\MetaQuotes\Terminal\...\MQL5\Logs\`
   - `[ai-trader]` または `[ea-log]` で検索
   - エラーメッセージの確認

### 4. Supabase Logs でリアルタイム監視

**手順**:
1. Dashboard → Logs → Edge Functions
2. 関数名で `ea-log` を選択
3. MT5 EAから実際のリクエストを送信
4. ログに以下が表示されることを確認:
   - `[ea-log] USDJPY M15 OnM15NewBar`
   - または対応するログエントリ

**期待されるログ**:
```
[ea-log] at=2025-10-13T... sym=USDJPY tf=M15 caller=OnM15NewBar win_prob=0.XXX
```

**エラーの場合**:
```
[ea-log] DB error: { message: "...", code: "..." }
```

## 📋 完璧な動作確認チェックリスト

### Phase 1: Supabase Dashboard 確認
- [ ] Tables: ea-log, ai_config, ai_signals が存在
- [ ] Tables: 各テーブルのカラム構成が正しい
- [ ] Tables: RLS設定が適切（anonロールが書き込み可能）
- [ ] Functions: 3つの関数が緑色（デプロイ済み）
- [ ] Logs: エラーなし

### Phase 2: cURL テスト
- [x] ai-trader GET → 200 OK
- [x] ai-trader POST → 200 OK, valid JSON response
- [x] ea-log POST → 200 OK
- [ ] ea-log POST後、Tableにデータが入っている

### Phase 3: MT5 EA テスト
- [ ] EA を新しいチャートにアタッチ
- [ ] Expert タブで `[ai-trader]` リクエスト成功ログ
- [ ] Expert タブで `[ea-log]` ログ送信成功ログ
- [ ] Supabase Logsでリクエスト受信を確認
- [ ] Supabase Tableにデータが蓄積されている

### Phase 4: エンドツーエンドテスト
- [ ] MT5で15分または1時間待機
- [ ] OnM15NewBar または OnH1NewBar が発火
- [ ] ai-trader から win_prob が返る
- [ ] win_prob >= 0.70 の場合、action が設定される
- [ ] ea-log にすべての情報が記録される
- [ ] Supabaseで過去のトレード履歴を確認可能

## 🔑 認証情報

### Anon Key (Public API Key)
```
eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5lYnBocm5ucG11cWJreW13ZWZzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTg1Mzg1MTUsImV4cCI6MjA3NDExNDUxNX0.RdjsC8R9Vxpb12IjaOTAHcBT0H1PippA6ixLDSYSBKI
```

### Project URL
```
https://nebphrnnpmuqbkymwefs.supabase.co
```

### MT5 EA での設定
EA Parameters → Input Parameters:
- `SupabaseUrl` = `https://nebphrnnpmuqbkymwefs.supabase.co`
- `SupabaseAnonKey` = 上記 Anon Key

## 🎯 次のアクション

1. **Supabase Dashboard にアクセス**
   - https://supabase.com/dashboard/project/nebphrnnpmuqbkymwefs
   
2. **Database → Tables で ea-log を開く**
   - スキーマを確認
   - RLS設定を確認
   - 手動でテストレコードを挿入してみる
   
3. **Database → SQL Editor で RLS ポリシーを追加**
   - 上記の修正SQLを実行
   
4. **再度 cURL でテスト**
   - ea-log に POST
   - Table にデータが入ることを確認
   
5. **MT5 EA で実地テスト**
   - 新しいチャートにアタッチ
   - Expert タブでログ監視
   - Supabase Logs でリアルタイム確認

---

**現在の状態**: 
- ✅ Edge Functions は正常にデプロイ済み
- ✅ ai-trader は完全に動作
- ⚠️ ea-log は 200 OK を返すが、DBへの書き込みが未確認
- ⚠️ RLS設定またはテーブル権限の問題の可能性が高い

**最優先対応**: Supabase Dashboard で ea-log テーブルのRLS設定を確認・修正
