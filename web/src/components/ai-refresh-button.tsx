"use client";

import { startTransition, useState } from "react";
import { useRouter } from "next/navigation";

type AiRefreshButtonProps = {
  cadence?: string | null;
  lookbackDays?: number | null;
  topN?: number | null;
};

export function AiRefreshButton({ cadence, lookbackDays, topN }: AiRefreshButtonProps) {
  const router = useRouter();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isReloading, setIsReloading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleRefresh() {
    setIsRefreshing(true);
    setError(null);
    setMessage(null);

    try {
      const response = await fetch("/api/dashboard", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          cadence: cadence ?? "daily",
          lookback_days: lookbackDays ?? 21,
          top_n: topN ?? 3,
        }),
      });

      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error ?? "AI判定の更新に失敗しました。");
      }

      setMessage("AI判定を更新しました。最新データへ切り替えます。 ");
      startTransition(() => {
        router.refresh();
      });
    } catch (refreshError) {
      const nextError = refreshError instanceof Error ? refreshError.message : "AI判定の更新に失敗しました。";
      setError(nextError);
    } finally {
      setIsRefreshing(false);
    }
  }

  function handlePageReload() {
    setIsReloading(true);
    window.location.reload();
  }

  return (
    <div className="flex flex-col gap-2 sm:items-start">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={handleRefresh}
          disabled={isRefreshing || isReloading}
          className="min-h-11 rounded-md border border-cyan-300/40 bg-cyan-300/10 px-5 py-2 text-sm font-semibold text-cyan-50 transition hover:bg-cyan-300/20 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isRefreshing ? "AI判定を更新中..." : "AI判定"}
        </button>
        <button
          type="button"
          title="ページを再読み込み"
          aria-label="ページを再読み込み"
          onClick={handlePageReload}
          disabled={isRefreshing || isReloading}
          className="inline-flex min-h-11 items-center gap-2 rounded-full border border-white/15 bg-white/8 px-5 py-3 text-sm font-semibold text-slate-100 transition hover:border-cyan-200/35 hover:bg-cyan-200/12 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <span aria-hidden="true" className={isReloading ? "animate-spin" : ""}>↻</span>
          {isReloading ? "更新中..." : "更新"}
        </button>
      </div>
      <p className="text-xs leading-6 text-slate-400">AI判定は取引計画を再作成し、更新は表示中のページだけを再読み込みします。</p>
      {message ? <p className="text-xs text-emerald-200">{message}</p> : null}
      {error ? <p className="text-xs text-rose-200">{error}</p> : null}
    </div>
  );
}
