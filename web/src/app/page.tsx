import { getDashboardData } from "@/lib/dashboard";

export const dynamic = "force-dynamic";

const PERIOD_OPTIONS = [
  { key: "7", label: "7日" },
  { key: "30", label: "30日" },
  { key: "90", label: "90日" },
  { key: "365", label: "365日" },
  { key: "all", label: "全期間" },
] as const;

function formatDateTime(value: string | null | undefined) {
  if (!value) return "-";
  return new Date(value).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });
}

function formatPercent(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "-";
  return `${value.toFixed(1)}%`;
}

function formatMoney(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "-";
  const sign = value > 0 ? "+" : "";
  return `${sign}${new Intl.NumberFormat("ja-JP", { maximumFractionDigits: 2 }).format(value)}`;
}

function formatDirection(value: string | null | undefined) {
  if (!value) return "-";
  return value;
}

type PageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function StatCard({ label, value, sublabel }: { label: string; value: string; sublabel?: string }) {
  return (
    <article className="rounded-3xl border border-white/10 bg-white/6 p-5 shadow-[0_20px_60px_rgba(0,0,0,0.22)] backdrop-blur">
      <p className="text-xs uppercase tracking-[0.24em] text-cyan-200/72">{label}</p>
      <p className="mt-3 text-3xl font-semibold text-white">{value}</p>
      {sublabel ? <p className="mt-2 text-sm text-slate-300">{sublabel}</p> : null}
    </article>
  );
}

function SectionTitle({ title, description }: { title: string; description: string }) {
  return (
    <div className="mb-5 flex items-end justify-between gap-4">
      <div>
        <h2 className="text-2xl font-semibold text-white">{title}</h2>
        <p className="mt-1 text-sm text-slate-300">{description}</p>
      </div>
    </div>
  );
}

export default async function Home({ searchParams }: PageProps) {
  const params = (await searchParams) ?? {};
  const rawPeriod = Array.isArray(params.period) ? params.period[0] : params.period;
  const period = PERIOD_OPTIONS.some((option) => option.key === rawPeriod) ? rawPeriod ?? "30" : "30";

  try {
    const data = await getDashboardData(period);
    const latest = data.pairSelector.latest;
    const liveContext = data.pairSelector.live_context;

    return (
      <main className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(34,197,94,0.18),_transparent_22%),linear-gradient(180deg,_#07111f_0%,_#081826_44%,_#050910_100%)] px-5 py-8 text-slate-100 sm:px-8 lg:px-10">
        <div className="mx-auto max-w-7xl">
          {data.dataErrors.length > 0 ? (
            <section className="mb-6 rounded-[28px] border border-amber-300/20 bg-amber-500/10 p-5 backdrop-blur">
              <p className="text-xs uppercase tracking-[0.28em] text-amber-200/80">Data Warning</p>
              <h2 className="mt-2 text-2xl font-semibold text-white">一部データ取得に失敗しています</h2>
              <p className="mt-2 text-sm leading-7 text-amber-50/90">
                Vercel の環境変数、Supabase の権限、または Function / REST API 応答を確認してください。下の詳細はそのまま原因切り分けに使えます。
              </p>
              <div className="mt-4 space-y-2 text-sm text-amber-100">
                {data.dataErrors.map((error) => (
                  <div key={error} className="rounded-2xl border border-white/10 bg-slate-950/35 px-4 py-3">{error}</div>
                ))}
              </div>
            </section>
          ) : null}

          <section className="rounded-[32px] border border-cyan-400/15 bg-slate-950/55 p-6 shadow-[0_24px_120px_rgba(3,10,18,0.55)] backdrop-blur lg:p-8">
            <div className="flex flex-col gap-8 lg:flex-row lg:items-start lg:justify-between">
              <div className="max-w-3xl">
                <p className="text-xs uppercase tracking-[0.32em] text-emerald-300/80">Awaji Samurai AI Trader</p>
                <h1 className="mt-3 text-4xl font-semibold tracking-tight text-white sm:text-5xl">
                  AIトレーダー運用ダッシュボード
                </h1>
                <p className="mt-4 max-w-3xl text-base leading-8 text-slate-300 sm:text-lg">
                  本日の推奨ペア、リアルタイムの AI 判断、EA ログ、直近実トレード、指定期間成績、総合成績を 1 画面で確認できる運用ビューです。
                </p>
                <div className="mt-5 flex flex-wrap gap-3">
                  <a href={`/api/dashboard?period=${period}`} className="rounded-full border border-emerald-300/25 bg-emerald-300/10 px-4 py-2 text-sm text-emerald-100 transition hover:bg-emerald-300/16">Dashboard API</a>
                  <a href="https://nebphrnnpmuqbkymwefs.supabase.co/functions/v1/pair-selector?limit=1" className="rounded-full border border-white/12 bg-white/6 px-4 py-2 text-sm text-slate-100 transition hover:bg-white/10">Pair Selector JSON</a>
                </div>
              </div>

              <div className="grid min-w-[280px] gap-4 sm:grid-cols-2 lg:w-[360px] lg:grid-cols-1">
                <StatCard label="最終更新" value={formatDateTime(latest?.generated_at ?? data.generatedAt)} />
                <StatCard label="本日トップ推奨" value={latest?.digest?.top_pick_symbol ?? latest?.top_picks?.[0]?.symbol ?? "-"} sublabel={latest?.digest?.risk_label ?? "-"} />
                <StatCard label="オープン中ポジション" value={String(data.openTrades.length)} sublabel={data.openTrades.length > 0 ? data.openTrades.map((trade) => trade.symbol).join(" / ") : "現在保有なし"} />
              </div>
            </div>

            <div className="mt-8 grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
              <article className="rounded-[28px] border border-white/10 bg-white/6 p-5 backdrop-blur">
                <SectionTitle title="本日のAI要約" description="pair-selector の live digest と市場テーマ" />
                <div className="space-y-3 text-sm leading-7 text-slate-200">
                  {(latest?.digest_lines ?? latest?.digest_text?.split("\n") ?? [latest?.summary ?? "要約なし"]).map((line) => (
                    <div key={line} className="rounded-2xl border border-white/8 bg-slate-900/60 px-4 py-3">{line}</div>
                  ))}
                </div>
                {liveContext?.summary ? <p className="mt-4 text-sm leading-7 text-slate-300">{liveContext.summary}</p> : null}
              </article>

              <article className="rounded-[28px] border border-white/10 bg-white/6 p-5 backdrop-blur">
                <SectionTitle title="市場テーマ" description="現在の市場認識と重要イベント" />
                <div className="flex flex-wrap gap-2">
                  {(liveContext?.themes ?? []).map((theme) => (
                    <span key={theme} className="rounded-full border border-cyan-300/18 bg-cyan-300/8 px-3 py-1 text-sm text-cyan-100">{theme}</span>
                  ))}
                </div>
                <div className="mt-4 space-y-3 text-sm text-slate-300">
                  {(liveContext?.economic_events ?? []).slice(0, 3).map((event) => (
                    <div key={`${event.country}-${event.title}-${event.status}`} className="rounded-2xl border border-white/8 bg-slate-900/55 px-4 py-3">
                      <div className="text-white">{event.country_label_ja ?? event.country} {event.title_ja ?? event.title}</div>
                      <div className="mt-1 text-xs text-slate-400">{event.status === "upcoming" ? "予定" : "直近"}{event.forecast ? ` / 予想 ${event.forecast}` : ""}{event.actual ? ` / 結果 ${event.actual}` : ""}</div>
                    </div>
                  ))}
                </div>
              </article>
            </div>
          </section>

          <section className="mt-8 grid gap-5 xl:grid-cols-2">
            <article className="rounded-[28px] border border-emerald-400/12 bg-slate-950/50 p-6 backdrop-blur">
              <SectionTitle title="本日の推奨ペア" description="リアルタイム更新の推奨・非推奨リスト" />
              <div className="grid gap-4 md:grid-cols-2">
                {(latest?.recommended_pairs ?? []).slice(0, 4).map((pair) => (
                  <div key={`rec-${pair.symbol}`} className="rounded-3xl border border-emerald-400/18 bg-emerald-400/8 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-lg font-semibold text-white">{pair.symbol}</p>
                        <p className="text-xs uppercase tracking-[0.18em] text-emerald-200/70">推奨</p>
                      </div>
                      <div className="text-right">
                        <p className="text-2xl font-semibold text-emerald-100">{pair.score}</p>
                        <p className="text-xs text-slate-300">{pair.confidence}</p>
                      </div>
                    </div>
                    <p className="mt-3 text-sm leading-7 text-slate-200">{pair.reason}</p>
                    {pair.caution ? <p className="mt-2 text-xs text-amber-200/80">注意: {pair.caution}</p> : null}
                  </div>
                ))}
              </div>
            </article>

            <article className="rounded-[28px] border border-rose-400/12 bg-slate-950/50 p-6 backdrop-blur">
              <SectionTitle title="本日の非推奨ペア" description="今日は外したい候補" />
              <div className="grid gap-4 md:grid-cols-2">
                {(latest?.avoided_pairs ?? []).slice(0, 4).map((pair) => (
                  <div key={`avoid-${pair.symbol}`} className="rounded-3xl border border-rose-400/18 bg-rose-400/8 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-lg font-semibold text-white">{pair.symbol}</p>
                        <p className="text-xs uppercase tracking-[0.18em] text-rose-200/70">回避</p>
                      </div>
                      <div className="text-right">
                        <p className="text-2xl font-semibold text-rose-100">{pair.score}</p>
                        <p className="text-xs text-slate-300">{pair.confidence}</p>
                      </div>
                    </div>
                    <p className="mt-3 text-sm leading-7 text-slate-200">{pair.reason}</p>
                    {pair.caution ? <p className="mt-2 text-xs text-amber-200/80">注意: {pair.caution}</p> : null}
                  </div>
                ))}
              </div>
            </article>
          </section>

          <section className="mt-8 grid gap-5 lg:grid-cols-[0.95fr_1.05fr]">
            <article className="rounded-[28px] border border-white/10 bg-slate-950/50 p-6 backdrop-blur">
              <SectionTitle title="直近5件のEAログ" description="ペア・判断時間・勝率・実行可否・売買方向" />
              <div className="space-y-4">
                {data.recentEaLogs.map((log) => (
                  <div key={log.id} className="rounded-3xl border border-white/8 bg-white/5 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <div className="text-lg font-semibold text-white">{log.sym} {log.tf ?? "-"}</div>
                        <div className="mt-1 text-xs text-slate-400">{formatDateTime(log.at)}</div>
                      </div>
                      <div className="flex flex-wrap gap-2 text-xs">
                        <span className="rounded-full bg-cyan-300/10 px-3 py-1 text-cyan-100">{formatDirection(log.action)}</span>
                        <span className="rounded-full bg-white/8 px-3 py-1 text-slate-200">{log.trade_decision ?? "-"}</span>
                        <span className="rounded-full bg-emerald-300/10 px-3 py-1 text-emerald-100">勝率 {formatPercent(log.win_prob != null ? log.win_prob * 100 : null)}</span>
                      </div>
                    </div>
                    <p className="mt-3 text-sm leading-7 text-slate-200">{log.decision_summary ?? log.ai_reasoning ?? "要約なし"}</p>
                    <div className="mt-2 flex flex-wrap gap-3 text-xs text-slate-400">
                      {log.entry_method ? <span>entry: {log.entry_method}</span> : null}
                      {log.skip_reason ? <span>skip: {log.skip_reason}</span> : null}
                      {log.order_ticket ? <span>ticket: {log.order_ticket}</span> : null}
                    </div>
                  </div>
                ))}
              </div>
            </article>

            <article className="rounded-[28px] border border-white/10 bg-slate-950/50 p-6 backdrop-blur">
              <SectionTitle title="直近の実トレード" description="保有中と決済完了を同時に確認" />
              <div className="mb-4 flex flex-wrap gap-2">
                {data.openTrades.length > 0 ? data.openTrades.map((trade) => (
                  <span key={`open-${trade.id}`} className="rounded-full border border-amber-300/18 bg-amber-300/8 px-3 py-1 text-xs text-amber-100">保有中 {trade.symbol} {trade.directionLabel}</span>
                )) : <span className="rounded-full border border-white/10 bg-white/6 px-3 py-1 text-xs text-slate-300">現在保有なし</span>}
              </div>
              <div className="overflow-hidden rounded-3xl border border-white/8">
                <table className="min-w-full divide-y divide-white/8 text-sm">
                  <thead className="bg-white/6 text-slate-300">
                    <tr>
                      <th className="px-4 py-3 text-left font-medium">銘柄</th>
                      <th className="px-4 py-3 text-left font-medium">判定日時</th>
                      <th className="px-4 py-3 text-left font-medium">方向</th>
                      <th className="px-4 py-3 text-left font-medium">勝率</th>
                      <th className="px-4 py-3 text-left font-medium">状態</th>
                      <th className="px-4 py-3 text-right font-medium">損益</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/6 bg-slate-950/35 text-slate-100">
                    {data.recentTrades.map((trade) => (
                      <tr key={trade.id}>
                        <td className="px-4 py-3">
                          <div className="font-medium">{trade.symbol}</div>
                          <div className="text-xs text-slate-400">{trade.timeframe ?? "-"}</div>
                        </td>
                        <td className="px-4 py-3 text-slate-300">{formatDateTime(trade.created_at)}</td>
                        <td className="px-4 py-3">{trade.directionLabel}</td>
                        <td className="px-4 py-3">{formatPercent(trade.win_prob != null ? trade.win_prob * 100 : null)}</td>
                        <td className="px-4 py-3">{trade.statusLabel}</td>
                        <td className="px-4 py-3 text-right">{formatMoney(trade.profit_loss)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </article>
          </section>

          <section className="mt-8 rounded-[28px] border border-white/10 bg-slate-950/50 p-6 backdrop-blur">
            <SectionTitle title="トレード成績分析" description="指定期間と総合成績を比較" />
            <div className="mb-5 flex flex-wrap gap-2">
              {PERIOD_OPTIONS.map((option) => {
                const active = option.key === data.selectedPeriod.key;
                return (
                  <a
                    key={option.key}
                    href={`/?period=${option.key}`}
                    className={`rounded-full px-4 py-2 text-sm transition ${active ? "bg-cyan-300 text-slate-950" : "border border-white/12 bg-white/6 text-slate-200 hover:bg-white/10"}`}
                  >
                    {option.label}
                  </a>
                );
              })}
            </div>
            <div className="grid gap-4 md:grid-cols-3 xl:grid-cols-6">
              <StatCard label={`${data.selectedPeriod.label} 勝率`} value={formatPercent(data.selectedPeriod.summary.winRate)} sublabel={`取引数 ${data.selectedPeriod.summary.tradeCount}`} />
              <StatCard label={`${data.selectedPeriod.label} 総損益`} value={formatMoney(data.selectedPeriod.summary.totalPnl)} sublabel={`平均 ${formatMoney(data.selectedPeriod.summary.averagePnl)}`} />
              <StatCard label={`${data.selectedPeriod.label} WIN`} value={String(data.selectedPeriod.summary.winCount)} sublabel={`LOSS ${data.selectedPeriod.summary.lossCount} / BE ${data.selectedPeriod.summary.breakevenCount}`} />
              <StatCard label="総合 勝率" value={formatPercent(data.total.summary.winRate)} sublabel={`取引数 ${data.total.summary.tradeCount}`} />
              <StatCard label="総合 総損益" value={formatMoney(data.total.summary.totalPnl)} sublabel={`平均 ${formatMoney(data.total.summary.averagePnl)}`} />
              <StatCard label="総合 WIN" value={String(data.total.summary.winCount)} sublabel={`LOSS ${data.total.summary.lossCount} / BE ${data.total.summary.breakevenCount}`} />
            </div>
            <div className="mt-6 grid gap-5 lg:grid-cols-2">
              <article className="rounded-3xl border border-white/8 bg-white/5 p-4">
                <h3 className="text-lg font-semibold text-white">{data.selectedPeriod.label} 銘柄別損益</h3>
                <div className="mt-4 space-y-3">
                  {data.selectedPeriod.symbolBreakdown.map((row) => (
                    <div key={`period-${row.symbol}`} className="flex items-center justify-between rounded-2xl bg-slate-900/55 px-4 py-3">
                      <div>
                        <div className="font-medium text-white">{row.symbol}</div>
                        <div className="text-xs text-slate-400">{row.tradeCount}件 / 勝率 {formatPercent(row.winRate)}</div>
                      </div>
                      <div className="text-sm font-semibold text-emerald-100">{formatMoney(row.totalPnl)}</div>
                    </div>
                  ))}
                </div>
              </article>
              <article className="rounded-3xl border border-white/8 bg-white/5 p-4">
                <h3 className="text-lg font-semibold text-white">総合 銘柄別損益</h3>
                <div className="mt-4 space-y-3">
                  {data.total.symbolBreakdown.map((row) => (
                    <div key={`total-${row.symbol}`} className="flex items-center justify-between rounded-2xl bg-slate-900/55 px-4 py-3">
                      <div>
                        <div className="font-medium text-white">{row.symbol}</div>
                        <div className="text-xs text-slate-400">{row.tradeCount}件 / 勝率 {formatPercent(row.winRate)}</div>
                      </div>
                      <div className="text-sm font-semibold text-emerald-100">{formatMoney(row.totalPnl)}</div>
                    </div>
                  ))}
                </div>
              </article>
            </div>
          </section>
        </div>
      </main>
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return (
      <main className="min-h-screen bg-slate-950 px-6 py-10 text-slate-100">
        <div className="mx-auto max-w-3xl rounded-[28px] border border-rose-400/20 bg-rose-950/20 p-8">
          <p className="text-xs uppercase tracking-[0.3em] text-rose-200/70">Dashboard Setup Required</p>
          <h1 className="mt-3 text-3xl font-semibold text-white">ダッシュボードの環境変数が未設定です</h1>
          <p className="mt-4 text-base leading-8 text-slate-300">{message}</p>
          <div className="mt-6 rounded-2xl border border-white/10 bg-white/6 p-4 text-sm leading-7 text-slate-200">
            <p>必要な環境変数:</p>
            <p>SUPABASE_URL</p>
            <p>SUPABASE_SERVICE_ROLE_KEY</p>
            <p className="mt-4">ローカルでは web/.env.local、Vercel では Project Settings → Environment Variables に設定してください。</p>
          </div>
        </div>
      </main>
    );
  }
}
