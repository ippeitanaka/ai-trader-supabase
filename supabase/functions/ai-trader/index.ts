import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY")!;
const OPENAI_MODEL = Deno.env.get("OPENAI_MODEL") || "gpt-4o"; // デフォルト: gpt-4o (高精度)

type CalibrationMode = "off" | "on";

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

function clampWinProb(v: number): number {
  // Policy in this project: win_prob is within [0.00, 0.90]
  const minProb = 0.0;
  const maxProb = 0.9;
  return Math.max(minProb, Math.min(maxProb, v));
}

type CalibrationScope = "symbol_tf_dir" | "symbol_tf" | "symbol" | "timeframe" | "global";
type CalibrationDebug = {
  applied: boolean;
  scope?: CalibrationScope;
  n?: number;
  avg_p?: number;
  win_rate?: number;
  bin?: number;
  bin_n?: number;
  bin_win_rate?: number;
  method?: "bin_smoothed" | "mean_shift";
  note?: string;
};

type CalibrationCacheEntry = {
  expiresAt: number;
  debug: CalibrationDebug;
  // Mapping for 0.05 bins.
  binWinRate: Record<string, { n: number; winRate: number }>;
  avgP: number;
  winRate: number;
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
): Promise<Array<{ win_prob: number; actual_result: string }>> {
  const lookbackDays = getCalibrationLookbackDays();
  const limit = getCalibrationLimit();
  const since = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000).toISOString();

  let q = supabase
    .from("ai_signals")
    .select("win_prob,actual_result")
    .gte("created_at", since)
    .in("actual_result", ["WIN", "LOSS"])
    .eq("is_virtual", false)
    .order("created_at", { ascending: false })
    .limit(limit);

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

  const rows = (data ?? []) as Array<{ win_prob: number; actual_result: string }>;
  return rows
    .filter((r) => typeof r.win_prob === "number" && Number.isFinite(r.win_prob))
    .map((r) => ({ win_prob: clampWinProb(r.win_prob), actual_result: String(r.actual_result || "") }));
}

function buildCalibrationCacheEntry(rows: Array<{ win_prob: number; actual_result: string }>, scope: CalibrationScope): CalibrationCacheEntry | null {
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
    debug: { applied: true, scope, n, avg_p: avgP, win_rate: winRate },
    binWinRate,
    avgP,
    winRate,
  };
}

async function getCalibrationEntry(req: TradeRequest): Promise<{ entry: CalibrationCacheEntry | null; scopeTried: CalibrationScope | null }> {
  const mode = getCalibrationMode();
  if (mode !== "on") return { entry: null, scopeTried: null };

  const scopes: CalibrationScope[] = ["symbol_tf_dir", "symbol_tf", "symbol", "timeframe", "global"];
  const minN = getCalibrationMinN();

  for (const scope of scopes) {
    const key = `v1|${scope}|${req.symbol}|${req.timeframe}|${req.ea_suggestion.dir}`;
    const cached = calibrationCache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      if ((cached.debug.n ?? 0) >= minN) return { entry: cached, scopeTried: scope };
    }

    const rows = await fetchCalibrationRows(scope, req);
    const built = buildCalibrationCacheEntry(rows, scope);
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
  let method: "bin_smoothed" | "mean_shift";
  let bin_n = bin?.n ?? 0;
  let bin_wr = bin?.winRate;

  if (bin && bin.n >= minBinN) {
    // Blend raw with empirical bin win rate. Weight grows with bin sample size.
    const w = Math.min(0.8, bin.n / 30);
    calibrated = raw * (1 - w) + bin.winRate * w;
    method = "bin_smoothed";
  } else {
    // Fallback: align mean prediction to realized mean in-scope (stable under small bins)
    const shift = entry.winRate - entry.avgP;
    calibrated = raw + shift;
    method = "mean_shift";
  }

  calibrated = clampWinProb(calibrated);

  const debug: CalibrationDebug = {
    applied: true,
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

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

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
  action: number;
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

type InputSanityIssue = {
  field: string;
  problem: string;
  value?: unknown;
};

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

  const reasons: string[] = [];

  // BTCUSD: avoid observed loss cluster at UTC19
  if (symbol === "BTCUSD" && utcHour === 19) {
    reasons.push("BTCUSD disabled at UTC19");
  }

  // Emergency guard: cap XAUUSD lot scaling.
  // Rationale: recent real-trade P/L indicates position sizing is too aggressive.
  if (symbol === "XAUUSD") {
    const lm = (response as any).lot_multiplier;
    if (typeof lm === "number" && isFinite(lm) && lm > 1.0) {
      (response as any).lot_multiplier = 1.0;
      (response as any).lot_level = "CAPPED (XAUUSD)";
      const prevReason = typeof (response as any).lot_reason === "string" ? (response as any).lot_reason : "";
      (response as any).lot_reason = prevReason
        ? `${prevReason} | GUARD: XAUUSD cap lot_multiplier=1.0`
        : "GUARD: XAUUSD cap lot_multiplier=1.0";
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
  const clientMinWinProbProvided = typeof req.min_win_prob === "number";
  const client_min_win_prob = sanitizeRecommendedMinWinProb(
    clientMinWinProbProvided ? req.min_win_prob : undefined,
  ) ?? 0.70;

  const raw = typeof base.win_prob === "number" ? base.win_prob : 0.5;
  const { winProb: calibrated, debug } = await calibrateWinProb(req, raw);

  const dir = (base.action === 1 || base.action === -1) ? base.action : 0;
  const action = dir !== 0 && calibrated >= client_min_win_prob ? dir : 0;
  const expected_value_r = computeExpectedValueR(calibrated);

  const reasoningSuffix = debug.applied
    ? ` | CAL(${debug.method}/${debug.scope} n=${debug.n}): raw=${round3(raw)}→${round3(calibrated)}`
    : "";

  return {
    ...base,
    win_prob: round3(calibrated),
    action,
    expected_value_r,
    reasoning: (base.reasoning || "") + reasoningSuffix,
    win_prob_raw: round3(raw),
    win_prob_calibration: debug,
  } as any;
}

function sanitizeRecommendedMinWinProb(v: unknown): number | null {
  if (typeof v !== "number" || !isFinite(v)) return null;
  // Policy: never raise above 0.75 (avoid reducing trade opportunities)
  const clamped = Math.max(0.6, Math.min(0.75, v));
  return Math.round(clamped * 1000) / 1000;
}

function computeExpectedValueR(winProb: number): number {
  // EV model consistent with virtual tracking: loss=-1R, win=+1.5R
  const ev = (winProb * 1.5) - ((1 - winProb) * 1.0);
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

/**
 * ML学習データに基づいてロット倍率を計算
 * レベル1: 通常 (1.0倍) - ML未学習 or 勝率60-70%
 * レベル2: やや自信あり (1.5倍) - 勝率70-80% + サンプル15件以上 + 過去5件中4勝以上
 * レベル3: 非常に自信あり (2.0倍) - 勝率80%以上 + サンプル20件以上 + 過去10件中8勝以上 + PF1.5以上
 * レベル4: 極めて自信あり (3.0倍) - 勝率85%以上 + サンプル30件以上 + 過去10件中9勝以上 + PF2.0以上
 */
function calculateLotMultiplier(
  matchedPattern: any | null,
  historicalTrades: any[]
): { multiplier: number; level: string; reason: string } {
  // ML学習データなし → レベル1（通常）
  const sampleTrades = matchedPattern?.real_trades ?? matchedPattern?.total_trades ?? 0;
  if (!matchedPattern || !matchedPattern.win_rate || sampleTrades < 10) {
    return {
      multiplier: 1.0,
      level: "Level 1 (通常)",
      reason: "ML学習データ不足またはサンプル数10件未満"
    };
  }

  const winRate = matchedPattern.win_rate;
  const totalTrades = sampleTrades;
  const profitFactor = matchedPattern.profit_factor || 1.0;

  // 直近のパフォーマンスを分析（最新10件）
  const recentTrades = historicalTrades
    .filter((t: any) => t.actual_result === "WIN" || t.actual_result === "LOSS")
    .slice(0, 10);
  const recent10Wins = recentTrades.filter((t: any) => t.actual_result === "WIN").length;
  
  const recent5Trades = recentTrades.slice(0, 5);
  const recent5Wins = recent5Trades.filter((t: any) => t.actual_result === "WIN").length;

  // レベル4: 極めて自信あり (3.0倍)
  if (
    winRate >= 0.85 &&
    totalTrades >= 30 &&
    profitFactor >= 2.0 &&
    recent10Wins >= 9
  ) {
    return {
      multiplier: 3.0,
      level: "Level 4 (極めて自信あり)",
      reason: `勝率${(winRate * 100).toFixed(1)}% (${totalTrades}件), PF=${profitFactor.toFixed(2)}, 直近10件中${recent10Wins}勝`
    };
  }

  // レベル3: 非常に自信あり (2.0倍)
  if (
    winRate >= 0.80 &&
    totalTrades >= 20 &&
    profitFactor >= 1.5 &&
    recent10Wins >= 8
  ) {
    return {
      multiplier: 2.0,
      level: "Level 3 (非常に自信あり)",
      reason: `勝率${(winRate * 100).toFixed(1)}% (${totalTrades}件), PF=${profitFactor.toFixed(2)}, 直近10件中${recent10Wins}勝`
    };
  }

  // レベル2: やや自信あり (1.5倍)
  if (
    winRate >= 0.70 &&
    totalTrades >= 15 &&
    recent5Wins >= 4
  ) {
    return {
      multiplier: 1.5,
      level: "Level 2 (やや自信あり)",
      reason: `勝率${(winRate * 100).toFixed(1)}% (${totalTrades}件), 直近5件中${recent5Wins}勝`
    };
  }

  // レベル1: 通常 (1.0倍) - デフォルト
  return {
    multiplier: 1.0,
    level: "Level 1 (通常)",
    reason: winRate >= 0.60 ? 
      `勝率${(winRate * 100).toFixed(1)}% (${totalTrades}件) - 基準未達` :
      `勝率${(winRate * 100).toFixed(1)}% (${totalTrades}件) - 低勝率パターン`
  };
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
  const APPLY_ML_LOT_MULTIPLIER = ENABLE_ML_CONTEXT_FOR_OPENAI;

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
      .limit(3);

    // レジームの一致を優先（ただし旧パターン互換のため NULL は許容）
    if (adxBucket) patternQuery = patternQuery.or(`adx_bucket.is.null,adx_bucket.eq.${adxBucket}`);
    if (bbBucket) patternQuery = patternQuery.or(`bb_width_bucket.is.null,bb_width_bucket.eq.${bbBucket}`);
    if (atrNormBucket) patternQuery = patternQuery.or(`atr_norm_bucket.is.null,atr_norm_bucket.eq.${atrNormBucket}`);

    const { data: patterns } = await patternQuery;
    matchedPatterns = patterns || [];
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
  
  // 📊 ロット倍率を計算（ML学習データ + 直近パフォーマンスに基づく）
  const lotMultiplierResult = APPLY_ML_LOT_MULTIPLIER
    ? calculateLotMultiplier(matchedPatterns.length > 0 ? matchedPatterns[0] : null, historicalTrades)
    : { multiplier: 1.0, level: "Level 1 (通常)", reason: `ML disabled (mode=${mlMode})` };
  console.log(`[AI] Lot Multiplier: ${lotMultiplierResult.multiplier}x (${lotMultiplierResult.level}) - ${lotMultiplierResult.reason}`);
  
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

**勝率範囲: 0%～90%**
- 最悪のシナリオ（全指標矛盾、高リスク）→ 0-20%
- 不確実性が高い（指標分散）→ 30-45%
- 中程度の確信（一部一致）→ 50-65%
- 高い確信（多数一致）→ 70-80%
- 最高のシナリオ（パーフェクトオーダー、全指標完全一致）→ 85-90%`;
  }
  
  // 共通の回答形式指示
  systemPrompt += `

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📋 回答形式（JSON）
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
以下のJSON形式で回答してください:
{
  "win_prob": 0.XX,  // 0.00～0.90の範囲で動的に設定
  "recommended_min_win_prob": 0.70, // 0.60～0.75（重要: 0.75を超えない＝取引機会を減らさない）
  "skip_reason": "", // 見送りなら理由（例: "range", "conflict", "news"）
  "confidence": "high" | "medium" | "low",
  "reasoning": "判断理由（40文字以内、主要な根拠を明記）"
}

  重要: 
• 上記の優先順位に従って判断してください
• ${ENABLE_ML_CONTEXT_FOR_OPENAI ? (learningPhase === "PHASE3_FULL_ML" ? "ML学習データの過去勝率を最重視" : learningPhase === "PHASE2_HYBRID" && matchedPatterns.length > 0 ? "ML学習データとテクニカル指標をバランス良く総合判断" : "すべてのテクニカル指標を総合的に評価") : "すべてのテクニカル指標を総合的に評価"}してください
• 0%～90%の幅広い範囲で動的に算出してください`;

  // 学習データ収集フェーズ用の総合判断プロンプト（廃止：上記に統合）
  const prompt = systemPrompt;

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,  // 環境変数で設定可能 (デフォルト: gpt-4o-mini)
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
• 全指標が一致 → 高勝率（70-90%）
• 大半が一致 → 中高勝率（60-75%）
• 指標が分散 → 中勝率（50-65%）
• 指標が矛盾 → 低勝率（30-45%）
• 最悪の条件 → 極低勝率（0-20%）

0%～90%の幅広い範囲で動的に算出し、JSON形式で簡潔に回答してください。指標間の矛盾が多いほど低勝率、一致が多いほど高勝率を設定してください。

JSON形式で回答: {"win_prob": 0.XX, "recommended_min_win_prob": 0.70, "skip_reason": "", "confidence": "high|medium|low", "reasoning": "…"}`
          },
          { role: "user", content: prompt }
        ],
        temperature: 0.2,  // より一貫性のある予測のため低めに設定
        max_tokens: 250,
      }),
    });

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
      return calculateSignalFallback(req);
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
    const raw_win_prob = win_prob;
    const cal = await calibrateWinProb(req, raw_win_prob);
    win_prob = cal.winProb;
    
    const confidence = aiResult.confidence || "unknown";
    const clientMinWinProbProvided = typeof req.min_win_prob === "number";
    const client_min_win_prob = sanitizeRecommendedMinWinProb(
      clientMinWinProbProvided ? req.min_win_prob : undefined,
    ) ?? 0.70;
    const reasoningBase = aiResult.reasoning || "N/A";
    const reasoningBase2 = clientMinWinProbProvided
      ? reasoningBase
      : `${reasoningBase} | WARN: min_win_prob not provided by client; default gate=0.70`;
    const reasoning = (!ENABLE_ML_CONTEXT_FOR_OPENAI && (matchedPatterns?.length ?? 0) > 0)
      ? `${reasoningBase2} | ML: ${mlMode} (pattern logged, not applied)`
      : reasoningBase2;
    const recommended_min_win_prob = sanitizeRecommendedMinWinProb(aiResult.recommended_min_win_prob);
    // Guard: never execute below EA-configured minimum.
    // recommended_min_win_prob はログ/参考用（実行ゲートとしては使用しない）。
    const action_gate_min_win_prob = client_min_win_prob;
    // EV is deterministic from win_prob.
    const expected_value_r = computeExpectedValueR(win_prob);
    const skip_reason = typeof aiResult.skip_reason === "string" ? aiResult.skip_reason : "";
    const entry_method: "market" = "market";
    const entry_params: null = null;
    const method_reason = "market-only execution";
    
    // 詳細ログ出力
    console.log(
      `[AI] OpenAI GPT-4 prediction: ${(win_prob * 100).toFixed(1)}% (${confidence}) - ${reasoning} | ` +
      `ichimoku=${ichimoku_score?.toFixed(2) || "N/A"} quality=${signalQuality} | entry_method=${entry_method} | ` +
      `lot=${lotMultiplierResult.multiplier}x (${lotMultiplierResult.level})`
    );
    
    const calSuffix = cal.debug.applied
      ? ` | CAL(${cal.debug.method}/${cal.debug.scope} n=${cal.debug.n}): raw=${round3(raw_win_prob)}→${round3(win_prob)}`
      : "";

    return {
      win_prob: round3(win_prob),
      action: win_prob >= action_gate_min_win_prob ? dir : 0,
      suggested_dir: dir,
      offset_factor: atr > 0.001 ? 0.25 : 0.2,
      expiry_minutes: 90,
      confidence: confidence,
      reasoning: `${reasoning}${calSuffix}`,
      recommended_min_win_prob: recommended_min_win_prob ?? undefined,
      expected_value_r,
      skip_reason,
      entry_method,
      entry_params,
      method_selected_by: "OpenAI",
      method_reason,
      lot_multiplier: lotMultiplierResult.multiplier,
      lot_level: lotMultiplierResult.level,
      lot_reason: lotMultiplierResult.reason,
      ml_pattern_used: matchedPatterns && matchedPatterns.length > 0,
      ml_pattern_id: matchedPatterns && matchedPatterns.length > 0 ? matchedPatterns[0].id : null,
      ml_pattern_name: matchedPatterns && matchedPatterns.length > 0 ? matchedPatterns[0].pattern_name : null,
      ml_pattern_confidence: matchedPatterns && matchedPatterns.length > 0 ? Math.round(matchedPatterns[0].win_rate * 100 * 100) / 100 : null,
      win_prob_raw: round3(raw_win_prob),
      win_prob_calibration: cal.debug,
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
  // Primary: higher win_prob. Secondary: higher expected_value_r.
  const buyWin = typeof buy.win_prob === "number" ? buy.win_prob : -Infinity;
  const sellWin = typeof sell.win_prob === "number" ? sell.win_prob : -Infinity;

  if (buyWin > sellWin) return { selectedDir: 1, selected: buy };
  if (sellWin > buyWin) return { selectedDir: -1, selected: sell };

  const buyEv = typeof buy.expected_value_r === "number" ? buy.expected_value_r : -Infinity;
  const sellEv = typeof sell.expected_value_r === "number" ? sell.expected_value_r : -Infinity;
  if (buyEv >= sellEv) return { selectedDir: 1, selected: buy };
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
    
    return new Response(
      JSON.stringify({ 
        ok: true, 
        service: "ai-trader with OpenAI + Comprehensive Technical Analysis", 
        version: "2.4.0-learning-phase",
        mode: "COMPREHENSIVE_TECHNICAL",
        ai_enabled: hasKey,
        ml_learning_enabled: false,
        openai_key_status: keyStatus,
        fallback_available: true,
        win_prob_range: "0% - 90%",
        features: [
          "comprehensive_technical_analysis",
          "all_indicators_integrated",
          "openai_gpt",
          "ma_cross",
          "macd",
          "rsi",
          "atr",
          "ichimoku_full",
          "market_only_execution"
        ],
        note: "Learning phase: AI comprehensively analyzes all technical indicators (MA, MACD, RSI, ATR, Ichimoku). Win probability: 0%-90% dynamic range. ML will be enabled after 100+ trades."
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
    
    const tradeReq: TradeRequest = body;

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
        response = calculateSignalFallback(tradeReq);
        predictionMethod = "Fallback-AfterAI-Error";
      }
    } else {
      console.warn(`[ai-trader] ⚠️ Using rule-based FALLBACK (no OpenAI key)`);
      response = calculateSignalFallback(tradeReq);
      predictionMethod = "Fallback-NoKey";
    }

    // Apply hard guards (double-safety with EA-side rules)
    response = applyExecutionGuards(tradeReq, response);

    // Attach market regime classification for logging/analysis.
    // Keep this deterministic so it exists even when OpenAI is unavailable.
    const regimeInfo = classifyMarketRegime(tradeReq);
    response = { ...response, ...regimeInfo };
    
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
