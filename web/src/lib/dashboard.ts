type PairRecommendation = {
  symbol: string;
  score: number;
  confidence: "high" | "medium" | "low";
  reason: string;
  caution?: string;
};

type PairSelectorDigest = {
  risk_label: string;
  top_pick_symbol: string;
  market_themes: string[];
  avoided_symbols: string[];
  top_pick_reason: string | null;
  avoided_reason: string | null;
};

type PairSelectorLiveContext = {
  summary?: string;
  risk_level?: "low" | "medium" | "high";
  themes?: string[];
  pair_notes?: Array<{
    symbol: string;
    bias: "supportive" | "neutral" | "cautious";
    notes: string[];
  }>;
  economic_events?: Array<{
    country: string;
    country_label_ja?: string;
    title: string;
    title_ja?: string;
    status: "upcoming" | "recent";
    actual?: string | null;
    forecast?: string | null;
    impact?: "High" | "Medium" | "Low";
  }>;
};

type PairSelectorLatest = {
  generated_at: string;
  cadence: string;
  timeframe: string;
  lookback_days: number;
  summary: string;
  digest_text?: string;
  digest_lines?: string[];
  digest?: PairSelectorDigest;
  top_picks: PairRecommendation[];
  recommended_pairs: PairRecommendation[];
  neutral_pairs: PairRecommendation[];
  avoided_pairs: PairRecommendation[];
};

type PairSelectorResponse = {
  latest: PairSelectorLatest | null;
  live_context: PairSelectorLiveContext | null;
};

type EALogRecord = {
  id: string;
  created_at: string;
  at: string;
  sym: string;
  tf: string | null;
  action: string | null;
  trade_decision: string | null;
  win_prob: number | null;
  decision_summary: string | null;
  skip_reason: string | null;
  entry_method: string | null;
  ai_reasoning: string | null;
  order_ticket: number | null;
};

type AISignalRecord = {
  id: number;
  created_at: string;
  symbol: string;
  timeframe: string | null;
  dir: number | null;
  win_prob: number | null;
  entry_price: number | null;
  exit_price: number | null;
  profit_loss: number | null;
  closed_at: string | null;
  actual_result: string | null;
  order_ticket: number | null;
  reason: string | null;
  decision_summary?: string | null;
  entry_method?: string | null;
  is_virtual?: boolean | null;
  reverse_execution?: boolean | null;
};

type DashboardSummary = {
  tradeCount: number;
  winCount: number;
  lossCount: number;
  breakevenCount: number;
  winRate: number | null;
  totalPnl: number;
  averagePnl: number | null;
};

type SymbolSummary = {
  symbol: string;
  tradeCount: number;
  winRate: number | null;
  totalPnl: number;
};

type DashboardData = {
  generatedAt: string;
  dataErrors: string[];
  pairSelector: PairSelectorResponse;
  recentEaLogs: EALogRecord[];
  recentTrades: Array<AISignalRecord & { statusLabel: string; directionLabel: string }>;
  openTrades: Array<AISignalRecord & { statusLabel: string; directionLabel: string }>;
  selectedPeriod: {
    key: string;
    label: string;
    summary: DashboardSummary;
    symbolBreakdown: SymbolSummary[];
  };
  total: {
    summary: DashboardSummary;
    symbolBreakdown: SymbolSummary[];
  };
};

const RAW_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SERVICE_ROLE_KEY ?? "";

function normalizeSupabaseProjectUrl(value: string) {
  return value
    .trim()
    .replace(/\/+$/, "")
    .replace(/\/(?:rest|functions)\/v1$/, "");
}

const SUPABASE_URL = normalizeSupabaseProjectUrl(RAW_SUPABASE_URL);

function requireEnv() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY for dashboard data fetch.");
  }
}

function supabaseHeaders() {
  return {
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Accept: "application/json",
  };
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: supabaseHeaders(),
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status} ${url}`);
  }
  return response.json() as Promise<T>;
}

async function safeFetch<T>(loader: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await loader();
  } catch {
    return fallback;
  }
}

async function safeFetchWithError<T>(label: string, loader: () => Promise<T>, fallback: T): Promise<{ data: T; error: string | null }> {
  try {
    return {
      data: await loader(),
      error: null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      data: fallback,
      error: `${label}: ${message}`,
    };
  }
}

function buildRestUrl(table: string, params: Record<string, string>) {
  const search = new URLSearchParams(params);
  return `${SUPABASE_URL}/rest/v1/${table}?${search.toString()}`;
}

function buildFunctionUrl(functionName: string, params: Record<string, string>) {
  const search = new URLSearchParams(params);
  return `${SUPABASE_URL}/functions/v1/${functionName}?${search.toString()}`;
}

function toIsoDaysAgo(days: number) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

function round2(value: number | null) {
  if (value === null || !Number.isFinite(value)) return null;
  return Math.round(value * 100) / 100;
}

function summarizeTrades(trades: AISignalRecord[]): DashboardSummary {
  const tradeCount = trades.length;
  const winCount = trades.filter((trade) => trade.actual_result === "WIN").length;
  const lossCount = trades.filter((trade) => trade.actual_result === "LOSS").length;
  const breakevenCount = trades.filter((trade) => trade.actual_result === "BREAK_EVEN").length;
  const totalPnl = trades.reduce((sum, trade) => sum + (trade.profit_loss ?? 0), 0);
  return {
    tradeCount,
    winCount,
    lossCount,
    breakevenCount,
    winRate: tradeCount > 0 ? round2((winCount / tradeCount) * 100) : null,
    totalPnl: round2(totalPnl) ?? 0,
    averagePnl: tradeCount > 0 ? round2(totalPnl / tradeCount) : null,
  };
}

function buildSymbolBreakdown(trades: AISignalRecord[]): SymbolSummary[] {
  const bySymbol = new Map<string, AISignalRecord[]>();
  for (const trade of trades) {
    const current = bySymbol.get(trade.symbol) ?? [];
    current.push(trade);
    bySymbol.set(trade.symbol, current);
  }

  return [...bySymbol.entries()]
    .map(([symbol, rows]) => {
      const summary = summarizeTrades(rows);
      return {
        symbol,
        tradeCount: summary.tradeCount,
        winRate: summary.winRate,
        totalPnl: summary.totalPnl,
      };
    })
    .sort((left, right) => right.totalPnl - left.totalPnl)
    .slice(0, 8);
}

function periodLabel(period: string) {
  if (period === "7") return "直近7日";
  if (period === "30") return "直近30日";
  if (period === "90") return "直近90日";
  if (period === "365") return "直近365日";
  return "全期間";
}

function directionLabel(dir: number | null) {
  if (dir === 1) return "BUY";
  if (dir === -1) return "SELL";
  return "HOLD";
}

function tradeStatusLabel(trade: AISignalRecord) {
  if (!trade.closed_at) return "保有中";
  if (trade.actual_result === "WIN") return "決済完了: WIN";
  if (trade.actual_result === "LOSS") return "決済完了: LOSS";
  if (trade.actual_result === "BREAK_EVEN") return "決済完了: BE";
  return "決済完了";
}

function decorateTrades(trades: AISignalRecord[]) {
  return trades.map((trade) => ({
    ...trade,
    statusLabel: tradeStatusLabel(trade),
    directionLabel: directionLabel(trade.dir),
  }));
}

async function fetchPairSelector(): Promise<PairSelectorResponse> {
  return fetchJson<PairSelectorResponse>(buildFunctionUrl("pair-selector", { limit: "1" }));
}

async function fetchRecentEaLogs(): Promise<EALogRecord[]> {
  const url = buildRestUrl("ea-log", {
    select: "id,created_at,at,sym,tf,action,trade_decision,win_prob,decision_summary,skip_reason,entry_method,ai_reasoning,order_ticket",
    order: "at.desc",
    limit: "5",
  });
  return fetchJson<EALogRecord[]>(url);
}

async function fetchRecentTrades(): Promise<AISignalRecord[]> {
  const url = buildRestUrl("ai_signals", {
    select: "id,created_at,symbol,timeframe,dir,win_prob,entry_price,exit_price,profit_loss,closed_at,actual_result,order_ticket,reason,decision_summary,entry_method,is_virtual,reverse_execution",
    is_virtual: "eq.false",
    order: "created_at.desc",
    limit: "12",
  });
  return fetchJson<AISignalRecord[]>(url);
}

async function fetchOpenTrades(): Promise<AISignalRecord[]> {
  const url = buildRestUrl("ai_signals", {
    select: "id,created_at,symbol,timeframe,dir,win_prob,entry_price,exit_price,profit_loss,closed_at,actual_result,order_ticket,reason,decision_summary,entry_method,is_virtual,reverse_execution",
    is_virtual: "eq.false",
    closed_at: "is.null",
    order: "created_at.desc",
    limit: "8",
  });
  return fetchJson<AISignalRecord[]>(url);
}

async function fetchClosedTrades(period: string): Promise<AISignalRecord[]> {
  const params: Record<string, string> = {
    select: "id,created_at,symbol,timeframe,dir,win_prob,entry_price,exit_price,profit_loss,closed_at,actual_result,order_ticket,reason,decision_summary,entry_method,is_virtual,reverse_execution",
    is_virtual: "eq.false",
    closed_at: "not.is.null",
    actual_result: "in.(WIN,LOSS,BREAK_EVEN)",
    order: "closed_at.desc",
    limit: period === "all" ? "5000" : "1000",
  };
  if (period !== "all") {
    params.closed_at = `gte.${toIsoDaysAgo(Number(period))}`;
  }
  const url = buildRestUrl("ai_signals", params);
  return fetchJson<AISignalRecord[]>(url);
}

export async function getDashboardData(period = "30"): Promise<DashboardData> {
  requireEnv();

  const [pairSelectorResult, recentEaLogsResult, recentTradesResult, openTradesResult, selectedTradesResult, totalTradesResult] = await Promise.all([
    safeFetchWithError("pair-selector", fetchPairSelector, { latest: null, live_context: null }),
    safeFetchWithError("ea-log recent", fetchRecentEaLogs, []),
    safeFetchWithError("ai_signals recent", fetchRecentTrades, []),
    safeFetchWithError("ai_signals open", fetchOpenTrades, []),
    safeFetchWithError(`ai_signals period ${period}`, () => fetchClosedTrades(period), []),
    safeFetchWithError("ai_signals total", () => fetchClosedTrades("all"), []),
  ]);

  const pairSelector = pairSelectorResult.data;
  const recentEaLogs = recentEaLogsResult.data;
  const recentTrades = recentTradesResult.data;
  const openTrades = openTradesResult.data;
  const selectedTrades = selectedTradesResult.data;
  const totalTrades = totalTradesResult.data;
  const dataErrors = [
    pairSelectorResult.error,
    recentEaLogsResult.error,
    recentTradesResult.error,
    openTradesResult.error,
    selectedTradesResult.error,
    totalTradesResult.error,
  ].filter((value): value is string => Boolean(value));

  return {
    generatedAt: new Date().toISOString(),
    dataErrors,
    pairSelector,
    recentEaLogs,
    recentTrades: decorateTrades(recentTrades),
    openTrades: decorateTrades(openTrades),
    selectedPeriod: {
      key: period,
      label: periodLabel(period),
      summary: summarizeTrades(selectedTrades),
      symbolBreakdown: buildSymbolBreakdown(selectedTrades),
    },
    total: {
      summary: summarizeTrades(totalTrades),
      symbolBreakdown: buildSymbolBreakdown(totalTrades),
    },
  };
}
