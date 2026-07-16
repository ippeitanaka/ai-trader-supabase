type PairRecommendation = {
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
};

type SessionWindow = {
  label?: string;
  start_utc?: string;
  end_utc?: string;
};

type EventWindow = {
  label?: string;
  start_at?: string;
  end_at?: string;
  impact?: "High" | "Medium" | "Low";
  reason?: string;
};

type TradePlanSymbol = {
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
  setup_focus?: string[];
};

type DailyTradePlan = {
  plan_version?: string;
  plan_date?: string;
  generated_at?: string;
  expires_at?: string;
  timeframe?: string;
  risk_level?: "low" | "medium" | "high";
  summary?: string;
  market_themes?: string[];
  symbols?: TradePlanSymbol[];
  selection_meta?: {
    requested_count: number;
    selected_count: number;
    eligible_count: number;
    backfilled_count: number;
    excluded_market_closed: string[];
    complete: boolean;
  };
  global_rules?: {
    avoid_high_impact_minutes_before?: number;
    avoid_high_impact_minutes_after?: number;
    require_higher_timeframe_alignment?: boolean;
    max_open_positions?: number;
  };
};

type PlanOverrides = {
  status?: "active" | "paused";
  gate_adjustment?: 0 | 0.05 | 0.10;
  gate_mode?: "ai" | "cautious" | "very_cautious";
  symbol_gate_adjustments?: Record<string, 0 | 0.05 | 0.10>;
  note?: string;
  updated_at?: string;
  history?: Array<Record<string, unknown>>;
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
  id?: number;
  generated_at: string;
  cadence: string;
  timeframe: string;
  lookback_days: number;
  top_n?: number;
  summary: string;
  digest_text?: string;
  digest_lines?: string[];
  digest?: PairSelectorDigest;
  top_picks: PairRecommendation[];
  recommended_pairs: PairRecommendation[];
  neutral_pairs: PairRecommendation[];
  avoided_pairs: PairRecommendation[];
  trade_plan?: DailyTradePlan;
  plan_overrides?: PlanOverrides;
  plan_status?: "active" | "paused" | string;
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
  win_prob_raw?: number | null;
  win_prob_calibrated?: number | null;
  win_prob_final?: number | null;
  calibration_applied?: boolean | null;
  calibration_version?: string | null;
  calibration_method?: string | null;
  calibration_scope?: string | null;
  calibration_sample_size?: number | null;
  calibration_shift?: number | null;
  h1_shadow_checked?: boolean | null;
  h1_shadow_would_block?: boolean | null;
  h1_shadow_reason?: string | null;
  plan_base_min_win_prob?: number | null;
  plan_gate_adjustment?: number | null;
  plan_effective_min_win_prob?: number | null;
  plan_gate_mode?: string | null;
  decision_summary: string | null;
  skip_reason: string | null;
  entry_method: string | null;
  trade_plan_id?: number | null;
  plan_alignment?: string | null;
  event_risk?: string | null;
  market_session?: string | null;
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
  win_prob_raw?: number | null;
  win_prob_calibrated?: number | null;
  win_prob_final?: number | null;
  calibration_applied?: boolean | null;
  calibration_version?: string | null;
  calibration_method?: string | null;
  calibration_scope?: string | null;
  calibration_sample_size?: number | null;
  calibration_shift?: number | null;
  h1_shadow_checked?: boolean | null;
  h1_shadow_would_block?: boolean | null;
  h1_shadow_reason?: string | null;
  plan_base_min_win_prob?: number | null;
  plan_gate_adjustment?: number | null;
  plan_effective_min_win_prob?: number | null;
  plan_gate_mode?: string | null;
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
  is_manual_trade?: boolean | null;
  trade_plan_id?: number | null;
  plan_alignment?: string | null;
  event_risk?: string | null;
  market_session?: string | null;
  shadow_reason?: string | null;
  mfe_r?: number | null;
  mae_r?: number | null;
};

type ShadowAnalysis = {
  candidateCount: number;
  resolvedCount: number;
  pendingCount: number;
  avoidedLossCount: number;
  missedWinCount: number;
  shadowWinRate: number | null;
  netR: number;
  averageRawProb: number | null;
  averageCalibratedProb: number | null;
  averageFinalProb: number | null;
  averageCalibrationShift: number | null;
  rawBrierScore: number | null;
  calibratedBrierScore: number | null;
  rawEce: number | null;
  calibratedEce: number | null;
  recent: AISignalRecord[];
};

type OpportunityCohort = {
  label: string;
  candidateCount: number;
  resolvedCount: number;
  winRate: number | null;
  netR: number;
};

type OpportunityAnalysis = {
  periodDays: number;
  rawSignalCount: number;
  independentEpisodeCount: number;
  modelReliabilityWeight: number;
  modelProbabilitySeparation: number | null;
  eligibleEpisodeCount: number;
  resolvedEligibleCount: number;
  eligibleWinRate: number | null;
  eligibleNetR: number;
  policyScenarios: OpportunityCohort[];
  probabilityCohorts: OpportunityCohort[];
  costCohorts: OpportunityCohort[];
  symbolCohorts: OpportunityCohort[];
  directionCohorts: OpportunityCohort[];
};

type H1AuditSummary = {
  checkedCount: number;
  wouldBlockCount: number;
  resolvedWouldBlockCount: number;
  wouldBlockWinRate: number | null;
  wouldBlockNetR: number;
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
  shadowAnalysis: ShadowAnalysis;
  opportunityAnalysis: OpportunityAnalysis;
  h1Audit: H1AuditSummary;
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

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      ...supabaseHeaders(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status} ${url}`);
  }
  return response.json() as Promise<T>;
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

function average(values: Array<number | null | undefined>) {
  const valid = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (valid.length === 0) return null;
  return valid.reduce((sum, value) => sum + value, 0) / valid.length;
}

function averageProbabilityPercent(values: Array<number | null | undefined>) {
  const value = average(values);
  return value === null ? null : round2(value * 100);
}

function summarizeShadowTrades(trades: AISignalRecord[]): ShadowAnalysis {
  const resolved = trades.filter((trade) => trade.actual_result === "WIN" || trade.actual_result === "LOSS");
  const wins = resolved.filter((trade) => trade.actual_result === "WIN");
  const losses = resolved.filter((trade) => trade.actual_result === "LOSS");
  const rawBrier = resolved.map((trade) => {
    if (trade.win_prob_raw == null) return null;
    const outcome = trade.actual_result === "WIN" ? 1 : 0;
    return (trade.win_prob_raw - outcome) ** 2;
  });
  const calibratedBrier = resolved.map((trade) => {
    if (trade.win_prob_calibrated == null) return null;
    const outcome = trade.actual_result === "WIN" ? 1 : 0;
    return (trade.win_prob_calibrated - outcome) ** 2;
  });
  const expectedCalibrationError = (selector: (trade: AISignalRecord) => number | null | undefined) => {
    if (resolved.length === 0) return null;
    let weightedError = 0;
    let measured = 0;
    for (let bin = 0; bin < 10; bin += 1) {
      const lower = bin / 10;
      const upper = (bin + 1) / 10;
      const rows = resolved.filter((trade) => {
        const probability = selector(trade);
        return probability != null && probability >= lower && (bin === 9 ? probability <= upper : probability < upper);
      });
      if (rows.length === 0) continue;
      const meanProbability = average(rows.map(selector));
      if (meanProbability === null) continue;
      const realizedRate = rows.filter((trade) => trade.actual_result === "WIN").length / rows.length;
      weightedError += Math.abs(meanProbability - realizedRate) * rows.length;
      measured += rows.length;
    }
    return measured > 0 ? weightedError / measured : null;
  };

  return {
    candidateCount: trades.length,
    resolvedCount: resolved.length,
    pendingCount: trades.filter((trade) => trade.actual_result === "PENDING" || trade.actual_result === "FILLED").length,
    avoidedLossCount: losses.length,
    missedWinCount: wins.length,
    shadowWinRate: resolved.length > 0 ? round2((wins.length / resolved.length) * 100) : null,
    netR: round2(resolved.reduce((sum, trade) => sum + (trade.profit_loss ?? 0), 0)) ?? 0,
    averageRawProb: averageProbabilityPercent(trades.map((trade) => trade.win_prob_raw)),
    averageCalibratedProb: averageProbabilityPercent(trades.map((trade) => trade.win_prob_calibrated)),
    averageFinalProb: averageProbabilityPercent(trades.map((trade) => trade.win_prob_final ?? trade.win_prob)),
    averageCalibrationShift: averageProbabilityPercent(trades.map((trade) => trade.calibration_shift)),
    rawBrierScore: round2(average(rawBrier)),
    calibratedBrierScore: round2(average(calibratedBrier)),
    rawEce: round2(expectedCalibrationError((trade) => trade.win_prob_raw)),
    calibratedEce: round2(expectedCalibrationError((trade) => trade.win_prob_calibrated)),
    recent: trades.slice(0, 8),
  };
}

function parseOpportunityDecision(trade: AISignalRecord) {
  const summary = trade.decision_summary ?? "";
  const read = (pattern: RegExp) => {
    const value = summary.match(pattern)?.[1];
    const parsed = value == null ? Number.NaN : Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  };
  return {
    modelWinProb: trade.win_prob_calibrated ?? trade.win_prob_raw ?? read(/\bp=(-?\d+(?:\.\d+)?)/),
    costR: read(/\bcost=(-?\d+(?:\.\d+)?)\//),
  };
}

function collapseOpportunityEpisodes(trades: AISignalRecord[], episodeMinutes = 120) {
  const sorted = [...trades].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
  const lastEpisodeAt = new Map<string, number>();
  const episodes: AISignalRecord[] = [];
  const episodeMs = episodeMinutes * 60 * 1000;

  for (const trade of sorted) {
    const createdAt = Date.parse(trade.created_at);
    if (!Number.isFinite(createdAt)) continue;
    const key = `${trade.symbol}:${trade.dir ?? 0}`;
    const previous = lastEpisodeAt.get(key);
    if (previous != null && createdAt - previous < episodeMs) continue;
    lastEpisodeAt.set(key, createdAt);
    episodes.push(trade);
  }
  return episodes;
}

function summarizeOpportunityCohort(label: string, trades: AISignalRecord[]): OpportunityCohort {
  const resolved = trades.filter((trade) => trade.actual_result === "WIN" || trade.actual_result === "LOSS");
  const wins = resolved.filter((trade) => trade.actual_result === "WIN").length;
  return {
    label,
    candidateCount: trades.length,
    resolvedCount: resolved.length,
    winRate: resolved.length > 0 ? round2((wins / resolved.length) * 100) : null,
    netR: round2(resolved.reduce((sum, trade) => sum + (trade.profit_loss ?? 0), 0)) ?? 0,
  };
}

function summarizeOpportunityAnalysis(trades: AISignalRecord[], periodDays = 7): OpportunityAnalysis {
  const since = Date.now() - periodDays * 24 * 60 * 60 * 1000;
  const recent = trades.filter((trade) => Date.parse(trade.created_at) >= since);
  const episodes = collapseOpportunityEpisodes(recent);
  const hardBlockTokens = [
    "daily_plan_paused",
    "daily_plan_symbol_not_selected",
    "daily_plan_expired",
    "daily_plan_event_window",
    "daily_plan_direction_mismatch",
    "daily_plan_manual_gate",
    "chart_structure_opposes_entry",
    "bad_inputs",
    "emergency_stop",
  ];
  const isHardBlocked = (trade: AISignalRecord) => {
    const diagnostics = `${trade.decision_summary ?? ""}|${trade.shadow_reason ?? ""}`.toLowerCase();
    return hardBlockTokens.some((token) => diagnostics.includes(token));
  };
  const withDecision = episodes.map((trade) => ({ trade, decision: parseOpportunityDecision(trade) }));
  const resolvedWithProbability = withDecision.filter(({ trade, decision }) =>
    (trade.actual_result === "WIN" || trade.actual_result === "LOSS") && decision.modelWinProb !== null
  );
  const winningProbabilities = resolvedWithProbability
    .filter(({ trade }) => trade.actual_result === "WIN")
    .map(({ decision }) => decision.modelWinProb!);
  const losingProbabilities = resolvedWithProbability
    .filter(({ trade }) => trade.actual_result === "LOSS")
    .map(({ decision }) => decision.modelWinProb!);
  const averageNumber = (values: number[]) =>
    values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  const winAverage = averageNumber(winningProbabilities);
  const lossAverage = averageNumber(losingProbabilities);
  const probabilitySeparation = winAverage !== null && lossAverage !== null ? winAverage - lossAverage : null;
  const sampleFactor = Math.max(0, Math.min(1, (resolvedWithProbability.length - 20) / 40));
  const rankStrength = probabilitySeparation !== null
    ? Math.max(0, Math.min(1, (probabilitySeparation - 0.01) / 0.09))
    : 0;
  const modelReliabilityWeight = sampleFactor * rankStrength;
  const adaptiveMatches = ({ trade, decision }: typeof withDecision[number]) => {
    if (isHardBlocked(trade) || decision.modelWinProb === null || decision.costR === null || decision.costR > 0.20) return false;
    const executionProbability = 0.50 + modelReliabilityWeight * (decision.modelWinProb - 0.50);
    const expectedValueR = executionProbability * 1.5 - (1 - executionProbability) - decision.costR;
    const dynamicGate = Math.max(0.48, (1 + decision.costR + 0.05) / 2.5);
    return executionProbability >= dynamicGate && expectedValueR >= 0.05;
  };
  const eligible = withDecision.filter(adaptiveMatches).map(({ trade }) => trade);
  const resolvedEligible = eligible.filter((trade) => trade.actual_result === "WIN" || trade.actual_result === "LOSS");
  const eligibleWins = resolvedEligible.filter((trade) => trade.actual_result === "WIN").length;
  const probabilityCohorts = [
    { label: "p<48%", min: -Infinity, max: 0.48 },
    { label: "48-50%", min: 0.48, max: 0.50 },
    { label: "50-55%", min: 0.50, max: 0.55 },
    { label: "p≥55%", min: 0.55, max: Infinity },
  ].map((bucket) => summarizeOpportunityCohort(
    bucket.label,
    withDecision
      .filter(({ decision }) => decision.modelWinProb !== null && decision.modelWinProb >= bucket.min && decision.modelWinProb < bucket.max)
      .map(({ trade }) => trade),
  ));
  const costCohorts = [
    { label: "cost≤0.15R", min: -Infinity, max: 0.15, inclusive: true },
    { label: "0.15-0.20R", min: 0.15, max: 0.20 },
    { label: "0.20-0.25R", min: 0.20, max: 0.25 },
    { label: "0.25-0.30R", min: 0.25, max: 0.30 },
    { label: "cost>0.30R", min: 0.30, max: Infinity },
  ].map((bucket) => summarizeOpportunityCohort(
    bucket.label,
    withDecision
      .filter(({ decision }) => decision.costR !== null &&
        (bucket.inclusive ? decision.costR <= bucket.max : decision.costR > bucket.min && decision.costR <= bucket.max))
      .map(({ trade }) => trade),
  ));
  const policyScenarios = [
    {
      label: "採用: 自動信頼度",
      matches: adaptiveMatches,
    },
    {
      label: "現行基礎ゲート",
      matches: ({ trade, decision }: typeof withDecision[number]) =>
        !isHardBlocked(trade) &&
        decision.modelWinProb !== null && decision.modelWinProb >= 0.55 &&
        decision.costR !== null &&
        decision.modelWinProb * 1.5 - (1 - decision.modelWinProb) - decision.costR >= 0.05 &&
        decision.costR <= 0.20,
    },
    {
      label: "単純緩和案",
      matches: ({ trade, decision }: typeof withDecision[number]) =>
        !isHardBlocked(trade) &&
        decision.modelWinProb !== null && decision.modelWinProb >= 0.48 &&
        decision.costR !== null &&
        decision.modelWinProb * 1.5 - (1 - decision.modelWinProb) - decision.costR >= 0.05 &&
        decision.costR <= 0.30,
    },
    {
      label: "50%縮約 25%",
      matches: ({ trade, decision }: typeof withDecision[number]) => {
        if (isHardBlocked(trade) || decision.modelWinProb === null || decision.costR === null || decision.costR > 0.25) return false;
        const shrunkProbability = 0.50 + 0.25 * (decision.modelWinProb - 0.50);
        const expectedValueR = shrunkProbability * 1.5 - (1 - shrunkProbability) - decision.costR;
        const dynamicGate = Math.max(0.48, (1 + decision.costR + 0.05) / 2.5);
        return shrunkProbability >= dynamicGate && expectedValueR >= 0.05;
      },
    },
    {
      label: "コスト≤0.20R参考",
      matches: ({ trade, decision }: typeof withDecision[number]) =>
        !isHardBlocked(trade) && decision.costR !== null && decision.costR <= 0.20,
    },
  ].map((scenario) => summarizeOpportunityCohort(
    scenario.label,
    withDecision.filter(scenario.matches).map(({ trade }) => trade),
  ));
  const symbolCohorts = [...new Set(episodes.map((trade) => trade.symbol))]
    .map((symbol) => summarizeOpportunityCohort(symbol, episodes.filter((trade) => trade.symbol === symbol)))
    .sort((a, b) => b.netR - a.netR);
  const directionCohorts = [
    summarizeOpportunityCohort("BUY", episodes.filter((trade) => trade.dir === 1)),
    summarizeOpportunityCohort("SELL", episodes.filter((trade) => trade.dir === -1)),
  ];

  return {
    periodDays,
    rawSignalCount: recent.length,
    independentEpisodeCount: episodes.length,
    modelReliabilityWeight: round2(modelReliabilityWeight * 100) ?? 0,
    modelProbabilitySeparation: probabilitySeparation === null ? null : round2(probabilitySeparation * 100),
    eligibleEpisodeCount: eligible.length,
    resolvedEligibleCount: resolvedEligible.length,
    eligibleWinRate: resolvedEligible.length > 0 ? round2((eligibleWins / resolvedEligible.length) * 100) : null,
    eligibleNetR: round2(resolvedEligible.reduce((sum, trade) => sum + (trade.profit_loss ?? 0), 0)) ?? 0,
    policyScenarios,
    probabilityCohorts,
    costCohorts,
    symbolCohorts,
    directionCohorts,
  };
}

function summarizeH1Audit(trades: AISignalRecord[]): H1AuditSummary {
  const wouldBlock = trades.filter((trade) => trade.h1_shadow_would_block === true);
  const resolved = wouldBlock.filter((trade) => trade.actual_result === "WIN" || trade.actual_result === "LOSS");
  const wins = resolved.filter((trade) => trade.actual_result === "WIN").length;
  return {
    checkedCount: trades.length,
    wouldBlockCount: wouldBlock.length,
    resolvedWouldBlockCount: resolved.length,
    wouldBlockWinRate: resolved.length > 0 ? round2((wins / resolved.length) * 100) : null,
    wouldBlockNetR: round2(resolved.reduce((sum, trade) => sum + (trade.profit_loss ?? 0), 0)) ?? 0,
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
  if (!trade.closed_at) {
    if (trade.actual_result === "FILLED") return "保有中";
    if (trade.actual_result === "PENDING") return "未約定";
    if (trade.actual_result === "CANCELLED") return "キャンセル";
    return "未決済";
  }
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

export async function triggerPairSelectorRefresh(options?: {
  cadence?: string;
  lookbackDays?: number;
  topN?: number;
}) {
  requireEnv();
  return postJson<Record<string, unknown>>(buildFunctionUrl("pair-selector", {}), {
    cadence: options?.cadence ?? "daily",
    lookback_days: options?.lookbackDays ?? 21,
    top_n: options?.topN ?? 3,
    triggered_by: "dashboard-manual-refresh",
  });
}

export async function updateTradePlanOverrides(reportId: number, overrides: PlanOverrides) {
  requireEnv();
  const url = buildRestUrl("pair_selection_reports", {
    id: `eq.${reportId}`,
  });
  const currentUrl = buildRestUrl("pair_selection_reports", {
    id: `eq.${reportId}`,
    select: "plan_overrides,plan_status",
    limit: "1",
  });
  const currentRows = await fetchJson<Array<{ plan_overrides?: PlanOverrides; plan_status?: string }>>(currentUrl);
  const current = currentRows[0]?.plan_overrides ?? {};
  const updatedAt = new Date().toISOString();
  const history = [
    ...(Array.isArray(current.history) ? current.history : []),
    { at: updatedAt, source: "dashboard", changes: overrides },
  ].slice(-50);
  const merged: PlanOverrides = {
    ...current,
    ...overrides,
    history,
    updated_at: updatedAt,
  };
  const response = await fetch(url, {
    method: "PATCH",
    headers: {
      ...supabaseHeaders(),
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify({
      plan_overrides: merged,
      plan_status: overrides.status ?? current.status ?? currentRows[0]?.plan_status ?? "active",
    }),
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status} ${url}`);
  }
  return response.json() as Promise<Record<string, unknown>[]>;
}

async function fetchRecentEaLogs(): Promise<EALogRecord[]> {
  const url = buildRestUrl("ea-log", {
    select: "id,created_at,at,sym,tf,action,trade_decision,win_prob,win_prob_raw,win_prob_calibrated,win_prob_final,calibration_applied,calibration_version,calibration_method,calibration_scope,calibration_sample_size,calibration_shift,h1_shadow_checked,h1_shadow_would_block,h1_shadow_reason,plan_base_min_win_prob,plan_gate_adjustment,plan_effective_min_win_prob,plan_gate_mode,decision_summary,skip_reason,entry_method,trade_plan_id,plan_alignment,event_risk,market_session,ai_reasoning,order_ticket",
    order: "at.desc",
    limit: "5",
  });
  return fetchJson<EALogRecord[]>(url);
}

async function fetchShadowTrades(): Promise<AISignalRecord[]> {
  const url = buildRestUrl("ai_signals", {
    select: "id,created_at,symbol,timeframe,dir,win_prob,win_prob_raw,win_prob_calibrated,win_prob_final,calibration_applied,calibration_version,calibration_method,calibration_scope,calibration_sample_size,calibration_shift,h1_shadow_checked,h1_shadow_would_block,h1_shadow_reason,plan_base_min_win_prob,plan_gate_adjustment,plan_effective_min_win_prob,plan_gate_mode,entry_price,exit_price,profit_loss,closed_at,actual_result,order_ticket,reason,decision_summary,entry_method,is_virtual,reverse_execution,is_manual_trade,trade_plan_id,plan_alignment,event_risk,market_session,shadow_reason,mfe_r,mae_r",
    is_virtual: "eq.true",
    reverse_execution: "eq.false",
    created_at: `gte.${toIsoDaysAgo(30)}`,
    order: "created_at.desc",
    limit: "2000",
  });
  return fetchJson<AISignalRecord[]>(url);
}

async function fetchH1AuditTrades(): Promise<AISignalRecord[]> {
  const url = buildRestUrl("ai_signals", {
    select: "id,created_at,symbol,timeframe,dir,win_prob,profit_loss,actual_result,h1_shadow_checked,h1_shadow_would_block,h1_shadow_reason,is_virtual",
    h1_shadow_checked: "eq.true",
    created_at: `gte.${toIsoDaysAgo(30)}`,
    order: "created_at.desc",
    limit: "2000",
  });
  return fetchJson<AISignalRecord[]>(url);
}

async function fetchRecentTrades(): Promise<AISignalRecord[]> {
  const url = buildRestUrl("ai_signals", {
    select: "id,created_at,symbol,timeframe,dir,win_prob,entry_price,exit_price,profit_loss,closed_at,actual_result,order_ticket,reason,decision_summary,entry_method,is_virtual,reverse_execution,is_manual_trade,trade_plan_id,plan_alignment,event_risk,market_session",
    is_virtual: "eq.false",
    or: "(is_manual_trade.is.null,is_manual_trade.eq.false)",
    reverse_execution: "eq.false",
    closed_at: "not.is.null",
    actual_result: "in.(WIN,LOSS,BREAK_EVEN)",
    order: "closed_at.desc",
    limit: "12",
  });
  return fetchJson<AISignalRecord[]>(url);
}

async function fetchOpenTrades(): Promise<AISignalRecord[]> {
  const url = buildRestUrl("ai_signals", {
    select: "id,created_at,symbol,timeframe,dir,win_prob,entry_price,exit_price,profit_loss,closed_at,actual_result,order_ticket,reason,decision_summary,entry_method,is_virtual,reverse_execution,is_manual_trade,trade_plan_id,plan_alignment,event_risk,market_session",
    is_virtual: "eq.false",
    or: "(is_manual_trade.is.null,is_manual_trade.eq.false)",
    actual_result: "eq.FILLED",
    closed_at: "is.null",
    order: "created_at.desc",
    limit: "8",
  });
  return fetchJson<AISignalRecord[]>(url);
}

async function fetchClosedTrades(period: string): Promise<AISignalRecord[]> {
  const params: Record<string, string> = {
    select: "id,created_at,symbol,timeframe,dir,win_prob,entry_price,exit_price,profit_loss,closed_at,actual_result,order_ticket,reason,decision_summary,entry_method,is_virtual,reverse_execution,is_manual_trade,trade_plan_id,plan_alignment,event_risk,market_session",
    is_virtual: "eq.false",
    or: "(is_manual_trade.is.null,is_manual_trade.eq.false)",
    reverse_execution: "eq.false",
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

  const [pairSelectorResult, recentEaLogsResult, recentTradesResult, openTradesResult, selectedTradesResult, totalTradesResult, shadowTradesResult, h1AuditResult] = await Promise.all([
    safeFetchWithError("pair-selector", fetchPairSelector, { latest: null, live_context: null }),
    safeFetchWithError("ea-log recent", fetchRecentEaLogs, []),
    safeFetchWithError("ai_signals recent", fetchRecentTrades, []),
    safeFetchWithError("ai_signals open", fetchOpenTrades, []),
    safeFetchWithError(`ai_signals period ${period}`, () => fetchClosedTrades(period), []),
    safeFetchWithError("ai_signals total", () => fetchClosedTrades("all"), []),
    safeFetchWithError("ai_signals shadow", fetchShadowTrades, []),
    safeFetchWithError("ai_signals H1 audit", fetchH1AuditTrades, []),
  ]);

  const pairSelector = pairSelectorResult.data;
  const recentEaLogs = recentEaLogsResult.data;
  const recentTrades = recentTradesResult.data;
  const openTrades = openTradesResult.data;
  const selectedTrades = selectedTradesResult.data;
  const totalTrades = totalTradesResult.data;
  const shadowTrades = shadowTradesResult.data;
  const h1AuditTrades = h1AuditResult.data;
  const dataErrors = [
    pairSelectorResult.error,
    recentEaLogsResult.error,
    recentTradesResult.error,
    openTradesResult.error,
    selectedTradesResult.error,
    totalTradesResult.error,
    shadowTradesResult.error,
    h1AuditResult.error,
  ].filter((value): value is string => Boolean(value));

  return {
    generatedAt: new Date().toISOString(),
    dataErrors,
    pairSelector,
    recentEaLogs,
    recentTrades: decorateTrades(recentTrades),
    openTrades: decorateTrades(openTrades),
    shadowAnalysis: summarizeShadowTrades(shadowTrades),
    opportunityAnalysis: summarizeOpportunityAnalysis(shadowTrades),
    h1Audit: summarizeH1Audit(h1AuditTrades),
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
