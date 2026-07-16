"use client";

import { startTransition, useState } from "react";
import { useRouter } from "next/navigation";

type TradePlanControlsProps = {
  reportId?: number | null;
  status?: string | null;
  gateAdjustment?: number | null;
};

type GateAdjustment = -0.10 | -0.05 | 0 | 0.05 | 0.10;
type SessionOverride = {
  mode: "custom" | "all_day";
  timezone: "Asia/Tokyo";
  windows?: Array<{
    label?: string;
    start_jst: string;
    end_jst: string;
  }>;
};

async function postPlanOverride(body: Record<string, unknown>) {
  const response = await fetch("/api/dashboard", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "plan_override", ...body }),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.error ?? "日次計画の更新に失敗しました。");
}

export function TradePlanControls({ reportId, status, gateAdjustment }: TradePlanControlsProps) {
  const router = useRouter();
  const [isPending, setIsPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isPaused = status === "paused";

  async function updateStatus(nextStatus: "active" | "paused") {
    if (!reportId) return;
    setIsPending(true);
    setMessage(null);
    setError(null);

    try {
      await postPlanOverride({
        report_id: reportId,
        status: nextStatus,
        note: nextStatus === "paused" ? "Paused from dashboard" : "Resumed from dashboard",
      });
      setMessage(nextStatus === "paused" ? "日次計画を一時停止しました。" : "日次計画を再開しました。");
      startTransition(() => router.refresh());
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "日次計画の更新に失敗しました。");
    } finally {
      setIsPending(false);
    }
  }

  async function updateGate(adjustment: GateAdjustment) {
    if (!reportId) return;
    setIsPending(true);
    setMessage(null);
    setError(null);
    try {
      await postPlanOverride({
        report_id: reportId,
        gate_adjustment: adjustment,
        note: `Global gate adjustment set to ${adjustment}`,
      });
      setMessage("実行ゲートを更新しました。");
      startTransition(() => router.refresh());
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "実行ゲートの更新に失敗しました。");
    } finally {
      setIsPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={!reportId || isPending || isPaused}
          onClick={() => updateStatus("paused")}
          className="rounded-full border border-rose-300/30 bg-rose-300/10 px-4 py-2 text-xs font-semibold text-rose-50 transition hover:bg-rose-300/18 disabled:cursor-not-allowed disabled:opacity-45"
        >
          計画を一時停止
        </button>
        <button
          type="button"
          disabled={!reportId || isPending || !isPaused}
          onClick={() => updateStatus("active")}
          className="rounded-full border border-emerald-300/30 bg-emerald-300/10 px-4 py-2 text-xs font-semibold text-emerald-50 transition hover:bg-emerald-300/18 disabled:cursor-not-allowed disabled:opacity-45"
        >
          計画を再開
        </button>
      </div>
      <div className="grid grid-cols-5 overflow-hidden rounded-lg border border-white/12 text-xs">
        {([
          { value: -0.10 as const, label: "-10pt" },
          { value: -0.05 as const, label: "-5pt" },
          { value: 0 as const, label: "AI推奨" },
          { value: 0.05 as const, label: "+5pt" },
          { value: 0.10 as const, label: "+10pt" },
        ]).map((option) => {
          const active = Math.abs((gateAdjustment ?? 0) - option.value) < 0.001;
          return (
            <button
              key={option.value}
              type="button"
              disabled={!reportId || isPending}
              onClick={() => updateGate(option.value)}
              className={`px-3 py-2 font-medium transition disabled:cursor-not-allowed disabled:opacity-45 ${active ? "bg-cyan-300 text-slate-950" : "bg-slate-950/35 text-slate-200 hover:bg-white/10"}`}
            >
              {option.label}
            </button>
          );
        })}
      </div>
      {message ? <p className="text-xs text-emerald-200">{message}</p> : null}
      {error ? <p className="text-xs text-rose-200">{error}</p> : null}
    </div>
  );
}

type SymbolGateControlProps = {
  reportId?: number | null;
  symbol: string;
  globalAdjustment?: number | null;
  symbolAdjustments?: Record<string, GateAdjustment>;
};

export function SymbolGateControl({ reportId, symbol, globalAdjustment, symbolAdjustments }: SymbolGateControlProps) {
  const router = useRouter();
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const symbolKey = symbol.toUpperCase();
  const hasOverride = Object.prototype.hasOwnProperty.call(symbolAdjustments ?? {}, symbolKey);
  const selected = hasOverride ? String(symbolAdjustments?.[symbolKey] ?? 0) : "inherit";

  async function updateSymbolGate(value: string) {
    if (!reportId) return;
    const next = { ...(symbolAdjustments ?? {}) };
    if (value === "inherit") delete next[symbolKey];
    else next[symbolKey] = Number(value) as GateAdjustment;
    setIsPending(true);
    setError(null);
    try {
      await postPlanOverride({
        report_id: reportId,
        symbol_gate_adjustments: next,
        note: `${symbolKey} gate adjustment set to ${value}`,
      });
      startTransition(() => router.refresh());
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "銘柄別ゲートの更新に失敗しました。");
    } finally {
      setIsPending(false);
    }
  }

  return (
    <div className="mt-3">
      <label className="text-xs text-slate-400" htmlFor={`gate-${symbolKey}`}>銘柄別ゲート</label>
      <select
        id={`gate-${symbolKey}`}
        value={selected}
        disabled={!reportId || isPending}
        onChange={(event) => updateSymbolGate(event.target.value)}
        className="mt-1 w-full rounded-lg border border-white/12 bg-slate-950/65 px-3 py-2 text-sm text-white outline-none focus:border-cyan-300/60 disabled:opacity-45"
      >
        <option value="inherit">全体設定 ({(globalAdjustment ?? 0) > 0 ? "+" : ""}{Math.round((globalAdjustment ?? 0) * 100)}pt)</option>
        <option value="-0.1">AI -10pt</option>
        <option value="-0.05">AI -5pt</option>
        <option value="0">AI推奨</option>
        <option value="0.05">+5pt</option>
        <option value="0.1">+10pt</option>
      </select>
      {error ? <p className="mt-1 text-xs text-rose-200">{error}</p> : null}
    </div>
  );
}

type SymbolSessionControlProps = {
  reportId?: number | null;
  symbol: string;
  sessionOverrides?: Record<string, SessionOverride>;
};

export function SymbolSessionControl({ reportId, symbol, sessionOverrides }: SymbolSessionControlProps) {
  const router = useRouter();
  const symbolKey = symbol.toUpperCase();
  const current = sessionOverrides?.[symbolKey];
  const initialWindow = current?.windows?.[0];
  const [mode, setMode] = useState<"ai" | "custom" | "all_day">(current?.mode ?? "ai");
  const [startJst, setStartJst] = useState(initialWindow?.start_jst ?? "07:00");
  const [endJst, setEndJst] = useState(initialWindow?.end_jst ?? "23:00");
  const [isPending, setIsPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function saveSession() {
    if (!reportId) return;
    const next = { ...(sessionOverrides ?? {}) };
    if (mode === "ai") {
      delete next[symbolKey];
    } else if (mode === "all_day") {
      next[symbolKey] = {
        mode: "all_day",
        timezone: "Asia/Tokyo",
      };
    } else {
      next[symbolKey] = {
        mode: "custom",
        timezone: "Asia/Tokyo",
        windows: [{
          label: "ダッシュボード手動設定",
          start_jst: startJst,
          end_jst: endJst,
        }],
      };
    }

    setIsPending(true);
    setMessage(null);
    setError(null);
    try {
      await postPlanOverride({
        report_id: reportId,
        symbol_session_overrides: next,
        note: `${symbolKey} session override set to ${mode}`,
      });
      setMessage("取引時間を更新しました。");
      startTransition(() => router.refresh());
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "取引時間の更新に失敗しました。");
    } finally {
      setIsPending(false);
    }
  }

  return (
    <div className="mt-3 rounded-lg border border-white/10 bg-slate-950/25 p-3">
      <label className="text-xs text-slate-400" htmlFor={`session-mode-${symbolKey}`}>取引時間（日本時間）</label>
      <select
        id={`session-mode-${symbolKey}`}
        value={mode}
        disabled={!reportId || isPending}
        onChange={(event) => setMode(event.target.value as "ai" | "custom" | "all_day")}
        className="mt-1 w-full rounded-lg border border-white/12 bg-slate-950/65 px-3 py-2 text-sm text-white outline-none focus:border-cyan-300/60 disabled:opacity-45"
      >
        <option value="ai">AI推奨時間を使用</option>
        <option value="custom">手動で指定</option>
        <option value="all_day">終日許可</option>
      </select>
      {mode === "custom" ? (
        <div className="mt-3 grid grid-cols-2 gap-2">
          <label className="text-xs text-slate-400">
            開始
            <input
              type="time"
              value={startJst}
              disabled={isPending}
              onChange={(event) => setStartJst(event.target.value)}
              className="mt-1 w-full rounded-lg border border-white/12 bg-slate-950/65 px-3 py-2 text-sm text-white outline-none focus:border-cyan-300/60"
            />
          </label>
          <label className="text-xs text-slate-400">
            終了
            <input
              type="time"
              value={endJst}
              disabled={isPending}
              onChange={(event) => setEndJst(event.target.value)}
              className="mt-1 w-full rounded-lg border border-white/12 bg-slate-950/65 px-3 py-2 text-sm text-white outline-none focus:border-cyan-300/60"
            />
          </label>
        </div>
      ) : null}
      <button
        type="button"
        disabled={!reportId || isPending || (mode === "custom" && (!startJst || !endJst))}
        onClick={saveSession}
        className="mt-3 w-full rounded-lg border border-cyan-300/25 bg-cyan-300/10 px-3 py-2 text-xs font-semibold text-cyan-50 transition hover:bg-cyan-300/18 disabled:cursor-not-allowed disabled:opacity-45"
      >
        {isPending ? "更新中..." : "取引時間を反映"}
      </button>
      {mode === "custom" && startJst > endJst ? <p className="mt-2 text-xs text-slate-400">日付をまたぐ時間帯として扱います。</p> : null}
      {message ? <p className="mt-2 text-xs text-emerald-200">{message}</p> : null}
      {error ? <p className="mt-2 text-xs text-rose-200">{error}</p> : null}
    </div>
  );
}
