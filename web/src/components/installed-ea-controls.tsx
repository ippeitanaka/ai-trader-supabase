"use client";

import { startTransition, useState } from "react";
import { useRouter } from "next/navigation";
import type { InstalledEaRow } from "@/lib/dashboard";
import type { EaRuntimeSettings, EaSessionOverride } from "../../../supabase/functions/_shared/ea-runtime";

const statusLabels = {
  online: "通信あり", trading_disabled: "自動売買OFF", disconnected: "ブローカー未接続",
  stale: "通信途絶", detached: "取り外し済み",
};
const membershipLabels = { selected: "推奨", conditional: "条件付き許可", avoided: "非推奨・取引可能", unlisted: "日次計画に記載なし" };
const inputClass = "min-h-11 min-w-0 w-full rounded-md border border-white/20 bg-neutral-950 px-3 py-2 text-sm text-white outline-none focus:border-cyan-300 disabled:opacity-50";
const jst = (time: string) => new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(time));

function EaControl({ row }: { row: InstalledEaRow }) {
  const router = useRouter();
  const [saved, setSaved] = useState<EaRuntimeSettings | null>(row.settings);
  const [gateMode, setGateMode] = useState(row.settings?.min_win_prob != null ? "manual" : "inherit");
  const [percent, setPercent] = useState(String(Math.round((row.settings?.min_win_prob ?? row.inheritedGate) * 100)));
  const [sessionMode, setSessionMode] = useState<"inherit" | "custom" | "all_day">(row.settings?.session_override?.mode ?? "inherit");
  const [windows, setWindows] = useState(row.settings?.session_override?.windows ?? row.inheritedSessions ?? [{ start_jst: "07:00", end_jst: "23:00" }]);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const id = `${row.symbol}-${row.strategyMode}`;
  const inheritedTime = row.inheritedSessions?.map((window) => `${window.start_jst}〜${window.end_jst}`).join(" / ") ?? "時間指定なし";

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const numeric = Number(percent);
    if (gateMode === "manual" && (!Number.isInteger(numeric) || numeric < 50 || numeric > 90)) {
      setError("勝率ゲートは50%から90%の整数で指定してください。");
      return;
    }
    const session: EaSessionOverride | null = sessionMode === "inherit" ? null : sessionMode === "all_day"
      ? { mode: "all_day", timezone: "Asia/Tokyo" }
      : { mode: "custom", timezone: "Asia/Tokyo", windows };
    setPending(true); setMessage(null); setError(null);
    try {
      const response = await fetch("/api/dashboard", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "ea_runtime_override", symbol: row.symbol, strategy_mode: row.strategyMode,
          min_win_prob: gateMode === "manual" ? numeric / 100 : null,
          session_override: session, expected_updated_at: saved?.updated_at ?? null,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "設定を保存できませんでした。");
      setSaved(result.result);
      setMessage("保存しました。次回のエントリー判定から適用されます。");
      startTransition(() => router.refresh());
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "設定を保存できませんでした。");
    } finally { setPending(false); }
  }

  return (
    <article className="min-w-0 rounded-lg border border-white/15 bg-neutral-950/40 p-4 sm:p-5" data-ea-key={id}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-lg font-semibold text-white">{row.symbol} <span className="text-sm font-normal text-cyan-200">{row.strategyMode === "scalp" ? "短期 M5" : "標準 M15"}</span></h3>
        <span className={`text-xs ${row.membership === "avoided" ? "text-amber-200" : "text-neutral-300"}`}>{membershipLabels[row.membership]}</span>
      </div>
      <div className="mt-3 space-y-1 text-xs leading-6 text-neutral-300">
        {row.instances.map((instance) => (
          <p key={instance.id} className="flex flex-wrap gap-x-3">
            <span className={instance.connectionStatus === "online" ? "text-emerald-300" : "text-amber-200"}>{statusLabels[instance.connectionStatus]}</span>
            <span>v{instance.ea_version}</span>
            <span>{instance.base_lot_size} lot / 建玉 {instance.current_positions}・上限 {instance.max_open_trades}</span>
            <span>受信 {jst(instance.last_seen_at)} JST</span>
          </p>
        ))}
      </div>
      <form onSubmit={save} className="mt-4 border-t border-white/10 pt-4">
        <fieldset disabled={pending} className="min-w-0 space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor={`${id}-gate-mode`} className="text-xs text-neutral-300">勝率ゲート</label>
              <select id={`${id}-gate-mode`} value={gateMode} onChange={(event) => setGateMode(event.target.value)} className={`${inputClass} mt-1`}>
                <option value="inherit">日次計画・既定に従う</option>
                <option value="manual">手動で指定</option>
              </select>
              {gateMode === "manual" ? (
                <label className="mt-2 flex items-center gap-2 text-sm text-neutral-300">
                  <span className="sr-only">{row.symbol} {row.strategyMode} 勝率（%）</span>
                  <input aria-label={`${row.symbol} ${row.strategyMode} 勝率（%）`} type="number" min={50} max={90} step={1} inputMode="numeric" required value={percent} onChange={(event) => setPercent(event.target.value)} className={inputClass} />
                  <span>%</span>
                </label>
              ) : <p className="mt-2 text-sm text-neutral-200">基準 {Math.round(row.inheritedGate * 100)}%</p>}
            </div>
            <div>
              <label htmlFor={`${id}-session-mode`} className="text-xs text-neutral-300">取引時間（日本時間）</label>
              <select id={`${id}-session-mode`} value={sessionMode} onChange={(event) => setSessionMode(event.target.value as typeof sessionMode)} className={`${inputClass} mt-1`}>
                <option value="inherit">日次計画に従う</option>
                <option value="custom">手動で指定</option>
                <option value="all_day">終日許可</option>
              </select>
              {sessionMode === "inherit" ? <p className="mt-2 break-words text-sm text-neutral-200">{inheritedTime}</p> : null}
            </div>
          </div>
          {sessionMode === "custom" ? (
            <div className="space-y-3">
              {windows.map((window, index) => (
                <div key={index} className="grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-end gap-2">
                  <label className="min-w-0 text-xs text-neutral-300">開始 {index + 1}
                    <input aria-label={`${id} 開始 ${index + 1}`} type="time" required value={window.start_jst} onChange={(event) => setWindows(windows.map((value, i) => i === index ? { ...value, start_jst: event.target.value } : value))} className={`${inputClass} mt-1`} />
                  </label>
                  <label className="min-w-0 text-xs text-neutral-300">終了 {index + 1}
                    <input aria-label={`${id} 終了 ${index + 1}`} type="time" required value={window.end_jst} onChange={(event) => setWindows(windows.map((value, i) => i === index ? { ...value, end_jst: event.target.value } : value))} className={`${inputClass} mt-1`} />
                  </label>
                  <button type="button" aria-label={`時間帯 ${index + 1} を削除`} title="時間帯を削除" disabled={windows.length === 1} onClick={() => setWindows(windows.filter((_, i) => i !== index))} className="min-h-11 px-1 text-xs text-neutral-300 disabled:opacity-30">削除</button>
                </div>
              ))}
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <button type="button" disabled={windows.length >= 3} onClick={() => setWindows([...windows, { start_jst: "07:00", end_jst: "23:00" }])} className="min-h-9 text-cyan-200 disabled:opacity-30">時間帯を追加</button>
                {windows.some((window) => window.start_jst > window.end_jst) ? <span className="text-amber-200">翌日にまたがる時間帯あり</span> : null}
              </div>
            </div>
          ) : null}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-xs text-neutral-400">{saved ? `設定更新 ${jst(saved.updated_at)} JST` : "個別設定なし"}</span>
            <button type="submit" className="min-h-11 rounded-md border border-cyan-300/40 bg-cyan-300/10 px-5 py-2 text-sm font-semibold text-cyan-50 hover:bg-cyan-300/20 disabled:opacity-50">{pending ? "保存中..." : "設定を保存"}</button>
          </div>
        </fieldset>
        {message ? <p role="status" className="mt-3 text-xs text-emerald-200">{message}</p> : null}
        {error ? <p role="alert" className="mt-3 text-xs text-rose-200">{error}</p> : null}
      </form>
    </article>
  );
}

export function InstalledEaControls({ rows }: { rows: InstalledEaRow[] }) {
  return (
    <section className="mt-8 border-y border-white/15 py-6" aria-labelledby="installed-eas-title">
      <div className="mb-5 flex flex-wrap items-baseline justify-between gap-3">
        <h2 id="installed-eas-title" className="text-2xl font-semibold text-white">設置中のEA</h2>
        <span className="text-sm text-neutral-300">{rows.length} 銘柄・モード / {rows.reduce((sum, row) => sum + row.instances.length, 0)} 設置</span>
      </div>
      {rows.length ? (
        <div className="grid items-start gap-4 xl:grid-cols-2">
          {rows.map((row) => <EaControl key={`${row.symbol}:${row.strategyMode}`} row={row} />)}
        </div>
      ) : <p className="py-4 text-sm text-neutral-400">EAの稼働情報はまだ届いていません。</p>}
    </section>
  );
}
