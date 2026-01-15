#!/usr/bin/env python3

import argparse
import datetime as dt
import json
import math
import os
import subprocess
import urllib.parse
import urllib.request
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Tuple


@dataclass
class Period:
	name: str
	start: dt.datetime
	end: dt.datetime


def _utc_now() -> dt.datetime:
	return dt.datetime.now(dt.timezone.utc)


def _parse_dt(s: str) -> dt.datetime:
	# Accept YYYY-MM-DD or ISO8601
	if len(s) == 10:
		return dt.datetime.fromisoformat(s).replace(tzinfo=dt.timezone.utc)
	d = dt.datetime.fromisoformat(s)
	return d if d.tzinfo else d.replace(tzinfo=dt.timezone.utc)


def _get_project_ref(args: argparse.Namespace) -> str:
	if args.project_ref:
		return args.project_ref

	# Try local Supabase temp linkage
	candidates = [
		os.path.join("supabase", ".temp", "project-ref"),
		os.path.join(".supabase", "project-ref"),
	]
	for p in candidates:
		if os.path.exists(p):
			with open(p, "r", encoding="utf-8") as f:
				ref = f.read().strip()
				if ref:
					return ref

	raise SystemExit(
		"project-ref が見つかりません。--project-ref を指定するか、supabase link されている必要があります。"
	)


def _get_service_role_key_via_cli(project_ref: str) -> str:
	# Avoid printing secrets by capturing stdout.
	try:
		proc = subprocess.run(
			["supabase", "projects", "api-keys", "--project-ref", project_ref, "-o", "json"],
			check=True,
			stdout=subprocess.PIPE,
			stderr=subprocess.PIPE,
			text=True,
		)
	except FileNotFoundError:
		raise SystemExit("supabase CLI が見つかりません。")
	except subprocess.CalledProcessError as e:
		msg = (e.stderr or "").strip() or (e.stdout or "").strip()
		raise SystemExit(f"supabase projects api-keys に失敗しました: {msg}")

	obj = json.loads(proc.stdout)
	data = obj["data"] if isinstance(obj, dict) and "data" in obj else obj
	if not isinstance(data, list):
		raise SystemExit("supabase projects api-keys の出力形式が想定外です。")

	for it in data:
		name = (it.get("name") or it.get("type") or "").lower()
		if name == "service_role":
			key = it.get("api_key")
			if key:
				return key

	raise SystemExit("service_role の API key が見つかりませんでした。")


def _get_api_key(args: argparse.Namespace, project_ref: str) -> str:
	if args.service_role_key:
		return args.service_role_key
	if os.getenv("SUPABASE_SERVICE_ROLE_KEY"):
		return os.environ["SUPABASE_SERVICE_ROLE_KEY"].strip()

	return _get_service_role_key_via_cli(project_ref)


def _http_get_json(url: str, headers: Dict[str, str]) -> Tuple[List[Dict[str, Any]], Optional[str]]:
	req = urllib.request.Request(url, method="GET", headers=headers)
	try:
		with urllib.request.urlopen(req, timeout=60) as resp:
			body = resp.read().decode("utf-8")
			content_range = resp.headers.get("Content-Range")
			return json.loads(body), content_range
	except urllib.error.HTTPError as e:
		body = e.read().decode("utf-8", errors="replace")
		raise RuntimeError(f"HTTP {e.code} {e.reason}: {body}")


def _fetch_all_rows(base_url: str, headers: Dict[str, str], batch_size: int = 1000) -> List[Dict[str, Any]]:
	out: List[Dict[str, Any]] = []
	offset = 0

	while True:
		# PostgREST uses Range header.
		h = dict(headers)
		h["Range"] = f"{offset}-{offset + batch_size - 1}"

		rows, content_range = _http_get_json(base_url, h)
		if not isinstance(rows, list):
			raise RuntimeError("PostgREST が配列以外を返しました")

		out.extend(rows)
		if len(rows) < batch_size:
			break

		if content_range and "/" in content_range:
			# Example: 0-999/1234
			total_str = content_range.split("/")[-1]
			if total_str.isdigit():
				total = int(total_str)
				offset += batch_size
				if offset >= total:
					break
				continue

		offset += batch_size

		# Safety break for runaway pagination
		if offset > 1_000_000:
			raise RuntimeError("取得件数が多すぎるため中断しました。期間を絞ってください。")

	return out


def _coerce_float(v: Any) -> Optional[float]:
	if v is None:
		return None
	if isinstance(v, (int, float)):
		return float(v)
	try:
		s = str(v).strip()
		if s == "":
			return None
		return float(s)
	except Exception:
		return None


def _extract_realized_win(row: Dict[str, Any]) -> Optional[int]:
	ar = row.get("actual_result")
	if isinstance(ar, str):
		aru = ar.strip().upper()
		if aru in ("WIN", "W", "TP"):
			return 1
		if aru in ("LOSS", "L", "SL"):
			return 0

	pnl = _coerce_float(row.get("profit_loss"))
	if pnl is not None:
		if pnl > 0:
			return 1
		if pnl < 0:
			return 0

	# If we can't infer, treat as unknown.
	return None


def _bin05(p: float) -> float:
	# [0,1] step 0.05
	b = math.floor(max(0.0, min(0.999999, p)) / 0.05) * 0.05
	return round(b, 2)


def _brier(prob: float, y: int) -> float:
	return (prob - y) ** 2


def _format_pct(x: Optional[float]) -> str:
	if x is None or math.isnan(x):
		return "-"
	return f"{x*100:.1f}%"


def _format_f(x: Optional[float], nd: int = 4) -> str:
	if x is None or math.isnan(x):
		return "-"
	return f"{x:.{nd}f}"


def _summarize(rows: List[Dict[str, Any]]) -> Dict[str, Any]:
	usable = []
	for r in rows:
		wp = _coerce_float(r.get("win_prob"))
		y = _extract_realized_win(r)
		if wp is None or y is None:
			continue
		if wp < 0 or wp > 1:
			continue
		sym = r.get("symbol")
		tf = r.get("timeframe")
		d = r.get("dir")
		usable.append((wp, y, str(sym) if sym is not None else "?", str(tf) if tf is not None else "?", str(d) if d is not None else "?"))

	n = len(usable)
	if n == 0:
		return {"n": 0}

	avg_p = sum(p for p, _, _, _, _ in usable) / n
	win_rate = sum(y for _, y, _, _, _ in usable) / n
	brier = sum(_brier(p, y) for p, y, _, _, _ in usable) / n

	bins: Dict[float, Dict[str, Any]] = {}
	for p, y, _, _, _ in usable:
		b = _bin05(p)
		d = bins.setdefault(b, {"n": 0, "sum_p": 0.0, "sum_y": 0})
		d["n"] += 1
		d["sum_p"] += p
		d["sum_y"] += y

	bin_rows = []
	for b in sorted(bins.keys()):
		d = bins[b]
		nn = d["n"]
		bin_rows.append(
			{
				"bin": b,
				"n": nn,
				"avg_p": d["sum_p"] / nn,
				"win_rate": d["sum_y"] / nn,
				"delta": (d["sum_y"] / nn) - (d["sum_p"] / nn),
			}
		)

	thresholds = [0.8, 0.75, 0.7, 0.65, 0.6]
	thr_rows = []
	for t in thresholds:
		sub = [(p, y) for p, y, _, _, _ in usable if p >= t]
		if not sub:
			thr_rows.append({"thr": t, "n": 0})
			continue
		nn = len(sub)
		thr_rows.append(
			{
				"thr": t,
				"n": nn,
				"avg_p": sum(p for p, _ in sub) / nn,
				"win_rate": sum(y for _, y in sub) / nn,
				"brier": sum(_brier(p, y) for p, y in sub) / nn,
			}
		)

	# symbol/timeframe/dir breakdown (for triage)
	groups: Dict[Tuple[str, str, str], Dict[str, Any]] = {}
	for p, y, sym, tf, d in usable:
		k = (sym, tf, d)
		g = groups.setdefault(k, {"n": 0, "sum_p": 0.0, "sum_y": 0, "sum_b": 0.0})
		g["n"] += 1
		g["sum_p"] += p
		g["sum_y"] += y
		g["sum_b"] += _brier(p, y)

	group_rows = []
	for (sym, tf, d), g in groups.items():
		nn = g["n"]
		group_rows.append(
			{
				"symbol": sym,
				"timeframe": tf,
				"dir": d,
				"n": nn,
				"avg_p": g["sum_p"] / nn,
				"win_rate": g["sum_y"] / nn,
				"delta": (g["sum_y"] / nn) - (g["sum_p"] / nn),
				"brier": g["sum_b"] / nn,
			}
		)
	group_rows.sort(key=lambda r: (-r["n"], r["symbol"], r["timeframe"], r["dir"]))

	return {
		"n": n,
		"avg_p": avg_p,
		"win_rate": win_rate,
		"brier": brier,
		"bins": bin_rows,
		"thresholds": thr_rows,
		"groups": group_rows,
	}


def _print_summary(title: str, s: Dict[str, Any]) -> None:
	print(f"\n== {title} ==")
	if s.get("n", 0) == 0:
		print("対象データなし（win_prob と勝敗が揃っている行がありません）")
		return

	print(
		f"n={s['n']}  avg_win_prob={_format_pct(s['avg_p'])}  realized_win_rate={_format_pct(s['win_rate'])}  brier={_format_f(s['brier'])}"
	)

	print("\n-- reliability bins (step=0.05) --")
	print("bin\tn\tavg_p\twin_rate\tdelta")
	for r in s["bins"]:
		print(
			f"{r['bin']:.2f}\t{r['n']}\t{_format_pct(r['avg_p'])}\t{_format_pct(r['win_rate'])}\t{_format_pct(r['delta'])}"
		)

	print("\n-- thresholds (p>=thr) --")
	print("thr\tn\tavg_p\twin_rate\tbrier")
	for r in s["thresholds"]:
		if r["n"] == 0:
			print(f"{r['thr']:.2f}\t0\t-\t-\t-")
			continue
		print(
			f"{r['thr']:.2f}\t{r['n']}\t{_format_pct(r['avg_p'])}\t{_format_pct(r['win_rate'])}\t{_format_f(r['brier'])}"
		)

	print("\n-- by symbol/timeframe/dir (top by n) --")
	print("symbol\ttf\tdir\tn\tavg_p\twin_rate\tdelta")
	for r in s.get("groups", [])[:20]:
		print(
			f"{r['symbol']}\t{r['timeframe']}\t{r['dir']}\t{r['n']}\t{_format_pct(r['avg_p'])}\t{_format_pct(r['win_rate'])}\t{_format_pct(r['delta'])}"
		)


def _build_query_url(project_ref: str, period: Period, include_virtual: bool) -> str:
	base = f"https://{project_ref}.supabase.co/rest/v1/ai_signals"

	select_cols = [
		"created_at",
		"symbol",
		"timeframe",
		"dir",
		"win_prob",
		"actual_result",
		"is_virtual",
	]

	params = [
		("select", ",".join(select_cols)),
		("order", "created_at.asc"),
		("created_at", f"gte.{period.start.isoformat()}"),
		("created_at", f"lt.{period.end.isoformat()}"),
	]

	if not include_virtual:
		# If column doesn't exist, server will 400; caller can retry.
		params.append(("is_virtual", "eq.false"))

	# If actual_result exists, pre-filter to reduce payload.
	params.append(("actual_result", "in.(WIN,LOSS,TP,SL,W,L)"))

	return base + "?" + urllib.parse.urlencode(params, safe=",().")


def main() -> int:
	ap = argparse.ArgumentParser()
	ap.add_argument("--project-ref", default=None)
	ap.add_argument("--service-role-key", default=None)
	ap.add_argument("--oct-start", default="2025-10-01")
	ap.add_argument("--oct-end", default="2025-12-01")
	ap.add_argument("--recent-days", type=int, default=14)
	ap.add_argument("--include-virtual", action="store_true")
	args = ap.parse_args()

	project_ref = _get_project_ref(args)
	api_key = _get_api_key(args, project_ref)

	headers = {
		"apikey": api_key,
		"Authorization": f"Bearer {api_key}",
		"Accept": "application/json",
	}

	oct_period = Period(
		name="2025-10/11",
		start=_parse_dt(args.oct_start),
		end=_parse_dt(args.oct_end),
	)

	now = _utc_now()
	recent_period = Period(
		name=f"Recent-{args.recent_days}d",
		start=now - dt.timedelta(days=args.recent_days),
		end=now,
	)

	periods = [oct_period, recent_period]

	for period in periods:
		url = _build_query_url(project_ref, period, include_virtual=args.include_virtual)
		try:
			rows = _fetch_all_rows(url, headers=headers)
		except RuntimeError as e:
			msg = str(e)
			# Retry if is_virtual or actual_result filter causes issues.
			if "is_virtual" in msg or "actual_result" in msg:
				params = [
					("select", "created_at,symbol,timeframe,dir,win_prob,actual_result,is_virtual"),
					("order", "created_at.asc"),
					("created_at", f"gte.{period.start.isoformat()}"),
					("created_at", f"lt.{period.end.isoformat()}"),
				]
				url2 = f"https://{project_ref}.supabase.co/rest/v1/ai_signals?" + urllib.parse.urlencode(
					params, safe=",()."
				)
				rows = _fetch_all_rows(url2, headers=headers)
			else:
				raise

		s = _summarize(rows)
		_print_summary(period.name, s)

	return 0


if __name__ == "__main__":
	raise SystemExit(main())