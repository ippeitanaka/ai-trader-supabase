"use client";

import { startTransition, useState } from "react";
import { useRouter } from "next/navigation";

type TradePlanControlsProps = {
  reportId?: number | null;
  status?: string | null;
  gateAdjustment?: number | null;
};

type GateAdjustment = 0 | 0.05 | 0.10;

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
      <div className="grid grid-cols-3 overflow-hidden rounded-lg border border-white/12 text-xs">
        {([
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
        <option value="inherit">全体設定 ({Math.round((globalAdjustment ?? 0) * 100)}pt)</option>
        <option value="0">AI推奨</option>
        <option value="0.05">+5pt</option>
        <option value="0.1">+10pt</option>
      </select>
      {error ? <p className="mt-1 text-xs text-rose-200">{error}</p> : null}
    </div>
  );
}
