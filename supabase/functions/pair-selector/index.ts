import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
let SUPABASE_SERVICE_ROLE_KEY =
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
  Deno.env.get("SERVICE_ROLE_KEY") ??
  "";
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") ?? "";
const PAIR_SELECTOR_MODEL = Deno.env.get("PAIR_SELECTOR_MODEL") ?? "gpt-5-mini";
const PAIR_SELECTOR_FALLBACK_MODEL = Deno.env.get("OPENAI_MODEL") ?? "gpt-4.1-mini";
const FINNHUB_API_KEY = Deno.env.get("FINNHUB_API_KEY") ?? "";

let supabase = createClient(
  SUPABASE_URL || "http://127.0.0.1",
  SUPABASE_SERVICE_ROLE_KEY || "invalid",
);

const DEFAULT_UNIVERSE = [
  "EURUSD",
  "GBPUSD",
  "USDJPY",
  "USDCHF",
  "AUDUSD",
  "NZDUSD",
  "USDCAD",
  "EURJPY",
  "GBPJPY",
  "XAUUSD",
  "XAGUSD",
  "BTCUSD",
];
const DEFAULT_TIMEFRAME = "M15";
const DEFAULT_LOOKBACK_DAYS = 21;
const DEFAULT_TOP_N = 3;
const SHADOW_EPISODE_MINUTES = 120;
const MIN_BACKFILL_SCORE = 48;
const GOOGLE_NEWS_RSS = "https://news.google.com/rss/search";
const FOREX_FACTORY_CALENDAR_URL = "https://nfs.faireconomy.media/ff_calendar_thisweek.json";
const FINNHUB_CALENDAR_URL = "https://finnhub.io/api/v1/economic-calendar";

const PAIR_TICKERS: Record<string, { label: string; ticker: string }> = {
  EURUSD: { label: "EUR/USD", ticker: "EURUSD=X" },
  GBPUSD: { label: "GBP/USD", ticker: "GBPUSD=X" },
  USDJPY: { label: "USD/JPY", ticker: "JPY=X" },
  USDCHF: { label: "USD/CHF", ticker: "CHF=X" },
  AUDUSD: { label: "AUD/USD", ticker: "AUDUSD=X" },
  NZDUSD: { label: "NZD/USD", ticker: "NZDUSD=X" },
  USDCAD: { label: "USD/CAD", ticker: "CAD=X" },
  EURJPY: { label: "EUR/JPY", ticker: "EURJPY=X" },
  GBPJPY: { label: "GBP/JPY", ticker: "GBPJPY=X" },
  XAUUSD: { label: "Gold", ticker: "GC=F" },
  XAGUSD: { label: "Silver", ticker: "SI=F" },
  BTCUSD: { label: "Bitcoin", ticker: "BTC-USD" },
};

const MACRO_TICKERS = [
  { key: "DXY", label: "US Dollar Index", ticker: "DX-Y.NYB" },
  { key: "US10Y", label: "US 10Y Yield", ticker: "^TNX" },
  { key: "VIX", label: "VIX", ticker: "^VIX" },
];

const NEWS_QUERIES = [
  { topic: "macro", query: '("Federal Reserve" OR inflation OR CPI OR jobs OR recession OR "Treasury yield" OR "US dollar") when:1d' },
  { topic: "fx", query: '(forex OR EURUSD OR USDJPY OR GBPUSD OR "yen" OR "euro" OR "pound") when:1d' },
  { topic: "metals", query: '(gold OR silver OR XAUUSD OR XAGUSD) when:1d' },
  { topic: "crypto", query: '(bitcoin OR BTCUSD OR crypto) when:1d' },
];

type KeySource = "env" | "authorization";

interface TradeRow {
  symbol: string;
  created_at: string;
  dir: number | null;
  actual_result: string | null;
  profit_loss: number | null;
  closed_at: string | null;
  win_prob: number | null;
  ml_pattern_used: boolean | null;
  entry_method: string | null;
}

interface SymbolStats {
  symbol: string;
  timeframe: string;
  real_trades: number;
  real_wins: number;
  real_losses: number;
  real_win_rate: number | null;
  real_total_profit_loss: number;
  real_avg_profit_loss: number | null;
  avg_win_prob: number | null;
  recent_7d_trades: number;
  recent_7d_win_rate: number | null;
  recent_7d_profit_loss: number;
  ml_used_trades: number;
  market_trades: number;
  market_win_rate: number | null;
  pullback_trades: number;
  pullback_win_rate: number | null;
  virtual_trades: number;
  virtual_raw_trades: number;
  virtual_episode_trades: number;
  virtual_win_rate: number | null;
  virtual_win_rate_bayesian: number | null;
  virtual_total_profit_loss: number;
  real_win_rate_bayesian: number | null;
  market_fit_score: number;
  market_regime: "directional" | "noisy" | "mixed" | "unavailable";
  market_eligible: boolean;
  score_components: {
    sample: number;
    real: number;
    recent: number;
    virtual: number;
    virtual_profit?: number;
    market: number;
  };
  compatibility_score: number;
}

interface PairRecommendation {
  symbol: string;
  score: number;
  confidence: "high" | "medium" | "low";
  reason: string;
  caution?: string;
  allowed_direction?: "buy" | "sell" | "both" | "none";
  strategy?: "trend_follow" | "pullback" | "mean_revert" | "breakout" | "standby";
  session_windows?: SessionWindow[];
  avoid_event_windows?: EventWindow[];
  min_win_prob?: number;
  max_cost_r?: number;
  plan_note?: string;
}

interface AiSelectionResult {
  summary: string;
  selected_pairs: PairRecommendation[];
  avoided_pairs: PairRecommendation[];
  trade_plan?: DailyTradePlan;
}

interface SessionWindow {
  label: string;
  start_utc: string;
  end_utc: string;
}

interface EventWindow {
  label: string;
  start_at: string;
  end_at: string;
  impact: "High" | "Medium" | "Low";
  reason: string;
}

interface TradePlanSymbol {
  symbol: string;
  allowed_direction: "buy" | "sell" | "both" | "none";
  strategy: "trend_follow" | "pullback" | "mean_revert" | "breakout" | "standby";
  session_windows: SessionWindow[];
  avoid_event_windows: EventWindow[];
  min_win_prob: number;
  max_cost_r: number;
  confidence: "high" | "medium" | "low";
  score: number;
  reason: string;
  setup_focus: string[];
}

interface DailyTradePlan {
  plan_version: string;
  plan_date: string;
  generated_at: string;
  expires_at: string;
  timeframe: string;
  risk_level: "low" | "medium" | "high";
  summary: string;
  market_themes: string[];
  symbols: TradePlanSymbol[];
  selection_meta: SelectionMeta;
  global_rules: {
    avoid_high_impact_minutes_before: number;
    avoid_high_impact_minutes_after: number;
    require_higher_timeframe_alignment: boolean;
    max_open_positions: number;
  };
}

interface SelectionMeta {
  requested_count: number;
  selected_count: number;
  eligible_count: number;
  backfilled_count: number;
  excluded_market_closed: string[];
  complete: boolean;
}

interface NewsHeadline {
  topic: string;
  title: string;
  source: string;
  published_at: string | null;
  url: string;
  summary?: string;
  resolved_url?: string;
}

interface MarketSnapshot {
  key: string;
  label: string;
  ticker: string;
  price: number | null;
  day_change_pct: number | null;
  week_change_pct: number | null;
  realized_vol_pct: number | null;
  direction: "up" | "down" | "flat";
}

interface PairMarketNote {
  symbol: string;
  bias: "supportive" | "neutral" | "cautious";
  notes: string[];
}

interface EconomicEvent {
  title: string;
  title_ja?: string;
  country: string;
  country_label_ja?: string;
  impact: "High" | "Medium" | "Low";
  date: string;
  actual?: string | null;
  forecast: string | null;
  previous: string | null;
  status: "upcoming" | "recent";
  affected_symbols: string[];
  expected_bias: "hawkish" | "dovish" | "neutral";
  reaction_bias?: "supports_usd" | "hurts_usd" | "supports_risk" | "hurts_risk" | "mixed";
  reaction_strength?: "small" | "medium" | "large";
  surprise_proxy?: "aligned" | "contrary" | "muted" | "unknown";
}

interface MarketContext {
  summary: string;
  risk_level: "low" | "medium" | "high";
  themes: string[];
  headlines: NewsHeadline[];
  snapshots: MarketSnapshot[];
  pair_notes: PairMarketNote[];
  economic_events: EconomicEvent[];
}

const TOPIC_KEYWORDS: Record<string, string[]> = {
  macro: ["federal reserve", "fed", "inflation", "cpi", "pce", "yield", "treasury", "dollar", "economy", "rates"],
  fx: ["forex", "eurusd", "usdjpy", "gbpusd", "yen", "euro", "pound", "dollar", "ecb", "boj", "boe", "fx"],
  metals: ["gold", "silver", "xau", "xag", "bullion", "precious metal", "metals"],
  crypto: ["bitcoin", "btc", "crypto", "cryptocurrency", "digital asset", "token"],
};

interface PairSelectionView {
  top_picks: PairRecommendation[];
  recommended_pairs: PairRecommendation[];
  neutral_pairs: PairRecommendation[];
  avoided_pairs: PairRecommendation[];
  ranked_pairs: Array<PairRecommendation & { category: "recommended" | "neutral" | "avoid" }>;
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Content-Type": "application/json",
  };
}

function missingSupabaseEnv(): string[] {
  const missing: string[] = [];
  if (!SUPABASE_URL) missing.push("SUPABASE_URL");
  if (!SUPABASE_SERVICE_ROLE_KEY) missing.push("SUPABASE_SERVICE_ROLE_KEY");
  return missing;
}

function ensureSupabaseForRequest(req: Request): { ok: true; keySource: KeySource } | { ok: false; missing: string[] } {
  if (!SUPABASE_URL) return { ok: false, missing: missingSupabaseEnv() };
  if (SUPABASE_SERVICE_ROLE_KEY) return { ok: true, keySource: "env" };

  const auth = req.headers.get("authorization") ?? "";
  const bearer = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  if (!bearer) return { ok: false, missing: missingSupabaseEnv() };

  SUPABASE_SERVICE_ROLE_KEY = bearer;
  supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  return { ok: true, keySource: "authorization" };
}

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

function round2(v: number | null): number | null {
  if (v === null || !Number.isFinite(v)) return null;
  return Math.round(v * 100) / 100;
}

function round3(v: number | null): number | null {
  if (v === null || !Number.isFinite(v)) return null;
  return Math.round(v * 1000) / 1000;
}

function round1(v: number | null): number | null {
  if (v === null || !Number.isFinite(v)) return null;
  return Math.round(v * 10) / 10;
}

function normalizeRequest(body: any) {
  const cadence = typeof body?.cadence === "string" && body.cadence.trim() ? body.cadence.trim() : "daily";
  const timeframe = typeof body?.timeframe === "string" && body.timeframe.trim() ? body.timeframe.trim() : DEFAULT_TIMEFRAME;
  const lookbackDays = clamp(Number(body?.lookback_days ?? DEFAULT_LOOKBACK_DAYS), 7, 90);
  const topN = clamp(Number(body?.top_n ?? DEFAULT_TOP_N), 1, 5);
  const universe = Array.isArray(body?.universe)
    ? body.universe
      .filter((x: unknown): x is string => typeof x === "string" && x.trim().length > 0)
      .map((x: string) => x.trim().toUpperCase())
    : DEFAULT_UNIVERSE;
  const triggeredBy = typeof body?.triggered_by === "string" && body.triggered_by.trim() ? body.triggered_by.trim() : "manual";

  return { cadence, timeframe, lookbackDays, topN, universe, triggeredBy };
}

function summarizeStatsForPrompt(stats: SymbolStats[]) {
  return stats.map((s) => ({
    symbol: s.symbol,
    real_trades: s.real_trades,
    real_win_rate: s.real_win_rate,
    real_total_profit_loss: s.real_total_profit_loss,
    avg_win_prob: s.avg_win_prob,
    recent_7d_trades: s.recent_7d_trades,
    recent_7d_win_rate: s.recent_7d_win_rate,
    recent_7d_profit_loss: s.recent_7d_profit_loss,
    ml_used_trades: s.ml_used_trades,
    market_trades: s.market_trades,
    market_win_rate: s.market_win_rate,
    pullback_trades: s.pullback_trades,
    pullback_win_rate: s.pullback_win_rate,
    virtual_trades: s.virtual_trades,
    virtual_raw_trades: s.virtual_raw_trades,
    virtual_episode_trades: s.virtual_episode_trades,
    virtual_win_rate: s.virtual_win_rate,
    virtual_win_rate_bayesian: s.virtual_win_rate_bayesian,
    real_win_rate_bayesian: s.real_win_rate_bayesian,
    market_fit_score: s.market_fit_score,
    market_regime: s.market_regime,
    market_eligible: s.market_eligible,
    score_components: s.score_components,
    compatibility_score: s.compatibility_score,
  }));
}

function scoreToConfidence(realTrades: number): "high" | "medium" | "low" {
  if (realTrades >= 12) return "high";
  if (realTrades >= 6) return "medium";
  return "low";
}

function noteForSymbol(marketContext: MarketContext | null, symbol: string): string | undefined {
  const note = marketContext?.pair_notes.find((x) => x.symbol === symbol);
  return note && note.notes.length > 0 ? note.notes.join(" / ") : undefined;
}

function pairRegimeLabel(snapshot: MarketSnapshot | undefined, symbol: string): "directional" | "noisy" | "mixed" {
  if (!snapshot) return "mixed";
  const absDay = Math.abs(snapshot.day_change_pct ?? 0);
  const vol = snapshot.realized_vol_pct ?? 0;
  if (vol >= volatilityThreshold(symbol) || absDay >= dayMoveThreshold(symbol)) return "noisy";
  if (absDay >= dayMoveThreshold(symbol) * 0.6 && vol <= volatilityThreshold(symbol) * 0.85) return "directional";
  return "mixed";
}

export function isMarketEligible(symbol: string, now = new Date()): boolean {
  if (symbol === "BTCUSD") return true;
  const day = now.getUTCDay();
  const hour = now.getUTCHours();
  // FX/metals are treated as closed from Friday 21:00 UTC until Sunday 21:00 UTC.
  if (day === 6) return false;
  if (day === 5 && hour >= 21) return false;
  if (day === 0 && hour < 21) return false;
  return true;
}

export function bayesianWinRate(wins: number, trades: number, priorRate: number, priorStrength: number): number {
  return (wins + priorRate * priorStrength) / (trades + priorStrength);
}

export function collapseShadowEpisodes(rows: TradeRow[]): TradeRow[] {
  const sorted = [...rows].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
  const episodes: TradeRow[] = [];
  let blockedUntil = Number.NEGATIVE_INFINITY;
  const episodeMs = SHADOW_EPISODE_MINUTES * 60 * 1000;

  for (const row of sorted) {
    const createdAt = Date.parse(row.created_at);
    if (!Number.isFinite(createdAt)) continue;
    if (createdAt < blockedUntil) continue;
    episodes.push(row);
    // The fixed horizon avoids source-time offsets from inflating one episode.
    blockedUntil = createdAt + episodeMs;
  }
  return episodes;
}

function marketFitForSymbol(
  symbol: string,
  marketContext: MarketContext | null,
  now: Date,
): { score: number; regime: SymbolStats["market_regime"]; eligible: boolean } {
  const eligible = isMarketEligible(symbol, now);
  const snapshot = marketContext?.snapshots.find((item) => item.key === symbol);
  if (!snapshot) return { score: eligible ? 48 : 0, regime: "unavailable", eligible };

  const regime = pairRegimeLabel(snapshot, symbol);
  const noteBias = marketContext?.pair_notes.find((item) => item.symbol === symbol)?.bias ?? "neutral";
  const directionStrength = Math.min(1, Math.abs(snapshot.day_change_pct ?? 0) / Math.max(dayMoveThreshold(symbol), 0.01));
  const weekConfirmation = Math.sign(snapshot.day_change_pct ?? 0) === Math.sign(snapshot.week_change_pct ?? 0) ? 1 : 0;
  const regimePoints = regime === "directional" ? 7 : regime === "noisy" ? -5 : 0;
  const biasPoints = noteBias === "supportive" ? 5 : noteBias === "cautious" ? -5 : 0;
  const trendPoints = directionStrength * 5 + weekConfirmation * 2;
  return {
    score: eligible ? clamp(50 + regimePoints + biasPoints + trendPoints, 30, 70) : 0,
    regime,
    eligible,
  };
}

function buildSystemFitNote(stats: SymbolStats, regime: "directional" | "noisy" | "mixed"): string | null {
  const marketWr = stats.market_win_rate;
  const pullbackWr = stats.pullback_win_rate;
  if (regime === "directional") {
    if (stats.market_trades >= 3 && marketWr !== null && marketWr >= 0.55) {
      return `過去実績では、この銘柄の順張り環境で市場成行エントリーが機能しやすい傾向です（market勝率 ${(marketWr * 100).toFixed(0)}%）`;
    }
    if (stats.market_trades >= 3 && marketWr !== null && marketWr <= 0.4) {
      return `過去実績では、この銘柄の順張り環境で市場成行エントリーは弱めです（market勝率 ${(marketWr * 100).toFixed(0)}%）`;
    }
  }
  if (regime === "noisy") {
    if (stats.pullback_trades >= 3 && pullbackWr !== null && pullbackWr >= 0.55) {
      return `過去実績では、この銘柄の荒れやすい押し目環境でも比較的耐えています（pullback勝率 ${(pullbackWr * 100).toFixed(0)}%）`;
    }
    if (stats.pullback_trades >= 3 && pullbackWr !== null && pullbackWr <= 0.4) {
      return `過去実績では、この銘柄の荒れやすい押し目環境は不利でした（pullback勝率 ${(pullbackWr * 100).toFixed(0)}%）`;
    }
  }
  return null;
}

function makeRecommendationFromStats(stats: SymbolStats, marketNote?: string): PairRecommendation {
  const realBayesian = stats.real_win_rate_bayesian ?? stats.real_win_rate ?? 0.45;
  const virtualBayesian = stats.virtual_win_rate_bayesian ?? stats.virtual_win_rate ?? 0.40;
  const virtualEpisodes = stats.virtual_episode_trades ?? stats.virtual_trades ?? 0;
  const marketFitScore = stats.market_fit_score ?? 50;
  const baseReason = `実取引 ${stats.real_trades}件（補正勝率 ${(realBayesian * 100).toFixed(1)}%）、仮想 ${virtualEpisodes}エピソード（補正勝率 ${(virtualBayesian * 100).toFixed(1)}%）、市場適合 ${marketFitScore.toFixed(1)}`;
  return {
    symbol: stats.symbol,
    score: Math.round(stats.compatibility_score),
    confidence: scoreToConfidence(stats.real_trades),
    reason: marketNote ? `${baseReason}; market=${marketNote}` : baseReason,
    caution: stats.real_trades < 5 ? "sample_small" : undefined,
  };
}

function utcTime(hour: number, minute = 0): string {
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function defaultSessionWindows(symbol: string, riskLevel: MarketContext["risk_level"] | undefined): SessionWindow[] {
  if (symbol === "BTCUSD") {
    return riskLevel === "high"
      ? [{ label: "NY risk window", start_utc: utcTime(13), end_utc: utcTime(21) }]
      : [{ label: "24h crypto", start_utc: utcTime(0), end_utc: utcTime(23, 59) }];
  }

  if (symbol === "XAUUSD" || symbol === "XAGUSD") {
    return [
      { label: "London metals", start_utc: utcTime(7), end_utc: utcTime(11) },
      { label: "NY metals", start_utc: utcTime(13), end_utc: utcTime(17) },
    ];
  }

  if (symbol.endsWith("JPY") || symbol.includes("JPY")) {
    return [
      { label: "Tokyo flow", start_utc: utcTime(0), end_utc: utcTime(5) },
      { label: "London/NY overlap", start_utc: utcTime(12), end_utc: utcTime(16) },
    ];
  }

  return [
    { label: "London", start_utc: utcTime(7), end_utc: utcTime(11) },
    { label: "NY overlap", start_utc: utcTime(12), end_utc: utcTime(16) },
  ];
}

function inferAllowedDirection(symbol: string, marketContext: MarketContext | null): TradePlanSymbol["allowed_direction"] {
  const snapshotByKey = new Map((marketContext?.snapshots ?? []).map((snapshot) => [snapshot.key, snapshot]));
  const dxy = snapshotByKey.get("DXY")?.day_change_pct ?? 0;
  const us10y = snapshotByKey.get("US10Y")?.day_change_pct ?? 0;
  const pairMove = snapshotByKey.get(symbol)?.day_change_pct ?? 0;

  if (["EURUSD", "GBPUSD", "AUDUSD", "NZDUSD", "XAUUSD", "XAGUSD", "BTCUSD"].includes(symbol)) {
    if (dxy >= 0.25 && pairMove <= 0.1) return "sell";
    if (dxy <= -0.25 && pairMove >= -0.1) return "buy";
  }
  if (["USDJPY", "USDCHF", "USDCAD"].includes(symbol)) {
    if (dxy >= 0.25 || us10y >= 0.4) return "buy";
    if (dxy <= -0.25) return "sell";
  }
  if (["EURJPY", "GBPJPY"].includes(symbol)) {
    if (us10y >= 0.4 && pairMove >= 0) return "buy";
    if ((marketContext?.risk_level ?? "low") === "high" && pairMove <= 0) return "sell";
  }

  return "both";
}

function inferStrategy(symbol: string, marketContext: MarketContext | null, stats?: SymbolStats): TradePlanSymbol["strategy"] {
  const snapshot = marketContext?.snapshots.find((item) => item.key === symbol);
  const regime = pairRegimeLabel(snapshot, symbol);
  if (regime === "directional") return "trend_follow";
  if (regime === "noisy") return stats && stats.pullback_win_rate !== null && stats.pullback_win_rate >= 0.5 ? "pullback" : "standby";
  if ((marketContext?.risk_level ?? "low") === "high") return "pullback";
  return "trend_follow";
}

function eventWindowsForSymbol(symbol: string, marketContext: MarketContext | null): EventWindow[] {
  const events = marketContext?.economic_events ?? [];
  const windows: EventWindow[] = [];
  for (const event of events) {
    if (event.impact !== "High") continue;
    if (!event.affected_symbols.includes(symbol)) continue;
    const eventTime = Date.parse(event.date);
    if (!Number.isFinite(eventTime)) continue;
    const beforeMs = 60 * 60 * 1000;
    const afterMs = 45 * 60 * 1000;
    const country = event.country_label_ja ?? countryLabelJa(event.country);
    const title = event.title_ja ?? localizedEconomicTitle(event.title);
    windows.push({
      label: `${country} ${title}`,
      start_at: new Date(eventTime - beforeMs).toISOString(),
      end_at: new Date(eventTime + afterMs).toISOString(),
      impact: event.impact,
      reason: `${event.status === "upcoming" ? "予定" : "直近"}の高重要イベント`,
    });
  }
  return windows.slice(0, 4);
}

function planGatesForSymbol(symbol: string, riskLevel: MarketContext["risk_level"] | undefined): { min_win_prob: number; max_cost_r: number } {
  const baseMin = riskLevel === "high" ? 0.52 : riskLevel === "medium" ? 0.50 : 0.48;
  const baseCost = 0.20;
  if (symbol === "BTCUSD") return { min_win_prob: baseMin + 0.01, max_cost_r: baseCost };
  if (symbol === "XAUUSD" || symbol === "XAGUSD") return { min_win_prob: baseMin + 0.02, max_cost_r: 0.18 };
  return { min_win_prob: baseMin, max_cost_r: baseCost };
}

function setupFocusForSymbol(strategy: TradePlanSymbol["strategy"], allowedDirection: TradePlanSymbol["allowed_direction"]): string[] {
  const focus = [
    "M15 signal quality",
    "H1 trend confirmation",
    "spread cost below gate",
  ];
  if (strategy === "trend_follow") focus.push("H4/D1 direction not opposing");
  if (strategy === "pullback") focus.push("entry after shallow retrace");
  if (strategy === "mean_revert") focus.push("RSI extreme plus rejection candle");
  if (allowedDirection !== "both") focus.push(`${allowedDirection.toUpperCase()} only`);
  return focus.slice(0, 5);
}

function makePlanSymbol(
  rec: PairRecommendation,
  stats: SymbolStats | undefined,
  marketContext: MarketContext | null,
): TradePlanSymbol {
  const allowedDirection = rec.allowed_direction ?? inferAllowedDirection(rec.symbol, marketContext);
  const strategy = rec.strategy ?? inferStrategy(rec.symbol, marketContext, stats);
  const gates = planGatesForSymbol(rec.symbol, marketContext?.risk_level);
  return {
    symbol: rec.symbol,
    allowed_direction: allowedDirection,
    strategy,
    session_windows: rec.session_windows?.length ? rec.session_windows : defaultSessionWindows(rec.symbol, marketContext?.risk_level),
    avoid_event_windows: rec.avoid_event_windows?.length ? rec.avoid_event_windows : eventWindowsForSymbol(rec.symbol, marketContext),
    min_win_prob: typeof rec.min_win_prob === "number" ? clamp(rec.min_win_prob, 0.45, 0.65) : gates.min_win_prob,
    max_cost_r: typeof rec.max_cost_r === "number"
      ? Math.min(clamp(rec.max_cost_r, 0.05, 0.20), gates.max_cost_r)
      : gates.max_cost_r,
    confidence: rec.confidence ?? scoreToConfidence(stats?.real_trades ?? 0),
    score: Number.isFinite(rec.score) ? Math.round(rec.score) : Math.round(stats?.compatibility_score ?? 50),
    reason: rec.reason || (stats ? makeRecommendationFromStats(stats, noteForSymbol(marketContext, rec.symbol)).reason : "AI selected"),
    setup_focus: setupFocusForSymbol(strategy, allowedDirection),
  };
}

function attachPlanToRecommendations(recs: PairRecommendation[], plan: DailyTradePlan | undefined): PairRecommendation[] {
  if (!plan) return recs;
  const bySymbol = new Map(plan.symbols.map((item) => [item.symbol, item]));
  return recs.map((rec) => {
    const item = bySymbol.get(rec.symbol);
    if (!item) return rec;
    return {
      ...rec,
      allowed_direction: item.allowed_direction,
      strategy: item.strategy,
      session_windows: item.session_windows,
      avoid_event_windows: item.avoid_event_windows,
      min_win_prob: item.min_win_prob,
      max_cost_r: item.max_cost_r,
      plan_note: item.setup_focus.join(" / "),
    };
  });
}

function defaultSelectionMeta(selectedCount: number): SelectionMeta {
  return {
    requested_count: selectedCount,
    selected_count: selectedCount,
    eligible_count: selectedCount,
    backfilled_count: 0,
    excluded_market_closed: [],
    complete: true,
  };
}

function buildFallbackTradePlan(
  selected: PairRecommendation[],
  stats: SymbolStats[],
  timeframe: string,
  marketContext: MarketContext | null,
  summary: string,
  selectionMeta = defaultSelectionMeta(selected.length),
): DailyTradePlan {
  const now = new Date();
  const statsBySymbol = new Map(stats.map((item) => [item.symbol, item]));
  const symbols = selected.slice(0, Math.max(1, selected.length)).map((rec) =>
    makePlanSymbol(rec, statsBySymbol.get(rec.symbol), marketContext)
  );

  return {
    plan_version: "daily-plan-v1",
    plan_date: now.toISOString().slice(0, 10),
    generated_at: now.toISOString(),
    expires_at: new Date(now.getTime() + 30 * 60 * 60 * 1000).toISOString(),
    timeframe,
    risk_level: marketContext?.risk_level ?? "medium",
    summary: summary || marketContext?.summary || "現在の市場環境とシステム実績から作成した日次トレード計画です。",
    market_themes: (marketContext?.themes ?? []).slice(0, 5),
    symbols,
    selection_meta: selectionMeta,
    global_rules: {
      avoid_high_impact_minutes_before: 60,
      avoid_high_impact_minutes_after: 45,
      require_higher_timeframe_alignment: true,
      max_open_positions: 1,
    },
  };
}

function normalizeTradePlan(
  value: unknown,
  selected: PairRecommendation[],
  stats: SymbolStats[],
  timeframe: string,
  marketContext: MarketContext | null,
  summary: string,
  selectionMeta = defaultSelectionMeta(selected.length),
): DailyTradePlan {
  const fallback = buildFallbackTradePlan(selected, stats, timeframe, marketContext, summary, selectionMeta);
  if (!value || typeof value !== "object" || Array.isArray(value)) return fallback;
  const raw = value as any;
  const symbolsRaw = Array.isArray(raw.symbols) ? raw.symbols : [];
  const statsBySymbol = new Map(stats.map((item) => [item.symbol, item]));
  const validSelected = new Set(selected.map((rec) => rec.symbol));
  const aiSymbols: TradePlanSymbol[] = symbolsRaw
    .filter((item: any) => typeof item?.symbol === "string" && validSelected.has(item.symbol))
    .map((item: any) => makePlanSymbol(item as PairRecommendation, statsBySymbol.get(item.symbol), marketContext));
  const aiBySymbol = new Map<string, TradePlanSymbol>(aiSymbols.map((item) => [item.symbol, item]));
  const symbols = selected.map((rec) =>
    aiBySymbol.get(rec.symbol) ?? makePlanSymbol(rec, statsBySymbol.get(rec.symbol), marketContext)
  );

  return {
    ...fallback,
    summary: typeof raw.summary === "string" && raw.summary.trim() ? raw.summary.trim() : fallback.summary,
    market_themes: Array.isArray(raw.market_themes) ? raw.market_themes.filter((x: unknown) => typeof x === "string").slice(0, 5) : fallback.market_themes,
    risk_level: raw.risk_level === "low" || raw.risk_level === "medium" || raw.risk_level === "high" ? raw.risk_level : fallback.risk_level,
    symbols: symbols.length > 0 ? symbols : fallback.symbols,
    selection_meta: selectionMeta,
    global_rules: {
      ...fallback.global_rules,
      ...(raw.global_rules && typeof raw.global_rules === "object" ? raw.global_rules : {}),
    },
  };
}

function shortenDigestReason(reason: string | undefined, maxLength = 48): string | null {
  if (!reason) return null;
  const normalized = reason.replace(/\s+/g, " ").trim();
  if (!normalized) return null;
  return normalized.length <= maxLength
    ? normalized
    : `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
}

function buildReportDigest(
  summary: string,
  selectionView: PairSelectionView,
  liveContext: MarketContext | null,
): {
  digest_text: string;
  digest_lines: string[];
  digest: {
    risk_label: string;
    top_pick_symbol: string;
    market_themes: string[];
    avoided_symbols: string[];
    top_pick_reason: string | null;
    avoided_reason: string | null;
  };
} {
  const topPickRec = selectionView.top_picks[0] ?? selectionView.recommended_pairs[0];
  const topPick = topPickRec?.symbol ?? "なし";
  const avoided = selectionView.avoided_pairs.slice(0, 2).map((pair) => pair.symbol);
  const firstAvoided = selectionView.avoided_pairs[0];
  const themes = (liveContext?.themes ?? []).slice(0, 2);
  const risk = liveContext?.risk_level === "high"
    ? "リスク高"
    : liveContext?.risk_level === "medium"
    ? "リスク中"
    : "リスク低";

  const line1 = `AI推奨ペア ${topPick} / ${risk}`;
  const line2 = themes.length > 0 ? `市場テーマ: ${themes.join(" / ")}` : `市場テーマ: ${summary || "情報なし"}`;
  const line3 = avoided.length > 0 ? `回避候補: ${avoided.join(", ")}` : "回避候補: 特になし";
  const line4 = topPickRec
    ? `推奨理由: ${shortenDigestReason(topPickRec.reason) ?? "情報なし"}`
    : null;
  const line5 = firstAvoided
    ? `回避理由: ${firstAvoided.symbol} ${shortenDigestReason(firstAvoided.reason, 40) ?? "情報なし"}`
    : null;
  const digestLines = [line1, line2, line3, line4, line5].filter((line): line is string => Boolean(line));
  return {
    digest_text: digestLines.join("\n"),
    digest_lines: digestLines,
    digest: {
      risk_label: risk,
      top_pick_symbol: topPick,
      market_themes: themes,
      avoided_symbols: avoided,
      top_pick_reason: topPickRec ? (shortenDigestReason(topPickRec.reason, 72) ?? null) : null,
      avoided_reason: firstAvoided ? `${firstAvoided.symbol} ${shortenDigestReason(firstAvoided.reason, 64) ?? ""}`.trim() : null,
    },
  };
}

function buildSelectionView(
  stats: SymbolStats[],
  aiSelection: AiSelectionResult,
  topN: number,
  marketContext: MarketContext | null,
): PairSelectionView {
  const sortedStats = [...stats].sort((a, b) => b.compatibility_score - a.compatibility_score);
  const bySymbol = new Map<string, PairRecommendation>();

  for (const stat of sortedStats) {
    bySymbol.set(stat.symbol, makeRecommendationFromStats(stat, noteForSymbol(marketContext, stat.symbol)));
  }

  for (const rec of aiSelection.selected_pairs) {
    const fallback = bySymbol.get(rec.symbol);
    bySymbol.set(rec.symbol, {
      symbol: rec.symbol,
      score: Number.isFinite(rec.score) ? rec.score : (fallback?.score ?? 50),
      confidence: rec.confidence ?? fallback?.confidence ?? "low",
      reason: rec.reason || fallback?.reason || "selected by AI",
      caution: rec.caution ?? fallback?.caution,
    });
  }

  for (const rec of aiSelection.avoided_pairs) {
    const fallback = bySymbol.get(rec.symbol);
    bySymbol.set(rec.symbol, {
      symbol: rec.symbol,
      score: Number.isFinite(rec.score) ? rec.score : (fallback?.score ?? 50),
      confidence: rec.confidence ?? fallback?.confidence ?? "low",
      reason: rec.reason || fallback?.reason || "avoided by AI",
      caution: rec.caution ?? fallback?.caution,
    });
  }

  const aiSelectedSymbols = new Set(aiSelection.selected_pairs.map((x) => x.symbol));
  const aiAvoidedSymbols = new Set(aiSelection.avoided_pairs.map((x) => x.symbol));

  const ranked_pairs = sortedStats.map((stat) => {
    const rec = bySymbol.get(stat.symbol) ?? makeRecommendationFromStats(stat);
    let category: "recommended" | "neutral" | "avoid";
    if (aiSelectedSymbols.has(stat.symbol)) {
      category = "recommended";
    } else if (stat.market_eligible === false || aiAvoidedSymbols.has(stat.symbol) || stat.compatibility_score < 45) {
      category = "avoid";
    } else {
      category = "neutral";
    }
    return { ...rec, category };
  });

  const recommended_pairs = ranked_pairs
    .filter((x) => x.category === "recommended")
    .map(({ category: _category, ...rest }) => rest);
  const neutral_pairs = ranked_pairs
    .filter((x) => x.category === "neutral")
    .map(({ category: _category, ...rest }) => rest);
  const avoided_pairs = ranked_pairs
    .filter((x) => x.category === "avoid")
    .sort((a, b) => a.score - b.score)
    .map(({ category: _category, ...rest }) => rest);
  const top_picks = recommended_pairs.slice(0, topN);

  return {
    top_picks,
    recommended_pairs,
    neutral_pairs,
    avoided_pairs,
    ranked_pairs,
  };
}

function fallbackSelection(stats: SymbolStats[], topN: number, timeframe: string, marketContext: MarketContext | null): AiSelectionResult {
  const sorted = [...stats]
    .filter((s) => s.market_eligible)
    .sort((a, b) => b.compatibility_score - a.compatibility_score);
  const selected_pairs = sorted
    .filter((s) => s.compatibility_score >= 55)
    .map((s) => makeRecommendationFromStats(s, noteForSymbol(marketContext, s.symbol)));
  const avoided_pairs = [...sorted]
    .filter((s) => s.compatibility_score < 45)
    .sort((a, b) => a.compatibility_score - b.compatibility_score)
    .map((s) => makeRecommendationFromStats(s, noteForSymbol(marketContext, s.symbol)));

  if (selected_pairs.length === 0 && sorted.length > 0) {
    selected_pairs.push(...sorted.slice(0, topN).map((s) => makeRecommendationFromStats(s, noteForSymbol(marketContext, s.symbol))));
  }

  const summary = marketContext?.summary || "現在の市場反応と直近実績を併用した簡易選定です。";
  const trade_plan = buildFallbackTradePlan(selected_pairs.slice(0, topN), stats, timeframe, marketContext, summary);

  return {
    summary,
    selected_pairs: attachPlanToRecommendations(selected_pairs, trade_plan),
    avoided_pairs,
    trade_plan,
  };
}

function appendCaution(current: string | undefined, caution: string): string {
  if (!current) return caution;
  const cautions = new Set(current.split(",").map((item) => item.trim()).filter(Boolean));
  cautions.add(caution);
  return [...cautions].join(",");
}

export function finalizeSelection(
  aiSelection: AiSelectionResult,
  stats: SymbolStats[],
  topN: number,
  marketContext: MarketContext | null,
): { selected: PairRecommendation[]; avoided: PairRecommendation[]; meta: SelectionMeta } {
  const statsBySymbol = new Map(stats.map((item) => [item.symbol, item]));
  const marketClosed = stats.filter((item) => !item.market_eligible).map((item) => item.symbol);
  const eligible = stats
    .filter((item) => item.market_eligible && item.compatibility_score >= MIN_BACKFILL_SCORE)
    .sort((a, b) => b.compatibility_score - a.compatibility_score);
  const avoidedSymbols = new Set(aiSelection.avoided_pairs.map((item) => item.symbol));
  const selected: PairRecommendation[] = [];
  const selectedSymbols = new Set<string>();

  for (const rec of aiSelection.selected_pairs) {
    const stat = statsBySymbol.get(rec.symbol);
    if (!stat?.market_eligible || avoidedSymbols.has(rec.symbol) || selectedSymbols.has(rec.symbol)) continue;
    selected.push({
      ...makeRecommendationFromStats(stat, noteForSymbol(marketContext, stat.symbol)),
      ...rec,
      symbol: stat.symbol,
    });
    selectedSymbols.add(stat.symbol);
    if (selected.length >= topN) break;
  }

  const aiSelectedCount = selected.length;
  for (const stat of eligible) {
    if (selected.length >= topN) break;
    if (selectedSymbols.has(stat.symbol) || avoidedSymbols.has(stat.symbol)) continue;
    const recommendation = makeRecommendationFromStats(stat, noteForSymbol(marketContext, stat.symbol));
    selected.push({
      ...recommendation,
      reason: `全銘柄市場スキャンから補充: ${recommendation.reason}`,
      caution: appendCaution(recommendation.caution, "market_backfill"),
    });
    selectedSymbols.add(stat.symbol);
  }

  const avoided = [...aiSelection.avoided_pairs];
  const avoidedSeen = new Set(avoided.map((item) => item.symbol));
  for (const symbol of marketClosed) {
    if (avoidedSeen.has(symbol)) continue;
    const stat = statsBySymbol.get(symbol);
    if (!stat) continue;
    avoided.push({
      ...makeRecommendationFromStats(stat, noteForSymbol(marketContext, symbol)),
      score: 0,
      reason: "対象市場が休場時間のため本日の候補から除外",
      caution: appendCaution(undefined, "market_closed"),
    });
  }

  return {
    selected,
    avoided,
    meta: {
      requested_count: topN,
      selected_count: selected.length,
      eligible_count: eligible.length,
      backfilled_count: Math.max(0, selected.length - aiSelectedCount),
      excluded_market_closed: marketClosed,
      complete: selected.length >= topN,
    },
  };
}

function decodeXmlEntities(input: string): string {
  return input
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&#x27;", "'")
    .replaceAll("&#39;", "'");
}

function extractXmlTag(block: string, tag: string): string | null {
  const match = block.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match ? decodeXmlEntities(match[1].trim()) : null;
}

function stripHtml(input: string): string {
  return decodeXmlEntities(input)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function shortenText(input: string, maxLen = 220): string {
  const trimmed = input.replace(/\s+/g, " ").trim();
  if (trimmed.length <= maxLen) return trimmed;
  return `${trimmed.slice(0, maxLen - 1).trimEnd()}…`;
}

function extractMetaContent(html: string, key: string): string | null {
  const patterns = [
    new RegExp(`<meta[^>]+property=["']${key}["'][^>]+content=["']([^"']+)["'][^>]*>`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${key}["'][^>]*>`, "i"),
    new RegExp(`<meta[^>]+name=["']${key}["'][^>]+content=["']([^"']+)["'][^>]*>`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+name=["']${key}["'][^>]*>`, "i"),
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) return stripHtml(match[1]);
  }
  return null;
}

function isRelevantHeadline(topic: string, title: string): boolean {
  const normalized = title.toLowerCase();
  const keywords = TOPIC_KEYWORDS[topic] ?? [];
  if (keywords.length === 0) return true;
  const matched = keywords.some((keyword) => normalized.includes(keyword));
  if (!matched) return false;
  if (topic === "metals" && /silver lake|silverado|golden state|gold coast/i.test(title)) return false;
  return true;
}

function extractParagraphSummary(html: string): string | null {
  const paragraphs = [...html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)]
    .map((match) => stripHtml(match[1]))
    .filter((text) => text.length >= 70 && text.length <= 420)
    .filter((text) => !/cookie|subscribe|advertis|sign up|newsletter/i.test(text));
  return paragraphs.length > 0 ? shortenText(paragraphs[0], 220) : null;
}

async function enrichHeadline(headline: NewsHeadline): Promise<NewsHeadline> {
  try {
    const response = await fetch(headline.url, {
      headers: { "User-Agent": "ai-trader-supabase/1.0" },
      redirect: "follow",
    });
    if (!response.ok) return headline;
    const finalUrl = response.url || headline.url;
    const html = await response.text();
    const metaDescription = extractMetaContent(html, "og:description")
      ?? extractMetaContent(html, "description")
      ?? extractParagraphSummary(html);
    return {
      ...headline,
      resolved_url: finalUrl,
      summary: metaDescription ? shortenText(metaDescription, 220) : undefined,
    };
  } catch (_error) {
    return headline;
  }
}

function affectedSymbolsForCountry(country: string): string[] {
  switch (country) {
    case "USD":
      return ["EURUSD", "GBPUSD", "USDJPY", "USDCHF", "AUDUSD", "NZDUSD", "USDCAD", "XAUUSD", "XAGUSD", "BTCUSD"];
    case "EUR":
      return ["EURUSD", "EURJPY"];
    case "GBP":
      return ["GBPUSD", "GBPJPY"];
    case "JPY":
      return ["USDJPY", "EURJPY", "GBPJPY"];
    case "CHF":
      return ["USDCHF"];
    case "CAD":
      return ["USDCAD"];
    case "AUD":
      return ["AUDUSD"];
    case "NZD":
      return ["NZDUSD"];
    case "XAU":
      return ["XAUUSD"];
    case "XAG":
      return ["XAGUSD"];
    default:
      return [];
  }
}

function titleAffectedSymbols(title: string): string[] {
  const t = title.toLowerCase();
  const set = new Set<string>();
  if (t.includes("gold") || t.includes("xau")) set.add("XAUUSD");
  if (t.includes("silver") || t.includes("xag")) set.add("XAGUSD");
  if (t.includes("bitcoin") || t.includes("btc") || t.includes("crypto")) set.add("BTCUSD");
  return [...set];
}

function parsePercentLike(value: string | null): number | null {
  if (!value) return null;
  const cleaned = value.replaceAll(",", "").trim();
  const match = cleaned.match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeEconomicCountry(value: string): string {
  const normalized = value.trim().toUpperCase();
  if (["US", "USA", "USD"].includes(normalized)) return "USD";
  if (["EU", "EMU", "EUR"].includes(normalized)) return "EUR";
  if (["UK", "GB", "GBP"].includes(normalized)) return "GBP";
  if (["JP", "JPY"].includes(normalized)) return "JPY";
  if (["CA", "CAD"].includes(normalized)) return "CAD";
  if (["CH", "CHF"].includes(normalized)) return "CHF";
  if (["AU", "AUD"].includes(normalized)) return "AUD";
  if (["NZ", "NZD"].includes(normalized)) return "NZD";
  return normalized;
}

function normalizeEconomicImpact(value: string): EconomicEvent["impact"] {
  const normalized = value.trim().toLowerCase();
  if (normalized === "high") return "High";
  if (normalized === "medium" || normalized === "moderate") return "Medium";
  return "Low";
}

function economicEventKey(event: Pick<EconomicEvent, "country" | "title" | "date">): string {
  return `${event.country}|${event.title.toLowerCase()}|${new Date(event.date).toISOString()}`;
}

function expectedBiasForEvent(country: string, title: string, forecast: string | null, previous: string | null): "hawkish" | "dovish" | "neutral" {
  const t = title.toLowerCase();
  const f = parsePercentLike(forecast);
  const p = parsePercentLike(previous);
  if (f === null || p === null) {
    if (t.includes("speaks") || t.includes("speech") || t.includes("summary") || t.includes("minutes")) return "neutral";
    return "neutral";
  }

  const risingIsHawkish = t.includes("cpi") || t.includes("inflation") || t.includes("pce") || t.includes("price index") || t.includes("wage") || t.includes("employment") || t.includes("payroll") || t.includes("pmi") || t.includes("confidence") || t.includes("sales") || t.includes("gdp");
  const fallingIsHawkish = t.includes("unemployment") || t.includes("claims");

  if (risingIsHawkish) {
    if (f > p) return "hawkish";
    if (f < p) return "dovish";
  }
  if (fallingIsHawkish) {
    if (f < p) return "hawkish";
    if (f > p) return "dovish";
  }
  return "neutral";
}

function actualBiasForEvent(title: string, actual: string | null, forecast: string | null): "hawkish" | "dovish" | "neutral" | null {
  const a = parsePercentLike(actual);
  const f = parsePercentLike(forecast);
  if (a === null || f === null) return null;
  const t = title.toLowerCase();
  const diff = a - f;
  if (Math.abs(diff) < 0.05) return "neutral";

  const risingIsHawkish = t.includes("cpi") || t.includes("inflation") || t.includes("pce") || t.includes("price index") || t.includes("wage") || t.includes("employment") || t.includes("payroll") || t.includes("pmi") || t.includes("confidence") || t.includes("sales") || t.includes("gdp");
  const fallingIsHawkish = t.includes("unemployment") || t.includes("claims");

  if (risingIsHawkish) return diff > 0 ? "hawkish" : "dovish";
  if (fallingIsHawkish) return diff < 0 ? "hawkish" : "dovish";
  return null;
}

function reactionBiasMatchesEvent(country: string, reactionBias: EconomicEvent["reaction_bias"], eventBias: "hawkish" | "dovish" | "neutral" | null): boolean | null {
  if (!reactionBias || reactionBias === "mixed" || !eventBias || eventBias === "neutral") return null;
  if (country === "USD") {
    return eventBias === "hawkish"
      ? reactionBias === "supports_usd"
      : reactionBias === "hurts_usd";
  }
  if (["EUR", "GBP", "AUD", "NZD", "JPY", "CAD", "CHF"].includes(country)) {
    return eventBias === "hawkish"
      ? reactionBias === "hurts_usd"
      : reactionBias === "supports_usd";
  }
  return null;
}

function summarizeReactionBias(event: Pick<EconomicEvent, "country" | "title" | "actual" | "forecast">, snapshotsByKey: Map<string, MarketSnapshot>, affectedSymbols: string[]): { reaction_bias: EconomicEvent["reaction_bias"]; reaction_strength: EconomicEvent["reaction_strength"]; surprise_proxy: EconomicEvent["surprise_proxy"] } {
  const country = event.country;
  const dxyMove = snapshotsByKey.get("DXY")?.day_change_pct ?? 0;
  const vixMove = snapshotsByKey.get("VIX")?.day_change_pct ?? 0;
  const firstAffected = affectedSymbols[0];
  const symbolMove = firstAffected ? Math.abs(snapshotsByKey.get(firstAffected)?.day_change_pct ?? 0) : 0;
  const composite = Math.max(Math.abs(dxyMove), Math.abs(vixMove) / 4, symbolMove);
  const reaction_strength: EconomicEvent["reaction_strength"] = composite >= 0.8 ? "large" : composite >= 0.3 ? "medium" : "small";

  let reaction_bias: EconomicEvent["reaction_bias"] = "mixed";
  if (country === "USD") {
    if (dxyMove >= 0.2) reaction_bias = "supports_usd";
    else if (dxyMove <= -0.2) reaction_bias = "hurts_usd";
  } else if (["EUR", "GBP", "AUD", "NZD"].includes(country)) {
    const first = affectedSymbols.find((symbol) => ["EURUSD", "GBPUSD", "AUDUSD", "NZDUSD"].includes(symbol));
    const move = first ? (snapshotsByKey.get(first)?.day_change_pct ?? 0) : 0;
    if (move >= 0.2) reaction_bias = "hurts_usd";
    else if (move <= -0.2) reaction_bias = "supports_usd";
  } else if (country === "JPY") {
    const move = snapshotsByKey.get("USDJPY")?.day_change_pct ?? 0;
    if (move <= -0.2) reaction_bias = "hurts_usd";
    else if (move >= 0.2) reaction_bias = "supports_usd";
  } else if (country === "CAD") {
    const move = snapshotsByKey.get("USDCAD")?.day_change_pct ?? 0;
    if (move <= -0.2) reaction_bias = "hurts_usd";
    else if (move >= 0.2) reaction_bias = "supports_usd";
  }

  const actualBias = actualBiasForEvent(event.title, event.actual ?? null, event.forecast ?? null);
  const reactionMatch = reactionBiasMatchesEvent(country, reaction_bias, actualBias);
  const surprise_proxy: EconomicEvent["surprise_proxy"] = reaction_strength === "small"
    ? "muted"
    : reactionMatch === true
    ? "aligned"
    : reactionMatch === false
    ? "contrary"
    : reaction_bias === "mixed"
    ? "unknown"
    : actualBias && actualBias !== "neutral"
    ? "aligned"
    : "unknown";

  return { reaction_bias, reaction_strength, surprise_proxy };
}

async function fetchFinnhubEconomicEvents(universe: string[]): Promise<EconomicEvent[]> {
  if (!FINNHUB_API_KEY) return [];
  try {
    const now = new Date();
    const from = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const to = new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const url = `${FINNHUB_CALENDAR_URL}?from=${from}&to=${to}&token=${encodeURIComponent(FINNHUB_API_KEY)}`;
    const response = await fetch(url, { headers: { "User-Agent": "ai-trader-supabase/1.0" } });
    if (!response.ok) return [];
    const payload = await response.json();
    const rows = Array.isArray(payload?.economicCalendar)
      ? payload.economicCalendar
      : Array.isArray(payload?.events)
      ? payload.events
      : [];
    const nowMs = Date.now();
    const lookbackMs = 24 * 60 * 60 * 1000;
    const lookaheadMs = 48 * 60 * 60 * 1000;

    return rows
      .map((item: any) => {
        const date = typeof item?.date === "string" ? item.date : "";
        const eventTime = Date.parse(date);
        if (!Number.isFinite(eventTime)) return null;
        if (eventTime < nowMs - lookbackMs || eventTime > nowMs + lookaheadMs) return null;
        const country = normalizeEconomicCountry(typeof item?.country === "string" ? item.country : "");
        const title = typeof item?.event === "string"
          ? item.event.trim()
          : typeof item?.title === "string"
          ? item.title.trim()
          : "";
        if (!country || !title) return null;
        const impacted = new Set<string>([
          ...affectedSymbolsForCountry(country),
          ...titleAffectedSymbols(title),
        ]);
        const affected = [...impacted].filter((symbol) => universe.includes(symbol));
        if (affected.length === 0) return null;
        const forecast = typeof item?.forecast === "string" && item.forecast.trim() ? item.forecast.trim() : null;
        const previous = typeof item?.previous === "string" && item.previous.trim() ? item.previous.trim() : null;
        const actual = typeof item?.actual === "string" && item.actual.trim() ? item.actual.trim() : null;
        return withEconomicEventLabels({
          title,
          country,
          impact: normalizeEconomicImpact(typeof item?.impact === "string" ? item.impact : ""),
          date,
          actual,
          forecast,
          previous,
          status: eventTime >= nowMs ? "upcoming" : "recent",
          affected_symbols: affected,
          expected_bias: expectedBiasForEvent(country, title, forecast, previous),
        } as EconomicEvent);
      })
      .filter((event: EconomicEvent | null): event is EconomicEvent => Boolean(event));
  } catch (_error) {
    return [];
  }
}

async function fetchEconomicEvents(universe: string[]): Promise<EconomicEvent[]> {
  try {
    const [fallbackResponse, finnhubEvents] = await Promise.all([
      fetch(FOREX_FACTORY_CALENDAR_URL, { headers: { "User-Agent": "ai-trader-supabase/1.0" } }),
      fetchFinnhubEconomicEvents(universe),
    ]);
    if (!fallbackResponse.ok && finnhubEvents.length === 0) return [];
    const payload = fallbackResponse.ok ? await fallbackResponse.json() : [];
    const fallbackEvents = Array.isArray(payload) ? payload : [];
    const now = Date.now();
    const lookbackMs = 8 * 60 * 60 * 1000;
    const lookaheadMs = 48 * 60 * 60 * 1000;

    const baseEvents = fallbackEvents
      .map((item: any) => {
        const date = typeof item?.date === "string" ? item.date : "";
        const eventTime = Date.parse(date);
        if (!Number.isFinite(eventTime)) return null;
        if (eventTime < now - lookbackMs || eventTime > now + lookaheadMs) return null;
        const country = normalizeEconomicCountry(typeof item?.country === "string" ? item.country : "");
        const title = typeof item?.title === "string" ? item.title.trim() : "";
        const impacted = new Set<string>([
          ...affectedSymbolsForCountry(country),
          ...titleAffectedSymbols(title),
        ]);
        const affected = [...impacted].filter((symbol) => universe.includes(symbol));
        if (affected.length === 0) return null;
        const forecast = typeof item?.forecast === "string" && item.forecast.trim() ? item.forecast.trim() : null;
        const previous = typeof item?.previous === "string" && item.previous.trim() ? item.previous.trim() : null;
        return withEconomicEventLabels({
          title,
          country,
          impact: normalizeEconomicImpact(typeof item?.impact === "string" ? item.impact : ""),
          date,
          actual: null,
          forecast,
          previous,
          status: eventTime >= now ? "upcoming" : "recent",
          affected_symbols: affected,
          expected_bias: expectedBiasForEvent(country, title, forecast, previous),
        } as EconomicEvent);
      })
      .filter((event: EconomicEvent | null): event is EconomicEvent => Boolean(event));

    const deduped = new Map<string, EconomicEvent>();
    for (const event of [...baseEvents, ...finnhubEvents]) {
      const key = economicEventKey(event);
      const existing = deduped.get(key);
      if (!existing || (!existing.actual && event.actual) || (existing.impact !== "High" && event.impact === "High")) {
        deduped.set(key, existing ? { ...existing, ...event } : event);
      }
    }

    return [...deduped.values()]
      .sort((a, b) => Date.parse(a.date) - Date.parse(b.date))
      .slice(0, 18);
  } catch (_error) {
    return [];
  }
}

async function fetchNewsHeadlines(): Promise<NewsHeadline[]> {
  const collected: NewsHeadline[] = [];

  await Promise.all(NEWS_QUERIES.map(async ({ topic, query }) => {
    try {
      const url = `${GOOGLE_NEWS_RSS}?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`;
      const response = await fetch(url, { headers: { "User-Agent": "ai-trader-supabase/1.0" } });
      if (!response.ok) return;
      const xml = await response.text();
      const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, 3);
      for (const item of items) {
        const block = item[1];
        const titleRaw = extractXmlTag(block, "title") ?? "";
        const link = extractXmlTag(block, "link") ?? "";
        const pubDate = extractXmlTag(block, "pubDate");
        const source = extractXmlTag(block, "source") ?? (titleRaw.includes(" - ") ? titleRaw.split(" - ").slice(-1)[0] : "Google News");
        const title = titleRaw.replace(/\s+-\s+[^-]+$/, "").trim();
        if (!title || !link) continue;
        if (!isRelevantHeadline(topic, title)) continue;
        collected.push({
          topic,
          title,
          source,
          published_at: pubDate,
          url: link,
        });
      }
    } catch (_error) {
      // Ignore transient headline fetch failures.
    }
  }));

  const seen = new Set<string>();
  const unique = collected.filter((headline) => {
    const key = `${headline.topic}:${headline.title}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 8);

  const enriched = await Promise.all(unique.map((headline, index) => index < 4 ? enrichHeadline(headline) : Promise.resolve(headline)));
  return enriched;
}

function calcStdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((sum, x) => sum + x, 0) / values.length;
  const variance = values.reduce((sum, x) => sum + (x - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(Math.max(variance, 0));
}

async function fetchMarketSnapshot(key: string, label: string, ticker: string): Promise<MarketSnapshot | null> {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=5d&interval=1h&includePrePost=false`;
    const response = await fetch(url, { headers: { "User-Agent": "ai-trader-supabase/1.0" } });
    if (!response.ok) return null;
    const payload = await response.json();
    const result = payload?.chart?.result?.[0];
    const closes = Array.isArray(result?.indicators?.quote?.[0]?.close)
      ? result.indicators.quote[0].close.filter((x: unknown): x is number => typeof x === "number" && Number.isFinite(x))
      : [];
    if (closes.length < 3) return null;
    const last = closes[closes.length - 1];
    const dayBase = closes[Math.max(0, closes.length - Math.min(24, closes.length - 1) - 1)] ?? closes[closes.length - 2];
    const weekBase = closes[0];
    const returns = closes.slice(1).map((x: number, idx: number) => ((x / closes[idx]) - 1) * 100).filter((x: number) => Number.isFinite(x));
    const dayChangePct = dayBase ? ((last / dayBase) - 1) * 100 : 0;
    const weekChangePct = weekBase ? ((last / weekBase) - 1) * 100 : 0;
    const realizedVolPct = calcStdDev(returns);
    let direction: "up" | "down" | "flat" = "flat";
    if (dayChangePct >= 0.15) direction = "up";
    if (dayChangePct <= -0.15) direction = "down";

    return {
      key,
      label,
      ticker,
      price: round2(last),
      day_change_pct: round2(dayChangePct),
      week_change_pct: round2(weekChangePct),
      realized_vol_pct: round2(realizedVolPct),
      direction,
    };
  } catch (_error) {
    return null;
  }
}

function volatilityThreshold(symbol: string): number {
  if (symbol === "BTCUSD") return 1.8;
  if (symbol === "XAUUSD" || symbol === "XAGUSD") return 0.9;
  return 0.35;
}

function dayMoveThreshold(symbol: string): number {
  if (symbol === "BTCUSD") return 2.5;
  if (symbol === "XAUUSD" || symbol === "XAGUSD") return 1.2;
  return 0.45;
}

function countryLabelJa(country: string): string {
  switch (country) {
    case "USD": return "米国";
    case "EUR": return "ユーロ圏";
    case "GBP": return "英国";
    case "JPY": return "日本";
    case "CAD": return "カナダ";
    case "AUD": return "豪州";
    case "NZD": return "NZ";
    case "CHF": return "スイス";
    default: return country;
  }
}

function localizedEconomicTitle(title: string): string {
  let next = title.trim();
  next = next.replace(/\by\/y\b/gi, "前年比");
  next = next.replace(/\bm\/m\b/gi, "前月比");
  next = next.replace(/\bq\/q\b/gi, "前期比");
  next = next.replace(/\bmom\b/gi, "前月比");
  next = next.replace(/\byoy\b/gi, "前年比");
  next = next.replace(/\bqoq\b/gi, "前期比");
  next = next.replace(/\bCPI\b/g, "CPI");

  const speechMatch = next.match(/^FOMC Member\s+(.+?)\s+Speaks$/i);
  if (speechMatch) return `FOMCメンバー ${speechMatch[1]} 発言`;

  const bubaMatch = next.match(/^German Buba President\s+(.+?)\s+Speaks$/i);
  if (bubaMatch) return `独連銀総裁 ${bubaMatch[1]} 発言`;

  next = next.replace(/^Credit Card Spending\s+前年比$/i, "クレジットカード支出 前年比");
  next = next.replace(/^Median CPI\s+前年比$/i, "中央値CPI 前年比");
  next = next.replace(/^Trimmed CPI\s+前年比$/i, "トリムCPI 前年比");
  next = next.replace(/^Common CPI\s+前年比$/i, "共通CPI 前年比");
  next = next.replace(/^CPI\s+前月比$/i, "CPI 前月比");

  return next;
}

function withEconomicEventLabels(event: EconomicEvent): EconomicEvent {
  return {
    ...event,
    title_ja: localizedEconomicTitle(event.title),
    country_label_ja: countryLabelJa(event.country),
  };
}

function surpriseProxyLabelJa(value: EconomicEvent["surprise_proxy"]): string {
  if (value === "aligned") return "結果と反応が整合";
  if (value === "contrary") return "結果と反応が逆行";
  if (value === "muted") return "反応は限定的";
  return "判定材料不足";
}

function buildPairMarketNote(symbol: string, snapshotByKey: Map<string, MarketSnapshot>, headlines: NewsHeadline[], economicEvents: EconomicEvent[]): PairMarketNote {
  const snapshot = snapshotByKey.get(symbol);
  const dxy = snapshotByKey.get("DXY");
  const us10y = snapshotByKey.get("US10Y");
  const vix = snapshotByKey.get("VIX");
  const notes: string[] = [];
  let bias: "supportive" | "neutral" | "cautious" = "neutral";

  if (!snapshot) {
    return { symbol, bias, notes: ["市場スナップショットを取得できませんでした"] };
  }

  const absDay = Math.abs(snapshot.day_change_pct ?? 0);
  const absWeek = Math.abs(snapshot.week_change_pct ?? 0);
  const vol = snapshot.realized_vol_pct ?? 0;

  if (vol >= volatilityThreshold(symbol) || absDay >= dayMoveThreshold(symbol)) {
    bias = "cautious";
    notes.push("現在の値動きは急で、往復びんたのリスクが高めです");
  } else if (absWeek >= dayMoveThreshold(symbol) * 0.8 && vol <= volatilityThreshold(symbol) * 0.85) {
    bias = "supportive";
    notes.push("現在の値動きは方向感があり、短期ノイズは過度ではありません");
  } else {
    notes.push("値動きは混在しており、強い方向感はまだありません");
  }

  if (["EURUSD", "GBPUSD", "AUDUSD", "NZDUSD"].includes(symbol) && (dxy?.day_change_pct ?? 0) >= 0.25) {
    notes.push("本日はドルが強く、対ドル通貨ペアには重しになりやすい状況です");
  }
  if (["USDCAD", "USDCHF", "USDJPY"].includes(symbol) && (dxy?.day_change_pct ?? 0) >= 0.25) {
    notes.push("足元の値動きには広いドル高が影響しています");
  }
  if (symbol === "USDJPY" && (us10y?.day_change_pct ?? 0) >= 0.4) {
    notes.push("米金利上昇が USDJPY の上昇圧力を強めています");
  }
  if (["XAUUSD", "XAGUSD"].includes(symbol) && (us10y?.day_change_pct ?? 0) >= 0.4) {
    notes.push("米金利上昇は金属に逆風です");
    bias = "cautious";
  }
  if (symbol === "BTCUSD") {
    if ((dxy?.day_change_pct ?? 0) <= -0.2 && (vix?.day_change_pct ?? 0) <= 1.5 && (snapshot.week_change_pct ?? 0) > 0) {
      notes.push("市場のリスク選好はビットコインに追い風です");
      if (bias === "neutral") bias = "supportive";
    }
    if ((vix?.day_change_pct ?? 0) >= 3 || (dxy?.day_change_pct ?? 0) >= 0.35) {
      notes.push("マクロのリスクオフ圧力で暗号資産は急変しやすい地合いです");
      bias = "cautious";
    }
  }

  const relatedHeadline = headlines.find((headline) => {
    const title = headline.title.toLowerCase();
    if (symbol === "BTCUSD") return title.includes("bitcoin") || title.includes("crypto");
    if (symbol === "XAUUSD" || symbol === "XAGUSD") return title.includes("gold") || title.includes("silver");
    if (symbol === "USDJPY") return title.includes("yen") || title.includes("boj");
    if (symbol === "EURUSD" || symbol === "EURJPY") return title.includes("euro") || title.includes("ecb");
    if (symbol === "GBPUSD" || symbol === "GBPJPY") return title.includes("pound") || title.includes("boe");
    return title.includes("dollar") || title.includes("forex");
  });
  if (relatedHeadline) {
    const digest = relatedHeadline.summary ? ` - ${relatedHeadline.summary}` : "";
    notes.push(`関連見出し: ${relatedHeadline.title}${digest}`);
  }

  const relatedEvent = economicEvents.find((event) => event.affected_symbols.includes(symbol));
  if (relatedEvent) {
    const timing = relatedEvent.status === "upcoming" ? "予定" : "直近";
    const country = relatedEvent.country_label_ja ?? countryLabelJa(relatedEvent.country);
    const title = relatedEvent.title_ja ?? localizedEconomicTitle(relatedEvent.title);
    const forecastInfo = relatedEvent.forecast ? ` / 予想 ${relatedEvent.forecast}` : "";
    const actualInfo = relatedEvent.actual ? ` / 結果 ${relatedEvent.actual}` : "";
    const surpriseInfo = relatedEvent.status === "recent" && relatedEvent.surprise_proxy
      ? ` / 判定 ${surpriseProxyLabelJa(relatedEvent.surprise_proxy)}`
      : "";
    notes.push(`${timing} ${country} ${title}${actualInfo}${forecastInfo}${surpriseInfo}`);
    if (relatedEvent.impact === "High") {
      bias = "cautious";
    }
  }

  return { symbol, bias, notes: notes.slice(0, 3) };
}

function buildMarketSummary(snapshotByKey: Map<string, MarketSnapshot>, pairNotes: PairMarketNote[], headlines: NewsHeadline[], economicEvents: EconomicEvent[]): { summary: string; themes: string[]; risk_level: "low" | "medium" | "high" } {
  const themes: string[] = [];
  const dxy = snapshotByKey.get("DXY");
  const us10y = snapshotByKey.get("US10Y");
  const vix = snapshotByKey.get("VIX");
  const btc = snapshotByKey.get("BTCUSD");
  const gold = snapshotByKey.get("XAUUSD");

  if ((dxy?.day_change_pct ?? 0) >= 0.25) themes.push("ドル高圧力");
  else if ((dxy?.day_change_pct ?? 0) <= -0.25) themes.push("ドル軟化");
  if ((us10y?.day_change_pct ?? 0) >= 0.4) themes.push("米長期金利上昇");
  else if ((us10y?.day_change_pct ?? 0) <= -0.4) themes.push("米長期金利低下");
  if ((vix?.day_change_pct ?? 0) >= 3) themes.push("リスクオフ警戒");
  if ((btc?.week_change_pct ?? 0) >= 3 && (vix?.day_change_pct ?? 0) <= 2) themes.push("暗号資産はリスク選好寄り");
  if (Math.abs(gold?.day_change_pct ?? 0) >= 1 || (gold?.realized_vol_pct ?? 0) >= 0.9) themes.push("金属は値動きが荒い");
  const highImpactUpcoming = economicEvents.filter((event) => event.status === "upcoming" && event.impact === "High");
  if (highImpactUpcoming.length > 0) {
    themes.push(`高影響イベント接近: ${highImpactUpcoming.slice(0, 2).map((event) => `${event.country} ${event.title}`).join(" / ")}`);
  }
  if (themes.length === 0) themes.push("市場反応はまだ混在");

  const cautiousCount = pairNotes.filter((x) => x.bias === "cautious").length;
  const supportiveCount = pairNotes.filter((x) => x.bias === "supportive").length;
  const risk_level = cautiousCount >= 4 || (vix?.day_change_pct ?? 0) >= 4 || highImpactUpcoming.length >= 2 ? "high" : cautiousCount >= 2 || highImpactUpcoming.length >= 1 ? "medium" : "low";
  const headlineText = headlines.length > 0
    ? `直近見出しでは ${headlines[0].title}`
    : highImpactUpcoming.length > 0
    ? `直近では ${highImpactUpcoming[0].country} ${highImpactUpcoming[0].title} を控えています`
    : "ニュース面では決定打は限定的";
  const balanceText = supportiveCount > cautiousCount
    ? "比較的、方向感が出ている銘柄が多めです。"
    : cautiousCount > supportiveCount
    ? "急な反応や荒い値動きへの警戒が必要です。"
    : "方向感とノイズが混在しています。";

  return {
    summary: `${themes.join(" / ")}。${headlineText}。${balanceText}`,
    themes,
    risk_level,
  };
}

async function fetchMarketContext(universe: string[]): Promise<MarketContext | null> {
  try {
    const targets = [
      ...universe.map((symbol) => ({ key: symbol, label: PAIR_TICKERS[symbol]?.label ?? symbol, ticker: PAIR_TICKERS[symbol]?.ticker ?? symbol })),
      ...MACRO_TICKERS,
    ];
    const [snapshotsRaw, headlines, economicEvents] = await Promise.all([
      Promise.all(targets.map((target) => fetchMarketSnapshot(target.key, target.label, target.ticker))),
      fetchNewsHeadlines(),
      fetchEconomicEvents(universe),
    ]);
    const snapshots = snapshotsRaw.filter((x): x is MarketSnapshot => Boolean(x));
    const snapshotByKey = new Map(snapshots.map((snapshot) => [snapshot.key, snapshot]));
    const enrichedEvents = economicEvents.map((event) => {
      if (event.status !== "recent") return event;
      return {
        ...event,
        ...summarizeReactionBias(event, snapshotByKey, event.affected_symbols),
      };
    });
    const pairNotes = universe.map((symbol) => buildPairMarketNote(symbol, snapshotByKey, headlines, enrichedEvents));
    const summaryInfo = buildMarketSummary(snapshotByKey, pairNotes, headlines, enrichedEvents);
    return {
      summary: summaryInfo.summary,
      risk_level: summaryInfo.risk_level,
      themes: summaryInfo.themes,
      headlines,
      snapshots,
      pair_notes: pairNotes,
      economic_events: enrichedEvents,
    };
  } catch (_error) {
    return null;
  }
}

async function fetchTrades(universe: string[], timeframe: string, sinceIso: string, isVirtual: boolean): Promise<TradeRow[]> {
  const { data, error } = await supabase
    .from("ai_signals")
    .select("created_at, symbol, dir, actual_result, profit_loss, closed_at, win_prob, ml_pattern_used, entry_method")
    .in("symbol", universe)
    .eq("timeframe", timeframe)
    .eq("is_virtual", isVirtual)
    .or("is_manual_trade.is.null,is_manual_trade.eq.false")
    .eq("reverse_execution", false)
    .in("actual_result", ["WIN", "LOSS", "BREAK_EVEN"])
    .gte("closed_at", sinceIso)
    .not("closed_at", "is", null)
    .order("closed_at", { ascending: false })
    .limit(5000);

  if (error) {
    throw new Error(`failed to fetch ${isVirtual ? "virtual" : "real"} trades: ${error.message}`);
  }
  return (data ?? []) as TradeRow[];
}

function buildStats(
  universe: string[],
  timeframe: string,
  realRows: TradeRow[],
  virtualRows: TradeRow[],
  marketContext: MarketContext | null,
  now = new Date(),
): SymbolStats[] {
  const recent7dCutoff = now.getTime() - 7 * 24 * 60 * 60 * 1000;
  return universe.map((symbol) => {
    const real = realRows.filter((r) => r.symbol === symbol);
    const virtualRaw = virtualRows.filter((r) => r.symbol === symbol);
    const virtual = collapseShadowEpisodes(virtualRaw);
    const realWins = real.filter((r) => r.actual_result === "WIN").length;
    const realLosses = real.filter((r) => r.actual_result === "LOSS").length;
    const realTrades = real.length;
    const realTotalProfitLoss = real.reduce((sum, r) => sum + (Number(r.profit_loss ?? 0) || 0), 0);
    const avgWinProb = realTrades > 0
      ? real.reduce((sum, r) => sum + (Number(r.win_prob ?? 0) || 0), 0) / realTrades
      : null;

    const recent7d = real.filter((r) => new Date(r.closed_at ?? 0).getTime() >= recent7dCutoff);
    const recent7dWins = recent7d.filter((r) => r.actual_result === "WIN").length;
    const recent7dTrades = recent7d.length;
    const recent7dProfitLoss = recent7d.reduce((sum, r) => sum + (Number(r.profit_loss ?? 0) || 0), 0);

    const virtualWins = virtual.filter((r) => r.actual_result === "WIN").length;
    const virtualTrades = virtual.length;
    const virtualTotalProfitLoss = virtual.reduce((sum, r) => sum + (Number(r.profit_loss ?? 0) || 0), 0);
    const mlUsedTrades = real.filter((r) => r.ml_pattern_used).length;
    const marketRows = real.filter((r) => (r.entry_method ?? "") === "market");
    const pullbackRows = real.filter((r) => (r.entry_method ?? "") === "pullback");
    const marketTrades = marketRows.length;
    const pullbackTrades = pullbackRows.length;
    const marketWins = marketRows.filter((r) => r.actual_result === "WIN").length;
    const pullbackWins = pullbackRows.filter((r) => r.actual_result === "WIN").length;

    const realWinRate = realTrades > 0 ? realWins / realTrades : null;
    const virtualWinRate = virtualTrades > 0 ? virtualWins / virtualTrades : null;
    const recent7dWinRate = recent7dTrades > 0 ? recent7dWins / recent7dTrades : null;
    const realAvgProfitLoss = realTrades > 0 ? realTotalProfitLoss / realTrades : null;

    const realWinRateBayesian = bayesianWinRate(realWins, realTrades, 0.45, 8);
    const recent7dWinRateBayesian = bayesianWinRate(recent7dWins, recent7dTrades, realWinRateBayesian, 6);
    const virtualWinRateBayesian = bayesianWinRate(virtualWins, virtualTrades, 0.40, 16);
    const marketFit = marketFitForSymbol(symbol, marketContext, now);
    const sampleComponent = clamp(realTrades / 12, 0, 1) * 6;
    const realWinComponent = (realWinRateBayesian - 0.45) * 55;
    const recentComponent = (recent7dWinRateBayesian - realWinRateBayesian) * 35;
    const virtualComponent = (virtualWinRateBayesian - 0.40) * 55;
    const virtualProfitComponent = clamp(virtualTotalProfitLoss / 5, -1, 1) * 8;
    const marketComponent = (marketFit.score - 50) * 0.65;
    const compatibilityScore = marketFit.eligible
      ? clamp(50 + sampleComponent + realWinComponent + recentComponent + virtualComponent + virtualProfitComponent + marketComponent, 0, 100)
      : 0;

    return {
      symbol,
      timeframe,
      real_trades: realTrades,
      real_wins: realWins,
      real_losses: realLosses,
      real_win_rate: round3(realWinRate),
      real_total_profit_loss: round2(realTotalProfitLoss) ?? 0,
      real_avg_profit_loss: round2(realAvgProfitLoss),
      avg_win_prob: round3(avgWinProb),
      recent_7d_trades: recent7dTrades,
      recent_7d_win_rate: round3(recent7dWinRate),
      recent_7d_profit_loss: round2(recent7dProfitLoss) ?? 0,
      ml_used_trades: mlUsedTrades,
      market_trades: marketTrades,
      market_win_rate: round3(marketTrades > 0 ? marketWins / marketTrades : null),
      pullback_trades: pullbackTrades,
      pullback_win_rate: round3(pullbackTrades > 0 ? pullbackWins / pullbackTrades : null),
      virtual_trades: virtualTrades,
      virtual_raw_trades: virtualRaw.length,
      virtual_episode_trades: virtualTrades,
      virtual_win_rate: round3(virtualWinRate),
      virtual_win_rate_bayesian: round3(virtualWinRateBayesian),
      virtual_total_profit_loss: round2(virtualTotalProfitLoss) ?? 0,
      real_win_rate_bayesian: round3(realWinRateBayesian),
      market_fit_score: Math.round(marketFit.score * 10) / 10,
      market_regime: marketFit.regime,
      market_eligible: marketFit.eligible,
      score_components: {
        sample: Math.round(sampleComponent * 10) / 10,
        real: Math.round(realWinComponent * 10) / 10,
        recent: Math.round(recentComponent * 10) / 10,
        virtual: Math.round(virtualComponent * 10) / 10,
        virtual_profit: Math.round(virtualProfitComponent * 10) / 10,
        market: Math.round(marketComponent * 10) / 10,
      },
      compatibility_score: Math.round(compatibilityScore * 10) / 10,
    };
  });
}

function applySystemFitToContext(marketContext: MarketContext | null, stats: SymbolStats[]): MarketContext | null {
  if (!marketContext) return null;
  const snapshotByKey = new Map(marketContext.snapshots.map((snapshot) => [snapshot.key, snapshot]));
  const nextNotes = marketContext.pair_notes.map((note) => {
    const stat = stats.find((item) => item.symbol === note.symbol);
    if (!stat) return note;
    const regime = pairRegimeLabel(snapshotByKey.get(note.symbol), note.symbol);
    const fitNote = buildSystemFitNote(stat, regime);
    if (!fitNote) return note;
    return {
      ...note,
      notes: [...note.notes, fitNote].slice(0, 4),
    };
  });
  return {
    ...marketContext,
    pair_notes: nextNotes,
  };
}

async function requestPairSelection(prompt: string): Promise<string | null> {
  const models = [...new Set([PAIR_SELECTOR_MODEL, PAIR_SELECTOR_FALLBACK_MODEL].filter(Boolean))];
  for (const model of models) {
    try {
      const isReasoningModel = /^gpt-5/i.test(model);
      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model,
          response_format: { type: "json_object" },
          messages: [
            {
              role: "system",
              content: "市場環境と運用実績から、コスト控除後の期待値が高い銘柄を順位付けする。取引回避を目的化せず、サンプル不足と過信を避けてJSONで返す。",
            },
            { role: "user", content: prompt },
          ],
          ...(isReasoningModel
            ? { reasoning_effort: "low", max_completion_tokens: 1600 }
            : { temperature: 0.1, max_tokens: 1200 }),
        }),
      });

      if (!response.ok) {
        console.error(`[pair-selector] OpenAI ${model} failed: ${response.status} ${await response.text()}`);
        continue;
      }
      const data = await response.json();
      const content = data?.choices?.[0]?.message?.content;
      if (typeof content === "string" && content.trim()) {
        console.log(`[pair-selector] Selection model: ${model}`);
        return content;
      }
    } catch (error) {
      console.error(`[pair-selector] OpenAI ${model} exception:`, error instanceof Error ? error.message : String(error));
    }
  }
  return null;
}

async function askOpenAi(stats: SymbolStats[], topN: number, cadence: string, timeframe: string, marketContext: MarketContext | null): Promise<AiSelectionResult> {
  if (!OPENAI_API_KEY) {
    return fallbackSelection(stats, topN, timeframe, marketContext);
  }

  const prompt = `あなたはMT5自動売買システムの運用アナリストです。
目的は「このシステムと今相性の良さそうな通貨ペア/銘柄」を選ぶことです。

重要条件:
- 現在の市場ニュース、マクロ文脈、市場反応を最初に評価する
- market_eligible=true の銘柄だけを候補にする。false は絶対に選ばない
- 実現勝率は real_win_rate_bayesian を主なガードレールとして使う
- サンプル数が少ない銘柄は過信しない
- 直近7日が悪化している銘柄は慎重に扱う
- virtual成績は重複をまとめた virtual_episode_trades と virtual_win_rate_bayesian を補助情報として使う
- 実績ゼロの銘柄も市場適合が高ければ候補から外さず、フィードバックループを避ける
- このシステムは ${timeframe} を使う
- top ${topN} 件を選ぶ
- 理由は「現在の市場環境」と「このシステムの直近実績」の両方に触れる
- 選んだ銘柄ごとに、今日だけ許可する方向・戦略・取引時間帯・避けるイベント・実行ゲートを決める
- 勝率の最大化ではなく、RR=1.5と取引コストを踏まえた期待値を最大化する
- 勝率50%前後でもコスト控除後の期待値が正なら候補として残す
- min_win_probは通常0.48～0.55。根拠なく0.60以上へ引き上げない
- max_cost_rは直近の独立機会でプラスだった0.20R以下を基本にする
- allowed_direction は buy/sell/both/none のいずれか。迷うなら both ではなく根拠のある方向へ絞る
- strategy は trend_follow/pullback/mean_revert/breakout/standby のいずれか
- 高重要イベントに影響される銘柄は、その前後を avoid_event_windows に入れる

現在の市場環境:
${JSON.stringify(marketContext, null, 2)}

候補データ:
${JSON.stringify(summarizeStatsForPrompt(stats), null, 2)}

JSONのみで回答:
{
  "summary": "日本語で、市場環境とシステム適合性を2-3文で要約",
  "selected_pairs": [
    {"symbol":"X","score":0-100,"confidence":"high|medium|low","reason":"日本語で1文","caution":"...","allowed_direction":"buy|sell|both|none","strategy":"trend_follow|pullback|mean_revert|breakout|standby","min_win_prob":0.50,"max_cost_r":0.20}
  ],
  "avoided_pairs": [
    {"symbol":"X","score":0-100,"confidence":"high|medium|low","reason":"日本語で1文","caution":"..."}
  ],
  "trade_plan": {
    "summary": "日本語で今日の取引計画を1-2文",
    "risk_level": "low|medium|high",
    "market_themes": ["..."],
    "symbols": [
      {
        "symbol": "X",
        "allowed_direction": "buy|sell|both|none",
        "strategy": "trend_follow|pullback|mean_revert|breakout|standby",
        "min_win_prob": 0.50,
        "max_cost_r": 0.20,
        "confidence": "high|medium|low",
        "score": 0-100,
        "reason": "日本語で具体的に",
        "setup_focus": ["H1 trend confirmation", "spread cost below gate"]
      }
    ],
    "global_rules": {
      "avoid_high_impact_minutes_before": 60,
      "avoid_high_impact_minutes_after": 45,
      "require_higher_timeframe_alignment": true,
      "max_open_positions": 1
    }
  }
}`;

  const content = await requestPairSelection(prompt);
  if (!content) return fallbackSelection(stats, topN, timeframe, marketContext);
  const jsonMatch = typeof content === "string" ? content.match(/\{[\s\S]*\}/) : null;
  if (!jsonMatch) {
    return fallbackSelection(stats, topN, timeframe, marketContext);
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]);
    const selected_pairs = Array.isArray(parsed?.selected_pairs) ? parsed.selected_pairs : [];
    const avoided_pairs = Array.isArray(parsed?.avoided_pairs) ? parsed.avoided_pairs : [];
    const summary = typeof parsed?.summary === "string" && parsed.summary.trim()
      ? parsed.summary.trim()
      : `${cadence} pair selection report`;
    const fallbackSelected = selected_pairs.length > 0
      ? selected_pairs
      : fallbackSelection(stats, topN, timeframe, marketContext).selected_pairs;
    const trade_plan = normalizeTradePlan(parsed?.trade_plan, fallbackSelected.slice(0, topN), stats, timeframe, marketContext, summary);

    return {
      summary,
      selected_pairs: attachPlanToRecommendations(fallbackSelected, trade_plan),
      avoided_pairs,
      trade_plan,
    };
  } catch (_error) {
    return fallbackSelection(stats, topN, timeframe, marketContext);
  }
}

async function generateReport(body: any) {
  const { cadence, timeframe, lookbackDays, topN, universe, triggeredBy } = normalizeRequest(body);
  const now = new Date();
  const sinceIso = new Date(now.getTime() - lookbackDays * 24 * 60 * 60 * 1000).toISOString();

  const [realRows, virtualRows, marketContext] = await Promise.all([
    fetchTrades(universe, timeframe, sinceIso, false),
    fetchTrades(universe, timeframe, sinceIso, true),
    fetchMarketContext(universe),
  ]);
  const stats = buildStats(universe, timeframe, realRows, virtualRows, marketContext, now);
  const enrichedContext = applySystemFitToContext(marketContext, stats);
  const aiSelection = await askOpenAi(stats, topN, cadence, timeframe, enrichedContext);
  const finalized = finalizeSelection(aiSelection, stats, topN, enrichedContext);
  aiSelection.selected_pairs = finalized.selected;
  aiSelection.avoided_pairs = finalized.avoided;
  const tradePlan = normalizeTradePlan(
    aiSelection.trade_plan,
    finalized.selected,
    stats,
    timeframe,
    enrichedContext,
    aiSelection.summary || enrichedContext?.summary || "",
    finalized.meta,
  );
  aiSelection.trade_plan = tradePlan;
  aiSelection.selected_pairs = attachPlanToRecommendations(aiSelection.selected_pairs, tradePlan);
  const selectionView = buildSelectionView(stats, aiSelection, topN, enrichedContext);
  const selectedWithPlan = attachPlanToRecommendations(finalized.selected, tradePlan);
  const topPicksWithPlan = selectedWithPlan.slice(0, topN);

  const payload = {
    generated_at: now.toISOString(),
    cadence,
    timeframe,
    lookback_days: lookbackDays,
    top_n: topN,
    universe,
    selected_pairs: selectedWithPlan,
    avoided_pairs: selectionView.avoided_pairs,
    candidate_stats: stats,
    summary: aiSelection.summary || enrichedContext?.summary || null,
    trade_plan: tradePlan,
    plan_status: "active",
    plan_overrides: {},
    model: PAIR_SELECTOR_MODEL,
    triggered_by: triggeredBy,
    status: "active",
  };

  let { data: inserted, error } = await supabase
    .from("pair_selection_reports")
    .insert(payload)
    .select()
    .single();

  if (error && /trade_plan|plan_status|plan_overrides|column/i.test(String(error.message ?? ""))) {
    const legacyPayload = { ...payload } as any;
    delete legacyPayload.trade_plan;
    delete legacyPayload.plan_status;
    delete legacyPayload.plan_overrides;
    const retry = await supabase
      .from("pair_selection_reports")
      .insert(legacyPayload)
      .select()
      .single();
    inserted = retry.data;
    error = retry.error;
  }

  if (error) {
    throw new Error(`failed to save pair selection report: ${error.message}`);
  }

  return {
    ...buildReportDigest(aiSelection.summary || enrichedContext?.summary || "", selectionView, enrichedContext),
    ok: true,
    report: {
      ...inserted,
      live_context: enrichedContext,
      ...buildReportDigest(aiSelection.summary || enrichedContext?.summary || "", selectionView, enrichedContext),
      trade_plan: tradePlan,
      top_picks: topPicksWithPlan,
      recommended_pairs: selectedWithPlan,
      neutral_pairs: selectionView.neutral_pairs,
      ranked_pairs: selectionView.ranked_pairs,
    },
  };
}

if (import.meta.main) Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders() });
  }

  const guard = ensureSupabaseForRequest(req);
  if (!guard.ok) {
    return new Response(JSON.stringify({ error: "missing env", missing: guard.missing }), {
      status: 500,
      headers: corsHeaders(),
    });
  }

  try {
    if (req.method === "GET") {
      const url = new URL(req.url);
      const limit = clamp(Number(url.searchParams.get("limit") ?? 1), 1, 10);
      const liveContextRaw = limit === 1 ? await fetchMarketContext(DEFAULT_UNIVERSE) : null;
      const primaryReports = await supabase
        .from("pair_selection_reports")
        .select("id, created_at, generated_at, cadence, timeframe, lookback_days, top_n, universe, selected_pairs, avoided_pairs, candidate_stats, summary, trade_plan, plan_overrides, plan_status, model, triggered_by")
        .eq("status", "active")
        .order("created_at", { ascending: false })
        .limit(limit);
      let data: any[] | null = primaryReports.data as any[] | null;
      let error: any = primaryReports.error;

      if (error && /trade_plan|plan_status|plan_overrides|column/i.test(String(error.message ?? ""))) {
        const retry = await supabase
          .from("pair_selection_reports")
          .select("id, created_at, generated_at, cadence, timeframe, lookback_days, top_n, universe, selected_pairs, avoided_pairs, candidate_stats, summary, model, triggered_by")
          .eq("status", "active")
          .order("created_at", { ascending: false })
          .limit(limit);
        data = retry.data;
        error = retry.error;
      }

      if (error) {
        throw new Error(error.message);
      }

      const reports = (data ?? []).map((report: any) => {
        const stats = Array.isArray(report?.candidate_stats) ? report.candidate_stats as SymbolStats[] : [];
        const aiSelection: AiSelectionResult = {
          summary: typeof report?.summary === "string" ? report.summary : "",
          selected_pairs: Array.isArray(report?.selected_pairs) ? report.selected_pairs : [],
          avoided_pairs: Array.isArray(report?.avoided_pairs) ? report.avoided_pairs : [],
        };
        const liveContext = applySystemFitToContext(liveContextRaw, stats);
        const reportPlan = normalizeTradePlan(
          report?.trade_plan,
          aiSelection.selected_pairs.slice(0, Number(report?.top_n ?? DEFAULT_TOP_N)),
          stats,
          String(report?.timeframe ?? DEFAULT_TIMEFRAME),
          liveContext,
          aiSelection.summary,
        );
        aiSelection.trade_plan = reportPlan;
        aiSelection.selected_pairs = attachPlanToRecommendations(aiSelection.selected_pairs, reportPlan);
        const selectionView = buildSelectionView(stats, aiSelection, Number(report?.top_n ?? DEFAULT_TOP_N), liveContext);
        const digest = buildReportDigest(aiSelection.summary, selectionView, liveContext);
        return {
          ...report,
          ...digest,
          trade_plan: reportPlan,
          plan_overrides: report?.plan_overrides ?? {},
          plan_status: typeof report?.plan_status === "string" ? report.plan_status : "active",
          top_picks: selectionView.top_picks,
          recommended_pairs: selectionView.recommended_pairs,
          neutral_pairs: selectionView.neutral_pairs,
          ranked_pairs: selectionView.ranked_pairs,
        };
      });

      return new Response(JSON.stringify({ ok: true, latest: reports[0] ?? null, reports, live_context: reports[0]?.candidate_stats ? applySystemFitToContext(liveContextRaw, reports[0].candidate_stats as SymbolStats[]) : liveContextRaw }), {
        status: 200,
        headers: corsHeaders(),
      });
    }

    if (req.method !== "POST") {
      return new Response(JSON.stringify({ error: "method not allowed" }), {
        status: 405,
        headers: corsHeaders(),
      });
    }

    const body = await req.json().catch(() => ({}));
    const result = await generateReport(body);
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: corsHeaders(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: corsHeaders(),
    });
  }
});
