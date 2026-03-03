#!/usr/bin/env bash

set -euo pipefail

# Monthly cleanup for public."ea-log" only.
# Safety policy:
# - Never touches ai_signals or other tables.
# - Keeps ML/tax-critical real trade data intact.

SUPABASE_URL="${SUPABASE_URL:-}"
SUPABASE_SERVICE_ROLE_KEY="${SUPABASE_SERVICE_ROLE_KEY:-}"
RETENTION_DAYS="${RETENTION_DAYS:-120}"
DRY_RUN="${DRY_RUN:-false}"

if [[ -z "$SUPABASE_URL" || -z "$SUPABASE_SERVICE_ROLE_KEY" ]]; then
  echo "❌ SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required"
  exit 1
fi

if ! [[ "$RETENTION_DAYS" =~ ^[0-9]+$ ]]; then
  echo "❌ RETENTION_DAYS must be an integer: $RETENTION_DAYS"
  exit 1
fi

if (( RETENTION_DAYS < 30 )); then
  echo "❌ RETENTION_DAYS must be >= 30 for safety (current: $RETENTION_DAYS)"
  exit 1
fi

BASE_URL="${SUPABASE_URL%/}"
TABLE_ENDPOINT="${BASE_URL}/rest/v1/ea-log"

now_utc="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
cutoff_utc="$(date -u -d "-${RETENTION_DAYS} days" '+%Y-%m-%dT%H:%M:%SZ')"
cutoff_enc="$(printf '%s' "$cutoff_utc" | jq -sRr @uri)"

count_rows() {
  local url="$1"
  local headers
  headers="$({
    curl -sS -D - -o /dev/null "$url" \
      -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}" \
      -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
      -H "Prefer: count=exact"
  })"

  local content_range
  content_range="$(printf '%s\n' "$headers" | grep -i '^content-range:' | tail -n1 | cut -d' ' -f2- | tr -d '\r')"
  if [[ -z "$content_range" ]]; then
    echo "0"
    return
  fi

  # format: 0-0/123 or */0
  local total
  total="${content_range##*/}"
  if [[ "$total" =~ ^[0-9]+$ ]]; then
    echo "$total"
  else
    echo "0"
  fi
}

total_before="$(count_rows "${TABLE_ENDPOINT}?select=id&limit=1")"
older_before="$(count_rows "${TABLE_ENDPOINT}?select=id&created_at=lt.${cutoff_enc}&limit=1")"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🧹 Monthly cleanup (ea-log only)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "now_utc=${now_utc}"
echo "retention_days=${RETENTION_DAYS}"
echo "cutoff_utc=${cutoff_utc}"
echo "dry_run=${DRY_RUN}"
echo "ea_log_total_before=${total_before}"
echo "ea_log_older_before=${older_before}"

if [[ "$DRY_RUN" == "true" ]]; then
  echo "✅ DRY_RUN=true のため削除は実行しません"
  exit 0
fi

if (( older_before == 0 )); then
  echo "✅ 削除対象なし（ea-log older than ${RETENTION_DAYS} days = 0）"
  exit 0
fi

http_code="$(curl -sS -o /tmp/ea_log_cleanup_delete_body.txt -w '%{http_code}' -X DELETE \
  "${TABLE_ENDPOINT}?created_at=lt.${cutoff_enc}" \
  -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "Prefer: return=minimal")"

if [[ "$http_code" != "200" && "$http_code" != "204" ]]; then
  echo "❌ DELETE failed: http_code=${http_code}"
  cat /tmp/ea_log_cleanup_delete_body.txt || true
  exit 1
fi

total_after="$(count_rows "${TABLE_ENDPOINT}?select=id&limit=1")"
older_after="$(count_rows "${TABLE_ENDPOINT}?select=id&created_at=lt.${cutoff_enc}&limit=1")"
deleted_count=$(( older_before - older_after ))

echo "delete_http_code=${http_code}"
echo "ea_log_total_after=${total_after}"
echo "ea_log_older_after=${older_after}"
echo "ea_log_deleted=${deleted_count}"
echo "✅ Cleanup completed (ea-log only)"
