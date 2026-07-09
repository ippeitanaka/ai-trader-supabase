"use client";

import { startTransition, useState } from "react";
import { useRouter } from "next/navigation";

type TradePlanControlsProps = {
  reportId?: number | null;
  status?: string | null;
};

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
      const response = await fetch("/api/dashboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "plan_override",
          report_id: reportId,
          status: nextStatus,
          note: nextStatus === "paused" ? "Paused from dashboard" : "Resumed from dashboard",
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error ?? "日次計画の更新に失敗しました。");
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
