
[![healthcheck](https://github.com/ippeitanaka/ai-trader-supabase/actions/workflows/healthcheck.yml/badge.svg)](https://github.com/ippeitanaka/ai-trader-supabase/actions/workflows/healthcheck.yml)

# ai-trader-supabase

Supabase Edge Functions backend for MT5 AI Trading EA (Expert Advisor).

## 🎯 Overview

This repository provides the backend infrastructure for **AI_QuadFusion_EA v1.3.0**, a MetaTrader 5 Expert Advisor that integrates AI-powered trading signals with Supabase Edge Functions.

### ⭐ Latest Update (v1.3.0 EA + v2.2.0 Edge Functions)
**Ichimoku Kinko Hyo (一目均衡表) Full Integration + Comprehensive Diagnostics** - AI-Powered Quad Fusion!
- 🎯 **EA v1.3.0**: 4 technical indicators: RSI + ATR + Moving Averages + **Ichimoku** 
- 🧠 **AI v2.2.0**: OpenAI GPT-4 deeply understands Ichimoku signals for smarter predictions
- 🔍 Signal quality classification (excellent/good/moderate/weak/conflicting)
- 🛡️ Conflict detection: Skip trades when indicators disagree
- 📊 Dynamic win probability ranges based on signal quality
- 🩺 **NEW: Comprehensive diagnostic system** - Detect OpenAI API issues instantly
- ⚠️ **NEW: Enhanced logging** - Track prediction method (OpenAI vs Fallback)
- 🔧 **NEW: Health check script** - Daily monitoring tool (`./health_check.sh`)
- See docs: [ICHIMOKU_INTEGRATION.md](./ICHIMOKU_INTEGRATION.md) | [CHECK_AI_STATUS.md](./CHECK_AI_STATUS.md)

### Architecture

```
MT5 EA (MQL5) ←→ Supabase Edge Functions ←→ PostgreSQL Database
```

- **MT5 EA**: Sends technical indicators and receives AI trading signals
- **Edge Functions**: Process requests, calculate signals, manage configuration
- **Database**: Store logs, configuration, and optional signal history

## � Project Structure

```
ai-trader-supabase/
├── supabase/
│   ├── functions/              # Edge Functions (TypeScript/Deno)
│   │   ├── ai-trader/         # メイン取引シグナルエンドポイント
│   │   ├── ai-config/         # 動的設定管理
│   │   ├── ea-log/            # EAログ保存
│   │   ├── ai-signals/        # シグナル履歴（オプション）
│   │   ├── ai-signals-update/ # シグナル更新
│   │   └── ai-reason/         # AI推論ログ
│   ├── migrations/            # データベースマイグレーション
│   └── config.toml            # Supabase設定
├── mt5/
│   ├── AI_TripleFusion_EA.mq5 # MT5 Expert Advisor
│   └── README.md              # EA マニュアル
├── archive/                   # 古いファイル・バックアップ（保守用）
│   ├── backup_functions/      # 旧バージョンのEdge Functions
│   ├── old_docs/              # 初期開発ドキュメント
│   └── old_sql/               # 移行前の個別SQLファイル
├── deno.json                  # Deno設定
└── README.md                  # このファイル
```

> **Note**: `archive/` ディレクトリには過去のバックアップと開発履歴が保存されています。
> 現在のプロジェクトでは使用されていませんが、参考用に保持されています。

## 🚀 Quick Start

### Daily Health Check (30 seconds)

#### 💻 PC/Terminal
```bash
./health_check.sh
```
Expected output: `✅ ステータス: 正常` with `ai_enabled: true`

#### 📱 Smartphone
Open in browser: https://nebphrnnpmuqbkymwefs.functions.supabase.co/ai-trader

Or scan QR code:
```bash
./generate_qr.sh
```

See [MOBILE_HEALTH_CHECK.md](./MOBILE_HEALTH_CHECK.md) for smartphone usage guide.

### Deploy Edge Functions
```bash
supabase functions deploy ai-trader
```

### Verify Deployment
```bash
curl https://nebphrnnpmuqbkymwefs.functions.supabase.co/ai-trader
```

See [DEPLOYMENT_CHECKLIST.md](./DEPLOYMENT_CHECKLIST.md) for detailed setup instructions.

## �📦 Components

### Supabase Edge Functions

#### 1. `ai-trader` - AI Trading Signal Endpoint (v2.2.0)
- **Purpose**: Receives technical indicator data from EA and returns trading signals
- **Method**: POST
- **Features**:
  - NUL byte removal for MQL5 compatibility
  - RSI-based signal calculation
  - ATR-based volatility adjustment
  - **⭐ NEW: Ichimoku score integration** - Enhanced signal confidence with 一目均衡表
  - OpenAI GPT-4 integration for smart predictions
  - Win probability estimation with ML learning
  - Dynamic offset and expiry calculation
  - Console logging for monitoring
  - Optional storage to `ai_signals` table

**Request Example** (v1.3.0+):
```json
{
  "symbol": "BTCUSD",
  "timeframe": "M15",
  "dir": 1,
  "rsi": 62.5,
  "atr": 0.00085,
  "ichimoku_score": 1.0,
  "price": 43250.50,
  "reason": "MA↑",
  "instance": "main",
  "version": "1.2.2"
}
```

**Response Example**:
```json
{
  "win_prob": 0.742,
  "action": 1,
  "offset_factor": 0.180,
  "expiry_minutes": 90
}
```

#### 2. `ea-log` - EA Log Storage
- **Purpose**: Stores EA activity logs for analysis and monitoring
- **Method**: POST
- **Features**:
  - NUL byte removal
  - Timestamp normalization
  - Fallback handling for missing columns
  - Console logging

**Request Example**:
```json
{
  "at": "2025-10-13T00:15:00Z",
  "sym": "BTCUSD",
  "tf": "M15",
  "rsi": 62.5,
  "atr": 0.00085,
  "price": 43250.50,
  "action": "BUY",
  "win_prob": 0.742,
  "offset_factor": 0.180,
  "expiry_minutes": 90,
  "reason": "MA↑",
  "instance": "main",
  "version": "1.2.2",
  "caller": "M15"
}
```

#### 3. `ai-config` - Dynamic Configuration
- **Purpose**: Returns configuration parameters for EA instances
- **Method**: GET
- **Features**:
  - `maybeSingle()` for safe row handling
  - Default values fallback
  - Per-instance configuration
  - Console logging

**Request**: `GET /ai-config?instance=main`

**Response Example**:
```json
{
  "min_win_prob": 0.70,
  "pending_offset_atr": 0.20,
  "pending_expiry_min": 90,
  "instance": "main",
  "updated_at": "2025-10-13T00:00:00Z"
}
```

### Database Tables

#### 1. `ea-log` - EA Activity Logs
```sql
CREATE TABLE "ea-log" (
  id BIGSERIAL PRIMARY KEY,
  at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sym TEXT,
  tf TEXT,
  rsi DOUBLE PRECISION,
  atr DOUBLE PRECISION,
  price DOUBLE PRECISION,
  action TEXT,
  win_prob DOUBLE PRECISION,
  offset_factor DOUBLE PRECISION,
  expiry_minutes INTEGER,
  reason TEXT,
  instance TEXT,
  version TEXT,
  caller TEXT
);
```

#### 2. `ai_config` - Dynamic Configuration
```sql
CREATE TABLE ai_config (
  id BIGSERIAL PRIMARY KEY,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  instance TEXT UNIQUE,
  min_win_prob DOUBLE PRECISION,
  pending_offset_atr DOUBLE PRECISION,
  pending_expiry_min INTEGER
);
```

#### 3. `ai_signals` - Signal History (Optional)
```sql
CREATE TABLE ai_signals (
  id BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  symbol TEXT,
  timeframe TEXT,
  dir INTEGER,
  win_prob DOUBLE PRECISION,
  atr DOUBLE PRECISION,
  rsi DOUBLE PRECISION,
  price DOUBLE PRECISION,
  reason TEXT,
  instance TEXT,
  model_version TEXT
);
```

## 🚀 Deployment

### 1. Setup Supabase Project
```bash
# Install Supabase CLI
npm install -g supabase

# Login to Supabase
supabase login

# Link to your project
supabase link --project-ref YOUR_PROJECT_REF
```

### 2. Run Migrations
```bash
# Apply database migrations
supabase db push

# Or manually run migrations in order:
# - 20251013_001_create_ea_log_table.sql
# - 20251013_002_create_ai_config_table.sql
# - 20251013_003_create_ai_signals_table.sql
```

### 3. Set Required Secrets

Edge Functions require these environment variables:

| Secret Name | Description | Example |
|------------|-------------|---------|
| `SUPABASE_URL` | Your Supabase project URL | `https://abcdefgh.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key (Settings → API) | `eyJ...` |

```bash
# Set secrets
supabase secrets set SUPABASE_URL=https://YOUR_PROJECT.supabase.co
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=YOUR_SERVICE_ROLE_KEY

# Verify secrets
supabase secrets list
```

### 4. Deploy Edge Functions

Deploy all three functions:

```bash
# Deploy individually
supabase functions deploy ai-trader
supabase functions deploy ea-log
supabase functions deploy ai-config

# Or deploy all at once (if supported)
supabase functions deploy
```

**Endpoint URLs** will be:
- `https://<project-ref>.functions.supabase.co/ai-trader`
- `https://<project-ref>.functions.supabase.co/ea-log`
- `https://<project-ref>.functions.supabase.co/ai-config`

### 5. Configure MT5 EA

#### Allow WebRequest URLs in MT5

1. Open MT5: **Tools → Options → Expert Advisors**
2. Check "Allow WebRequest for listed URL:"
3. Add: `https://<project-ref>.functions.supabase.co`

#### Update EA Parameters
Update the EA parameters with your Supabase URLs:
```mql5
input string AI_Endpoint_URL = "https://YOUR_PROJECT.functions.supabase.co/ai-trader";
input string EA_Log_URL = "https://YOUR_PROJECT.functions.supabase.co/ea-log";
input string AI_Config_URL = "https://YOUR_PROJECT.functions.supabase.co/ai-config";
input string AI_Bearer_Token = "YOUR_SERVICE_ROLE_KEY";
```

## 📊 Monitoring

### Console Logs

**ai-trader**:
```
[ai-trader] symbol=BTCUSD tf=M15 dir=1 win=0.742 off=0.180 exp=90 inst=main ver=1.2.2
```

**ea-log**:
```
[ea-log] at=2025-10-13T00:15Z sym=BTCUSD tf=M15 caller=M15 win_prob=0.742
```

**ai-config**:
```
[ai-config] ok inst=main min=0.70 off=0.20 exp=90
```

### Query Logs
```sql
-- Recent EA logs
SELECT * FROM "ea-log" ORDER BY at DESC LIMIT 100;

-- Signals by symbol
SELECT sym, COUNT(*), AVG(win_prob) 
FROM "ea-log" 
WHERE action IN ('BUY', 'SELL')
GROUP BY sym;

-- Config history
SELECT * FROM ai_config ORDER BY updated_at DESC;
```

## 🔧 Configuration Management

Update EA configuration dynamically:
```sql
UPDATE ai_config 
SET 
  min_win_prob = 0.75,
  pending_offset_atr = 0.25,
  pending_expiry_min = 120,
  updated_at = NOW()
WHERE instance = 'main';
```

## � Technical Details

### NUL Byte Handling

MQL5's `WebRequest()` can append trailing NUL bytes (`\u0000`) to JSON payloads. All Edge Functions handle this:

```typescript
// Read as text first
const raw = await req.text();
// Remove trailing NUL bytes
const safe = raw.replace(/\u0000+$/g, "");
// Parse cleaned JSON
const body = JSON.parse(safe);
```

**Why this approach:**
- MQL5 `StringToCharArray()` adds NUL terminators
- Direct `req.json()` fails with `SyntaxError: Unexpected token`
- Text-based cleaning ensures compatibility

### Safe Query Pattern

The `ai-config` function uses `.maybeSingle()` instead of `.single()`:

```typescript
const { data, error } = await supabase
  .from("ai_config")
  .select("*")
  .eq("instance", instance)
  .maybeSingle();  // Returns null if no rows, first row if multiple
```

**Benefits:**
- No error when table is empty
- Graceful handling of multiple rows
- Always returns default config as fallback

### Column Fallback Strategy

The `ea-log` function implements retry logic for missing columns:

```typescript
let { error } = await supabase.from("ea-log").insert(logEntry);

// Retry without optional columns if they don't exist
if (error && (error.message.includes("offset_factor") || error.message.includes("expiry_minutes"))) {
  const fallbackEntry = { ...logEntry };
  delete fallbackEntry.offset_factor;
  delete fallbackEntry.expiry_minutes;
  
  const result = await supabase.from("ea-log").insert(fallbackEntry);
  error = result.error;
}
```

**Why:**
- Backward compatibility with older table schemas
- No 500 errors due to schema mismatch
- Allows gradual migration

## �📝 EA v1.2.2 Update Summary (2025-10-13)

### Changes
- ✅ **NUL byte removal**: All functions use `raw.replace(/\u0000+$/g, "")` pattern
- ✅ **Console logging**: Structured logs with `[function-name]` prefix
- ✅ **CORS support**: Complete GET/POST/OPTIONS with proper headers
- ✅ **maybeSingle()**: Safe query method in ai-config
- ✅ **Default fallback**: ai-config returns `{min_win_prob:0.7, pending_offset_atr:0.2, pending_expiry_min:90}`
- ✅ **Column fallback**: ea-log retries without offset_factor/expiry_minutes on failure
- ✅ **Migrations**: Three DDL files with `IF NOT EXISTS` clauses

### Maintenance & Updates (2025-10-15)

#### プロジェクトメンテナンス
- **アーカイブ化**: バックアップファイルと古いドキュメントを `archive/` ディレクトリに移動
- **ファイル整理**: 
  - Edge Functions のバックアップ (`index_fallback_backup.ts`, `index_with_openai.ts`)
  - 個別SQLファイル（マイグレーションに統合済み）
  - 初期開発ドキュメント（13ファイル）
- **構造改善**: プロジェクト構造をより明確に整理

#### 診断システムの追加
- **OpenAI API Key 検証強化**: 長さチェック、プレースホルダー検出
- **予測方法トラッキング**: `OpenAI-GPT`, `Fallback-NoKey`, `Fallback-AfterAI-Error`
- **詳細ロギング**: 各ステップで明確なログメッセージと警告
- **診断エンドポイント**: GET `/ai-trader` で `ai_enabled` と `openai_key_status` を返す
- **健康チェックスクリプト**: `./health_check.sh` で日次監視が可能

#### 新規ドキュメント
- [CHECK_AI_STATUS.md](./CHECK_AI_STATUS.md) - AI接続状況の確認方法（詳細ガイド）
- [QUICK_DIAGNOSIS.md](./QUICK_DIAGNOSIS.md) - クイック診断チートシート
- [OPENAI_TROUBLESHOOTING.md](./OPENAI_TROUBLESHOOTING.md) - トラブルシューティングガイド
- [DEPLOYMENT_CHECKLIST.md](./DEPLOYMENT_CHECKLIST.md) - デプロイ前チェックリスト
- [DIAGNOSTIC_CHANGES.md](./DIAGNOSTIC_CHANGES.md) - コード変更の詳細

## 🔐 Security

- Use **Service Role Key** for Edge Functions (stored as secret)
- Never commit secrets to git
- Consider adding API key authentication for production
- Enable Row Level Security (RLS) on tables if needed

## 📚 Resources

- [Supabase Edge Functions Documentation](https://supabase.com/docs/guides/functions)
- [MT5 EA Documentation](./mt5/README.md)
- [MQL5 WebRequest Documentation](https://www.mql5.com/en/docs/network/webrequest)

## 🤝 Contributing

This is a personal trading project. Use at your own risk.

## ⚠️ Disclaimer

**This is experimental trading software. Use only with demo accounts for testing. Real trading involves significant financial risk.**
