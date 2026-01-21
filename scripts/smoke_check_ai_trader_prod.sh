#!/bin/bash
set -euo pipefail

# Smoke test for production ai-trader Edge Function
#
# Goal:
# - Confirm the deployed function includes the new EV/cost gating diagnostics.
# - Specifically, we expect these fields in the JSON response:
#     - cost_r
#     - cost_r_source
#   and the reasoning to include a "GATE(" suffix.
#
# Usage:
#   bash scripts/smoke_check_ai_trader_prod.sh
#   FUNCTION_URL="https://<project>.functions.supabase.co/ai-trader" bash scripts/smoke_check_ai_trader_prod.sh

FUNCTION_URL=${FUNCTION_URL:-"https://nebphrnnpmuqbkymwefs.functions.supabase.co/ai-trader"}

echo "[smoke] GET $FUNCTION_URL"
GET_JSON=$(curl -s "$FUNCTION_URL")
GET_VERSION=$(echo "$GET_JSON" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("version"))' 2>/dev/null || true)
echo "[smoke] version=${GET_VERSION:-unknown}"

# Build a realistic payload (matches TradeRequest shape)
PAYLOAD_JSON=$(python3 - <<'PY'
import json
payload={
  "symbol":"XAUUSD",
  "timeframe":"M15",
  "min_win_prob":0.55,
  "price":2050.0,
  "bid":2049.95,
  "ask":2050.05,
  "ema_25":2049.0,
  "sma_100":2048.0,
  "sma_200":2047.0,
  "sma_800":2040.0,
  "ma_cross":1,
  "rsi":55.0,
  "atr":2.0,
  "macd": {"main":0.5,"signal":0.4,"histogram":0.1,"cross":1},
  "ichimoku": {"tenkan":2049.5,"kijun":2048.5,"senkou_a":2048.8,"senkou_b":2047.9,"chikou":2050.0,"tk_cross":1,"cloud_color":1,"price_vs_cloud":1},
  "ea_suggestion": {"dir":0,"tech_dir":1,"reason":"smoke_test","ichimoku_score":60}
}
print(json.dumps(payload))
PY
)

echo "[smoke] POST $FUNCTION_URL"
RESP=$(echo "$PAYLOAD_JSON" | curl -s -X POST "$FUNCTION_URL" -H 'content-type: application/json' --data-binary @-)

# Assertions
printf '%s' "$RESP" | python3 -c 'import json,sys
resp=json.load(sys.stdin)
missing=[]
for k in ("cost_r","cost_r_source"):
    if k not in resp:
        missing.append(k)
reasoning=(resp.get("reasoning") or "")
if "GATE(" not in reasoning:
    missing.append("reasoning:GATE(")
if missing:
    print("[smoke] FAIL: missing diagnostics:", ", ".join(missing))
    print("[smoke] Tip: deploy updated edge function (ai-trader) and retry.")
    sys.exit(2)
print("[smoke] OK: diagnostics present")
print("[smoke] cost_r_source=", resp.get("cost_r_source"))
print("[smoke] cost_r=", resp.get("cost_r"))
'
