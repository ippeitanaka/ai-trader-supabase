"use client";

import { startTransition, useState } from "react";
import { useRouter } from "next/navigation";

type TradePlanControlsProps = {
  reportId?: number | null;
  status?: string | null;
};

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

export function TradePlanControls({ reportId, status }: TradePlanControlsProps) {
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
      {message ? <p className="text-xs text-emerald-200">{message}</p> : null}
      {error ? <p className="text-xs text-rose-200">{error}</p> : null}
    </div>
  );
}

type SymbolGateControlProps = {
  reportId?: number | null;
  symbol: string;
  aiMinWinProb: number;
  symbolMinWinProbs?: Record<string, number>;
};

export function SymbolGateControl({ reportId, symbol, aiMinWinProb, symbolMinWinProbs }: SymbolGateControlProps) {
  const router = useRouter();
  const [isPending, setIsPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const symbolKey = symbol.toUpperCase();
  const aiPercent = Math.round(Math.max(0.50, Math.min(0.75, aiMinWinProb)) * 100);
  const overrideValue = symbolMinWinProbs?.[symbolKey];
  const hasOverride = typeof overrideValue === "number";
  const [percent, setPercent] = useState(Math.round((overrideValue ?? aiMinWinProb) * 100));

  async function updateSymbolGate(useAi: boolean) {
    if (!reportId) return;
    const next = { ...(symbolMinWinProbs ?? {}) };
    if (useAi) delete next[symbolKey];
    else next[symbolKey] = Math.max(50, Math.min(90, Math.round(percent))) / 100;
    setIsPending(true);
    setMessage(null);
    setError(null);
    try {
      await postPlanOverride({
        report_id: reportId,
        symbol_min_win_probs: next,
        note: useAi ? `${symbolKey} gate reset to AI` : `${symbolKey} gate set to ${next[symbolKey]}`,
      });
      if (useAi) setPercent(aiPercent);
      setMessage(useAi ? "AI推奨へ戻しました。" : "最終勝率ゲートを更新しました。");
      startTransition(() => router.refresh());
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "銘柄別ゲートの更新に失敗しました。");
    } finally {
      setIsPending(false);
    }
  }

  return (
    <div className="mt-3 rounded-lg border border-white/10 bg-slate-950/25 p-3">
      <div className="flex items-center justify-between gap-3 text-xs">
        <span className="text-slate-400">勝率ゲート</span>
        <span className="text-cyan-100">AI推奨 {aiPercent}% / 最終 {Math.round(percent)}%{hasOverride ? "（手動）" : ""}</span>
      </div>
      <div className="mt-2 grid grid-cols-[minmax(0,1fr)_auto] gap-2">
        <label className="sr-only" htmlFor={`gate-${symbolKey}`}>最終勝率ゲート</label>
        <input
          id={`gate-${symbolKey}`}
          type="number"
          min="50"
          max="90"
          step="1"
          value={percent}
          disabled={!reportId || isPending}
          onChange={(event) => setPercent(Math.max(50, Math.min(90, Number(event.target.value))))}
          className="w-full rounded-lg border border-white/12 bg-slate-950/65 px-3 py-2 text-sm text-white outline-none focus:border-cyan-300/60 disabled:opacity-45"
        />
        <button
          type="button"
          disabled={!reportId || isPending}
          onClick={() => updateSymbolGate(false)}
          className="rounded-lg border border-cyan-300/25 bg-cyan-300/10 px-3 py-2 text-xs font-semibold text-cyan-50 transition hover:bg-cyan-300/18 disabled:opacity-45"
        >
          反映
        </button>
      </div>
      <button
        type="button"
        disabled={!reportId || isPending || !hasOverride}
        onClick={() => updateSymbolGate(true)}
        className="mt-2 text-xs text-slate-400 underline decoration-white/20 underline-offset-4 transition hover:text-white disabled:no-underline disabled:opacity-40"
      >
        AI推奨へ戻す
      </button>
      {message ? <p className="mt-1 text-xs text-emerald-200">{message}</p> : null}
      {error ? <p className="mt-1 text-xs text-rose-200">{error}</p> : null}
    </div>
  );
}

type SymbolSessionControlProps = {
  reportId?: number | null;
  symbol: string;
  sessionOverrides?: Record<string, SessionOverride>;
  inheritLabel?: string;
  aiSessionWindows?: Array<{ start_utc?: string; end_utc?: string }>;
};

function utcTimeToJst(value: string | undefined, fallback: string): string {
  const match = value?.match(/^(\d{2}):(\d{2})$/);
  if (!match) return fallback;
  const hour = (Number(match[1]) + 9) % 24;
  return `${String(hour).padStart(2, "0")}:${match[2]}`;
}

export function SymbolSessionControl({ reportId, symbol, sessionOverrides, inheritLabel = "AI推奨時間を使用", aiSessionWindows }: SymbolSessionControlProps) {
  const router = useRouter();
  const symbolKey = symbol.toUpperCase();
  const current = sessionOverrides?.[symbolKey];
  const initialWindow = current?.windows?.[0];
  const aiWindow = aiSessionWindows?.[0];
  const [mode, setMode] = useState<"ai" | "custom" | "all_day">(current?.mode ?? "ai");
  const [startJst, setStartJst] = useState(initialWindow?.start_jst ?? utcTimeToJst(aiWindow?.start_utc, "07:00"));
  const [endJst, setEndJst] = useState(initialWindow?.end_jst ?? utcTimeToJst(aiWindow?.end_utc, "23:00"));
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
        <option value="ai">{inheritLabel}</option>
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
