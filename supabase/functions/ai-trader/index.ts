import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY")!;
const OPENAI_MODEL = Deno.env.get("OPENAI_MODEL") || "gpt-4.1-mini"; // デフォルト: gpt-4.1-mini

type CalibrationMode = "off" | "on";

function isCalibrationRequired(): boolean {
  const raw = (Deno.env.get("AI_TRADER_CALIBRATION_REQUIRED") ?? "off").toLowerCase().trim();
  return raw === "on" || raw === "true" || raw === "1";
}

function getCalibrationMode(): CalibrationMode {
  const raw = (Deno.env.get("AI_TRADER_WINPROB_CALIBRATION") ?? "off").toLowerCase().trim();
  if (raw === "on" || raw === "true" || raw === "1") return "on";
  return "off";
}

function getCalibrationLookbackDays(): number {
  const v = Number(Deno.env.get("AI_TRADER_CALIBRATION_LOOKBACK_DAYS") ?? 90);
  if (!Number.isFinite(v) || v < 7) return 90;
  return Math.min(365, Math.floor(v));
}

function getCalibrationLimit(): number {
  const v = Number(Deno.env.get("AI_TRADER_CALIBRATION_LIMIT") ?? 200);
  if (!Number.isFinite(v) || v < 50) return 200;
  return Math.min(1000, Math.floor(v));
}

function getCalibrationMinN(): number {
  const v = Number(Deno.env.get("AI_TRADER_CALIBRATION_MIN_N") ?? 30);
  if (!Number.isFinite(v) || v < 10) return 30;
  return Math.min(300, Math.floor(v));
}

function getCalibrationMinBinN(): number {
  const v = Number(Deno.env.get("AI_TRADER_CALIBRATION_MIN_BIN_N") ?? 8);
  if (!Number.isFinite(v) || v < 3) return 8;
  return Math.min(50, Math.floor(v));
}

// When enabled, includes virtual trades in calibration data.
// Useful when virtual trading volume dominates and represents current market conditions.
function isCalibrationIncludeVirtual(): boolean {
  const raw = (Deno.env.get("AI_TRADER_CALIBRATION_INCLUDE_VIRTUAL") ?? "off").toLowerCase().trim();
  return raw === "on" || raw === "true" || raw === "1";
}

// Maximum absolute calibration shift (±). Prevents extreme corrections from polluted data.
// Default 0.20: allows up to ±0.20 adjustment (e.g. 0.65 → 0.45 at most).
function getCalibrationMaxShift(): number {
  const v = Number(Deno.env.get("AI_TRADER_CALIBRATION_MAX_SHIFT") ?? "0.20");
  if (!Number.isFinite(v) || v <= 0) return 0.20;
  return Math.min(0.50, v);
}

// Recent performance soft guard parameters
function getRecentPerfLookback(): number {
  const v = Number(Deno.env.get("AI_TRADER_RECENT_PERF_LOOKBACK") ?? 30);
  if (!Number.isFinite(v) || v < 5) return 30;
  return Math.min(100, Math.floor(v));
}

function getRecentPerfThreshold(): number {
  // Win_rate below this triggers a penalty.
  const v = Number(Deno.env.get("AI_TRADER_RECENT_PERF_THRESHOLD") ?? 0.40);
  if (!Number.isFinite(v)) return 0.40;
  return Math.max(0.20, Math.min(0.60, v));
}

function getRecentPerfPenalty(): number {
  // Max penalty applied to win_prob when recent win_rate is 0.
  const v = Number(Deno.env.get("AI_TRADER_RECENT_PERF_PENALTY") ?? 0.10);
  if (!Number.isFinite(v)) return 0.10;
  return Math.max(0.0, Math.min(0.30, v));
}

function getRecentPerfMinN(): number {
  const v = Number(Deno.env.get("AI_TRADER_RECENT_PERF_MIN_N") ?? 10);
  if (!Number.isFinite(v) || v < 3) return 10;
  return Math.min(50, Math.floor(v));
}

function includeVirtualInPerfGuards(): boolean {
  // Default off: avoid dragging real-trade win_prob by noisy virtual outcomes.
  const raw = (Deno.env.get("AI_TRADER_PERF_GUARDS_INCLUDE_VIRTUAL") ?? "off").toLowerCase().trim();
  return raw === "on" || raw === "true" || raw === "1";
}

type RecentPerfResult = {
  applied: boolean;
  winProb: number;
  guardTag: string;
};

async function applyRecentPerfGuard(
  req: TradeRequest,
  dir: number,
  winProb: number,
): Promise<RecentPerfResult> {
  const lookback = getRecentPerfLookback();
  const minN = getRecentPerfMinN();
  const threshold = getRecentPerfThreshold();
  const maxPenalty = getRecentPerfPenalty();

  if (maxPenalty <= 0) return { applied: false, winProb, guardTag: "" };

  let q = supabase
    .from("ai_signals")
    .select("actual_result")
    .eq("symbol", req.symbol)
    .eq("timeframe", req.timeframe)
    .eq("dir", dir)
    .eq("reverse_execution", false)
    .in("actual_result", ["WIN", "LOSS"])
    .order("created_at", { ascending: false })
    .limit(lookback);

  if (!includeVirtualInPerfGuards()) {
    q = q.eq("is_virtual", false);
  }

  const { data, error } = await q;
  if (error || !data || data.length < minN) {
    return { applied: false, winProb, guardTag: "" };
  }

  const wins = data.filter((r: any) => r.actual_result === "WIN").length;
  const recentWr = wins / data.length;

  if (recentWr >= threshold) {
    return { applied: false, winProb, guardTag: "" };
  }

  // Apply penalty proportional to how far below threshold we are.
  const shortfall = threshold - recentWr;
  const penalty = Math.min(maxPenalty, shortfall * maxPenalty / threshold);
  const penalized = clampWinProb(winProb - penalty);

  const guardTag =
    `RECENT_PERF(penalized ${round3(winProb)}→${round3(penalized)}` +
    ` recentWr=${round3(recentWr)} n=${data.length} threshold=${round3(threshold)})`;

  return { applied: true, winProb: penalized, guardTag };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Consecutive Loss Streak Guard (v2.7.0)
// RECENT_PERF measures aggregate win rate over N trades (can miss current losing streaks).
// STREAK_GUARD fires immediately when the most-recent K trades are all LOSS.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function getStreakLookback(): number {
  const v = Number(Deno.env.get("AI_TRADER_STREAK_LOOKBACK") ?? 10);
  if (!Number.isFinite(v) || v < 3) return 10;
  return Math.min(20, Math.floor(v));
}

function getStreakMaxConsecutive(): number {
  // Trigger penalty when consecutive LOSS count >= this value.
  const v = Number(Deno.env.get("AI_TRADER_STREAK_MAX_CONSECUTIVE") ?? 3);
  if (!Number.isFinite(v) || v < 2) return 3;
  return Math.min(10, Math.floor(v));
}

function getStreakPenalty(): number {
  // Max penalty applied when all lookback trades are LOSS.
  const v = Number(Deno.env.get("AI_TRADER_STREAK_PENALTY") ?? 0.10);
  if (!Number.isFinite(v)) return 0.10;
  return Math.max(0.0, Math.min(0.30, Math.round(v * 1000) / 1000));
}

type StreakGuardResult = {
  applied: boolean;
  streak: number;
  winProb: number;
  guardTag: string;
};

async function applyStreakGuard(
  req: TradeRequest,
  dir: number,
  winProb: number,
): Promise<StreakGuardResult> {
  const lookback = getStreakLookback();
  const maxConsecutive = getStreakMaxConsecutive();
  const maxPenalty = getStreakPenalty();

  if (maxPenalty <= 0 || maxConsecutive <= 0) {
    return { applied: false, streak: 0, winProb, guardTag: "" };
  }

  let q = supabase
    .from("ai_signals")
    .select("actual_result")
    .eq("symbol", req.symbol)
    .eq("timeframe", req.timeframe)
    .eq("dir", dir)
    .eq("reverse_execution", false)
    .in("actual_result", ["WIN", "LOSS"])
    .order("created_at", { ascending: false })
    .limit(lookback);

  if (!includeVirtualInPerfGuards()) {
    q = q.eq("is_virtual", false);
  }

  const { data, error } = await q;

  if (error || !data || data.length < maxConsecutive) {
    return { applied: false, streak: 0, winProb, guardTag: "" };
  }

  // Count consecutive LOSS from the most-recent end.
  let streak = 0;
  for (const row of data) {
    if ((row as any).actual_result === "LOSS") {
      streak++;
    } else {
      break;
    }
  }

  if (streak < maxConsecutive) {
    return { applied: false, streak, winProb, guardTag: "" };
  }

  // Scale penalty proportional to streak length, amplified when streak exceeds trigger.
  const ratio = streak / lookback;
  const amplifier = Math.min(2.0, 1 + (streak - maxConsecutive) / maxConsecutive);
  const penalty = Math.min(maxPenalty, ratio * maxPenalty * amplifier);
  const penalized = clampWinProb(winProb - penalty);

  const guardTag =
    `STREAK_GUARD(penalized ${round3(winProb)}→${round3(penalized)}` +
    ` streak=${streak} lookback=${data.length} maxConsec=${maxConsecutive})`;

  return { applied: true, streak, winProb: penalized, guardTag };
}

function clampWinProb(v: number): number {
  // Policy in this project: win_prob is within [0.00, 1.00]
  const minProb = 0.0;
  const maxProb = 1.0;
  return Math.max(minProb, Math.min(maxProb, v));
}

type CalibrationScope = "symbol_tf_dir" | "symbol_tf" | "symbol" | "timeframe" | "global";
type CalibrationDebug = {
  applied: boolean;
  version?: "v2";
  source?: "raw" | "mixed_legacy";
  scope?: CalibrationScope;
  n?: number;
  avg_p?: number;
  win_rate?: number;
  bin?: number;
  bin_n?: number;
  bin_win_rate?: number;
  method?: "bin_smoothed" | "hierarchical_shift";
  note?: string;
};

type CalibrationCacheEntry = {
  expiresAt: number;
  debug: CalibrationDebug;
  // Mapping for 0.05 bins.
  binWinRate: Record<string, { n: number; winRate: number }>;
  avgP: number;
  winRate: number;
  source: "raw" | "mixed_legacy";
};

const calibrationCache = new Map<string, CalibrationCacheEntry>();

function binKey05(p: number): string {
  const b = Math.floor(Math.max(0, Math.min(0.899999, p)) / 0.05) * 0.05;
  return b.toFixed(2);
}

function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}

async function fetchCalibrationRows(
  scope: CalibrationScope,
  req: TradeRequest,
): Promise<Array<{ win_prob: number; actual_result: string; source: "raw" | "legacy" }>> {
  const lookbackDays = getCalibrationLookbackDays();
  const limit = getCalibrationLimit();
  const since = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000).toISOString();

  const includeVirtual = isCalibrationIncludeVirtual();

  let q = supabase
    .from("ai_signals")
    .select("win_prob_raw,win_prob,actual_result")
    .gte("created_at", since)
    .eq("reverse_execution", false)
    .in("actual_result", ["WIN", "LOSS"])
    .order("created_at", { ascending: false })
    .limit(limit);

  // By default use only real trades for calibration to avoid virtual-mode bias.
  // Set AI_TRADER_CALIBRATION_INCLUDE_VIRTUAL=on when virtual trades dominate.
  if (!includeVirtual) {
    q = q.eq("is_virtual", false);
  }

  if (scope === "symbol_tf_dir") {
    q = q.eq("symbol", req.symbol).eq("timeframe", req.timeframe).eq("dir", req.ea_suggestion.dir);
  } else if (scope === "symbol_tf") {
    q = q.eq("symbol", req.symbol).eq("timeframe", req.timeframe);
  } else if (scope === "symbol") {
    q = q.eq("symbol", req.symbol);
  } else if (scope === "timeframe") {
    q = q.eq("timeframe", req.timeframe);
  }

  const { data, error } = await q;
  if (error) {
    console.warn(`[calibration] fetch error scope=${scope}: ${error.message}`);
    return [];
  }

  const rows = (data ?? []) as Array<{ win_prob_raw: number | null; win_prob: number; actual_result: string }>;
  return rows
    .map((r) => ({
      win_prob: typeof r.win_prob_raw === "number" && Number.isFinite(r.win_prob_raw) ? r.win_prob_raw : r.win_prob,
      actual_result: String(r.actual_result || ""),
      source: typeof r.win_prob_raw === "number" && Number.isFinite(r.win_prob_raw) ? "raw" as const : "legacy" as const,
    }))
    .filter((r) => typeof r.win_prob === "number" && Number.isFinite(r.win_prob))
    .map((r) => ({ ...r, win_prob: clampWinProb(r.win_prob) }));
}

function buildCalibrationCacheEntry(
  rows: Array<{ win_prob: number; actual_result: string; source: "raw" | "legacy" }>,
  scope: CalibrationScope,
  source: "raw" | "mixed_legacy",
): CalibrationCacheEntry | null {
  if (!rows || rows.length === 0) return null;

  let n = 0;
  let sumP = 0;
  let wins = 0;

  const bins: Record<string, { n: number; wins: number }> = {};

  for (const r of rows) {
    const p = r.win_prob;
    const y = r.actual_result === "WIN" ? 1 : r.actual_result === "LOSS" ? 0 : null;
    if (y === null) continue;
    n += 1;
    sumP += p;
    wins += y;

    const bk = binKey05(p);
    const b = (bins[bk] = bins[bk] ?? { n: 0, wins: 0 });
    b.n += 1;
    b.wins += y;
  }

  if (n === 0) return null;
  const avgP = sumP / n;
  const winRate = wins / n;

  // Laplace smoothing to avoid 0/1 extremes when n is small.
  const binWinRate: Record<string, { n: number; winRate: number }> = {};
  for (const [k, b] of Object.entries(bins)) {
    const alpha = 1;
    binWinRate[k] = { n: b.n, winRate: (b.wins + alpha) / (b.n + 2 * alpha) };
  }

  return {
    expiresAt: Date.now() + 5 * 60 * 1000, // 5 min TTL
    debug: { applied: true, version: "v2", source, scope, n, avg_p: avgP, win_rate: winRate },
    binWinRate,
    avgP,
    winRate,
    source,
  };
}

async function getCalibrationEntry(req: TradeRequest): Promise<{ entry: CalibrationCacheEntry | null; scopeTried: CalibrationScope | null }> {
  const mode = getCalibrationMode();
  if (mode !== "on") return { entry: null, scopeTried: null };

  const scopes: CalibrationScope[] = ["symbol_tf_dir", "symbol_tf", "symbol", "timeframe", "global"];
  const minN = getCalibrationMinN();

  for (const scope of scopes) {
    const key = `v2|${scope}|${req.symbol}|${req.timeframe}|${req.ea_suggestion.dir}`;
    const cached = calibrationCache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      if ((cached.debug.n ?? 0) >= minN) return { entry: cached, scopeTried: scope };
    }

    const rows = await fetchCalibrationRows(scope, req);
    const rawRows = rows.filter((row) => row.source === "raw");
    const useRawOnly = rawRows.length >= minN;
    const built = buildCalibrationCacheEntry(useRawOnly ? rawRows : rows, scope, useRawOnly ? "raw" : "mixed_legacy");
    if (built) calibrationCache.set(key, built);
    if (built && (built.debug.n ?? 0) >= minN) return { entry: built, scopeTried: scope };
  }

  return { entry: null, scopeTried: null };
}

async function calibrateWinProb(req: TradeRequest, rawWinProb: number): Promise<{ winProb: number; debug: CalibrationDebug }> {
  const mode = getCalibrationMode();
  const raw = clampWinProb(rawWinProb);
  if (mode !== "on") return { winProb: raw, debug: { applied: false, note: "calibration_off" } };

  const { entry, scopeTried } = await getCalibrationEntry(req);
  if (!entry || !scopeTried) return { winProb: raw, debug: { applied: false, note: "insufficient_history" } };

  const bk = binKey05(raw);
  const bin = entry.binWinRate[bk];
  const minBinN = getCalibrationMinBinN();

  let calibrated: number;
  let method: "bin_smoothed" | "hierarchical_shift";
  let bin_n = bin?.n ?? 0;
  let bin_wr = bin?.winRate;

  // Legacy rows contain the old final probability, not a true raw prediction.
  // Keep their bootstrap influence small until enough clean v2 outcomes exist.
  const maxShift = Math.min(getCalibrationMaxShift(), entry.source === "raw" ? 0.10 : 0.05);

  if (bin && bin.n >= minBinN) {
    // Blend raw with empirical bin win rate. Weight grows with bin sample size.
    const w = Math.min(0.8, bin.n / (bin.n + 20));
    const blended = raw * (1 - w) + bin.winRate * w;
    // Cap the total shift to prevent extreme corrections from noisy data.
    calibrated = raw + Math.max(-maxShift, Math.min(maxShift, blended - raw));
    method = "bin_smoothed";
  } else {
    // Hierarchical shrinkage: sparse scopes stay close to the original model.
    const supportWeight = entry.debug.n! / (entry.debug.n! + 100);
    const shift = (entry.winRate - entry.avgP) * supportWeight;
    calibrated = raw + Math.max(-maxShift, Math.min(maxShift, shift));
    method = "hierarchical_shift";
  }

  calibrated = clampWinProb(calibrated);

  const debug: CalibrationDebug = {
    applied: true,
    version: "v2",
    source: entry.source,
    scope: scopeTried,
    n: entry.debug.n,
    avg_p: entry.avgP,
    win_rate: entry.winRate,
    bin: Number(bk),
    bin_n,
    bin_win_rate: bin_wr,
    method,
  };
  return { winProb: calibrated, debug };
}

type MlMode = "off" | "log_only" | "on";

function getMlMode(): MlMode {
  const raw = (Deno.env.get("AI_TRADER_ML_MODE") ?? "log_only").toLowerCase().trim();
  if (raw === "on" || raw === "true" || raw === "1") return "on";
  if (raw === "off" || raw === "false" || raw === "0") return "off";
  return "log_only";
}

function isEmergencyStopEnabled(): boolean {
  const raw = (Deno.env.get("AI_TRADER_EMERGENCY_STOP") ?? "off").toLowerCase().trim();
  return raw === "on" || raw === "true" || raw === "1" || raw === "enabled";
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

type HigherTimeframeSnapshot = {
  timeframe?: string;
  trend_dir?: number;
  ema_slope_atr?: number;
  price_vs_ema25_atr?: number;
  adx?: number;
  di_plus?: number;
  di_minus?: number;
  rsi?: number;
  atr_norm?: number;
  price_vs_cloud?: number;
};

type DailyPlanSymbol = {
  symbol: string;
  allowed_direction?: "buy" | "sell" | "both" | "none";
  strategy?: string;
  session_windows?: Array<{ label?: string; start_utc?: string; end_utc?: string }>;
  avoid_event_windows?: Array<{ label?: string; start_at?: string; end_at?: string; impact?: string; reason?: string }>;
  min_win_prob?: number;
  max_cost_r?: number;
  confidence?: string;
  score?: number;
  reason?: string;
  setup_focus?: string[];
};

type DailyPlanContext = {
  report_id: number | null;
  generated_at?: string | null;
  plan_status: "active" | "paused" | "unknown";
  summary?: string | null;
  risk_level?: "low" | "medium" | "high";
  market_themes?: string[];
  item?: DailyPlanSymbol | null;
  plan_overrides?: Record<string, unknown>;
};

export interface TradeRequest {
  symbol: string;
  timeframe: string;

  // EA側の実行閾値（例: 0.60）。サーバの action 判定がこれより厳しくならないようにする。
  min_win_prob?: number;
  
  // 価格情報
  price: number;
  bid: number;
  ask: number;
  
  // 移動平均線
  ema_25: number;
  sma_100: number;
  sma_200: number;
  sma_800: number;
  ma_cross: number;  // 1=golden cross, -1=dead cross
  
  // モメンタム指標
  rsi: number;
  atr: number;

  // レジーム判定用（任意: EA側が送信する場合のみ）
  atr_norm?: number; // ATR/price
  adx?: number; // ADX main
  di_plus?: number; // +DI
  di_minus?: number; // -DI
  bb_width?: number; // (Upper-Lower)/Middle
  
  // MACD
  macd: {
    main: number;
    signal: number;
    histogram: number;
    cross: number;  // 1=bullish, -1=bearish
  };
  
  // 一目均衡表
  ichimoku: {
    tenkan: number;
    kijun: number;
    senkou_a: number;
    senkou_b: number;
    chikou: number;
    tk_cross: number;       // 転換線 vs 基準線
    cloud_color: number;    // 雲の色
    price_vs_cloud: number; // 価格 vs 雲の位置
  };

  // ローソク足パターン（任意）
  candle_features?: {
    bull_engulfing?: number;
    bear_engulfing?: number;
    bull_pinbar?: number;
    bear_pinbar?: number;
    inside_bar?: number;
    inside_break_dir?: number;
    three_up?: number;
    three_down?: number;
    bull_reversal_score?: number;
    bear_reversal_score?: number;
    bull_continuation_score?: number;
    bear_continuation_score?: number;
  };

  // 生OHLC（確定足、古い→新しい順）
  candle_bars?: Array<{
    t?: string;
    o: number;
    h: number;
    l: number;
    c: number;
    tv?: number;
    rv?: number;
    body?: number;
    range?: number;
  }>;

  // Execution context supplied by the EA.
  market_session?: string;
  utc_hour?: number;
  day_of_week?: number;
  higher_timeframes?: Record<string, HigherTimeframeSnapshot>;
  level_distances?: Record<string, number | string | null>;
  chart_structure?: Record<string, number | string | null>;
  volatility_context?: Record<string, number | string | null>;
  cost_context?: Record<string, number | string | null>;
  
  // EA側の判断（参考情報として）
  ea_suggestion: {
    dir: number;
    // EAが推奨する方向（AIが方向を決めるモードでは dir=0 を送る想定）
    tech_dir?: number;
    reason: string;
    ichimoku_score: number;
  };
  
  instance?: string;
  version?: string;
}

export interface TradeResponse {
  win_prob: number;
  win_prob_raw?: number;
  win_prob_calibrated?: number;
  win_prob_final?: number;
  calibration_applied?: boolean;
  calibration_version?: string | null;
  calibration_method?: string | null;
  calibration_scope?: string | null;
  calibration_sample_size?: number | null;
  calibration_bin_sample_size?: number | null;
  calibration_shift?: number;
  probability_adjustments?: Record<string, number | string | boolean | null>;
  action: number;
  decision_summary?: string;
  // action=0 の場合でも「AIがより良いと見た方向」を返す（検証/学習用）
  suggested_dir?: number;
  // dir=0（両方向評価）のとき、EAが簡単に表示/保存できるように top-level で返す
  buy_win_prob?: number;
  sell_win_prob?: number;
  buy_action?: number;
  sell_action?: number;
  offset_factor: number;
  expiry_minutes: number;
  confidence?: string;
  reasoning?: string;
  // Dynamic gating / EV
  recommended_min_win_prob?: number; // 0.60 - 0.75 (never higher to avoid reducing opportunities)
  expected_value_r?: number; // EV in R-multiples (loss=-1R, win=+1.5R)
  reward_rr?: number;
  risk_atr_mult?: number;
  // Cost diagnostics
  cost_r?: number;
  cost_r_source?: "real" | "assumed";
  skip_reason?: string;
  // Execution is market-only
  entry_method?: "market";
  entry_params?: null;
  method_selected_by?: "OpenAI" | "Fallback" | "Manual";
  method_reason?: string;
  // ML pattern tracking
  ml_pattern_used?: boolean;
  ml_pattern_id?: number | null;
  ml_pattern_name?: string | null;
  ml_pattern_confidence?: number | null;

  // Market regime / strategy classification (for debugging & post-analysis)
  regime?: "trend" | "range" | "uncertain";
  strategy?: "trend_follow" | "mean_revert" | "none";
  regime_confidence?: "high" | "medium" | "low";

  // Optional debug payload for dual-direction evaluation
  direction_eval?: {
    selected_dir: number;
    buy?: { win_prob: number; action: number; expected_value_r?: number; entry_method?: string; skip_reason?: string };
    sell?: { win_prob: number; action: number; expected_value_r?: number; entry_method?: string; skip_reason?: string };
  };

  // Daily trade plan diagnostics
  trade_plan_id?: number | null;
  plan_alignment?: string | null;
  event_risk?: string | null;
  plan_base_min_win_prob?: number | null;
  plan_gate_adjustment?: number;
  plan_effective_min_win_prob?: number | null;
  plan_gate_mode?: "ai" | "cautious" | "very_cautious";
  daily_plan?: DailyPlanContext | null;
}

function classifyMarketRegime(req: TradeRequest): Pick<TradeResponse, "regime" | "strategy" | "regime_confidence"> {
  // Use optional fields when present; default safely.
  const adx = typeof req.adx === "number" && Number.isFinite(req.adx) ? req.adx : null;
  const bb = typeof req.bb_width === "number" && Number.isFinite(req.bb_width) ? req.bb_width : null;
  const atrNorm = typeof req.atr_norm === "number" && Number.isFinite(req.atr_norm) ? req.atr_norm : null;

  // Thresholds are intentionally conservative.
  // - ADX: trend strength (20-25+ is typically trending)
  // - bb_width / atr_norm: volatility expansion (breakouts) vs squeeze (range)
  const adxTrend = adx !== null && adx >= 22;
  const adxRange = adx !== null && adx <= 18;

  const volTrend = (bb !== null && bb >= 0.030) || (atrNorm !== null && atrNorm >= 0.0020);
  const volRange = (bb !== null && bb <= 0.015) || (atrNorm !== null && atrNorm <= 0.0012);

  // Strong trend: ADX high AND volatility not squeezed.
  if (adxTrend && volTrend) {
    return { regime: "trend", strategy: "trend_follow", regime_confidence: "high" };
  }

  // Range: ADX low AND volatility squeezed.
  if (adxRange && volRange) {
    return { regime: "range", strategy: "mean_revert", regime_confidence: "high" };
  }

  // Mixed signals.
  if ((adxTrend && !volRange) || (volTrend && !adxRange)) {
    return { regime: "trend", strategy: "trend_follow", regime_confidence: "medium" };
  }
  if ((adxRange && !volTrend) || (volRange && !adxTrend)) {
    return { regime: "range", strategy: "mean_revert", regime_confidence: "medium" };
  }

  return { regime: "uncertain", strategy: "none", regime_confidence: "low" };
}

function buildRegimePrefix(
  regime?: TradeResponse["regime"],
  strategy?: TradeResponse["strategy"],
  conf?: TradeResponse["regime_confidence"],
): string {
  const r = typeof regime === "string" ? regime.trim() : "";
  const s = typeof strategy === "string" ? strategy.trim() : "";
  const c = typeof conf === "string" ? conf.trim() : "";
  if (!r && !s && !c) return "";
  const parts: string[] = [];
  if (r) parts.push(`regime=${r}`);
  if (s) parts.push(`strategy=${s}`);
  if (c) parts.push(`conf=${c}`);
  return `[${parts.join(" ")}]`;
}

function attachRegimePrefixToReasoning(
  reasoning: unknown,
  regime?: TradeResponse["regime"],
  strategy?: TradeResponse["strategy"],
  conf?: TradeResponse["regime_confidence"],
): string | undefined {
  const prefix = buildRegimePrefix(regime, strategy, conf);
  const text = typeof reasoning === "string" ? reasoning.trim() : "";
  if (!prefix) return text || undefined;

  // Avoid duplicating if the model already included regime info.
  if (/\bregime\s*=\s*/i.test(text) || text.startsWith(prefix)) return text || prefix;
  return text ? `${prefix} ${text}` : prefix;
}

function buildDecisionSummary(opts: {
  willExecute: boolean;
  dir: number;
  winProb: number;
  effectiveGate: number;
  expectedValueR: number;
  minEvR: number;
  costR: number;
  maxCostR: number;
  calibrationRequired: boolean;
  calibrationApplied: boolean;
  skipReason?: string;
}): string {
  const dirLabel = opts.dir === 1 ? "BUY" : opts.dir === -1 ? "SELL" : "HOLD";
  const status = opts.willExecute ? "実行" : "見送り";
  const calLabel = opts.calibrationApplied ? "ok" : (opts.calibrationRequired ? "required_not_applied" : "off");
  const parts = [
    `${status} ${dirLabel}`,
    `p=${round3(opts.winProb)}`,
    `gate=${round3(opts.effectiveGate)}`,
    `ev=${round3(opts.expectedValueR)}R`,
    `minEv=${round3(opts.minEvR)}R`,
    `cost=${round3(opts.costR)}/${round3(opts.maxCostR)}`,
    `cal=${calLabel}`,
  ];
  if (!opts.willExecute && opts.skipReason) parts.push(`skip=${opts.skipReason}`);
  return parts.join(" | ");
}

function appendReasonText(current: unknown, addition: string): string {
  const base = typeof current === "string" ? current.trim() : "";
  return base ? `${base} | ${addition}` : addition;
}

function appendSkip(current: unknown, addition: string): string {
  const base = typeof current === "string" ? current.trim() : "";
  if (!base) return addition;
  return base.split(/[|+]/).includes(addition) ? base : `${base}|${addition}`;
}

function directionToPlanLabel(dir: number): "buy" | "sell" | "none" {
  if (dir > 0) return "buy";
  if (dir < 0) return "sell";
  return "none";
}

function minutesFromTime(value: string | undefined): number | null {
  if (!value) return null;
  const match = value.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (!Number.isFinite(h) || !Number.isFinite(m) || h < 0 || h > 23 || m < 0 || m > 59) return null;
  return h * 60 + m;
}

function isNowInSessionWindow(window: NonNullable<DailyPlanSymbol["session_windows"]>[number], utcHour?: number): boolean {
  const start = minutesFromTime(window.start_utc);
  const end = minutesFromTime(window.end_utc);
  if (start === null || end === null) return true;
  const now = (typeof utcHour === "number" ? utcHour : new Date().getUTCHours()) * 60 + new Date().getUTCMinutes();
  if (start <= end) return now >= start && now <= end;
  return now >= start || now <= end;
}

function activeEventWindow(item: DailyPlanSymbol | null | undefined): NonNullable<DailyPlanSymbol["avoid_event_windows"]>[number] | null {
  const windows = item?.avoid_event_windows ?? [];
  const now = Date.now();
  for (const window of windows) {
    const start = Date.parse(String(window.start_at ?? ""));
    const end = Date.parse(String(window.end_at ?? ""));
    if (Number.isFinite(start) && Number.isFinite(end) && now >= start && now <= end) {
      return window;
    }
  }
  return null;
}

function normalizeGateAdjustment(value: unknown): 0 | 0.05 | 0.10 {
  const numeric = typeof value === "number" ? value : Number(value);
  if (Math.abs(numeric - 0.10) < 0.0001) return 0.10;
  if (Math.abs(numeric - 0.05) < 0.0001) return 0.05;
  return 0;
}

function resolvePlanGateAdjustment(plan: DailyPlanContext, symbol: string): {
  adjustment: 0 | 0.05 | 0.10;
  mode: "ai" | "cautious" | "very_cautious";
} {
  const overrides = plan.plan_overrides ?? {};
  const bySymbol = overrides.symbol_gate_adjustments;
  const symbolKey = symbol.toUpperCase();
  const symbolValue = bySymbol && typeof bySymbol === "object"
    ? (bySymbol as Record<string, unknown>)[symbolKey]
    : undefined;
  const adjustment = normalizeGateAdjustment(symbolValue ?? overrides.gate_adjustment);
  const mode = adjustment === 0.10 ? "very_cautious" : adjustment === 0.05 ? "cautious" : "ai";
  return { adjustment, mode };
}

function htfOpposesDirection(req: TradeRequest, dir: number): boolean {
  if (!req.higher_timeframes || dir === 0) return false;
  const checks = ["h1", "h4", "d1", "H1", "H4", "D1"]
    .map((key) => req.higher_timeframes?.[key])
    .filter((v): v is HigherTimeframeSnapshot => Boolean(v));
  if (checks.length === 0) return false;
  const opposing = checks.filter((snapshot) => typeof snapshot.trend_dir === "number" && snapshot.trend_dir === -dir);
  return opposing.length >= Math.min(2, checks.length);
}

async function fetchDailyPlanContext(req: TradeRequest): Promise<DailyPlanContext | null> {
  let primary: any = await supabase
    .from("pair_selection_reports")
    .select("id, generated_at, timeframe, selected_pairs, summary, trade_plan, plan_overrides, plan_status")
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(5);

  if (primary.error && /trade_plan|plan_status|plan_overrides|column/i.test(String(primary.error.message ?? ""))) {
    primary = await supabase
      .from("pair_selection_reports")
      .select("id, generated_at, timeframe, selected_pairs, summary")
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(5);
  }

  if (primary.error || !primary.data || primary.data.length === 0) return null;

  const report = (primary.data.find((row: any) => row?.timeframe === req.timeframe) ?? primary.data[0]) as any;
  const plan = report?.trade_plan && typeof report.trade_plan === "object" ? report.trade_plan : null;
  const selectedPairs = Array.isArray(report?.selected_pairs) ? report.selected_pairs : [];
  const planSymbols = Array.isArray(plan?.symbols) ? plan.symbols : [];
  const item = [...planSymbols, ...selectedPairs].find((row: any) => {
    return typeof row?.symbol === "string" && row.symbol.toUpperCase() === req.symbol.toUpperCase();
  }) ?? null;
  const overrides = report?.plan_overrides && typeof report.plan_overrides === "object" ? report.plan_overrides : {};
  const overrideStatus = typeof (overrides as any).status === "string" ? String((overrides as any).status) : "";
  const planStatus = overrideStatus === "paused" || report?.plan_status === "paused" ? "paused" : "active";

  return {
    report_id: typeof report?.id === "number" ? report.id : Number(report?.id ?? null) || null,
    generated_at: typeof report?.generated_at === "string" ? report.generated_at : null,
    plan_status: planStatus,
    summary: typeof plan?.summary === "string" ? plan.summary : (typeof report?.summary === "string" ? report.summary : null),
    risk_level: plan?.risk_level === "low" || plan?.risk_level === "medium" || plan?.risk_level === "high" ? plan.risk_level : undefined,
    market_themes: Array.isArray(plan?.market_themes) ? plan.market_themes.filter((v: unknown) => typeof v === "string").slice(0, 5) : [],
    item: item as DailyPlanSymbol | null,
    plan_overrides: overrides as Record<string, unknown>,
  };
}

function buildDailyPlanPrompt(plan: DailyPlanContext | null, req: TradeRequest): string {
  const htf = req.higher_timeframes ? JSON.stringify(req.higher_timeframes) : "N/A";
  const levels = req.level_distances ? JSON.stringify(req.level_distances) : "N/A";
  const chart = req.chart_structure ? JSON.stringify(req.chart_structure) : "N/A";
  const vol = req.volatility_context ? JSON.stringify(req.volatility_context) : "N/A";
  const cost = req.cost_context ? JSON.stringify(req.cost_context) : "N/A";
  if (!plan) {
    return `\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n🧭 日次トレード計画\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n最新の日次計画は取得できませんでした。EAの上位足/セッション/構造情報を通常の判断補助として使ってください。\n• session=${req.market_session ?? "unknown"} utc_hour=${req.utc_hour ?? "unknown"} day=${req.day_of_week ?? "unknown"}\n• higher_timeframes=${htf}\n• level_distances=${levels}\n• chart_structure=${chart}\n• volatility_context=${vol}\n• cost_context=${cost}`;
  }
  return `\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n🧭 日次トレード計画\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n• report_id=${plan.report_id ?? "N/A"} status=${plan.plan_status} risk=${plan.risk_level ?? "unknown"}\n• summary=${plan.summary ?? "N/A"}\n• themes=${(plan.market_themes ?? []).join(" / ") || "N/A"}\n• symbol_plan=${JSON.stringify(plan.item ?? null)}\n• session=${req.market_session ?? "unknown"} utc_hour=${req.utc_hour ?? "unknown"} day=${req.day_of_week ?? "unknown"}\n• higher_timeframes=${htf}\n• level_distances=${levels}\n• chart_structure=${chart}\n• volatility_context=${vol}\n• cost_context=${cost}\n\nこの日次計画に反する方向・時間帯・イベント直前直後・上位足逆行・節目直前・異常コストのエントリーは、勝率を保守的に見積もってください。`;
}

function contextNumber(source: Record<string, number | string | null> | undefined, key: string): number | null {
  const value = source?.[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function applyChartQualityGuard(tradeReq: TradeRequest, response: TradeResponse): TradeResponse {
  const actionDir = typeof response.action === "number" ? response.action : 0;
  if (actionDir === 0) return response;

  const chart = tradeReq.chart_structure;
  const vol = tradeReq.volatility_context;
  const cost = tradeReq.cost_context;
  const reasons: string[] = [];
  let alignment = response.plan_alignment ?? "chart_aligned";

  const swingDir = contextNumber(chart, "swing_dir");
  const lastBreakDir = contextNumber(chart, "last_break_dir");
  const resistanceDist = contextNumber(chart, "nearest_resistance_dist_atr");
  const supportDist = contextNumber(chart, "nearest_support_dist_atr");
  const rangePosition = contextNumber(chart, "range_position");
  const atrPercentile = contextNumber(vol, "atr_percentile_100");
  const rangeExpansion = contextNumber(vol, "range_expansion_20");
  const spreadAtr = contextNumber(cost, "spread_atr");
  const tickVolumeRatio = contextNumber(cost, "tick_volume_ratio_20");

  if (swingDir !== null && lastBreakDir !== null && swingDir === -actionDir && lastBreakDir === -actionDir) {
    reasons.push("chart_structure_opposes_entry");
    alignment = "structure_conflict";
  }

  if (actionDir > 0 && resistanceDist !== null && resistanceDist >= 0 && resistanceDist < 0.25 && lastBreakDir !== 1) {
    reasons.push("near_resistance_without_break");
    alignment = "level_conflict";
  }
  if (actionDir < 0 && supportDist !== null && supportDist >= 0 && supportDist < 0.25 && lastBreakDir !== -1) {
    reasons.push("near_support_without_break");
    alignment = "level_conflict";
  }

  if (actionDir > 0 && rangePosition !== null && rangePosition > 0.92 && lastBreakDir !== 1) {
    reasons.push("long_at_range_extreme");
    alignment = "level_conflict";
  }
  if (actionDir < 0 && rangePosition !== null && rangePosition < 0.08 && lastBreakDir !== -1) {
    reasons.push("short_at_range_extreme");
    alignment = "level_conflict";
  }

  if (atrPercentile !== null && atrPercentile < 0.12 && rangeExpansion !== null && rangeExpansion < 0.65) {
    reasons.push("volatility_too_compressed");
  }
  if (spreadAtr !== null && spreadAtr > 0.12) {
    reasons.push("spread_atr_too_high");
  }
  if (lastBreakDir === actionDir && tickVolumeRatio !== null && tickVolumeRatio < 0.55) {
    reasons.push("breakout_without_volume");
  }

  if (reasons.length === 0) {
    return {
      ...response,
      plan_alignment: response.plan_alignment ?? alignment,
    };
  }

  const guardNote = `CHART_GUARD: ${reasons.join("; ")}`;
  return {
    ...response,
    action: 0,
    entry_method: "market",
    entry_params: null,
    plan_alignment: alignment,
    skip_reason: appendSkip(response.skip_reason, reasons[0]),
    decision_summary: appendReasonText(response.decision_summary, `chart_block=${reasons.join("+")}`),
    reasoning: appendReasonText(response.reasoning, guardNote),
    method_reason: appendReasonText(response.method_reason, guardNote),
  };
}

async function applyDailyPlanGuard(tradeReq: TradeRequest, response: TradeResponse): Promise<TradeResponse> {
  const plan = await fetchDailyPlanContext(tradeReq);
  if (!plan) return response;

  const item = plan.item ?? null;
  const actionDir = typeof response.action === "number" ? response.action : 0;
  const reasons: string[] = [];
  let eventRisk = "none";
  let alignment = response.plan_alignment ?? (item ? "aligned" : "symbol_not_in_daily_plan");
  const gateOverride = resolvePlanGateAdjustment(plan, tradeReq.symbol);
  const planBaseGate = typeof item?.min_win_prob === "number" ? clampWinProb(item.min_win_prob) : null;
  const planEffectiveGate = planBaseGate === null
    ? null
    : clampWinProb(planBaseGate + gateOverride.adjustment);

  if (plan.plan_status === "paused") reasons.push("daily_plan_paused");
  if (!item) reasons.push("daily_plan_symbol_not_selected");

  const expiresAt = (item as any)?.expires_at ?? (plan as any)?.expires_at;
  if (typeof expiresAt === "string") {
    const expiresMs = Date.parse(expiresAt);
    if (Number.isFinite(expiresMs) && Date.now() > expiresMs) reasons.push("daily_plan_expired");
  }

  const eventWindow = activeEventWindow(item);
  if (eventWindow) {
    eventRisk = eventWindow.impact === "High" ? "high" : "medium";
    reasons.push("daily_plan_event_window");
  }

  if (item && actionDir !== 0) {
    const allowed = item.allowed_direction ?? "both";
    const actual = directionToPlanLabel(actionDir);
    if (allowed === "none" || (allowed !== "both" && actual !== allowed)) {
      reasons.push("daily_plan_direction_mismatch");
      alignment = "direction_mismatch";
    }

    const sessions = item.session_windows ?? [];
    if (sessions.length > 0 && !sessions.some((window) => isNowInSessionWindow(window, tradeReq.utc_hour))) {
      reasons.push("daily_plan_session_closed");
      alignment = "session_mismatch";
    }

    if (planEffectiveGate !== null && response.win_prob < planEffectiveGate) {
      reasons.push("daily_plan_winprob_below_plan");
      alignment = "plan_gate_miss";
    }

    const costR = typeof response.cost_r === "number" ? response.cost_r : null;
    if (typeof item.max_cost_r === "number" && costR !== null && costR > item.max_cost_r) {
      reasons.push("daily_plan_cost_too_high");
      alignment = "plan_gate_miss";
    }

    if (htfOpposesDirection(tradeReq, actionDir)) {
      reasons.push("daily_plan_htf_conflict");
      alignment = "htf_conflict";
    }
  }

  const planTag =
    `DAILY_PLAN(id=${plan.report_id ?? "na"} status=${plan.plan_status}` +
    ` align=${alignment} event=${eventRisk}` +
    `${item?.allowed_direction ? ` dir=${item.allowed_direction}` : ""}` +
    `${item?.strategy ? ` strategy=${item.strategy}` : ""}` +
    `${planEffectiveGate !== null ? ` gate=${round3(planBaseGate!)}+${round3(gateOverride.adjustment)}=>${round3(planEffectiveGate)}` : ""})`;

  const withDiagnostics = {
    ...response,
    trade_plan_id: plan.report_id,
    plan_alignment: alignment,
    event_risk: eventRisk,
    plan_base_min_win_prob: planBaseGate,
    plan_gate_adjustment: gateOverride.adjustment,
    plan_effective_min_win_prob: planEffectiveGate,
    plan_gate_mode: gateOverride.mode,
    daily_plan: plan,
    reasoning: appendReasonText(response.reasoning, planTag),
    method_reason: appendReasonText(response.method_reason, planTag),
    decision_summary: planEffectiveGate === null
      ? response.decision_summary
      : appendReasonText(response.decision_summary, `planGate=${round3(planBaseGate!)}+${round3(gateOverride.adjustment)}=>${round3(planEffectiveGate)}`),
  } as TradeResponse;

  if (actionDir === 0 || reasons.length === 0) return withDiagnostics;

  const guardNote = `GUARD: ${reasons.join("; ")}`;
  return {
    ...withDiagnostics,
    action: 0,
    entry_method: "market",
    entry_params: null,
    skip_reason: appendSkip(withDiagnostics.skip_reason, reasons[0]),
    decision_summary: appendReasonText(withDiagnostics.decision_summary, `plan_block=${reasons.join("+")}`),
    reasoning: appendReasonText(withDiagnostics.reasoning, guardNote),
    method_reason: appendReasonText(withDiagnostics.method_reason, guardNote),
  };
}

type InputSanityIssue = {
  field: string;
  problem: string;
  value?: unknown;
};

function normalizeTradeRequest(body: any): TradeRequest {
  const req = (body ?? {}) as TradeRequest;

  const isFiniteNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
  const isSide = (v: unknown): v is -1 | 0 | 1 => v === -1 || v === 0 || v === 1;
  const fallbackPrice = isFiniteNumber(req.price) && req.price > 0 ? req.price : 1;

  const macdRaw: any = req.macd ?? {};
  const macd = {
    main: isFiniteNumber(macdRaw.main) ? macdRaw.main : 0,
    signal: isFiniteNumber(macdRaw.signal) ? macdRaw.signal : 0,
    histogram: isFiniteNumber(macdRaw.histogram) ? macdRaw.histogram : 0,
    cross: isSide(macdRaw.cross) ? macdRaw.cross : 0,
  };

  const ichRaw: any = req.ichimoku ?? {};
  const ichimoku = {
    tenkan: isFiniteNumber(ichRaw.tenkan) && ichRaw.tenkan > 0 ? ichRaw.tenkan : fallbackPrice,
    kijun: isFiniteNumber(ichRaw.kijun) && ichRaw.kijun > 0 ? ichRaw.kijun : fallbackPrice,
    senkou_a: isFiniteNumber(ichRaw.senkou_a) && ichRaw.senkou_a > 0 ? ichRaw.senkou_a : fallbackPrice,
    senkou_b: isFiniteNumber(ichRaw.senkou_b) && ichRaw.senkou_b > 0 ? ichRaw.senkou_b : fallbackPrice,
    chikou: isFiniteNumber(ichRaw.chikou) && ichRaw.chikou > 0 ? ichRaw.chikou : fallbackPrice,
    tk_cross: isSide(ichRaw.tk_cross) ? ichRaw.tk_cross : 0,
    cloud_color: isSide(ichRaw.cloud_color) ? ichRaw.cloud_color : 0,
    price_vs_cloud: isSide(ichRaw.price_vs_cloud) ? ichRaw.price_vs_cloud : 0,
  };

  // Optional regime fields: drop invalid values instead of hard-failing.
  const atr_norm =
    isFiniteNumber(req.atr_norm) && req.atr_norm > 0 && req.atr_norm <= 0.2
      ? req.atr_norm
      : undefined;
  const adx =
    isFiniteNumber(req.adx) && req.adx >= 0 && req.adx <= 100
      ? req.adx
      : undefined;
  const di_plus = isFiniteNumber(req.di_plus) ? req.di_plus : undefined;
  const di_minus = isFiniteNumber(req.di_minus) ? req.di_minus : undefined;
  const bb_width =
    isFiniteNumber(req.bb_width) && req.bb_width > 0 && req.bb_width <= 0.5
      ? req.bb_width
      : undefined;

  const cfRaw: any = req.candle_features ?? {};
  const to01 = (v: unknown): number => {
    if (v === 1 || v === true) return 1;
    if (v === 0 || v === false) return 0;
    return 0;
  };
  const toSide = (v: unknown): number => (v === 1 || v === -1 ? Number(v) : 0);
  const toScore = (v: unknown): number => {
    if (typeof v !== "number" || !Number.isFinite(v)) return 0;
    if (v < 0) return 0;
    if (v > 10) return 10;
    return Math.round(v);
  };

  const candle_features = {
    bull_engulfing: to01(cfRaw.bull_engulfing),
    bear_engulfing: to01(cfRaw.bear_engulfing),
    bull_pinbar: to01(cfRaw.bull_pinbar),
    bear_pinbar: to01(cfRaw.bear_pinbar),
    inside_bar: to01(cfRaw.inside_bar),
    inside_break_dir: toSide(cfRaw.inside_break_dir),
    three_up: to01(cfRaw.three_up),
    three_down: to01(cfRaw.three_down),
    bull_reversal_score: toScore(cfRaw.bull_reversal_score),
    bear_reversal_score: toScore(cfRaw.bear_reversal_score),
    bull_continuation_score: toScore(cfRaw.bull_continuation_score),
    bear_continuation_score: toScore(cfRaw.bear_continuation_score),
  };

  const barsRaw = Array.isArray((req as any).candle_bars) ? (req as any).candle_bars : [];
  const candle_bars = barsRaw
    .slice(-32)
    .map((b: any) => {
      const o = typeof b?.o === "number" && Number.isFinite(b.o) ? b.o : NaN;
      const h = typeof b?.h === "number" && Number.isFinite(b.h) ? b.h : NaN;
      const l = typeof b?.l === "number" && Number.isFinite(b.l) ? b.l : NaN;
      const c = typeof b?.c === "number" && Number.isFinite(b.c) ? b.c : NaN;
      if (!Number.isFinite(o) || !Number.isFinite(h) || !Number.isFinite(l) || !Number.isFinite(c)) return null;
      if (o <= 0 || h <= 0 || l <= 0 || c <= 0 || h < l) return null;
      const tv = typeof b?.tv === "number" && Number.isFinite(b.tv) ? b.tv : undefined;
      const rv = typeof b?.rv === "number" && Number.isFinite(b.rv) ? b.rv : undefined;
      const body = typeof b?.body === "number" && Number.isFinite(b.body) ? b.body : Math.abs(c - o);
      const range = typeof b?.range === "number" && Number.isFinite(b.range) ? b.range : Math.abs(h - l);
      return {
        t: typeof b?.t === "string" ? b.t : undefined,
        o,
        h,
        l,
        c,
        tv,
        rv,
        body,
        range,
      };
    })
    .filter((v: any) => v !== null) as TradeRequest["candle_bars"];

  const session = typeof (req as any).market_session === "string"
    ? (req as any).market_session.trim().slice(0, 40)
    : undefined;
  const utc_hour = isFiniteNumber((req as any).utc_hour)
    ? Math.max(0, Math.min(23, Math.floor((req as any).utc_hour)))
    : undefined;
  const day_of_week = isFiniteNumber((req as any).day_of_week)
    ? Math.max(0, Math.min(6, Math.floor((req as any).day_of_week)))
    : undefined;

  const htfRaw = (req as any).higher_timeframes;
  const higher_timeframes: Record<string, HigherTimeframeSnapshot> | undefined =
    htfRaw && typeof htfRaw === "object" && !Array.isArray(htfRaw)
      ? Object.fromEntries(
          Object.entries(htfRaw)
            .slice(0, 6)
            .map(([key, value]) => {
              const v: any = value ?? {};
              return [key, {
                timeframe: typeof v.timeframe === "string" ? v.timeframe : key,
                trend_dir: isSide(v.trend_dir) ? Number(v.trend_dir) : undefined,
                ema_slope_atr: isFiniteNumber(v.ema_slope_atr) ? v.ema_slope_atr : undefined,
                price_vs_ema25_atr: isFiniteNumber(v.price_vs_ema25_atr) ? v.price_vs_ema25_atr : undefined,
                adx: isFiniteNumber(v.adx) ? v.adx : undefined,
                di_plus: isFiniteNumber(v.di_plus) ? v.di_plus : undefined,
                di_minus: isFiniteNumber(v.di_minus) ? v.di_minus : undefined,
                rsi: isFiniteNumber(v.rsi) ? v.rsi : undefined,
                atr_norm: isFiniteNumber(v.atr_norm) ? v.atr_norm : undefined,
                price_vs_cloud: isSide(v.price_vs_cloud) ? Number(v.price_vs_cloud) : undefined,
              }];
            }),
        )
      : undefined;

  const distRaw = (req as any).level_distances;
  const level_distances: TradeRequest["level_distances"] | undefined =
    distRaw && typeof distRaw === "object" && !Array.isArray(distRaw)
      ? Object.fromEntries(
          Object.entries(distRaw)
            .slice(0, 24)
            .filter(([, value]) => typeof value === "string" || value === null || isFiniteNumber(value)),
        ) as TradeRequest["level_distances"]
      : undefined;

  const sanitizeContext = (raw: unknown, limit = 32): Record<string, number | string | null> | undefined => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
    const entries = Object.entries(raw as Record<string, unknown>)
      .slice(0, limit)
      .filter(([, value]) => typeof value === "string" || value === null || isFiniteNumber(value));
    return entries.length > 0 ? Object.fromEntries(entries) as Record<string, number | string | null> : undefined;
  };

  const chart_structure = sanitizeContext((req as any).chart_structure);
  const volatility_context = sanitizeContext((req as any).volatility_context);
  const cost_context = sanitizeContext((req as any).cost_context);

  return {
    ...req,
    macd,
    ichimoku,
    atr_norm,
    adx,
    di_plus,
    di_minus,
    bb_width,
    candle_features,
    candle_bars,
    market_session: session,
    utc_hour,
    day_of_week,
    higher_timeframes,
    level_distances,
    chart_structure,
    volatility_context,
    cost_context,
  };
}

function assessInputSanity(req: TradeRequest): InputSanityIssue[] {
  const issues: InputSanityIssue[] = [];

  const isFiniteNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
  const requireFinite = (field: string, value: unknown) => {
    if (!isFiniteNumber(value)) issues.push({ field, problem: "missing_or_non_finite", value });
  };
  const requirePositive = (field: string, value: unknown) => {
    if (!isFiniteNumber(value) || value <= 0) issues.push({ field, problem: "non_positive", value });
  };
  const requireRange = (field: string, value: unknown, min: number, max: number) => {
    if (!isFiniteNumber(value) || value < min || value > max) issues.push({ field, problem: `out_of_range(${min}-${max})`, value });
  };

  requirePositive("price", req.price);
  requirePositive("bid", req.bid);
  requirePositive("ask", req.ask);
  if (isFiniteNumber(req.bid) && isFiniteNumber(req.ask) && req.ask < req.bid) {
    issues.push({ field: "bid_ask", problem: "ask_lt_bid", value: { bid: req.bid, ask: req.ask } });
  }

  requirePositive("ema_25", req.ema_25);
  requirePositive("sma_100", req.sma_100);
  requirePositive("sma_200", req.sma_200);
  requirePositive("sma_800", req.sma_800);
  requireRange("rsi", req.rsi, 0, 100);
  requirePositive("atr", req.atr);

  // Optional regime fields: if provided, they must be sane.
  if (typeof req.atr_norm !== "undefined") {
    if (!isFiniteNumber(req.atr_norm) || req.atr_norm <= 0 || req.atr_norm > 0.2) {
      issues.push({ field: "atr_norm", problem: "invalid_optional", value: req.atr_norm });
    }
  }
  if (typeof req.adx !== "undefined") {
    if (!isFiniteNumber(req.adx) || req.adx < 0 || req.adx > 100) {
      issues.push({ field: "adx", problem: "invalid_optional", value: req.adx });
    }
  }
  if (typeof req.bb_width !== "undefined") {
    if (!isFiniteNumber(req.bb_width) || req.bb_width <= 0 || req.bb_width > 0.5) {
      issues.push({ field: "bb_width", problem: "invalid_optional", value: req.bb_width });
    }
  }

  // Nested required groups (EA payload corruption often shows up here)
  requireFinite("macd.main", req.macd?.main);
  requireFinite("macd.signal", req.macd?.signal);
  requireFinite("macd.histogram", req.macd?.histogram);
  requireFinite("macd.cross", req.macd?.cross);

  requirePositive("ichimoku.tenkan", req.ichimoku?.tenkan);
  requirePositive("ichimoku.kijun", req.ichimoku?.kijun);
  requirePositive("ichimoku.senkou_a", req.ichimoku?.senkou_a);
  requirePositive("ichimoku.senkou_b", req.ichimoku?.senkou_b);
  requirePositive("ichimoku.chikou", req.ichimoku?.chikou);
  requireFinite("ichimoku.tk_cross", req.ichimoku?.tk_cross);
  requireFinite("ichimoku.cloud_color", req.ichimoku?.cloud_color);
  requireFinite("ichimoku.price_vs_cloud", req.ichimoku?.price_vs_cloud);

  return issues;
}

function applyExecutionGuards(tradeReq: TradeRequest, response: TradeResponse): TradeResponse {
  const symbol = (tradeReq.symbol || "").toUpperCase();
  const utcHour = new Date().getUTCHours();
  const hasMlSupport = (response as any).ml_pattern_used === true;
  const adx = typeof tradeReq.adx === "number" && Number.isFinite(tradeReq.adx) ? tradeReq.adx : null;
  const diPlus = typeof tradeReq.di_plus === "number" && Number.isFinite(tradeReq.di_plus) ? tradeReq.di_plus : null;
  const diMinus = typeof tradeReq.di_minus === "number" && Number.isFinite(tradeReq.di_minus) ? tradeReq.di_minus : null;
  const macdCross = typeof tradeReq.macd?.cross === "number" && Number.isFinite(tradeReq.macd.cross)
    ? tradeReq.macd.cross
    : null;

  const reasons: string[] = [];

  // BTCUSD: avoid observed loss cluster at UTC19
  if (symbol === "BTCUSD" && utcHour === 19) {
    reasons.push("BTCUSD disabled at UTC19");
  }

  // XAGUSD has recently traded without any ML-backed pattern support and degraded sharply.
  // Block execution until the symbol has an active matched ML pattern again.
  if (symbol === "XAGUSD" && !hasMlSupport) {
    reasons.push("XAGUSD requires ML-backed pattern support");
  }

  if (symbol === "XAUUSD") {
    const actionDir = typeof response.action === "number" ? response.action : 0;
    const lowAdx = adx !== null && adx < 18;
    const bearishMomentum = (macdCross !== null && macdCross < 0) || (diPlus !== null && diMinus !== null && diMinus > diPlus);
    const bullishMomentum = (macdCross !== null && macdCross > 0) || (diPlus !== null && diMinus !== null && diPlus > diMinus);

    if (lowAdx && actionDir > 0 && bearishMomentum) {
      reasons.push(`XAUUSD long blocked in weak trend (adx=${round3(adx)} macdCross=${macdCross ?? "na"} di+=${diPlus ?? "na"} di-=${diMinus ?? "na"})`);
    }
    if (lowAdx && actionDir < 0 && bullishMomentum) {
      reasons.push(`XAUUSD short blocked in weak trend (adx=${round3(adx)} macdCross=${macdCross ?? "na"} di+=${diPlus ?? "na"} di-=${diMinus ?? "na"})`);
    }
  }

  if (reasons.length === 0) return response;

  const guardNote = `GUARD: ${reasons.join("; ")}`;

  return {
    ...response,
    action: 0,
    entry_method: "market",
    entry_params: null,
    skip_reason: response.skip_reason || "guard",
    method_selected_by: response.method_selected_by || "Manual",
    method_reason: response.method_reason ? `${response.method_reason} | ${guardNote}` : guardNote,
    reasoning: response.reasoning ? `${response.reasoning} | ${guardNote}` : guardNote,
  };
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Content-Type": "application/json",
  };
}

import { calculateQuadFusionScore } from "./quad-fusion.ts";

// フォールバック計算（OpenAI失敗時用） - QuadFusionを使用
function calculateSignalFallback(req: TradeRequest): TradeResponse {
  // ★ QuadFusion分析を使用
  const analysis = calculateQuadFusionScore(req);
  const { atr } = req;
  
  let offset_factor = 0.2;
  let expiry_minutes = 90;
  
  // ATRによるリスク調整
  if (atr > 0) {
    if (atr > 0.001) {
      offset_factor = 0.25;
      expiry_minutes = 120; // 高ボラティリティは長めの有効期限
    } else if (atr < 0.0005) {
      offset_factor = 0.15;
      expiry_minutes = 60; // 低ボラティリティは短めの有効期限
    }
  }

  console.log(
    `[Fallback] QuadFusion: win_prob=${(analysis.win_prob * 100).toFixed(1)}% ` +
    `direction=${analysis.direction} confidence=${analysis.confidence}`
  );
  
  return {
    win_prob: Math.round(analysis.win_prob * 1000) / 1000,
    action: analysis.direction,
    suggested_dir: analysis.direction,
    offset_factor: Math.round(offset_factor * 1000) / 1000,
    expiry_minutes,
    confidence: analysis.confidence,
    reasoning: analysis.reasoning,
    recommended_min_win_prob: 0.75,
    expected_value_r: computeExpectedValueR(analysis.win_prob),
    skip_reason: analysis.direction === 0 ? "no-trade" : "",
    entry_method: "market",
    entry_params: null,
    method_selected_by: "Fallback",
    method_reason: "QuadFusion fallback (market-only execution)",
    ml_pattern_used: false,
    ml_pattern_id: null,
    ml_pattern_name: null,
    ml_pattern_confidence: null,
  };
}

async function calculateSignalFallbackWithCalibration(req: TradeRequest): Promise<TradeResponse> {
  const base = calculateSignalFallback(req);
  const rt = await getRuntimeTradeParams(req);
  const calibrationMode = getCalibrationMode();
  const calibrationRequired = calibrationMode === "on" && isCalibrationRequired();
  const clientMinWinProbProvided = typeof req.min_win_prob === "number";
  const client_min_win_prob = sanitizeRecommendedMinWinProb(
    clientMinWinProbProvided ? req.min_win_prob : (rt.minWinProbFromConfig ?? undefined),
  ) ?? 0.70;
  const minEvR = getMinEvR();
  const evGateMinWinProb = computeEvGateMinWinProb({ rewardRR: rt.rewardRR, costR: rt.costR, minEvR });
  const minWinProbFloor = getMinWinProbFloor();
  const maxCostR = getMaxCostR();
  // Respect EA/configured minimum, never execute below it.
  const action_gate_min_win_prob = Math.max(minWinProbFloor, client_min_win_prob);

  const raw = typeof base.win_prob === "number" ? base.win_prob : 0.5;
  const { winProb: calibrated, debug } = await calibrateWinProb(req, raw);

  const calibrationOk = !calibrationRequired || debug.applied;

  const dir = (base.action === 1 || base.action === -1) ? base.action : 0;
  const rsiGuard = applyExtremeRsiPenalty({ req, dir, winProb: calibrated, costR: rt.costR });
  const afterRsi = rsiGuard.winProb;

  // RSI Mean-Reversion Bonus: SHORT@RSI>=70 / LONG@RSI<=30 has ~63% win rate historically.
  const rsiMrBonus = applyRsiMrBonus({ req, dir, winProb: afterRsi });
  const afterRsiMr = rsiMrBonus.winProb;

  // Recent performance soft guard (fallback path)
  // Skip for RSI MR trades: recent perf history is trend-follow signals, not MR.
  const recentPerfResult = rsiMrBonus.skipsRecentPerf
    ? { winProb: afterRsiMr, applied: false, guardTag: "" }
    : await applyRecentPerfGuard(req, dir, afterRsiMr);
  const afterRecentPerf = recentPerfResult.winProb;

  // Consecutive loss streak guard (fallback path)
  // Skip for RSI MR trades (same rationale as RECENT_PERF).
  const streakResult = rsiMrBonus.skipsStreakGuard
    ? { winProb: afterRecentPerf, applied: false, streak: 0, guardTag: "" }
    : await applyStreakGuard(req, dir, afterRecentPerf);
  const winProbFinal = streakResult.winProb;

  // Effective gate: lower slightly for confirmed RSI mean-reversion setups.
  const effective_gate = action_gate_min_win_prob - rsiMrBonus.gateReduction;

  const expected_value_r = computeExpectedValueR(winProbFinal, rt.rewardRR, rt.costR);
  const costOk = rt.costR <= maxCostR;
  const action =
    dir !== 0 &&
      costOk &&
      calibrationOk &&
      winProbFinal >= effective_gate &&
      expected_value_r >= minEvR
      ? dir
      : 0;

  let skip_reason = typeof base.skip_reason === "string" ? base.skip_reason : "";
  if (action === 0 && dir !== 0) {
    const parts: string[] = [];
    if (!calibrationOk) parts.push("calibration_not_applied");
    if (!costOk) parts.push("cost_too_high");
    if (expected_value_r < minEvR) parts.push("ev_below_min");
    if (winProbFinal < effective_gate) parts.push("winprob_below_gate");
    if (rsiGuard.applied) parts.push("extreme_rsi_penalty");
    if (rsiMrBonus.applied) parts.push("rsi_mr_bonus");
    if (recentPerfResult.applied) parts.push("recent_perf_penalty");
    if (streakResult.applied) parts.push("streak_guard");
    if (parts.length > 0) skip_reason = skip_reason ? `${skip_reason}|${parts.join("+")}` : parts.join("+");
  }

  // Put diagnostics first so they survive EA-side truncation.
  const gateTag =
    `GATE(EV>=${minEvR.toFixed(2)}R rr=${round3(rt.rewardRR)} costR=${round3(rt.costR)} ` +
    `costSrc=${rt.costRSource} maxCostR=${round3(maxCostR)} gateP=${round3(effective_gate)} ` +
    `calReq=${calibrationRequired ? 1 : 0} calApplied=${debug.applied ? 1 : 0})`;

  const calTag = debug.applied
    ? `CAL(${debug.method}/${debug.scope} n=${debug.n}): raw=${round3(raw)}→${round3(calibrated)}`
    : "";
  const rsiGuardTag = rsiGuard.guardTag;
  const rsiMrBonusTag = rsiMrBonus.guardTag;
  const recentPerfTag = recentPerfResult.guardTag;
  const streakTag = streakResult.guardTag;

  const baseReasoning = typeof base.reasoning === "string" ? base.reasoning.trim() : "";
  const tags = [gateTag, calTag, rsiGuardTag, rsiMrBonusTag, recentPerfTag, streakTag].filter((s) => s && s.trim().length > 0).join(" | ");
  const reasoning = baseReasoning ? `${tags} | ${baseReasoning}` : tags;
  const decision_summary = buildDecisionSummary({
    willExecute: action !== 0,
    dir,
    winProb: winProbFinal,
    effectiveGate: effective_gate,
    expectedValueR: expected_value_r,
    minEvR,
    costR: rt.costR,
    maxCostR,
    calibrationRequired,
    calibrationApplied: debug.applied,
    skipReason: skip_reason,
  });

  return {
    ...base,
    win_prob: round3(winProbFinal),
    action,
    decision_summary,
    expected_value_r,
    reward_rr: round3(rt.rewardRR),
    risk_atr_mult: round3(rt.riskAtrMult),
    cost_r: round3(rt.costR),
    cost_r_source: rt.costRSource,
    reasoning,
    win_prob_raw: round3(raw),
    win_prob_calibrated: round3(calibrated),
    win_prob_final: round3(winProbFinal),
    calibration_applied: debug.applied,
    calibration_version: debug.version ?? null,
    calibration_method: debug.method ?? null,
    calibration_scope: debug.scope ?? null,
    calibration_sample_size: debug.n ?? null,
    calibration_bin_sample_size: debug.bin_n ?? null,
    calibration_shift: round3(calibrated - raw),
    probability_adjustments: {
      calibration_version: debug.version ?? null,
      calibration_source: debug.source ?? null,
      calibration: round3(calibrated - raw),
      extreme_rsi: round3(afterRsi - calibrated),
      rsi_mean_reversion: round3(afterRsiMr - afterRsi),
      recent_performance: round3(afterRecentPerf - afterRsiMr),
      loss_streak: round3(winProbFinal - afterRecentPerf),
      total_post_calibration: round3(winProbFinal - calibrated),
    },
    win_prob_calibration: debug,
    skip_reason,
  } as any;
}

function sanitizeRecommendedMinWinProb(v: unknown): number | null {
  if (typeof v !== "number" || !isFinite(v)) return null;
  // Policy:
  // - never raise above 0.75 (avoid reducing trade opportunities)
  // - allow values below 0.60 because win_prob may be calibrated downward
  const clamped = Math.max(0.40, Math.min(0.75, v));
  return Math.round(clamped * 1000) / 1000;
}

function getMinEvR(): number {
  const v = Number(Deno.env.get("AI_TRADER_MIN_EV_R") ?? 0.10);
  if (!Number.isFinite(v)) return 0.10;
  return Math.max(0.0, Math.min(0.5, Math.round(v * 1000) / 1000));
}

function getMinWinProbFloor(): number {
  // Floor to prevent execution with too-low win_prob when RR is high.
  const v = Number(Deno.env.get("AI_TRADER_MIN_WIN_PROB_FLOOR") ?? 0.55);
  if (!Number.isFinite(v)) return 0.55;
  return Math.max(0.40, Math.min(0.75, Math.round(v * 1000) / 1000));
}

function getMaxCostR(): number {
  // Hard guard: avoid trading when spread is too large relative to ATR-based risk distance.
  // Example: 0.12 means spread consumes 12% of 1R risk distance.
  const v = Number(Deno.env.get("AI_TRADER_MAX_COST_R") ?? 0.12);
  if (!Number.isFinite(v)) return 0.12;
  return Math.max(0.0, Math.min(0.5, Math.round(v * 1000) / 1000));
}

function getAssumedCostR(): number {
  // Fallback cost in R when bid/ask/atr are missing.
  // Default aligns with analysis SQL (assumed_cost_r=0.02).
  const v = Number(Deno.env.get("AI_TRADER_ASSUMED_COST_R") ?? 0.02);
  if (!Number.isFinite(v)) return 0.02;
  return Math.max(0.0, Math.min(0.5, Math.round(v * 1000) / 1000));
}

function getExtremeRsiLongThreshold(): number {
  const v = Number(Deno.env.get("AI_TRADER_EXTREME_RSI_LONG") ?? 75);
  if (!Number.isFinite(v)) return 75;
  return Math.max(60, Math.min(95, Math.round(v)));
}

function getExtremeRsiShortThreshold(): number {
  const v = Number(Deno.env.get("AI_TRADER_EXTREME_RSI_SHORT") ?? 25);
  if (!Number.isFinite(v)) return 25;
  return Math.max(5, Math.min(40, Math.round(v)));
}

function getExtremeRsiAdxThreshold(): number {
  const v = Number(Deno.env.get("AI_TRADER_EXTREME_RSI_ADX_MIN") ?? 30);
  if (!Number.isFinite(v)) return 30;
  return Math.max(10, Math.min(60, Math.round(v)));
}

function getExtremeRsiLowCostRThreshold(): number {
  const v = Number(Deno.env.get("AI_TRADER_EXTREME_RSI_COSTR_MAX") ?? 0.05);
  if (!Number.isFinite(v)) return 0.05;
  return Math.max(0.0, Math.min(0.2, Math.round(v * 1000) / 1000));
}

function getExtremeRsiPenalty(): number {
  // Soft guard: reduce win_prob before gate check instead of hard-forcing action=0.
  const v = Number(Deno.env.get("AI_TRADER_EXTREME_RSI_PENALTY") ?? 0.12);
  if (!Number.isFinite(v)) return 0.12;
  return Math.max(0.0, Math.min(0.5, Math.round(v * 1000) / 1000));
}

function applyExtremeRsiPenalty(opts: {
  req: TradeRequest;
  dir: number;
  winProb: number;
  costR: number;
}): {
  winProb: number;
  applied: boolean;
  allowByException: boolean;
  guardTag: string;
} {
  const { req, dir } = opts;
  const rsi = typeof req.rsi === "number" && Number.isFinite(req.rsi) ? req.rsi : null;
  if (rsi === null || (dir !== 1 && dir !== -1)) {
    return { winProb: opts.winProb, applied: false, allowByException: false, guardTag: "" };
  }

  const longExtreme = getExtremeRsiLongThreshold();
  const shortExtreme = getExtremeRsiShortThreshold();
  const contrarianExtreme = (dir === 1 && rsi >= longExtreme) || (dir === -1 && rsi <= shortExtreme);
  if (!contrarianExtreme) {
    return { winProb: opts.winProb, applied: false, allowByException: false, guardTag: "" };
  }

  const adxMin = getExtremeRsiAdxThreshold();
  const adx = typeof req.adx === "number" && Number.isFinite(req.adx) ? req.adx : null;
  const adxHigh = adx !== null && adx >= adxMin;

  const pvc = req.ichimoku?.price_vs_cloud;
  const cloudAligned = (dir === 1 && pvc === 1) || (dir === -1 && pvc === -1);

  const lowCostMax = getExtremeRsiLowCostRThreshold();
  const costLow = Number.isFinite(opts.costR) && opts.costR <= lowCostMax;

  const allowByException = adxHigh && cloudAligned && costLow;
  if (allowByException) {
    return {
      winProb: opts.winProb,
      applied: false,
      allowByException: true,
      guardTag: `RSI_GUARD(exception rsi=${round3(rsi)} adx=${adx !== null ? round3(adx) : "na"} cloud=${pvc ?? "na"} costR=${round3(opts.costR)})`,
    };
  }

  const penalty = getExtremeRsiPenalty();
  const penalized = clampWinProb(opts.winProb - penalty);
  return {
    winProb: penalized,
    applied: true,
    allowByException: false,
    guardTag:
      `RSI_GUARD(penalized ${round3(opts.winProb)}→${round3(penalized)} ` +
      `rsi=${round3(rsi)} dir=${dir} adx=${adx !== null ? round3(adx) : "na"} ` +
      `cloud=${pvc ?? "na"} costR=${round3(opts.costR)})`,
  };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// RSI Mean-Reversion Bonus
// Analysis shows SHORT@RSI>=70 / LONG@RSI<=30 achieves ~63% win rate
// vs 23-25% for trend-following. Boost win_prob for these setups and
// skip RECENT_PERF guard (which is based on trend-follow signal history).
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function getRsiMrBonusThresholdHigh(): number {
  const v = Number(Deno.env.get("AI_TRADER_RSI_MR_THRESHOLD_HIGH") ?? 70);
  if (!Number.isFinite(v)) return 70;
  return Math.max(60, Math.min(90, Math.round(v)));
}

function getRsiMrBonusThresholdLow(): number {
  const v = Number(Deno.env.get("AI_TRADER_RSI_MR_THRESHOLD_LOW") ?? 30);
  if (!Number.isFinite(v)) return 30;
  return Math.max(10, Math.min(40, Math.round(v)));
}

function getRsiMrBonusAmount(): number {
  const v = Number(Deno.env.get("AI_TRADER_RSI_MR_BONUS") ?? 0.20);
  if (!Number.isFinite(v)) return 0.20;
  return Math.max(0.0, Math.min(0.5, Math.round(v * 1000) / 1000));
}

function getRsiMrGateReduction(): number {
  const v = Number(Deno.env.get("AI_TRADER_RSI_MR_GATE_REDUCTION") ?? 0.05);
  if (!Number.isFinite(v)) return 0.05;
  return Math.max(0.0, Math.min(0.3, Math.round(v * 1000) / 1000));
}

function applyRsiMrBonus(opts: {
  req: TradeRequest;
  dir: number;
  winProb: number;
}): {
  winProb: number;
  applied: boolean;
  skipsRecentPerf: boolean;
  skipsStreakGuard: boolean;
  gateReduction: number;
  guardTag: string;
} {
  const { req, dir } = opts;
  const rsi = typeof req.rsi === "number" && Number.isFinite(req.rsi) ? req.rsi : null;
  if (rsi === null || (dir !== 1 && dir !== -1)) {
    return { winProb: opts.winProb, applied: false, skipsRecentPerf: false, skipsStreakGuard: false, gateReduction: 0, guardTag: "" };
  }
  const highThresh = getRsiMrBonusThresholdHigh();
  const lowThresh = getRsiMrBonusThresholdLow();
  // Mean reversion: SHORT when overbought, LONG when oversold
  const isMeanReversion = (dir === -1 && rsi >= highThresh) || (dir === 1 && rsi <= lowThresh);
  if (!isMeanReversion) {
    return { winProb: opts.winProb, applied: false, skipsRecentPerf: false, skipsStreakGuard: false, gateReduction: 0, guardTag: "" };
  }
  const bonus = getRsiMrBonusAmount();
  const gateReduction = getRsiMrGateReduction();
  const boosted = clampWinProb(opts.winProb + bonus);
  return {
    winProb: boosted,
    applied: true,
    skipsRecentPerf: true,    // Recent perf is trend-follow history; MR trades are different
    skipsStreakGuard: true,   // Streak history is also trend-follow; skip for MR trades
    gateReduction,
    guardTag: `RSI_MR_BONUS(+${round3(bonus)} ${round3(opts.winProb)}→${round3(boosted)} rsi=${round3(rsi)} dir=${dir} gate-${round3(gateReduction)})`,
  };
}

type AiConfigRuntimeRow = {
  min_win_prob?: number | null;
  reward_rr?: number | null;
  risk_atr_mult?: number | null;
};

type AiConfigCacheEntry = {
  expiresAt: number;
  row: AiConfigRuntimeRow | null;
};

const aiConfigCache = new Map<string, AiConfigCacheEntry>();

function normalizeInstance(instance: unknown): string {
  const s = typeof instance === "string" ? instance.trim() : "";
  return s ? s : "main";
}

async function fetchAiConfigRuntimeRow(instance: string): Promise<AiConfigRuntimeRow | null> {
  const cached = aiConfigCache.get(instance);
  if (cached && cached.expiresAt > Date.now()) return cached.row;

  const { data, error } = await supabase
    .from("ai_config")
    .select("min_win_prob,reward_rr,risk_atr_mult")
    .eq("instance", instance)
    .maybeSingle();

  if (error) {
    console.warn(`[ai-trader] ai_config fetch error instance=${instance}: ${error.message}`);
    aiConfigCache.set(instance, { expiresAt: Date.now() + 60_000, row: null });
    return null;
  }

  const row = (data ?? null) as AiConfigRuntimeRow | null;
  aiConfigCache.set(instance, { expiresAt: Date.now() + 5 * 60_000, row });
  return row;
}

async function getRuntimeTradeParams(req: TradeRequest): Promise<{
  instance: string;
  minWinProbFromConfig: number | null;
  rewardRR: number;
  riskAtrMult: number;
  costR: number;
  costRSource: "real" | "assumed";
}> {
  const instance = normalizeInstance(req.instance);
  const row = await fetchAiConfigRuntimeRow(instance);

  const rewardRR =
    typeof row?.reward_rr === "number" && Number.isFinite(row.reward_rr) && row.reward_rr > 0
      ? row.reward_rr
      : 1.5;
  const riskAtrMult =
    typeof row?.risk_atr_mult === "number" && Number.isFinite(row.risk_atr_mult) && row.risk_atr_mult > 0
      ? row.risk_atr_mult
      : 2.0;
  const minWinProbFromConfig =
    typeof row?.min_win_prob === "number" && Number.isFinite(row.min_win_prob)
      ? sanitizeRecommendedMinWinProb(row.min_win_prob)
      : null;

  const assumedCostR = getAssumedCostR();
  const hasSpread =
    typeof req.ask === "number" &&
    typeof req.bid === "number" &&
    Number.isFinite(req.ask) &&
    Number.isFinite(req.bid) &&
    req.ask >= req.bid;
  const hasAtr = typeof req.atr === "number" && Number.isFinite(req.atr) && req.atr > 0;

  const spread = hasSpread ? req.ask - req.bid : 0;
  const atr = hasAtr ? req.atr : 0;
  const riskDistance = atr > 0 ? atr * riskAtrMult : 0;
  const hasRealCost = hasSpread && hasAtr && riskDistance > 0;
  const costR = hasRealCost ? spread / riskDistance : assumedCostR;
  const costRSource: "real" | "assumed" = hasRealCost ? "real" : "assumed";

  return {
    instance,
    minWinProbFromConfig,
    rewardRR,
    riskAtrMult,
    costR: round3(costR),
    costRSource,
  };
}

function computeEvGateMinWinProb(opts: { rewardRR: number; costR: number; minEvR: number }): number {
  const rr = Number.isFinite(opts.rewardRR) && opts.rewardRR > 0 ? opts.rewardRR : 1.5;
  const costR = Number.isFinite(opts.costR) && opts.costR > 0 ? opts.costR : 0;
  const minEvR = Number.isFinite(opts.minEvR) && opts.minEvR > 0 ? opts.minEvR : 0;

  // Solve: p*rr - (1-p) - costR >= minEvR  =>  p >= (1 + costR + minEvR) / (rr + 1)
  const denom = rr + 1;
  if (denom <= 0) return 0.9;
  return clampWinProb((1 + costR + minEvR) / denom);
}

function computeExpectedValueR(winProb: number, rewardRR = 1.5, costR = 0): number {
  const rr = Number.isFinite(rewardRR) && rewardRR > 0 ? rewardRR : 1.5;
  const c = Number.isFinite(costR) && costR > 0 ? costR : 0;
  // EV model: loss=-1R, win=+RR, then subtract transaction cost in R.
  const ev = (winProb * rr) - ((1 - winProb) * 1.0) - c;
  return Math.round(ev * 1000) / 1000;
}

function bucketAdx(v: number | undefined): string | null {
  if (typeof v !== "number" || !isFinite(v)) return null;
  if (v < 15) return "low";
  if (v < 25) return "mid";
  return "high";
}

function bucketBbWidth(v: number | undefined): string | null {
  if (typeof v !== "number" || !isFinite(v)) return null;
  if (v < 0.003) return "squeeze";
  if (v < 0.008) return "normal";
  return "wide";
}

function bucketAtrNorm(v: number | undefined): string | null {
  if (typeof v !== "number" || !isFinite(v)) return null;
  if (v < 0.0005) return "low";
  if (v < 0.0012) return "mid";
  return "high";
}

type StrictPatternFlags = {
  strict_macd_rsi: boolean;
  strict_ma_rsi: boolean;
  strict_ichimoku_tk_rsi: boolean;
  strict_cloud_macd: boolean;
  strict_engulfing: boolean;
  strict_inside_breakout: boolean;
};

function computeStrictPatternFlags(req: TradeRequest): StrictPatternFlags {
  const dir = req.ea_suggestion.dir;
  const rsi = typeof req.rsi === "number" ? req.rsi : NaN;
  const ema25 = typeof req.ema_25 === "number" ? req.ema_25 : NaN;
  const sma100 = typeof req.sma_100 === "number" ? req.sma_100 : NaN;
  const price = typeof req.price === "number" ? req.price : NaN;
  const macdCross = req.macd?.cross;
  const tkCross = req.ichimoku?.tk_cross;
  const cloudColor = req.ichimoku?.cloud_color;
  const priceVsCloud = req.ichimoku?.price_vs_cloud;
  const kijun = typeof req.ichimoku?.kijun === "number" ? req.ichimoku.kijun : NaN;
  const cf = req.candle_features;

  if (dir !== 1 && dir !== -1) {
    return {
      strict_macd_rsi: false,
      strict_ma_rsi: false,
      strict_ichimoku_tk_rsi: false,
      strict_cloud_macd: false,
      strict_engulfing: false,
      strict_inside_breakout: false,
    };
  }

  return {
    strict_macd_rsi: dir > 0
      ? macdCross === 1 && Number.isFinite(ema25) && Number.isFinite(sma100) && ema25 >= sma100 && rsi >= 45 && rsi <= 65
      : macdCross === -1 && Number.isFinite(ema25) && Number.isFinite(sma100) && ema25 <= sma100 && rsi >= 35 && rsi <= 55,
    strict_ma_rsi: dir > 0
      ? req.ma_cross === 1 && rsi >= 45 && rsi <= 60
      : req.ma_cross === -1 && rsi >= 40 && rsi <= 55,
    strict_ichimoku_tk_rsi: dir > 0
      ? tkCross === 1 && Number.isFinite(price) && Number.isFinite(kijun) && price >= kijun && rsi >= 45 && rsi <= 65
      : tkCross === -1 && Number.isFinite(price) && Number.isFinite(kijun) && price <= kijun && rsi >= 35 && rsi <= 55,
    strict_cloud_macd: dir > 0
      ? cloudColor === 1 && priceVsCloud === 1 && macdCross === 1
      : cloudColor === -1 && priceVsCloud === -1 && macdCross === -1,
    strict_engulfing: dir > 0
      ? cf?.bull_engulfing === 1 && rsi <= 50
      : cf?.bear_engulfing === 1 && rsi >= 50,
    strict_inside_breakout: dir > 0
      ? cf?.inside_break_dir === 1
      : cf?.inside_break_dir === -1,
  };
}

function patternMatchesCurrentSetup(pattern: any, flags: StrictPatternFlags): boolean {
  switch (pattern?.pattern_type) {
    case "strict_macd_rsi":
      return flags.strict_macd_rsi;
    case "strict_ma_rsi":
      return flags.strict_ma_rsi;
    case "strict_ichimoku_tk_rsi":
      return flags.strict_ichimoku_tk_rsi;
    case "strict_cloud_macd":
      return flags.strict_cloud_macd;
    case "strict_engulfing":
      return flags.strict_engulfing;
    case "strict_inside_breakout":
      return flags.strict_inside_breakout;
    default:
      return true;
  }
}

// OpenAI APIを使用したAI予測
async function calculateSignalWithAIForFixedDir(req: TradeRequest): Promise<TradeResponse> {
  const { symbol, timeframe, rsi, atr, price, ea_suggestion } = req;
  const dir = ea_suggestion.dir;
  const reason = ea_suggestion.reason;
  const ichimoku_score = ea_suggestion.ichimoku_score;

  // MLモード: off=ML参照なし, log_only=MLを記録のみ(判断/ロットに影響させない), on=従来通り
  const mlMode = getMlMode();

  const techDir = typeof ea_suggestion.tech_dir === "number" ? ea_suggestion.tech_dir : undefined;

  const atrNorm = typeof req.atr_norm === "number" ? req.atr_norm : undefined;
  const adx = typeof req.adx === "number" ? req.adx : undefined;
  const diPlus = typeof req.di_plus === "number" ? req.di_plus : undefined;
  const diMinus = typeof req.di_minus === "number" ? req.di_minus : undefined;
  const bbWidth = typeof req.bb_width === "number" ? req.bb_width : undefined;
  const cf = req.candle_features;
  const strictFlags = computeStrictPatternFlags(req);
  const candleBarsSummary = Array.isArray(req.candle_bars) && req.candle_bars.length > 0
    ? req.candle_bars
        .slice(-8)
        .map((b, i) => {
          const dirLabel = b.c > b.o ? "UP" : b.c < b.o ? "DOWN" : "DOJI";
          const stamp = b.t ?? `bar-${i + 1}`;
          return `${i + 1}. ${stamp} O=${b.o.toFixed(5)} H=${b.h.toFixed(5)} L=${b.l.toFixed(5)} C=${b.c.toFixed(5)} ${dirLabel}`;
        })
        .join("\n")
    : "N/A";
  const dailyPlanContext = await fetchDailyPlanContext(req);
  const dailyPlanPrompt = buildDailyPlanPrompt(dailyPlanContext, req);
  
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 🔄 ハイブリッド学習システム（3段階）
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // フェーズ1 (0-79件):    テクニカル判定のみ
  // フェーズ2 (80-999件):  ハイブリッド（高品質パターンのみML使用）
  // フェーズ3 (1000件+):   完全ML移行
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  
  // ステップ1: 完結した取引件数をカウント
  const { count: completedTradesCount } = await supabase
    .from("ai_signals")
    .select("*", { count: "exact", head: true })
    .in("actual_result", ["WIN", "LOSS"])
    .eq("reverse_execution", false)
    .eq("is_virtual", false);
  
  const totalCompletedTrades = completedTradesCount || 0;
  console.log(`[AI] 📊 Total completed trades: ${totalCompletedTrades}`);
  
  // ステップ2: フェーズ判定
  let learningPhase: "PHASE1_TECHNICAL" | "PHASE2_HYBRID" | "PHASE3_FULL_ML";
  let mlThresholds = { minSamples: 10, minConfidence: 0.5 }; // デフォルト閾値
  
  if (totalCompletedTrades < 80) {
    learningPhase = "PHASE1_TECHNICAL";
    console.log(`[AI] ⚙️  PHASE 1: テクニカル判定モード (${totalCompletedTrades}/80件)`);
  } else if (totalCompletedTrades < 1000) {
    learningPhase = "PHASE2_HYBRID";
    mlThresholds = { minSamples: 15, minConfidence: 0.7 }; // ハイブリッド時は厳格化
    console.log(`[AI] 🔄 PHASE 2: ハイブリッドモード (${totalCompletedTrades}/1000件) - サンプル${mlThresholds.minSamples}件以上 & 信頼度${mlThresholds.minConfidence * 100}%以上のみML使用`);
  } else {
    learningPhase = "PHASE3_FULL_ML";
    mlThresholds = { minSamples: 10, minConfidence: 0.5 }; // 完全ML時は標準設定
    console.log(`[AI] 🚀 PHASE 3: 完全MLモード (${totalCompletedTrades}件達成)`);
  }
  
  // ステップ3: ML学習データを取得（PHASE1以外）
  const ENABLE_ML_LEARNING = learningPhase !== "PHASE1_TECHNICAL";

  // 実トレードにMLを組み込まない運用のため、MLの影響範囲をモードで制御する。
  // - log_only: ml_patterns のマッチ結果は返す/保存するが、OpenAIプロンプトや win_prob/lot には反映しない。
  // - off: ml_patterns を参照しない（完全無効）
  // - on: 従来通り ML を判断に反映
  const ENABLE_ML_PATTERN_LOOKUP = ENABLE_ML_LEARNING && mlMode !== "off";
  const ENABLE_ML_CONTEXT_FOR_OPENAI = ENABLE_ML_LEARNING && mlMode === "on";
  const APPLY_ML_WIN_PROB_ADJUSTMENT = ENABLE_ML_CONTEXT_FOR_OPENAI;

  console.log(`[AI] ML mode=${mlMode} (phase=${learningPhase})`);
  
  let matchedPatterns: any[] = [];
  let recommendations: any[] = [];
  let historicalTrades: any[] = [];
  
  if (ENABLE_ML_PATTERN_LOOKUP) {
    // 1. ML学習済みパターンをTOP3まで取得（フェーズに応じた閾値）
    const adxBucket = bucketAdx(adx ?? undefined);
    const bbBucket = bucketBbWidth(bbWidth ?? undefined);
    const atrNormBucket = bucketAtrNorm(atrNorm ?? undefined);

    let patternQuery = supabase
      .from("ml_patterns")
      .select("*")
      .eq("symbol", symbol)
      .eq("timeframe", timeframe)
      .eq("direction", dir)
      .eq("is_active", true)
      .gte("rsi_max", rsi)
      .lte("rsi_min", rsi)
      .gte("real_trades", mlThresholds.minSamples) // 実トレードのサンプル数で判定
      .gte("confidence_score", mlThresholds.minConfidence) // フェーズ別閾値
      .order("confidence_score", { ascending: false })
      .limit(20);

    // レジームの一致を優先（ただし旧パターン互換のため NULL は許容）
    if (adxBucket) patternQuery = patternQuery.or(`adx_bucket.is.null,adx_bucket.eq.${adxBucket}`);
    if (bbBucket) patternQuery = patternQuery.or(`bb_width_bucket.is.null,bb_width_bucket.eq.${bbBucket}`);
    if (atrNormBucket) patternQuery = patternQuery.or(`atr_norm_bucket.is.null,atr_norm_bucket.eq.${atrNormBucket}`);

    const { data: patterns } = await patternQuery;
    matchedPatterns = (patterns || [])
      .filter((pattern: any) => patternMatchesCurrentSetup(pattern, strictFlags))
      .slice(0, 3);
  }

  // MLを実判断に組み込むときだけ、推奨事項や類似トレードもプロンプト用に取得する。
  if (ENABLE_ML_CONTEXT_FOR_OPENAI) {
    const { data: recs } = await supabase
      .from("ml_recommendations")
      .select("*")
      .eq("status", "active")
      .order("priority", { ascending: true })
      .limit(3);
    recommendations = recs || [];

    const { data: trades } = await supabase
      .from("ai_signals")
      .select("*")
      .eq("symbol", symbol)
      .eq("timeframe", timeframe)
      .eq("dir", dir)
      .not("actual_result", "is", null)
      .in("actual_result", ["WIN", "LOSS"])
      .eq("reverse_execution", false)
      .eq("is_virtual", false)
      .order("created_at", { ascending: false })
      .limit(30);
    historicalTrades = trades || [];
  }
  
  let mlContext = "";
  let mlWinRateBoost = 0;
  let successCases = "";
  let failureCases = "";
  let recommendationsText = "";
  
  // パターンマッチング結果を整形（フェーズ情報付き）
  if (matchedPatterns && matchedPatterns.length > 0) {
    // フェーズ別のヘッダー
    let phaseInfo = "";
    if (learningPhase === "PHASE2_HYBRID") {
      phaseInfo = `\n🔄 ハイブリッドモード (${totalCompletedTrades}/1000件) - 高品質パターンのみML使用`;
    } else if (learningPhase === "PHASE3_FULL_ML") {
      phaseInfo = `\n🚀 完全MLモード (${totalCompletedTrades}件達成) - 全パターン活用`;
    }
    
    mlContext = `\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n📚 ML学習済みパターン検出 (TOP ${matchedPatterns.length})${phaseInfo}\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;
    
    matchedPatterns.forEach((pattern: any, index: number) => {
      mlContext += `\n\n【パターン${index + 1}】${pattern.pattern_name}`;
      mlContext += `\n• 過去勝率: ${(pattern.win_rate * 100).toFixed(1)}% (${pattern.win_count}勝 ${pattern.loss_count}敗 / 全${pattern.total_trades}件)`;
      if (pattern.real_trades !== undefined || pattern.virtual_trades !== undefined) {
        const real = pattern.real_trades ?? "N/A";
        const virt = pattern.virtual_trades ?? 0;
        mlContext += `\n• サンプル内訳: 実${real}件 / 仮想${virt}件`;
      }
      mlContext += `\n• 平均利益: +${pattern.avg_profit.toFixed(0)}, 平均損失: -${pattern.avg_loss.toFixed(0)}`;
      mlContext += `\n• プロフィットファクター: ${pattern.profit_factor.toFixed(2)}`;
      mlContext += `\n• 信頼度スコア: ${(pattern.confidence_score * 100).toFixed(1)}%`;
      mlContext += `\n• サンプル数: ${pattern.sample_size_adequate ? "✅ 十分" : "⚠️ 不足"}`;
      
      // 最も信頼できるパターンで勝率調整（控えめ設定）
      if (index === 0) {
        if (pattern.win_rate >= 0.75 && pattern.sample_size_adequate) {
          mlWinRateBoost = +0.05; // 高勝率パターン（+5%に抑える）
        } else if (pattern.win_rate >= 0.65 && pattern.sample_size_adequate) {
          mlWinRateBoost = +0.02; // 中程度の勝率（+2%）
        } else if (pattern.win_rate < 0.50 && pattern.sample_size_adequate) {
          mlWinRateBoost = -0.08; // 低勝率パターン（-8%に抑える）
        } else if (pattern.win_rate < 0.45) {
          mlWinRateBoost = -0.12; // 極めて低い勝率（-12%に抑える）
        }
      }
    });
    
    // フェーズ別の指示
    if (learningPhase === "PHASE2_HYBRID") {
      mlContext += `\n\n⚡ ハイブリッド判定: このパターンはサンプル${mlThresholds.minSamples}件以上 & 信頼度${mlThresholds.minConfidence * 100}%以上の高品質データです。過去勝率を重視しつつ、テクニカル指標と総合判断してください。`;
    } else if (learningPhase === "PHASE3_FULL_ML") {
      mlContext += `\n\n⚡ ML学習の重要性: このパターンは実際の取引データに基づいています。過去勝率を最重視してください。`;
    }
    
    console.log(`[AI] ML Pattern matched: ${matchedPatterns[0].pattern_name}, win_rate=${matchedPatterns[0].win_rate}, boost=${mlWinRateBoost}, phase=${learningPhase}`);
  } else if (ENABLE_ML_LEARNING) {
    // ML有効だがパターンマッチなし → テクニカル判定にフォールバック
    console.log(`[AI] ⚠️ No ML pattern matched (phase=${learningPhase}) - Fallback to technical analysis`);
    mlContext = `\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n⚙️  該当する学習パターンなし - テクニカル判定モード\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n条件に合う過去データが不足しているため、テクニカル指標のみで判断します。`;
  }
  
  // 過去の成功事例を抽出
  if (historicalTrades && historicalTrades.length > 0) {
    const winTrades = historicalTrades.filter((t: any) => t.actual_result === "WIN");
    const lossTrades = historicalTrades.filter((t: any) => t.actual_result === "LOSS");
    
    if (winTrades.length > 0) {
      successCases = `\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n✅ 過去の成功事例 (直近${Math.min(winTrades.length, 3)}件)\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;
      
      winTrades.slice(0, 3).forEach((trade: any, index: number) => {
        const createdDate = new Date(trade.created_at);
        successCases += `\n\n【成功${index + 1}】${createdDate.toLocaleString('ja-JP', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}`;
        successCases += `\n• RSI: ${trade.rsi?.toFixed(1) || "N/A"}, ATR: ${trade.atr?.toFixed(5) || "N/A"}`;
        successCases += `\n• 理由: ${trade.reason || "N/A"}`;
        successCases += `\n• AI予測勝率: ${(trade.win_prob * 100).toFixed(0)}%`;
        successCases += `\n• 結果: WIN 🎯 (利益: +${trade.profit_loss?.toFixed(0) || "N/A"})`;
        if (trade.tp_hit) successCases += ` ← TP到達`;
        if (trade.hold_duration_minutes) successCases += `\n• 保有時間: ${trade.hold_duration_minutes}分`;
      });
      
      successCases += `\n\n💡 成功の共通点を分析し、現在の条件と照らし合わせてください。`;
    }
    
    if (lossTrades.length > 0) {
      failureCases = `\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n❌ 過去の失敗事例 (直近${Math.min(lossTrades.length, 3)}件)\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;
      
      lossTrades.slice(0, 3).forEach((trade: any, index: number) => {
        const createdDate = new Date(trade.created_at);
        failureCases += `\n\n【失敗${index + 1}】${createdDate.toLocaleString('ja-JP', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}`;
        failureCases += `\n• RSI: ${trade.rsi?.toFixed(1) || "N/A"}, ATR: ${trade.atr?.toFixed(5) || "N/A"}`;
        failureCases += `\n• 理由: ${trade.reason || "N/A"}`;
        failureCases += `\n• AI予測勝率: ${(trade.win_prob * 100).toFixed(0)}%`;
        failureCases += `\n• 結果: LOSS 💥 (損失: ${trade.profit_loss?.toFixed(0) || "N/A"})`;
        if (trade.sl_hit) failureCases += ` ← SL損切り`;
        if (trade.hold_duration_minutes) failureCases += `\n• 保有時間: ${trade.hold_duration_minutes}分`;
      });
      
      failureCases += `\n\n⚠️ 失敗の共通点: これらと類似条件では勝率を下げるべきです。`;
    }
    
    // 全体の勝率統計
    const totalWins = winTrades.length;
    const totalLosses = lossTrades.length;
    const totalTrades = totalWins + totalLosses;
    const overallWinRate = totalTrades > 0 ? (totalWins / totalTrades * 100).toFixed(1) : "N/A";
    
    successCases += `\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n📊 直近30件の統計\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;
    successCases += `\n• WIN: ${totalWins}件, LOSS: ${totalLosses}件`;
    successCases += `\n• 勝率: ${overallWinRate}%`;
    successCases += totalTrades > 0 ? `\n• トレンド: ${parseFloat(overallWinRate) >= 60 ? "📈 好調" : parseFloat(overallWinRate) >= 50 ? "➡️ 普通" : "📉 不調"}` : "";
  }
  
  // ML推奨事項を整形
  if (recommendations && recommendations.length > 0) {
    recommendationsText = `\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n💡 ML推奨事項 (アクティブ)\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;
    
    recommendations.forEach((rec: any, index: number) => {
      const icon = rec.recommendation_type === "favor_pattern" ? "✅" : 
                   rec.recommendation_type === "avoid_pattern" ? "⚠️" : "ℹ️";
      const priority = rec.priority === "high" ? "🔴 高" : 
                       rec.priority === "medium" ? "🟡 中" : "⚫ 低";
      
      recommendationsText += `\n\n【推奨${index + 1}】${icon} ${rec.title}`;
      recommendationsText += `\n• 優先度: ${priority}`;
      recommendationsText += `\n• 内容: ${rec.description}`;
      if (rec.expected_win_rate_improvement) {
        recommendationsText += `\n• 期待勝率改善: ${rec.expected_win_rate_improvement > 0 ? "+" : ""}${(rec.expected_win_rate_improvement * 100).toFixed(0)}%`;
      }
    });
    
    recommendationsText += `\n\n⚡ これらの推奨事項を勝率予測に反映してください。`;
  }
  
  // ⭐ 一目均衡表スコアの詳細分析を追加
  let ichimokuContext = "";
  let signalQuality = "unknown";
  let confidenceBoost = 0;
  
  if (ichimoku_score !== undefined && ichimoku_score !== null) {
    if (ichimoku_score >= 0.9) {
      // 最強シグナル: MA + 一目の両方が完全一致
      signalQuality = "excellent";
      confidenceBoost = 15;
      ichimokuContext = `
- 一目均衡表分析: **最強シグナル（信頼度95%）**
  * 移動平均線（EMA25 vs SMA100）が${dir > 0 ? "上昇" : "下降"}トレンドを示す
  * 一目均衡表の転換線が基準線を${dir > 0 ? "上" : "下"}抜け
  * 価格が雲の${dir > 0 ? "上" : "下"}に位置（強いトレンド）
  * 雲が${dir > 0 ? "青色（陽転）" : "赤色（陰転）"}でトレンドを確認
  → 複数の独立したテクニカル指標が同一方向を示す極めて強いシグナル`;
    } else if (ichimoku_score >= 0.6) {
      // 一目のみが強シグナル
      signalQuality = "good";
      confidenceBoost = 10;
      ichimokuContext = `
- 一目均衡表分析: **強シグナル（信頼度80%）**
  * 一目均衡表が明確な${dir > 0 ? "買い" : "売り"}シグナル
  * 転換線・基準線・雲の3要素が揃っている
  * 移動平均線は中立だが、一目が強い方向性を示す
  → 一目均衡表単独でも信頼できるシグナル`;
    } else if (ichimoku_score >= 0.4) {
      // MAのみが強シグナル
      signalQuality = "moderate";
      confidenceBoost = 5;
      ichimokuContext = `
- 一目均衡表分析: **中程度シグナル（信頼度65%）**
  * 移動平均線が${dir > 0 ? "上昇" : "下降"}トレンドを示す
  * 一目均衡表は中立（雲の中または転換・基準線が接近）
  * トレンド初期または調整局面の可能性
  → 移動平均線のみのシグナルのため慎重に判断`;
    } else if (ichimoku_score > 0) {
      // 弱いシグナル
      signalQuality = "weak";
      confidenceBoost = 0;
      ichimokuContext = `
- 一目均衡表分析: **弱シグナル（信頼度50%）**
  * 指標間の一致度が低い
  * トレンドが不明瞭またはレンジ相場
  → エントリーは慎重に、勝率は低めに見積もるべき`;
    } else {
      // シグナル矛盾
      signalQuality = "conflicting";
      confidenceBoost = -10;
      ichimokuContext = `
- 一目均衡表分析: **⚠️ シグナル矛盾（信頼度30%）**
  * 移動平均線と一目均衡表が逆方向を示している
  * 相場の転換点またはダマシの可能性が高い
  * 例: MAは買いだが、価格が雲の下にある
  → **エントリー非推奨**: 複数指標が矛盾する局面は避けるべき`;
    }
  }
  
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 🎯 フェーズ別システムプロンプト生成
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // IMPORTANT:
  // - ML mode=log_only must NOT influence OpenAI decisions.
  // - Only include ML-derived context in the prompt when ENABLE_ML_CONTEXT_FOR_OPENAI is true.
  const ML_PROMPT_ENABLED = ENABLE_ML_CONTEXT_FOR_OPENAI;
  const mlContextForPrompt = ML_PROMPT_ENABLED ? mlContext : "";
  const successCasesForPrompt = ML_PROMPT_ENABLED ? successCases : "";
  const failureCasesForPrompt = ML_PROMPT_ENABLED ? failureCases : "";
  const recommendationsForPrompt = ML_PROMPT_ENABLED ? recommendationsText : "";

  let systemPrompt = "";
  let priorityGuideline = "";
  
  if (ML_PROMPT_ENABLED && learningPhase === "PHASE3_FULL_ML" && matchedPatterns.length > 0) {
    // ━━━ PHASE 3: 完全MLモード（1000件以上） ━━━
    priorityGuideline = `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🚀 優先順位（完全MLモード）
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. ML学習データ（過去勝率） ⭐⭐⭐⭐⭐ 最重視
2. 過去の成功/失敗事例 ⭐⭐⭐⭐
3. テクニカル指標（補助情報） ⭐⭐
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;
    
    systemPrompt = `あなたはプロの金融トレーダー兼AIアナリストです。1000件以上の実績データに基づくML学習結果を最重視して勝率を予測してください。
${priorityGuideline}
${mlContextForPrompt}${successCasesForPrompt}${failureCasesForPrompt}${recommendationsForPrompt}
${dailyPlanPrompt}
  補助情報: RSI=${rsi.toFixed(2)}, ATR=${atr.toFixed(5)}${atrNorm !== undefined ? `, ATR_norm=${atrNorm.toFixed(8)}` : ""}${adx !== undefined ? `, ADX=${adx.toFixed(2)}` : ""}${diPlus !== undefined ? `, +DI=${diPlus.toFixed(2)}` : ""}${diMinus !== undefined ? `, -DI=${diMinus.toFixed(2)}` : ""}${bbWidth !== undefined ? `, BB_width=${bbWidth.toFixed(6)}` : ""}
${ichimokuContext}
EA判断: ${reason}`;
    
  } else if (ML_PROMPT_ENABLED && learningPhase === "PHASE2_HYBRID" && matchedPatterns.length > 0) {
    // ━━━ PHASE 2: ハイブリッドモード（80-999件、パターンあり） ━━━
    priorityGuideline = `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔄 優先順位（ハイブリッドモード - ML使用）
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. ML学習データ（高品質パターン） ⭐⭐⭐⭐
2. テクニカル指標（総合判断） ⭐⭐⭐
3. 過去の成功/失敗事例 ⭐⭐
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
※ サンプル${mlThresholds.minSamples}件以上 & 信頼度${mlThresholds.minConfidence * 100}%以上の高品質パターンを検出しました。
※ ML学習データとテクニカル指標をバランス良く総合判断してください。`;
    
    systemPrompt = `あなたはプロの金融トレーダー兼AIアナリストです。高品質なML学習結果とテクニカル指標を総合的に判断し、勝率を予測してください。
${priorityGuideline}
${mlContextForPrompt}${successCasesForPrompt}${failureCasesForPrompt}
${dailyPlanPrompt}
  テクニカル指標: RSI=${rsi.toFixed(2)}, ATR=${atr.toFixed(5)}${atrNorm !== undefined ? `, ATR_norm=${atrNorm.toFixed(8)}` : ""}${adx !== undefined ? `, ADX=${adx.toFixed(2)}` : ""}${diPlus !== undefined ? `, +DI=${diPlus.toFixed(2)}` : ""}${diMinus !== undefined ? `, -DI=${diMinus.toFixed(2)}` : ""}${bbWidth !== undefined ? `, BB_width=${bbWidth.toFixed(6)}` : ""}
${ichimokuContext}
EA判断: ${reason}`;
    
  } else {
    // ━━━ PHASE 1 or PHASE 2（パターンなし）: テクニカル判定モード ━━━
    priorityGuideline = `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⚙️  優先順位（テクニカル判定モード）
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. トレンドの一致度 ⭐⭐⭐
2. 一目均衡表の状態 ⭐⭐⭐
3. EA側の一目スコア ⭐⭐⭐
4. RSI/MACDの状態 ⭐⭐
5. ボラティリティ（ATR） ⭐
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;
    
    systemPrompt = `あなたはプロの金融トレーダー兼AIアナリストです。すべてのテクニカル指標とEA側の総合判断を総合的に分析し、取引の成功確率（勝率）を0.0～1.0の範囲で予測してください。
  ${priorityGuideline}${mlContextForPrompt}
${dailyPlanPrompt}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📊 市場情報
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
• 銘柄: ${symbol}
• 時間軸: ${timeframe}
• エントリー方向: ${dir > 0 ? "買い（ロング）" : dir < 0 ? "売り（ショート）" : "中立"}
• 現在価格: ${price}
• Bid: ${req.bid}, Ask: ${req.ask}, Spread: ${((req.ask - req.bid) / price * 10000).toFixed(1)} pips

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📈 テクニカル指標（全データ）
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

【移動平均線】
• EMA25: ${req.ema_25.toFixed(2)}
• SMA100: ${req.sma_100.toFixed(2)}
• SMA200: ${req.sma_200.toFixed(2)}
• SMA800: ${req.sma_800.toFixed(2)}
• MAクロス: ${req.ma_cross > 0 ? "ゴールデンクロス（上昇トレンド）" : "デッドクロス（下降トレンド）"}

【MA配置とトレンド強度】
${(() => {
  const price = req.price;
  const ema25 = req.ema_25;
  const sma100 = req.sma_100;
  const sma200 = req.sma_200;
  const sma800 = req.sma_800;
  
  // パーフェクトオーダーチェック
  const isPerfectBull = price > ema25 && ema25 > sma100 && sma100 > sma200 && sma200 > sma800;
  const isPerfectBear = price < ema25 && ema25 < sma100 && sma100 < sma200 && sma200 < sma800;
  
  // 200日線との位置関係
  const diff200 = ((price - sma200) / sma200 * 100);
  const pos200 = price > sma200 ? "上" : price < sma200 ? "下" : "同水準";
  
  // 800日線との位置関係
  const diff800 = ((price - sma800) / sma800 * 100);
  const pos800 = price > sma800 ? "上" : price < sma800 ? "下" : "同水準";
  
  let analysis = "";
  
  if (isPerfectBull) {
    analysis = "🔥 パーフェクトオーダー（上昇）達成！全MAが順番に並び最強の上昇トレンド";
  } else if (isPerfectBear) {
    analysis = "🔥 パーフェクトオーダー（下降）達成！全MAが順番に並び最強の下降トレンド";
  } else {
    analysis = `価格は200日線の${pos200}（${diff200.toFixed(1)}%）、800日線の${pos800}（${diff800.toFixed(1)}%）`;
  }
  
  // 長期トレンドの判定
  let longTrend = "";
  if (price > sma200 && price > sma800) {
    longTrend = "✅ 長期上昇トレンド（200日線・800日線の両方を上回る）";
  } else if (price < sma200 && price < sma800) {
    longTrend = "⚠️ 長期下降トレンド（200日線・800日線の両方を下回る）";
  } else {
    longTrend = "⚡ 長期トレンド転換期（200日線と800日線の間で攻防中）";
  }
  
  return `• ${analysis}\n• ${longTrend}`;
})()}

【MACD】
• Main: ${req.macd.main.toFixed(5)}
• Signal: ${req.macd.signal.toFixed(5)}
• Histogram: ${req.macd.histogram.toFixed(5)}
• クロス: ${req.macd.cross > 0 ? "上昇クロス（買いシグナル）" : "下降クロス（売りシグナル）"}

【モメンタム】
• RSI: ${rsi.toFixed(2)} ${rsi > 70 ? "⚠️ 買われすぎ（反転リスク高）" : rsi < 30 ? "⚠️ 売られすぎ（反転チャンス）" : rsi > 50 && rsi <= 70 ? "✓ 健全な上昇" : rsi >= 30 && rsi < 50 ? "✓ 健全な下降" : "✓ 中立"}
• ATR: ${atr.toFixed(5)} ${atr > 0.001 ? "（高ボラティリティ→大きな値動き、利益チャンス大）" : atr < 0.0005 ? "（低ボラティリティ→小さな値動き、レンジ相場）" : "（通常ボラティリティ）"}

【レジーム（追加特徴量）】
• ATR正規化（ATR/価格）: ${atrNorm !== undefined ? atrNorm.toFixed(8) : "N/A"}
• ADX: ${adx !== undefined ? adx.toFixed(2) : "N/A"}
• +DI: ${diPlus !== undefined ? diPlus.toFixed(2) : "N/A"}, -DI: ${diMinus !== undefined ? diMinus.toFixed(2) : "N/A"}
• BB幅（(Upper-Lower)/Middle）: ${bbWidth !== undefined ? bbWidth.toFixed(6) : "N/A"}

【一目均衡表】
• 転換線: ${req.ichimoku.tenkan.toFixed(2)}
• 基準線: ${req.ichimoku.kijun.toFixed(2)}
• 先行スパンA: ${req.ichimoku.senkou_a.toFixed(2)}
• 先行スパンB: ${req.ichimoku.senkou_b.toFixed(2)}
• 遅行スパン: ${req.ichimoku.chikou.toFixed(2)}
• TK_Cross: ${req.ichimoku.tk_cross > 0 ? "転換線 > 基準線（短期上昇）" : "転換線 < 基準線（短期下降）"}
• 雲の色: ${req.ichimoku.cloud_color > 0 ? "陽転（青雲、上昇トレンド）" : "陰転（赤雲、下降トレンド）"}
• 価格 vs 雲: ${req.ichimoku.price_vs_cloud > 0 ? "雲の上（強気相場）" : req.ichimoku.price_vs_cloud < 0 ? "雲の下（弱気相場）" : "雲の中（不確実、レンジ）"}

【ローソク足パターン（直近確定足）】
• Bull Engulfing: ${cf?.bull_engulfing ? "あり" : "なし"}, Bear Engulfing: ${cf?.bear_engulfing ? "あり" : "なし"}
• Bull Pinbar: ${cf?.bull_pinbar ? "あり" : "なし"}, Bear Pinbar: ${cf?.bear_pinbar ? "あり" : "なし"}
• Inside Bar: ${cf?.inside_bar ? "あり" : "なし"}, Inside Break Dir: ${cf?.inside_break_dir ?? 0}
• 3-bar up/down: ${cf?.three_up ? "up" : "-"} / ${cf?.three_down ? "down" : "-"}
• 反転スコア（Bull/Bear）: ${cf?.bull_reversal_score ?? 0} / ${cf?.bear_reversal_score ?? 0}
• 継続スコア（Bull/Bear）: ${cf?.bull_continuation_score ?? 0} / ${cf?.bear_continuation_score ?? 0}

【生OHLC（直近、古い→新しい）】
${candleBarsSummary}

【EA総合判断】
• 判定: ${reason}
• 一目スコア: ${ichimoku_score?.toFixed(2) || "N/A"} ${ichimokuContext}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🎯 勝率予測ガイドライン（総合判断）
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**基準となる判断要素:**

1. **パーフェクトオーダー** ⭐⭐⭐⭐⭐
   - 全MA順列（価格>EMA25>SMA100>SMA200>SMA800）→ 80-90%（最強トレンド）
   - 逆パーフェクトオーダー → 80-90%（最強下降、売りの場合）
   - パーフェクトオーダー達成時は勝率を大幅に上げる

2. **長期トレンド（200日線・800日線）** ⭐⭐⭐⭐
   - 価格が200日線・800日線の両方の上 → +10-15%（長期上昇相場）
   - 価格が200日線・800日線の両方の下 → +10-15%（長期下降、売りの場合）
   - 200日線と800日線の間で攻防 → -5-10%（トレンド転換期、不確実性）
   - 200日線からの乖離率が大きい（±5%以上）→ -5-10%（過熱/冷え込み）

3. **トレンドの一致度** ⭐⭐⭐
   - MA、MACD、一目均衡表が同一方向 → 70-85%（強いトレンド）
   - 2つが一致、1つが中立 → 60-70%（中程度のトレンド）
   - 指標が分散 → 50-60%（弱いトレンド）
   - 指標が矛盾 → 30-45%（不確実、リスク高）

4. **一目均衡表の状態** ⭐⭐⭐
   - 価格が雲の上 + 陽転 + TK上昇クロス → +10-15%
   - 価格が雲の下 + 陰転 + TK下降クロス → +10-15%（売りの場合）
   - 価格が雲の中 → -10-15%（不確実性ペナルティ）

5. **RSIの状態** ⭐⭐
   - RSI 50-70 + 買い方向 → +5-10%（健全な上昇）
   - RSI 30-50 + 売り方向 → +5-10%（健全な下降）
   - RSI 70超 + 買い方向 → -10-20%（反転リスク）
   - RSI 30未満 + 売り方向 → -10-20%（反転リスク）
   - RSI 30未満 + 買い方向 → +5-10%（逆張りチャンス）
   - RSI 70超 + 売り方向 → +5-10%（逆張りチャンス）

6. **MACDの状態** ⭐⭐
   - MACD上昇クロス + 買い方向 → +5-8%
   - MACD下降クロス + 売り方向 → +5-8%
   - Histogram拡大 → +3-5%（モメンタム増加）
   - MACDとエントリー方向が逆 → -8-12%

7. **ボラティリティ（ATR）** ⭐
   - 高ボラティリティ → +3-5%（利益チャンス大）
   - 低ボラティリティ → -5-10%（レンジ相場リスク）

8. **EA側の一目スコア** ⭐⭐⭐
   - excellent (0.9+) → 基準勝率 75-85%
   - good (0.6-0.9) → 基準勝率 65-75%
   - moderate (0.4-0.6) → 基準勝率 55-65%
   - weak (0.0-0.4) → 基準勝率 45-55%
   - conflicting (<0.0) → 基準勝率 30-45%

9. **ローソク足パターン（反転/継続）** ⭐⭐⭐
  - 反転スコアが高い + RSI過熱/売られすぎ + 指標の過熱感 → 逆張り候補
  - 継続スコアが高い + MA/一目と同方向 → 順張り優先
  - ローソク足が他指標と矛盾する場合は過信せず勝率を抑制

10. **生OHLCの並び（文脈判断）** ⭐⭐⭐
  - 連続高値切り上げ/安値切り上げは順張りを優先
  - 長い上ヒゲ連発+上昇鈍化、または長い下ヒゲ連発+下落鈍化は反転候補
  - 単発シグナルより、複数本での整合性を優先

**勝率範囲: 0%～100%**
- 最悪のシナリオ（全指標矛盾、高リスク）→ 0-20%
- 不確実性が高い（指標分散）→ 25-40%
- 中程度の確信（一部一致）→ 40-55%
- 高い確信（多数一致）→ 55-68%
- 最高のシナリオ（パーフェクトオーダー、全指標完全一致）→ 65-78%

⭐ **RSI極値での逆張りセットアップ（実績上の高勝率条件）**:
過去データの分析から、以下の条件で実際の勝率が約63%と高くなります:
- **SHORT with RSI >= 70** (買われすぎからの反転): win_prob = 0.68-0.80 を推奨
- **LONG with RSI <= 30** (売られすぎからの反転): win_prob = 0.68-0.80 を推奨
これはトレンドフォローの25%勝率に対して、平均回帰（逆張り）が優位な現在の相場環境を反映しています。
RSIが極値の場合は積極的に高い win_prob を設定してください。

⚠️ **キャリブレーション注記**: 実績データによると、AIの予測には系統的な過信が見られます。
「高い確信」シグナルでも実際の勝率は50-65%程度です（RSI逆張りを除く）。保守的な予測（-5〜-10%調整）を心がけてください。`;
  }
  
  // 共通の回答形式指示
  systemPrompt += `

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📋 回答形式（JSON）
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
以下のJSON形式で回答してください:
{
  "win_prob": 0.XX,  // 0.00～1.00の範囲で動的に設定
  "recommended_min_win_prob": 0.70, // 0.60～0.75（重要: 0.75を超えない＝取引機会を減らさない）
  "skip_reason": "", // 見送りなら理由（例: "range", "conflict", "news"）
  "confidence": "high" | "medium" | "low",
  "reasoning": "判断理由（40文字以内、主要な根拠を明記）"
}

  重要: 
• 上記の優先順位に従って判断してください
• ${ENABLE_ML_CONTEXT_FOR_OPENAI ? (learningPhase === "PHASE3_FULL_ML" ? "ML学習データの過去勝率を最重視" : learningPhase === "PHASE2_HYBRID" && matchedPatterns.length > 0 ? "ML学習データとテクニカル指標をバランス良く総合判断" : "すべてのテクニカル指標を総合的に評価") : "すべてのテクニカル指標を総合的に評価"}してください
• 0%～90%の幅広い範囲で動的に算出してください
• 実績ベースのキャリブレーション注記を参考に、過信を避けてください`;

  // 学習データ収集フェーズ用の総合判断プロンプト（廃止：上記に統合）
  const prompt = systemPrompt;

  try {
    const openAiTimeoutRaw = Number(Deno.env.get("OPENAI_TIMEOUT_MS") ?? "12000");
    const openAiTimeoutMs = Math.max(500, Math.min(60_000, Number.isFinite(openAiTimeoutRaw) ? openAiTimeoutRaw : 12000));
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), openAiTimeoutMs);

    let response: Response;
    try {
      response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: OPENAI_MODEL,  // 環境変数で設定可能 (デフォルト: gpt-4.1-mini)
        messages: [
          { 
            role: "system", 
            content: ENABLE_ML_CONTEXT_FOR_OPENAI 
              ? `あなたはプロの金融トレーダーです。以下の優先順位で分析してください:

⭐⭐⭐ 最優先: ML学習済みパターンの実績データ（勝率、利益率、サンプル数）
⭐⭐⭐ 最優先: 過去の成功・失敗事例から学ぶ（同じ失敗を繰り返さない）
⭐⭐ 重要: ML推奨事項（favor/avoid）に従う
⭐ 参考: テクニカル指標（一目均衡表、RSI、ATR）

JSON形式で簡潔に回答してください。過度に楽観的な予測は避け、実績データを最重視してください。`
              : `あなたはプロの金融トレーダーです。すべてのテクニカル指標を総合的に分析して勝率を予測してください。

🎯 分析の重要ポイント:
⭐⭐⭐ 最重視: 指標間の一致度（MA、MACD、一目均衡表が同一方向か？）
⭐⭐⭐ 最重視: 一目均衡表の状態（価格vs雲、雲の色、TKクロス）
⭐⭐ 重要: RSIの状態（買われすぎ/売られすぎ、エントリー方向との整合性）
⭐⭐ 重要: MACDの方向性（エントリー方向との一致度）
⭐ 参考: ATR（ボラティリティ、利益チャンスの大きさ）
⭐ 参考: EA側の一目スコア（総合判定の信頼度）

💡 判断基準:
• 全指標が一致 → 高勝率（70-95%）
• 大半が一致 → 中高勝率（60-75%）
• 指標が分散 → 中勝率（50-65%）
• 指標が矛盾 → 低勝率（30-45%）
• 最悪の条件 → 極低勝率（0-20%）

0%～100%の幅広い範囲で動的に算出し、JSON形式で簡潔に回答してください。指標間の矛盾が多いほど低勝率、一致が多いほど高勝率を設定してください。

JSON形式で回答: {"win_prob": 0.XX, "recommended_min_win_prob": 0.70, "skip_reason": "", "confidence": "high|medium|low", "reasoning": "…"}`
          },
          { role: "user", content: prompt }
        ],
        temperature: 0.2,  // より一貫性のある予測のため低めに設定
        max_tokens: 250,
      }),
      });
    } finally {
      clearTimeout(timeoutId);
    }

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[AI] OpenAI API error: ${response.status} - ${errorText}`);
      console.warn("[AI] Falling back to rule-based calculation");
      return await calculateSignalFallbackWithCalibration(req);
    }

    const data = await response.json();
    const content = data.choices[0].message.content;
    
    // JSONを抽出（マークダウンコードブロックを除去）
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error("[AI] No JSON in response. Raw content:", content.substring(0, 200));
      console.warn("[AI] Falling back to rule-based calculation");
      return await calculateSignalFallbackWithCalibration(req);
    }
    
  const aiResult = JSON.parse(jsonMatch[0]);
    let win_prob = parseFloat(aiResult.win_prob);
    
    // 安全性チェック
    if (isNaN(win_prob) || win_prob < 0 || win_prob > 1) {
      console.error("[AI] Invalid win_prob:", win_prob, "from AI response:", JSON.stringify(aiResult));
      console.warn("[AI] Falling back to rule-based calculation");
      return await calculateSignalFallbackWithCalibration(req);
    }
    
    // ⭐ 学習データ収集フェーズではML調整をスキップ
    if (APPLY_ML_WIN_PROB_ADJUSTMENT && mlWinRateBoost !== 0) {
      const originalProb = win_prob;
      win_prob = win_prob + mlWinRateBoost;
      console.log(`[AI] ML adjustment applied: ${originalProb.toFixed(3)} → ${win_prob.toFixed(3)} (boost: ${mlWinRateBoost.toFixed(3)})`);
    }
    
    // 勝率範囲を0%～90%に設定（幅広く動的に算出）
    win_prob = clampWinProb(win_prob);

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // ✅ Win probability calibration (server-side)
    // Uses recent realized outcomes (WIN/LOSS) from ai_signals to reduce overconfidence.
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    const calibrationMode = getCalibrationMode();
    const calibrationRequired = calibrationMode === "on" && isCalibrationRequired();

    const raw_win_prob = win_prob;
    const cal = await calibrateWinProb(req, raw_win_prob);
    win_prob = cal.winProb;

    const calibrationOk = !calibrationRequired || cal.debug.applied;
    
    const confidence = aiResult.confidence || "unknown";
    const rt = await getRuntimeTradeParams(req);
    const clientMinWinProbProvided = typeof req.min_win_prob === "number";
    const client_min_win_prob = sanitizeRecommendedMinWinProb(
      clientMinWinProbProvided ? req.min_win_prob : (rt.minWinProbFromConfig ?? undefined),
    ) ?? 0.70;
    const reasoningBase = aiResult.reasoning || "N/A";
    const reasoningBase2 = clientMinWinProbProvided || rt.minWinProbFromConfig !== null
      ? reasoningBase
      : `${reasoningBase} | WARN: min_win_prob not provided; default gate=0.70`;
    const reasoning = (!ENABLE_ML_CONTEXT_FOR_OPENAI && (matchedPatterns?.length ?? 0) > 0)
      ? `${reasoningBase2} | ML: ${mlMode} (pattern logged, not applied)`
      : reasoningBase2;
    const recommended_min_win_prob = sanitizeRecommendedMinWinProb(aiResult.recommended_min_win_prob);
    // recommended_min_win_prob はログ/参考用（実行ゲートとしては使用しない）。
    const minEvR = getMinEvR();
    const evGateMinWinProb = computeEvGateMinWinProb({ rewardRR: rt.rewardRR, costR: rt.costR, minEvR });
    const minWinProbFloor = getMinWinProbFloor();
    const maxCostR = getMaxCostR();
    // Respect EA/configured minimum, never execute below it.
    const action_gate_min_win_prob = Math.max(minWinProbFloor, client_min_win_prob);
    const rsiGuard = applyExtremeRsiPenalty({ req, dir, winProb: win_prob, costR: rt.costR });
    win_prob = rsiGuard.winProb;

    // RSI Mean-Reversion Bonus: SHORT@RSI>=70 / LONG@RSI<=30 has ~63% win rate historically.
    const rsiMrBonus = applyRsiMrBonus({ req, dir, winProb: win_prob });
    win_prob = rsiMrBonus.winProb;

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // ✅ Recent performance soft guard
    // Skip for RSI MR trades: recent perf is trend-follow history, not MR trades.
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    const recentPerfResult = rsiMrBonus.skipsRecentPerf
      ? { winProb: win_prob, applied: false, guardTag: "" }
      : await applyRecentPerfGuard(req, dir, win_prob);
    win_prob = recentPerfResult.winProb;

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // ✅ Consecutive loss streak guard (v2.7.0)
    // Skip for RSI MR trades (same rationale as RECENT_PERF).
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    const streakResult = rsiMrBonus.skipsStreakGuard
      ? { winProb: win_prob, applied: false, streak: 0, guardTag: "" }
      : await applyStreakGuard(req, dir, win_prob);
    win_prob = streakResult.winProb;

    // Effective gate: lower slightly for RSI mean-reversion setups.
    const effective_gate = action_gate_min_win_prob - rsiMrBonus.gateReduction;

    const expected_value_r = computeExpectedValueR(win_prob, rt.rewardRR, rt.costR);
    let skip_reason = typeof aiResult.skip_reason === "string" ? aiResult.skip_reason : "";
    const entry_method: "market" = "market";
    const entry_params: null = null;
    const method_reason = "market-only execution";
    
    // 詳細ログ出力
    console.log(
      `[AI] OpenAI GPT-4 prediction: ${(win_prob * 100).toFixed(1)}% (${confidence}) - ${reasoning} | ` +
      `ichimoku=${ichimoku_score?.toFixed(2) || "N/A"} quality=${signalQuality} | entry_method=${entry_method} | lot=fixed`
    );
    
    // Put diagnostics first so they survive EA-side truncation.
    const gateTag =
      `GATE(EV>=${minEvR.toFixed(2)}R rr=${round3(rt.rewardRR)} costR=${round3(rt.costR)} ` +
      `costSrc=${rt.costRSource} maxCostR=${round3(maxCostR)} gateP=${round3(effective_gate)} ` +
      `calReq=${calibrationRequired ? 1 : 0} calApplied=${cal.debug.applied ? 1 : 0})`;

    const calTag = cal.debug.applied
      ? `CAL(${cal.debug.method}/${cal.debug.scope} n=${cal.debug.n}): raw=${round3(raw_win_prob)}→${round3(cal.winProb)}`
      : "";
    const rsiGuardTag = rsiGuard.guardTag;
    const rsiMrBonusTag = rsiMrBonus.guardTag;
    const recentPerfTag = recentPerfResult.guardTag;
    const streakTag = streakResult.guardTag;

    const tags = [gateTag, calTag, rsiGuardTag, rsiMrBonusTag, recentPerfTag, streakTag].filter((s) => s && s.trim().length > 0).join(" | ");

    const costOk = rt.costR <= maxCostR;
    const willExecute =
      costOk &&
      calibrationOk &&
      win_prob >= effective_gate &&
      expected_value_r >= minEvR;
    if (!willExecute && dir !== 0) {
      const parts: string[] = [];
      if (!calibrationOk) parts.push("calibration_not_applied");
      if (!costOk) parts.push("cost_too_high");
      if (expected_value_r < minEvR) parts.push("ev_below_min");
      if (win_prob < effective_gate) parts.push("winprob_below_gate");
      if (rsiGuard.applied) parts.push("extreme_rsi_penalty");
      if (rsiMrBonus.applied) parts.push("rsi_mr_bonus");
      if (recentPerfResult.applied) parts.push("recent_perf_penalty");
      if (streakResult.applied) parts.push("streak_guard");
      if (parts.length > 0) skip_reason = skip_reason ? `${skip_reason}|${parts.join("+")}` : parts.join("+");
    }

    const decision_summary = buildDecisionSummary({
      willExecute,
      dir,
      winProb: win_prob,
      effectiveGate: effective_gate,
      expectedValueR: expected_value_r,
      minEvR,
      costR: rt.costR,
      maxCostR,
      calibrationRequired,
      calibrationApplied: cal.debug.applied,
      skipReason: skip_reason,
    });

    return {
      win_prob: round3(win_prob),
      action: willExecute ? dir : 0,
      decision_summary,
      suggested_dir: dir,
      offset_factor: atr > 0.001 ? 0.25 : 0.2,
      expiry_minutes: 90,
      confidence: confidence,
      reasoning: `${tags} | ${reasoning}`,
      recommended_min_win_prob: recommended_min_win_prob ?? undefined,
      expected_value_r,
      reward_rr: round3(rt.rewardRR),
      risk_atr_mult: round3(rt.riskAtrMult),
      cost_r: round3(rt.costR),
      cost_r_source: rt.costRSource,
      skip_reason,
      entry_method,
      entry_params,
      method_selected_by: "OpenAI",
      method_reason,
      ml_pattern_used: matchedPatterns && matchedPatterns.length > 0,
      ml_pattern_id: matchedPatterns && matchedPatterns.length > 0 ? matchedPatterns[0].id : null,
      ml_pattern_name: matchedPatterns && matchedPatterns.length > 0 ? matchedPatterns[0].pattern_name : null,
      ml_pattern_confidence: matchedPatterns && matchedPatterns.length > 0 ? Math.round(matchedPatterns[0].win_rate * 100 * 100) / 100 : null,
      win_prob_raw: round3(raw_win_prob),
      win_prob_calibrated: round3(cal.winProb),
      win_prob_final: round3(win_prob),
      calibration_applied: cal.debug.applied,
      calibration_version: cal.debug.version ?? null,
      calibration_method: cal.debug.method ?? null,
      calibration_scope: cal.debug.scope ?? null,
      calibration_sample_size: cal.debug.n ?? null,
      calibration_bin_sample_size: cal.debug.bin_n ?? null,
      calibration_shift: round3(cal.winProb - raw_win_prob),
      probability_adjustments: {
        calibration_version: cal.debug.version ?? null,
        calibration_source: cal.debug.source ?? null,
        calibration: round3(cal.winProb - raw_win_prob),
        extreme_rsi: round3(rsiGuard.winProb - cal.winProb),
        rsi_mean_reversion: round3(rsiMrBonus.winProb - rsiGuard.winProb),
        recent_performance: round3(recentPerfResult.winProb - rsiMrBonus.winProb),
        loss_streak: round3(streakResult.winProb - recentPerfResult.winProb),
        total_post_calibration: round3(win_prob - cal.winProb),
      },
      win_prob_calibration: cal.debug,
      trade_plan_id: dailyPlanContext?.report_id ?? null,
      plan_alignment: dailyPlanContext?.item ? "model_context" : "no_symbol_plan",
      event_risk: activeEventWindow(dailyPlanContext?.item) ? "high" : "none",
      daily_plan: dailyPlanContext,
    } as any;
    
  } catch (error) {
    console.error("[AI] OpenAI exception:", error instanceof Error ? error.message : String(error));
    console.error("[AI] Stack trace:", error instanceof Error ? error.stack : "N/A");
    console.warn("[AI] Falling back to rule-based calculation");
    return await calculateSignalFallbackWithCalibration(req);
  }
}

function pickBetterDirection(
  buy: TradeResponse,
  sell: TradeResponse,
): { selectedDir: 1 | -1; selected: TradeResponse } {
  // Primary: higher expected_value_r. Secondary: higher win_prob.
  const buyEv = typeof buy.expected_value_r === "number" ? buy.expected_value_r : -Infinity;
  const sellEv = typeof sell.expected_value_r === "number" ? sell.expected_value_r : -Infinity;

  if (buyEv > sellEv) return { selectedDir: 1, selected: buy };
  if (sellEv > buyEv) return { selectedDir: -1, selected: sell };

  const buyWin = typeof buy.win_prob === "number" ? buy.win_prob : -Infinity;
  const sellWin = typeof sell.win_prob === "number" ? sell.win_prob : -Infinity;
  if (buyWin >= sellWin) return { selectedDir: 1, selected: buy };
  return { selectedDir: -1, selected: sell };
}

// OpenAI APIを使用したAI予測（dir=0 の場合は BUY/SELL を両方評価して比較）
async function calculateSignalWithAI(req: TradeRequest): Promise<TradeResponse> {
  const requestedDir = req?.ea_suggestion?.dir;
  if (requestedDir === 0) {
    const baseSuggestion = req.ea_suggestion;

    const buyReq: TradeRequest = {
      ...req,
      ea_suggestion: {
        ...baseSuggestion,
        dir: 1,
        tech_dir:
          typeof baseSuggestion.tech_dir === "number" ? baseSuggestion.tech_dir : undefined,
      },
    };
    const sellReq: TradeRequest = {
      ...req,
      ea_suggestion: {
        ...baseSuggestion,
        dir: -1,
        tech_dir:
          typeof baseSuggestion.tech_dir === "number" ? baseSuggestion.tech_dir : undefined,
      },
    };

    const [buyRes, sellRes] = await Promise.all([
      calculateSignalWithAIForFixedDir(buyReq),
      calculateSignalWithAIForFixedDir(sellReq),
    ]);

    const picked = pickBetterDirection(buyRes, sellRes);
    const selected = picked.selected;

    // Ensure suggested_dir is always the chosen direction even if action=0.
    const mergedReasoning = [
      selected.reasoning,
      `DUAL_DIR: selected=${picked.selectedDir} buy=${buyRes.win_prob?.toFixed?.(3) ?? buyRes.win_prob} sell=${sellRes.win_prob?.toFixed?.(3) ?? sellRes.win_prob}`,
    ]
      .filter(Boolean)
      .join(" | ");

    return {
      ...selected,
      suggested_dir: picked.selectedDir,
      buy_win_prob: buyRes.win_prob,
      sell_win_prob: sellRes.win_prob,
      buy_action: buyRes.action,
      sell_action: sellRes.action,
      reasoning: mergedReasoning,
      direction_eval: {
        selected_dir: picked.selectedDir,
        buy: {
          win_prob: buyRes.win_prob,
          action: buyRes.action,
          expected_value_r: buyRes.expected_value_r,
          entry_method: buyRes.entry_method,
          skip_reason: buyRes.skip_reason,
        },
        sell: {
          win_prob: sellRes.win_prob,
          action: sellRes.action,
          expected_value_r: sellRes.expected_value_r,
          entry_method: sellRes.entry_method,
          skip_reason: sellRes.skip_reason,
        },
      },
    };
  }

  return calculateSignalWithAIForFixedDir(req);
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }
  
  if (req.method === "GET") {
    // OpenAI API KEY の詳細確認
    const hasKey = OPENAI_API_KEY && OPENAI_API_KEY.length > 10 && !OPENAI_API_KEY.includes("YOUR_");
    const keyStatus = OPENAI_API_KEY 
      ? (hasKey ? `configured (${OPENAI_API_KEY.length} chars)` : "invalid or placeholder")
      : "NOT SET";

    const mlMode = getMlMode();
    const emergencyStopEnabled = isEmergencyStopEnabled();

    // Compute learning phase in the same way as POST (lightweight count query)
    const { count: completedTradesCount } = await supabase
      .from("ai_signals")
      .select("*", { count: "exact", head: true })
      .in("actual_result", ["WIN", "LOSS"])
      .eq("reverse_execution", false)
      .eq("is_virtual", false);
    const totalCompletedTrades = completedTradesCount || 0;
    const learningPhase = totalCompletedTrades < 80
      ? "PHASE1_TECHNICAL"
      : totalCompletedTrades < 1000
        ? "PHASE2_HYBRID"
        : "PHASE3_FULL_ML";

    const mlLearningEnabled = learningPhase !== "PHASE1_TECHNICAL";
    const mlAppliedToDecisions = mlLearningEnabled && mlMode === "on";
    
    return new Response(
      JSON.stringify({ 
        ok: true, 
        service: "ai-trader with OpenAI + Comprehensive Technical Analysis", 
        version: "2.10.0-chart-structure",
        mode: "COMPREHENSIVE_TECHNICAL",
        ai_enabled: hasKey,
        ml_learning_enabled: mlLearningEnabled,
        ml_mode: mlMode,
        ml_phase: learningPhase,
        ml_applied_to_decisions: mlAppliedToDecisions,
        emergency_stop_enabled: emergencyStopEnabled,
        ml_completed_trades: totalCompletedTrades,
        openai_key_status: keyStatus,
        openai_model: OPENAI_MODEL,
        fallback_available: true,
        win_prob_range: "0% - 100%",
        features: [
          "comprehensive_technical_analysis",
          "all_indicators_integrated",
          "openai_gpt",
          "ma_cross",
          "macd",
          "rsi",
          "atr",
          "ichimoku_full",
          "daily_trade_plan_guard",
          "higher_timeframe_context",
          "chart_structure_guard",
          "volatility_cost_context",
          "market_only_execution"
        ],
        note: "Learning phase: AI comprehensively analyzes all technical indicators (MA, MACD, RSI, ATR, Ichimoku). ML phase gating: <80 trades=technical, 80-999=hybrid, 1000+=full. Set AI_TRADER_ML_MODE=on to apply ML to decisions (otherwise log_only)."
      }),
      { status: 200, headers: corsHeaders() }
    );
  }
  
  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      { status: 405, headers: corsHeaders() }
    );
  }
  
  try {
    const raw = await req.text();
    const safe = raw.replace(/\u0000+$/g, "");
    
    let body;
    try {
      body = JSON.parse(safe);
    } catch (parseError) {
      console.error("[ai-trader] JSON parse error:", parseError);
      return new Response(
        JSON.stringify({ error: "Invalid JSON" }),
        { status: 400, headers: corsHeaders() }
      );
    }
    
    // v1.4.0 新構造のバリデーション
    const required = ["symbol", "timeframe", "price", "rsi", "atr"];
    for (const field of required) {
      if (!(field in body)) {
        return new Response(
          JSON.stringify({ error: `Missing: ${field}` }),
          { status: 400, headers: corsHeaders() }
        );
      }
    }
    
    // ea_suggestionの存在確認
    if (!body.ea_suggestion || typeof body.ea_suggestion !== 'object') {
      return new Response(
        JSON.stringify({ error: "Missing: ea_suggestion" }),
        { status: 400, headers: corsHeaders() }
      );
    }
    
    if (!("dir" in body.ea_suggestion)) {
      return new Response(
        JSON.stringify({ error: "Missing: ea_suggestion.dir" }),
        { status: 400, headers: corsHeaders() }
      );
    }
    
    const tradeReq: TradeRequest = normalizeTradeRequest(body);
    const emergencyStopEnabled = isEmergencyStopEnabled();

    // Input sanity guard: if EA payload is corrupted (missing/zeroed indicators), never execute.
    // Return a normal 200 response (action=0) so EA can continue operating without hard failures.
    const sanityIssues = assessInputSanity(tradeReq);
    if (sanityIssues.length > 0) {
      const summary = sanityIssues
        .slice(0, 8)
        .map((i) => `${i.field}:${i.problem}`)
        .join(", ");
      const methodReason = `GUARD: bad_inputs (${sanityIssues.length}) ${summary}`;
      console.warn(`[ai-trader] ⚠️ ${methodReason}`);

      const requestedDir = tradeReq?.ea_suggestion?.dir;
      const suggested_dir = requestedDir === 1 || requestedDir === -1 ? requestedDir : undefined;

      const response: TradeResponse = {
        win_prob: 0.5,
        action: 0,
        suggested_dir,
        offset_factor: 0.2,
        expiry_minutes: 90,
        confidence: "low",
        reasoning: methodReason,
        skip_reason: "bad_inputs",
        entry_method: "market",
        entry_params: null,
        method_selected_by: "Manual",
        method_reason: methodReason,
      };

      return new Response(JSON.stringify(response), { status: 200, headers: corsHeaders() });
    }
    
    // ⭐ OpenAI API KEY の存在確認とログ
    const hasOpenAIKey = OPENAI_API_KEY && OPENAI_API_KEY.length > 10 && !OPENAI_API_KEY.includes("YOUR_");
    
    if (!hasOpenAIKey) {
      console.warn(`[ai-trader] ⚠️ OPENAI_API_KEY not properly configured!`);
      console.warn(`[ai-trader] Key status: ${OPENAI_API_KEY ? `exists (length=${OPENAI_API_KEY.length})` : "NOT SET"}`);
      console.warn(`[ai-trader] Using FALLBACK calculation only`);
    } else {
      console.log(`[ai-trader] ✓ OpenAI API KEY configured (length=${OPENAI_API_KEY.length})`);
    }
    
    // OpenAI_API_KEYが設定されていればAI使用、なければフォールバック
    let response;
    let predictionMethod = "UNKNOWN";
    
    if (hasOpenAIKey) {
      console.log(`[ai-trader] 🤖 Attempting OpenAI GPT prediction... (Mode: TECHNICAL_ONLY - Learning Phase)`);
      try {
        response = await calculateSignalWithAI(tradeReq);
        predictionMethod = "OpenAI-GPT-Technical";
        console.log(`[ai-trader] ✓ OpenAI prediction successful (technical indicators only)`);
      } catch (aiError) {
        console.error(`[ai-trader] ❌ OpenAI prediction failed:`, aiError);
        console.warn(`[ai-trader] Switching to fallback calculation...`);
        response = await calculateSignalFallbackWithCalibration(tradeReq);
        predictionMethod = "Fallback-AfterAI-Error";
      }
    } else {
      console.warn(`[ai-trader] ⚠️ Using rule-based FALLBACK (no OpenAI key)`);
      response = await calculateSignalFallbackWithCalibration(tradeReq);
      predictionMethod = "Fallback-NoKey";
    }

    // Apply hard guards (double-safety with EA-side rules)
    response = applyExecutionGuards(tradeReq, response);
    response = applyChartQualityGuard(tradeReq, response);
    response = await applyDailyPlanGuard(tradeReq, response);

    // Emergency stop: keep AI inference (win_prob/reasoning) for monitoring/learning,
    // but force execution decision to no-trade.
    if (emergencyStopEnabled) {
      const stopReason = "EMERGENCY_STOP: forced action=0 by AI_TRADER_EMERGENCY_STOP";
      const prevSkip = typeof (response as any).skip_reason === "string" ? (response as any).skip_reason : "";
      const prevReasoning = typeof (response as any).reasoning === "string" ? (response as any).reasoning : "";
      const prevMethodReason = typeof (response as any).method_reason === "string" ? (response as any).method_reason : "";

      (response as any).action = 0;
      (response as any).skip_reason = prevSkip ? `${prevSkip}|emergency_stop` : "emergency_stop";
      (response as any).reasoning = prevReasoning ? `${prevReasoning} | ${stopReason}` : stopReason;
      (response as any).method_reason = prevMethodReason ? `${prevMethodReason} | ${stopReason}` : stopReason;

      console.warn(`[ai-trader] 🚨 ${stopReason}`);
    }

    // Attach market regime classification for logging/analysis.
    // Keep this deterministic so it exists even when OpenAI is unavailable.
    const regimeInfo = classifyMarketRegime(tradeReq);
    response = { ...response, ...regimeInfo };

    // Embed regime info into reasoning so downstream loggers can reconstruct
    // even if clients don't forward separate regime/strategy fields.
    (response as any).reasoning = attachRegimePrefixToReasoning(
      (response as any).reasoning,
      (response as any).regime,
      (response as any).strategy,
      (response as any).regime_confidence,
    );
    
    // ⭐ 詳細ログ出力（判定方法を明示）
    const ichimokuInfo = tradeReq.ea_suggestion.ichimoku_score !== undefined 
      ? ` ichimoku=${tradeReq.ea_suggestion.ichimoku_score.toFixed(2)}` 
      : "";

    const techDirInfo = typeof tradeReq.ea_suggestion.tech_dir === "number"
      ? ` tech_dir=${tradeReq.ea_suggestion.tech_dir}`
      : "";
    const suggestedDirInfo = typeof (response as any).suggested_dir === "number"
      ? ` suggested_dir=${(response as any).suggested_dir}`
      : "";
    
    console.log(
      `[ai-trader] 📊 RESULT: ${tradeReq.symbol} ${tradeReq.timeframe} ` +
      `req_dir=${tradeReq.ea_suggestion.dir}${techDirInfo} action=${response.action}${suggestedDirInfo} win=${response.win_prob.toFixed(3)}${ichimokuInfo} ` +
      `reason="${tradeReq.ea_suggestion.reason}" method=${predictionMethod}` +
      (response.entry_method ? ` | entry_method=${response.entry_method} sel_by=${response.method_selected_by || 'N/A'}` : ``)
    );
    
    // ⚠️ フォールバックの場合は警告
    if (predictionMethod.startsWith("Fallback")) {
      console.warn(`[ai-trader] ⚠️ WARNING: Using fallback calculation! Check OpenAI API key configuration.`);
    }
    
    return new Response(
      JSON.stringify(response),
      { status: 200, headers: corsHeaders() }
    );
    
  } catch (error) {
    console.error("[ai-trader] Error:", error);
    return new Response(
      JSON.stringify({ error: "Internal error" }),
      { status: 500, headers: corsHeaders() }
    );
  }
});
