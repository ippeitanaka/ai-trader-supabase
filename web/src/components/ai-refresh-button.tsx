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

  return (
    <div className="flex flex-col gap-2 sm:items-start">
      <button
        type="button"
        onClick={handleRefresh}
        disabled={isRefreshing}
        className="rounded-full border border-cyan-300/28 bg-cyan-300/12 px-5 py-3 text-sm font-semibold text-cyan-50 transition hover:bg-cyan-300/18 disabled:cursor-not-allowed disabled:opacity-70"
      >
        {isRefreshing ? "AI判定を更新中..." : "AI判定"}
      </button>
      <p className="text-xs leading-6 text-slate-400">押すと推奨ペアを再判定し、その後ページ全体を最新状態へ更新します。</p>
      {message ? <p className="text-xs text-emerald-200">{message}</p> : null}
      {error ? <p className="text-xs text-rose-200">{error}</p> : null}
    </div>
  );
}
