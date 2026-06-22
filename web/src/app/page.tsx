import { getDashboardData } from "@/lib/dashboard";
import { AiRefreshButton } from "@/components/ai-refresh-button";

export const dynamic = "force-dynamic";

type DashboardData = Awaited<ReturnType<typeof getDashboardData>>;
type EALogRecord = DashboardData["recentEaLogs"][number];
type TradeRecord = DashboardData["recentTrades"][number];

const PERIOD_OPTIONS = [
  { key: "7", label: "7日" },
  { key: "30", label: "30日" },
  { key: "90", label: "90日" },
  { key: "365", label: "365日" },
  { key: "all", label: "全期間" },
] as const;

const COUNTRY_LABELS: Record<string, string> = {
  USD: "米国",
  EUR: "ユーロ圏",
  GBP: "英国",
  JPY: "日本",
  CAD: "カナダ",
  AUD: "豪州",
  NZD: "ニュージーランド",
  CHF: "スイス",
  CNY: "中国",
};

const SKIP_REASON_LABELS: Record<string, string> = {
  winprob_below_gate: "勝率が実行基準を下回ったため",
  ev_below_min: "期待値が最低基準を下回ったため",
  cost_too_high: "コストが許容上限を超えたため",
  calibration_not_applied: "補正モデルを適用できなかったため",
  extreme_rsi_penalty: "RSI が過熱圏で逆行リスクが高いため",
  rsi_mr_bonus: "逆張り補正は入ったが実行基準には届かなかったため",
  recent_perf_penalty: "直近成績の悪化を考慮して抑制したため",
  streak_guard: "連敗ガードを優先したため",
};

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

function formatCadenceLabel(value: string | null | undefined) {
  switch (value) {
    case "daily":
      return "日次更新";
    case "hourly":
      return "時間更新";
    case "weekly":
      return "週次更新";
    default:
      return value ?? "更新頻度不明";
  }
}

function formatIndicatorTitle(title: string) {
  return title
    .replace(/^Median CPI\s+y\/y$/i, "中央値CPI 前年比")
    .replace(/^Median CPI\s+m\/m$/i, "中央値CPI 前月比")
    .replace(/^Core CPI\s+y\/y$/i, "コアCPI 前年比")
    .replace(/^Core CPI\s+m\/m$/i, "コアCPI 前月比")
    .replace(/^CPI\s+y\/y$/i, "CPI 前年比")
    .replace(/^CPI\s+m\/m$/i, "CPI 前月比")
    .replace(/^Retail Sales\s+m\/m$/i, "小売売上高 前月比")
    .replace(/^Employment Change$/i, "雇用者数")
    .trim();
}

function humanizeTheme(theme: string) {
  if (!theme.startsWith("高影響イベント接近:")) return theme;

  const items = theme
    .replace("高影響イベント接近:", "")
    .split("/")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      const match = item.match(/^([A-Z]{3})\s+(.+)$/);
      if (!match) return { country: "", title: formatIndicatorTitle(item) };
      return {
        country: match[1],
        title: formatIndicatorTitle(match[2]),
      };
    });

  if (items.length === 0) return theme;

  const grouped = new Map<string, string[]>();
  for (const item of items) {
    const list = grouped.get(item.country) ?? [];
    list.push(item.title);
    grouped.set(item.country, list);
  }

  const descriptions = [...grouped.entries()].map(([country, titles]) => {
    const countryLabel = COUNTRY_LABELS[country] ?? country;
    const uniqueTitles = [...new Set(titles)];
    const allCpi = uniqueTitles.every((title) => title.includes("CPI"));
    if (allCpi) {
      return `${countryLabel}で重要なCPI関連指標（${uniqueTitles.join("、")}）の発表が近づいています`;
    }
    return `${countryLabel}で重要指標（${uniqueTitles.join("、")}）の発表が近づいています`;
  });

  return descriptions.join(" / ");
}

function parseDecisionSummary(summary: string | null | undefined) {
  if (!summary) return null;

  const tokens = summary.split(" | ").map((token) => token.trim()).filter(Boolean);
  if (tokens.length === 0) return null;

  const [headline, ...pairs] = tokens;
  const headlineMatch = headline.match(/^(実行|見送り)\s+(BUY|SELL|HOLD)$/);
  const values: Record<string, string> = {};
  for (const pair of pairs) {
    const index = pair.indexOf("=");
    if (index <= 0) continue;
    values[pair.slice(0, index)] = pair.slice(index + 1);
  }

  return {
    status: headlineMatch?.[1] ?? null,
    direction: headlineMatch?.[2] ?? null,
    winProb: values.p ? Number(values.p) : null,
    gate: values.gate ? Number(values.gate) : null,
    ev: values.ev ? Number(values.ev.replace(/R$/i, "")) : null,
    minEv: values.minEv ? Number(values.minEv.replace(/R$/i, "")) : null,
    cost: values.cost ?? null,
    calibration: values.cal ?? null,
    skip: values.skip ?? null,
  };
}

function translateSkipReasons(skip: string | null | undefined) {
  if (!skip) return [];
  return skip
    .split(/[|+]/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => SKIP_REASON_LABELS[part] ?? part.replace(/_/g, " "));
}

function buildEaNarrative(log: EALogRecord) {
  const parsed = parseDecisionSummary(log.decision_summary);
  if (!parsed) return log.decision_summary ?? log.ai_reasoning ?? "要約なし";

  const sentences: string[] = [];
  if (parsed.status === "実行") {
    sentences.push(`${parsed.direction} 方向の条件が揃ったため、今回はエントリー実行の判断です。`);
  } else if (parsed.status === "見送り") {
    sentences.push(`${parsed.direction} 方向のシグナルはありましたが、今回はエントリーを見送りました。`);
  }

  if (parsed.winProb != null && parsed.gate != null) {
    const actual = parsed.winProb * 100;
    const required = parsed.gate * 100;
    const comparison = actual >= required ? "基準を満たしています" : "基準を下回っています";
    sentences.push(`想定勝率は ${actual.toFixed(1)}% で、実行基準 ${required.toFixed(1)}% と比べると ${comparison}。`);
  }

  if (parsed.ev != null && parsed.minEv != null) {
    const comparison = parsed.ev >= parsed.minEv ? "上回っています" : "下回っています";
    sentences.push(`期待値は ${parsed.ev.toFixed(2)}R で、最低基準 ${parsed.minEv.toFixed(2)}R を ${comparison}。`);
  }

  if (parsed.cost) {
    const [current, limit] = parsed.cost.split("/");
    if (current && limit) {
      sentences.push(`取引コストは ${current}R で、許容上限 ${limit}R の範囲で判定しています。`);
    }
  }

  if (parsed.calibration) {
    const calibrationLabel = parsed.calibration === "off"
      ? "勝率補正は今回は使っていません"
      : parsed.calibration === "ok"
        ? "勝率補正を適用したうえで判定しています"
        : "本来必要な勝率補正を適用できませんでした";
    sentences.push(`${calibrationLabel}。`);
  }

  const translatedSkipReasons = translateSkipReasons(parsed.skip ?? log.skip_reason ?? null);
  if (translatedSkipReasons.length > 0) {
    sentences.push(`見送り理由: ${translatedSkipReasons.join(" / ")}。`);
  }

  return sentences.join(" ");
}

function buildMarketPulse(
  themeCount: number,
  openTradeCount: number,
  hasDataErrors: boolean,
) {
  if (hasDataErrors) {
    return {
      label: "要点検",
      tone: "border-amber-300/20 bg-amber-300/10 text-amber-50",
      description: "一部データが欠損しています。運用判断前に連携状況を確認してください。",
    };
  }

  if (themeCount >= 3) {
    return {
      label: "イベント集中",
      tone: "border-rose-300/18 bg-rose-300/10 text-rose-50",
      description: "重要テーマが重なっています。通常より慎重な執行判断が必要です。",
    };
  }

  if (openTradeCount > 0) {
    return {
      label: "ポジション監視",
      tone: "border-cyan-300/18 bg-cyan-300/10 text-cyan-50",
      description: "保有ポジションがあります。新規判断より既存ポジション管理を優先してください。",
    };
  }

  return {
    label: "通常監視",
    tone: "border-emerald-300/18 bg-emerald-300/10 text-emerald-50",
    description: "大きな警戒要因は少なく、通常どおり監視しやすい状態です。",
  };
}

function TradeCards({ trades }: { trades: TradeRecord[] }) {
  return (
    <div className="space-y-3 md:hidden">
      {trades.map((trade) => (
        <article key={trade.id} className="rounded-3xl border border-white/8 bg-slate-950/45 p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-base font-semibold text-white">{trade.symbol}</div>
              <div className="text-xs text-slate-400">{trade.timeframe ?? "-"} / {formatDateTime(trade.created_at)}</div>
            </div>
            <div className="rounded-full bg-white/8 px-3 py-1 text-xs text-slate-200">{trade.directionLabel}</div>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
            <div>
              <div className="text-xs text-slate-400">勝率</div>
              <div className="mt-1 text-slate-100">{formatPercent(trade.win_prob != null ? trade.win_prob * 100 : null)}</div>
            </div>
            <div>
              <div className="text-xs text-slate-400">状態</div>
              <div className="mt-1 text-slate-100">{trade.statusLabel}</div>
            </div>
            <div className="col-span-2">
              <div className="text-xs text-slate-400">損益</div>
              <div className="mt-1 text-slate-100">{formatMoney(trade.profit_loss)}</div>
            </div>
          </div>
        </article>
      ))}
    </div>
  );
}

function HeroBadge({ label, value }: { label: string; value: string }) {
  return (
    <div className="surface-panel rounded-2xl px-4 py-3">
      <p className="text-[11px] uppercase tracking-[0.24em] text-slate-400">{label}</p>
      <p className="mt-2 text-sm font-medium text-white sm:text-base">{value}</p>
    </div>
  );
}

type PageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function StatCard({
  label,
  value,
  sublabel,
  accent = "text-cyan-200/72",
}: {
  label: string;
  value: string;
  sublabel?: string;
  accent?: string;
}) {
  return (
    <article className="surface-panel rounded-3xl p-5 shadow-[0_20px_60px_rgba(0,0,0,0.22)] backdrop-blur">
      <p className={`text-xs uppercase tracking-[0.24em] ${accent}`}>{label}</p>
      <p className="mt-3 text-3xl font-semibold text-white">{value}</p>
      {sublabel ? <p className="mt-2 text-sm text-slate-300">{sublabel}</p> : null}
    </article>
  );
}

function SectionTitle({ title, description }: { title: string; description: string }) {
  return (
    <div className="mb-5 flex flex-col items-start justify-between gap-2 sm:flex-row sm:items-end sm:gap-4">
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

  let data: DashboardData;

  try {
    data = await getDashboardData(period);
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

  const latest = data.pairSelector.latest;
  const liveContext = data.pairSelector.live_context;
  const marketPulse = buildMarketPulse(
    liveContext?.themes?.length ?? 0,
    data.openTrades.length,
    data.dataErrors.length > 0,
  );
  const spotlightReason = latest?.top_picks?.[0]?.reason ?? latest?.recommended_pairs?.[0]?.reason ?? "理由データなし";

  return (
    <main className="dashboard-shell min-h-screen px-5 py-8 text-slate-100 sm:px-8 lg:px-10">
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

        <section className="hero-panel rounded-[32px] p-6 shadow-[0_24px_120px_rgba(3,10,18,0.55)] backdrop-blur lg:p-8">
          <div className="flex flex-col gap-8 lg:flex-row lg:items-start lg:justify-between">
            <div className="max-w-3xl">
              <div className="mb-5 inline-flex items-center gap-3 rounded-full border border-white/12 bg-white/6 px-4 py-2 text-xs uppercase tracking-[0.24em] text-slate-300">
                <span className="h-2.5 w-2.5 rounded-full bg-emerald-300 shadow-[0_0_18px_rgba(134,239,172,0.9)]" />
                AI Trader Command View
              </div>
              <h1 className="font-title text-3xl font-semibold tracking-[0.16em] text-white sm:text-5xl">
                Awaji Samurai AI Trader
              </h1>
              <p className="mt-4 max-w-3xl text-base leading-8 text-slate-300 sm:text-lg">
                本日の推奨ペア、リアルタイムの AI 判断、EA ログ、直近実トレード、指定期間成績、総合成績を 1 画面で確認できる運用ビューです。
              </p>
              <div className="mt-6 grid gap-3 sm:grid-cols-3">
                <HeroBadge label="更新 cadence" value={formatCadenceLabel(latest?.cadence ?? null)} />
                <HeroBadge label="監視テーマ" value={`${liveContext?.themes?.length ?? 0} 件`} />
                <HeroBadge label="選定 lookback" value={`${latest?.lookback_days ?? 21} 日`} />
              </div>
              <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-start">
                <AiRefreshButton
                  cadence={latest?.cadence ?? "daily"}
                  lookbackDays={latest?.lookback_days ?? 21}
                  topN={latest?.top_n ?? latest?.top_picks?.length ?? latest?.recommended_pairs?.length ?? 3}
                />
                <a href={`/api/dashboard?period=${period}`} className="rounded-full border border-emerald-300/25 bg-emerald-300/10 px-4 py-2 text-center text-sm text-emerald-100 transition hover:bg-emerald-300/16">Dashboard API</a>
                <a href="https://nebphrnnpmuqbkymwefs.supabase.co/functions/v1/pair-selector?limit=1" className="rounded-full border border-white/12 bg-white/6 px-4 py-2 text-center text-sm text-slate-100 transition hover:bg-white/10">Pair Selector JSON</a>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2 lg:w-[360px] lg:grid-cols-1">
              <StatCard label="最終更新" value={formatDateTime(latest?.generated_at ?? data.generatedAt)} accent="text-emerald-200/75" />
              <StatCard label="本日トップ推奨" value={latest?.digest?.top_pick_symbol ?? latest?.top_picks?.[0]?.symbol ?? "-"} sublabel={latest?.digest?.risk_label ?? "-"} accent="text-cyan-200/75" />
              <StatCard label="オープン中ポジション" value={String(data.openTrades.length)} sublabel={data.openTrades.length > 0 ? data.openTrades.map((trade) => trade.symbol).join(" / ") : "現在保有なし"} accent="text-amber-200/75" />
            </div>
          </div>

          <div className="mt-8 grid gap-4 xl:grid-cols-[1.1fr_0.75fr_0.75fr]">
            <article className={`rounded-[28px] border p-5 backdrop-blur ${marketPulse.tone}`}>
              <p className="text-xs uppercase tracking-[0.24em] text-current/70">運用ステータス</p>
              <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <h2 className="text-2xl font-semibold text-white">{marketPulse.label}</h2>
                  <p className="mt-2 max-w-2xl text-sm leading-7 text-current/88">{marketPulse.description}</p>
                </div>
                <div className="grid min-w-[220px] grid-cols-2 gap-3 text-sm text-white/90">
                  <div className="rounded-2xl border border-white/10 bg-slate-950/30 px-4 py-3">
                    <div className="text-xs uppercase tracking-[0.2em] text-white/55">本日注目</div>
                    <div className="mt-2 font-medium text-white">{latest?.digest?.top_pick_symbol ?? latest?.top_picks?.[0]?.symbol ?? "-"}</div>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-slate-950/30 px-4 py-3">
                    <div className="text-xs uppercase tracking-[0.2em] text-white/55">イベント件数</div>
                    <div className="mt-2 font-medium text-white">{liveContext?.economic_events?.length ?? 0} 件</div>
                  </div>
                </div>
              </div>
            </article>

            <article className="surface-panel rounded-[28px] p-5 backdrop-blur">
              <p className="text-xs uppercase tracking-[0.24em] text-slate-400">トップ推奨の見立て</p>
              <div className="mt-3 flex items-center justify-between gap-4">
                <div className="text-3xl font-semibold text-white">{latest?.top_picks?.[0]?.symbol ?? latest?.recommended_pairs?.[0]?.symbol ?? "-"}</div>
                <span className="rounded-full border border-emerald-300/20 bg-emerald-300/10 px-3 py-1 text-xs text-emerald-100">
                  {latest?.digest?.risk_label ?? "Risk Unset"}
                </span>
              </div>
              <p className="mt-4 text-sm leading-7 text-slate-300">{spotlightReason}</p>
            </article>

            <article className="surface-panel rounded-[28px] p-5 backdrop-blur">
              <p className="text-xs uppercase tracking-[0.24em] text-slate-400">稼働メモ</p>
              <div className="mt-4 space-y-3 text-sm text-slate-300">
                <div className="rounded-2xl border border-white/8 bg-slate-950/45 px-4 py-3">更新時刻: {formatDateTime(latest?.generated_at ?? data.generatedAt)}</div>
                <div className="rounded-2xl border border-white/8 bg-slate-950/45 px-4 py-3">推奨候補: {(latest?.recommended_pairs?.length ?? 0)} 件 / 回避候補: {(latest?.avoided_pairs?.length ?? 0)} 件</div>
                <div className="rounded-2xl border border-white/8 bg-slate-950/45 px-4 py-3">直近ログ: {data.recentEaLogs.length} 件を表示中</div>
              </div>
            </article>
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
            <article className="surface-panel rounded-[28px] p-5 backdrop-blur">
              <SectionTitle title="本日のAI要約" description="pair-selector の live digest と市場テーマ" />
              <div className="space-y-3 text-sm leading-7 text-slate-200">
                {(latest?.digest_lines ?? latest?.digest_text?.split("\n") ?? [latest?.summary ?? "要約なし"]).map((line) => (
                  <div key={line} className="rounded-2xl border border-white/8 bg-slate-900/60 px-4 py-3">{line}</div>
                ))}
              </div>
              {liveContext?.summary ? <p className="mt-4 text-sm leading-7 text-slate-300">{liveContext.summary}</p> : null}
            </article>

            <article className="surface-panel rounded-[28px] p-5 backdrop-blur">
              <SectionTitle title="市場テーマ" description="現在の市場認識と重要イベント" />
              <div className="grid gap-3 sm:grid-cols-2">
                {(liveContext?.themes ?? []).map((theme) => (
                  <div key={theme} className="rounded-2xl border border-cyan-300/18 bg-cyan-300/8 px-4 py-3 text-sm leading-6 text-cyan-50">
                    {humanizeTheme(theme)}
                  </div>
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
          <article className="surface-panel rounded-[28px] p-6 backdrop-blur">
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

          <article className="surface-panel rounded-[28px] p-6 backdrop-blur">
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
          <article className="surface-panel rounded-[28px] p-6 backdrop-blur">
            <SectionTitle title="直近5件のEAログ" description="ペア・判断時間・勝率・実行可否・売買方向" />
            <div className="space-y-4">
              {data.recentEaLogs.map((log) => (
                <div key={log.id} className="rounded-3xl border border-white/8 bg-white/5 p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <div className="text-lg font-semibold text-white">{log.sym} {log.tf ?? "-"}</div>
                      <div className="mt-1 text-xs text-slate-400">{formatDateTime(log.at)}</div>
                    </div>
                    <div className="flex flex-wrap gap-2 text-xs sm:justify-end">
                      <span className="max-w-full rounded-full bg-cyan-300/10 px-3 py-1 text-cyan-100">{formatDirection(log.action)}</span>
                      <span className="max-w-full rounded-full bg-white/8 px-3 py-1 text-slate-200">{log.trade_decision ?? "-"}</span>
                      <span className="max-w-full rounded-full bg-emerald-300/10 px-3 py-1 text-emerald-100">勝率 {formatPercent(log.win_prob != null ? log.win_prob * 100 : null)}</span>
                    </div>
                  </div>
                  <p className="mt-3 text-sm leading-7 text-slate-100">{buildEaNarrative(log)}</p>
                  {log.decision_summary ? <p className="mt-3 overflow-hidden rounded-2xl border border-white/8 bg-slate-950/45 px-4 py-3 font-mono text-xs leading-6 break-all text-slate-400">診断ログ: {log.decision_summary}</p> : null}
                  <div className="mt-2 flex flex-col gap-2 text-xs text-slate-400 sm:flex-row sm:flex-wrap sm:gap-3">
                    {log.entry_method ? <span className="break-all">entry: {log.entry_method}</span> : null}
                    {log.skip_reason ? <span className="break-all">skip: {log.skip_reason}</span> : null}
                    {log.order_ticket ? <span className="break-all">ticket: {log.order_ticket}</span> : null}
                  </div>
                </div>
              ))}
            </div>
          </article>

          <article className="surface-panel rounded-[28px] p-6 backdrop-blur">
            <SectionTitle title="直近の実トレード" description="保有中と決済完了を同時に確認" />
            <div className="mb-4 flex flex-wrap gap-2">
              {data.openTrades.length > 0 ? data.openTrades.map((trade) => (
                <span key={`open-${trade.id}`} className="rounded-full border border-amber-300/18 bg-amber-300/8 px-3 py-1 text-xs text-amber-100">保有中 {trade.symbol} {trade.directionLabel}</span>
              )) : <span className="rounded-full border border-white/10 bg-white/6 px-3 py-1 text-xs text-slate-300">現在保有なし</span>}
            </div>
            <TradeCards trades={data.recentTrades} />
            <div className="hidden overflow-hidden rounded-3xl border border-white/8 md:block">
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

        <section className="surface-panel mt-8 rounded-[28px] p-6 backdrop-blur">
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
}
