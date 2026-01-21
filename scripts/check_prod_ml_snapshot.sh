#!/bin/bash
set -euo pipefail

# Production snapshot checker (no keys printed)
# - ai-trader health: confirms ml_mode/ml_phase/ml_applied_to_decisions
# - ml-training health: confirms latest training / active patterns
# - ai-signals health: confirms function is responding (requires auth header)

PROJECT_REF="${PROJECT_REF:-nebphrnnpmuqbkymwefs}"

AI_TRADER_URL="https://${PROJECT_REF}.functions.supabase.co/ai-trader"
ML_TRAINING_URL="https://${PROJECT_REF}.functions.supabase.co/ml-training"
AI_SIGNALS_URL="https://${PROJECT_REF}.functions.supabase.co/ai-signals"

if ! command -v supabase >/dev/null 2>&1; then
  echo "supabase CLI not found"
  exit 1
fi

if ! command -v python3 >/dev/null 2>&1; then
  echo "python3 not found"
  exit 1
fi

ANON_KEY=$(supabase projects api-keys --project-ref "$PROJECT_REF" --output json | python3 -c 'import sys,json; keys=json.load(sys.stdin); print([k for k in keys if k.get("name")=="anon"][0]["api_key"])')

echo "== ai-trader (health) =="
curl -sS "$AI_TRADER_URL" | python3 -m json.tool

echo ""
echo "== ml-training (health) =="
curl -sS "$ML_TRAINING_URL" | python3 -m json.tool

echo ""
echo "== ai-signals (health, authenticated) =="
curl -sS \
  -H "Authorization: Bearer $ANON_KEY" \
  -H "apikey: $ANON_KEY" \
  "$AI_SIGNALS_URL" | python3 -m json.tool

echo ""
echo "OK: snapshot complete"
