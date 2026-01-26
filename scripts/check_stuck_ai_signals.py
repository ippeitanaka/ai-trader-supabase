#!/usr/bin/env python3

import argparse
import json
import os
import subprocess
from datetime import datetime, timedelta, timezone
from typing import Any
import urllib.parse
import urllib.request


def get_service_role_key(project_ref: str) -> str:
    env_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if env_key:
        return env_key

    keys_json = subprocess.check_output(
        ["supabase", "projects", "api-keys", "--project-ref", project_ref, "-o", "json"],
        text=True,
    )
    keys = json.loads(keys_json)
    keys_list = keys.get("keys") if isinstance(keys, dict) else keys
    return [k for k in keys_list if k.get("name") == "service_role"][0]["api_key"]


def http_get_json(url: str, headers: dict[str, str]) -> Any:
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read())


def count_exact(base: str, headers: dict[str, str], table: str, and_filter: str) -> int:
    params = {
        "select": "id",
        "and": and_filter,
    }
    url = f"{base}/{table}?{urllib.parse.urlencode(params, safe=':,()><=')}"
    req = urllib.request.Request(url, headers={**headers, "Prefer": "count=exact"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        content_range = resp.headers.get("Content-Range", "")
        return int(content_range.split("/")[-1]) if "/" in content_range else 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Check stuck ai_signals rows (non-virtual).")
    parser.add_argument(
        "--project-ref",
        default=os.environ.get("PROJECT_REF", "nebphrnnpmuqbkymwefs"),
        help="Supabase project ref (default: env PROJECT_REF or nebphrnnpmuqbkymwefs)",
    )
    parser.add_argument(
        "--filled-max-age-hours",
        type=float,
        default=48.0,
        help="Report FILLED & no-close rows older than this many hours (default: 48)",
    )
    parser.add_argument(
        "--pending-max-age-hours",
        type=float,
        default=24.0,
        help="Report PENDING rows older than this many hours (default: 24)",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=20,
        help="How many rows to print for each category (default: 20)",
    )

    args = parser.parse_args()

    base = os.environ.get("SUPABASE_URL") or f"https://{args.project_ref}.supabase.co/rest/v1"
    if base.endswith(".supabase.co"):
        base = base + "/rest/v1"

    key = get_service_role_key(args.project_ref)
    headers = {"apikey": key, "Authorization": f"Bearer {key}"}

    now = datetime.now(timezone.utc)
    iso_filled_cutoff = (now - timedelta(hours=args.filled_max_age_hours)).isoformat()
    iso_pending_cutoff = (now - timedelta(hours=args.pending_max_age_hours)).isoformat()

    filled_filter = (
        f"(is_virtual.eq.false,actual_result.eq.FILLED,closed_at.is.null,"
        f"exit_price.is.null,profit_loss.is.null,created_at.lt.{iso_filled_cutoff})"
    )
    pending_filter = (
        f"(is_virtual.eq.false,actual_result.eq.PENDING,created_at.lt.{iso_pending_cutoff})"
    )

    filled_count = count_exact(base, headers, "ai_signals", filled_filter)
    pending_count = count_exact(base, headers, "ai_signals", pending_filter)

    print("=== ai_signals stuck check ===")
    print(f"project_ref={args.project_ref}")
    print(f"now_utc={now.isoformat()}")
    print("")
    print(f"FILLED & no-close & age>{args.filled_max_age_hours}h: {filled_count}")
    print(f"PENDING & age>{args.pending_max_age_hours}h: {pending_count}")

    # Print details for FILLED
    if filled_count:
        params = {
            "select": "id,created_at,symbol,timeframe,order_ticket,entry_price,actual_result,closed_at",
            "and": filled_filter,
            "order": "created_at.asc",
            "limit": str(args.limit),
        }
        url = f"{base}/ai_signals?{urllib.parse.urlencode(params, safe=':,()><=')}"
        rows = http_get_json(url, headers)
        print("\n--- oldest FILLED no-close (stuck candidates) ---")
        for r in rows:
            print(
                f"{r['created_at']} {r.get('symbol')} {r.get('timeframe')} "
                f"ticket={r.get('order_ticket')} id={r.get('id')}"
            )
        print("\nNOTE: FILLED & closed_at NULL は『保有中』の可能性があります。MT5で未保有確認後にのみ、ticket限定で整理してください。")

    # Print details for PENDING
    if pending_count:
        params = {
            "select": "id,created_at,symbol,timeframe,order_ticket,actual_result,closed_at",
            "and": pending_filter,
            "order": "created_at.asc",
            "limit": str(args.limit),
        }
        url = f"{base}/ai_signals?{urllib.parse.urlencode(params, safe=':,()><=')}"
        rows = http_get_json(url, headers)
        print("\n--- oldest PENDING (stale candidates) ---")
        for r in rows:
            print(
                f"{r['created_at']} {r.get('symbol')} {r.get('timeframe')} "
                f"ticket={r.get('order_ticket')} id={r.get('id')}"
            )

    return 0 if (filled_count == 0 and pending_count == 0) else 2


if __name__ == "__main__":
    raise SystemExit(main())
