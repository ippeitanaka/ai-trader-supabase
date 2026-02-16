import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") || "";
const OPENAI_MODEL = Deno.env.get("OPENAI_MODEL") || "gpt-4o-mini";
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

type Postmortem = {
  tags: string[];
  summary: string;
  model?: string;
};

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function toFiniteNumberOrNull(value: unknown): number | null {
  return isFiniteNumber(value) ? value : null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function mergeRegimeIntoEntryParams(
  entryParams: unknown,
  regime: unknown,
  strategy: unknown,
  regimeConfidence: unknown,
): any {
  const r = typeof regime === "string" ? regime.trim() : "";
  const s = typeof strategy === "string" ? strategy.trim() : "";
  const c = typeof regimeConfidence === "string" ? regimeConfidence.trim() : "";
  const hasAny = Boolean(r || s || c);
  if (!hasAny) return entryParams ?? null;

  const regimeObj: Record<string, string> = {};
  if (r) regimeObj.regime = r;
  if (s) regimeObj.strategy = s;
  if (c) regimeObj.regime_confidence = c;

  if (entryParams === null || entryParams === undefined) {
    return { _regime: regimeObj };
  }
  if (isPlainObject(entryParams)) {
    return { ...entryParams, _regime: regimeObj };
  }
  return { _value: entryParams, _regime: regimeObj };
}

// Guard helpers for Postgres numeric(p,s) columns
function pgNumeric20_5(value: unknown): number | null {
  const n = toFiniteNumberOrNull(value);
  if (n === null) return null;
  // numeric(20,5) -> up to 15 digits before decimal
  const capped = clamp(n, -9e14, 9e14);
  return roundTo(capped, 5);
}

function pgNumeric10_2(value: unknown): number | null {
  const n = toFiniteNumberOrNull(value);
  if (n === null) return null;
  // numeric(10,2) -> up to 8 digits before decimal
  const capped = clamp(n, -9.9e7, 9.9e7);
  return roundTo(capped, 2);
}

function pgNumeric5_2(value: unknown): number | null {
  const n = toFiniteNumberOrNull(value);
  if (n === null) return null;
  const capped = clamp(n, -999.99, 999.99);
  return roundTo(capped, 2);
}

function allowEntryMiscalculationTag(row: any): boolean {
  const planned = row?.planned_entry_price;
  const actual = row?.entry_price;
  if (!isFiniteNumber(planned) || !isFiniteNumber(actual)) return false;
  const diff = Math.abs(actual - planned);

  // Threshold policy:
  // - guard against tiny rounding/slippage/spread noise (>= 0.2)
  // - scale with price (>= 2 bps)
  // - scale with ATR if available (>= 0.25 * ATR)
  const absThresh = 0.2;
  const relThresh = Math.abs(actual) * 0.00002;
  const atrThresh = isFiniteNumber(row?.atr) && row.atr > 0 ? row.atr * 0.25 : 0;
  const thresh = Math.max(absThresh, relThresh, atrThresh);
  return diff >= thresh;
}

function sanitizePostmortem(pm: Postmortem, row: any): Postmortem {
  const tags = Array.isArray(pm?.tags) ? [...pm.tags] : [];
  let summary = typeof pm?.summary === "string" ? pm.summary : "";

  const hasEntryMiscalc = tags.includes("entry_miscalculation");
  if (hasEntryMiscalc && !allowEntryMiscalculationTag(row)) {
    const filtered = tags.filter((t) => t !== "entry_miscalculation");
    // Avoid strongly claiming miscalculation when we don't have objective evidence.
    if (summary.includes("計算ミス") || summary.includes("エントリー計算")) {
      summary = row?.actual_result === "CANCELLED"
        ? `CANCELLED: ${row?.cancelled_reason || "reason_unknown"}`
        : row?.sl_hit
          ? "SL到達により損失が発生しました。"
          : "損失が発生しました。";
    }
    return { ...pm, tags: filtered, summary };
  }

  return { ...pm, tags, summary };
}

function sanitizeTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) return [];
  const out: string[] = [];
  for (const t of tags) {
    if (typeof t !== "string") continue;
    const s = t.trim();
    if (!s) continue;
    // keep tags compact and safe for analytics
    const normalized = s
      .toLowerCase()
      .replace(/[^a-z0-9_\-]+/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_+|_+$/g, "");
    if (!normalized) continue;
    if (!out.includes(normalized)) out.push(normalized);
    if (out.length >= 12) break;
  }
  return out;
}

function fallbackPostmortem(row: any): Postmortem {
  const tags: string[] = ["loss"];

  if (row?.actual_result === "CANCELLED") tags[0] = "cancelled";
  if (row?.sl_hit === true) tags.push("sl_hit");
  if (row?.tp_hit === true) tags.push("tp_hit");
  if (typeof row?.entry_method === "string" && row.entry_method) tags.push(`method_${row.entry_method}`);
  if (typeof row?.cancelled_reason === "string" && row.cancelled_reason) tags.push("has_cancel_reason");
  if (typeof row?.adx === "number" && isFinite(row.adx) && row.adx < 15) tags.push("weak_trend");
  if (typeof row?.bb_width === "number" && isFinite(row.bb_width) && row.bb_width < 0.003) tags.push("bb_squeeze");
  if (typeof row?.atr_norm === "number" && isFinite(row.atr_norm) && row.atr_norm > 0.0012) tags.push("high_vol");

  const summary = row?.actual_result === "CANCELLED"
    ? `CANCELLED: ${row?.cancelled_reason || "reason_unknown"}`
    : row?.sl_hit
      ? "LOSS: SL hit"
      : "LOSS";

  return { tags: tags.slice(0, 8), summary };
}

async function generatePostmortem(row: any): Promise<Postmortem> {
  if (!OPENAI_API_KEY || OPENAI_API_KEY.length < 10 || OPENAI_API_KEY.includes("YOUR_")) {
    return fallbackPostmortem(row);
  }

  const timeoutMsRaw = Number(Deno.env.get("POSTMORTEM_TIMEOUT_MS") ?? "2500");
  const timeoutMs = Math.max(500, Math.min(10_000, Number.isFinite(timeoutMsRaw) ? timeoutMsRaw : 2500));

  const prompt = `You are an expert trading postmortem analyst.
Return strict JSON only.

Given this trade record (some fields may be null):
${JSON.stringify({
    symbol: row?.symbol,
    timeframe: row?.timeframe,
    dir: row?.dir,
    entry_method: row?.entry_method,
    entry_params: row?.entry_params,
  planned_order_type: row?.planned_order_type,
  planned_entry_price: row?.planned_entry_price,
  planned_sl: row?.planned_sl,
  planned_tp: row?.planned_tp,
  order_ticket: row?.order_ticket,
  entry_price: row?.entry_price,
  bid: row?.bid,
  ask: row?.ask,
    win_prob: row?.win_prob,
  atr: row?.atr,
    atr_norm: row?.atr_norm,
    adx: row?.adx,
    di_plus: row?.di_plus,
    di_minus: row?.di_minus,
    bb_width: row?.bb_width,
    rsi: row?.rsi,
    ma_cross: row?.ma_cross,
    macd_cross: row?.macd_cross,
    ichimoku_price_vs_cloud: row?.ichimoku_price_vs_cloud,
    ichimoku_cloud_color: row?.ichimoku_cloud_color,
    actual_result: row?.actual_result,
    sl_hit: row?.sl_hit,
    tp_hit: row?.tp_hit,
    profit_loss: row?.profit_loss,
    hold_duration_minutes: row?.hold_duration_minutes,
    cancelled_reason: row?.cancelled_reason,
    reason: row?.reason,
    model_version: row?.model_version,
    is_virtual: row?.is_virtual,
  })}

Task:
- If actual_result is LOSS or CANCELLED, produce 3-6 short tags (snake_case) that explain likely failure causes.
- Produce a one-line summary (<= 120 chars) in Japanese.
- Do not include any PII.

JSON schema:
{ "tags": ["tag1"], "summary": "..." }`;

  let timeoutId: number | null = null;
  const controller = new AbortController();
  try {
    timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: OPENAI_MODEL,
        messages: [
          { role: "system", content: "Return strict JSON only." },
          { role: "user", content: prompt },
        ],
        temperature: 0.2,
        max_tokens: 200,
      }),
    });

    if (!resp.ok) {
      return fallbackPostmortem(row);
    }
    const data = await resp.json();
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== "string") return fallbackPostmortem(row);
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) return fallbackPostmortem(row);
    const parsed = JSON.parse(match[0]);

    const tags = sanitizeTags(parsed?.tags);
    const summary = typeof parsed?.summary === "string" ? parsed.summary.trim().slice(0, 140) : "";
    if (tags.length === 0 || !summary) return fallbackPostmortem(row);

    return sanitizePostmortem({ tags, summary, model: OPENAI_MODEL }, row);
  } catch (_err) {
    return fallbackPostmortem(row);
  } finally {
    if (timeoutId !== null) clearTimeout(timeoutId);
  }
}

interface AISignalEntry {
  // AI判定時の情報
  symbol: string;
  timeframe: string;
  dir: number;
  win_prob: number;
  atr?: number;
  atr_norm?: number;
  adx?: number;
  di_plus?: number;
  di_minus?: number;
  bb_width?: number;
  rsi?: number;
  price?: number;
  reason?: string;
  instance?: string;
  model_version?: string;

  // Market regime / strategy classification (optional)
  regime?: string | null;
  strategy?: string | null;
  regime_confidence?: string | null;
  
  // 価格情報
  bid?: number;
  ask?: number;
  
  // 移動平均線
  ema_25?: number;
  sma_100?: number;
  ma_cross?: number; // 1=bullish, -1=bearish
  
  // MACD指標
  macd_main?: number;
  macd_signal?: number;
  macd_histogram?: number;
  macd_cross?: number; // 1=bullish, -1=bearish
  
  // 一目均衡表
  ichimoku_tenkan?: number;
  ichimoku_kijun?: number;
  ichimoku_senkou_a?: number;
  ichimoku_senkou_b?: number;
  ichimoku_chikou?: number;
  ichimoku_tk_cross?: number; // 1=tenkan>kijun, -1=tenkan<kijun
  ichimoku_cloud_color?: number; // 1=bullish, -1=bearish
  ichimoku_price_vs_cloud?: number; // 1=above, -1=below, 0=in
  
  // エントリー手法情報（任意）
  entry_method?: string | null; // 'pullback' | 'breakout' | 'mtf_confirm' | 'none'
  entry_params?: any | null;    // JSON パラメータ（k, o, expiry_bars など）
  method_selected_by?: string | null; // 'OpenAI' | 'Fallback' | 'Manual'
  method_confidence?: number | null;  // 0.0 - 1.0
  method_reason?: string | null;
  
  // ML pattern tracking
  ml_pattern_used?: boolean | null;
  ml_pattern_id?: number | null;
  ml_pattern_name?: string | null;
  ml_pattern_confidence?: number | null;

  // manual trade
  lot_size?: number;

  // lot sizing telemetry
  lot_multiplier?: number | null;
  lot_level?: string | null;
  lot_reason?: string | null;
  executed_lot?: number | null;

  // Virtual (paper/shadow) trade support
  is_virtual?: boolean | null;
  planned_entry_price?: number | null;
  planned_sl?: number | null;
  planned_tp?: number | null;
  planned_order_type?: number | null;
  virtual_filled_at?: string | null;
  
  // 注文情報
  order_ticket?: number | string;
  entry_price?: number;
  
  // 結果情報（後で更新）
  exit_price?: number;
  profit_loss?: number;
  closed_at?: string;
  hold_duration_minutes?: number;
  actual_result?: string; // 'WIN', 'LOSS', 'BREAK_EVEN', 'PENDING', 'CANCELLED'
  cancelled_reason?: string;
  sl_hit?: boolean;
  tp_hit?: boolean;
}

function safeText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const s = value.trim();
  return s.length > 0 ? s : null;
}

function parseOrderTicket(value: unknown): string | null {
  if (typeof value === "number") {
    // NOTE: JS number cannot represent all 64-bit integers safely.
    // MT5 tickets can exceed Number.MAX_SAFE_INTEGER; require string in that case.
    if (!Number.isFinite(value) || value <= 0) return null;
    if (!Number.isSafeInteger(value)) return null;
    const s = String(value);
    if (s.length > 20) return null;
    return s;
  }
  if (typeof value === "string") {
    const s = value.trim();
    if (!s) return null;
    if (!/^[0-9]+$/.test(s)) return null;
    if (s === "0") return null;
    if (s.length > 20) return null;
    return s;
  }
  return null;
}

type ActualResult = "PENDING" | "FILLED" | "WIN" | "LOSS" | "BREAK_EVEN" | "CANCELLED";

function normalizeActualResult(value: unknown): ActualResult | null {
  if (typeof value !== "string") return null;
  const s = value.trim().toUpperCase();
  switch (s) {
    case "PENDING":
    case "FILLED":
    case "WIN":
    case "LOSS":
    case "BREAK_EVEN":
    case "CANCELLED":
      return s;
    default:
      return null;
  }
}

function isAllowedActualResultTransition(prev: ActualResult | null, next: ActualResult): boolean {
  if (prev === null) return true;
  if (prev === next) return true;

  switch (prev) {
    case "PENDING":
      return ["FILLED", "WIN", "LOSS", "BREAK_EVEN", "CANCELLED"].includes(next);
    case "FILLED":
      return ["WIN", "LOSS", "BREAK_EVEN", "CANCELLED"].includes(next);
    case "WIN":
    case "LOSS":
    case "BREAK_EVEN":
    case "CANCELLED":
      return false;
    default:
      return false;
  }
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, PUT, GET, OPTIONS",
    "Content-Type": "application/json",
  };
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders() });
  }

  try {
    // GET may not have a JSON body; treat it as a lightweight health/status endpoint.
    if (req.method === "GET") {
      const url = new URL(req.url);
      const hoursRaw = url.searchParams.get("hours");
      const limitRaw = url.searchParams.get("limit");
      const diagSymbol = (url.searchParams.get("symbol") ?? "").trim();
      const diagTimeframe = (url.searchParams.get("timeframe") ?? "").trim();

      const windowHours = Math.max(1, Math.min(72, Number(hoursRaw ?? 6)));
      const rowLimit = Math.max(10, Math.min(500, Number(limitRaw ?? 200)));
      const sinceIso = new Date(Date.now() - windowHours * 60 * 60 * 1000).toISOString();

      const { data: recent, error } = await supabase
        .from("ai_signals")
        .select(
          "id, created_at, symbol, timeframe, actual_result, ml_pattern_used, ml_pattern_name, ml_pattern_confidence",
        )
        .gte("created_at", sinceIso)
        .order("created_at", { ascending: false })
        .limit(rowLimit);

      const latestSignal = error ? null : (recent?.[0] ?? null);

      const rows = Array.isArray(recent) ? recent : [];
      const signals = rows.length;
      const mlUsed = rows.reduce((sum, r: any) => sum + (r?.ml_pattern_used ? 1 : 0), 0);
      const mlUsedPct = signals > 0 ? Math.round((mlUsed / signals) * 1000) / 10 : 0;

      const bySymbolTfMap = new Map<string, { symbol: string; timeframe: string; signals: number; ml_used: number }>();
      const topPatternsMap = new Map<string, { pattern_name: string; uses: number }>();

      for (const r of rows as any[]) {
        const symbol = typeof r?.symbol === "string" ? r.symbol : "?";
        const timeframe = typeof r?.timeframe === "string" ? r.timeframe : "?";
        const key = `${symbol}|${timeframe}`;
        const cur = bySymbolTfMap.get(key) ?? { symbol, timeframe, signals: 0, ml_used: 0 };
        cur.signals += 1;
        if (r?.ml_pattern_used) cur.ml_used += 1;
        bySymbolTfMap.set(key, cur);

        if (r?.ml_pattern_used && typeof r?.ml_pattern_name === "string" && r.ml_pattern_name.trim()) {
          const pn = r.ml_pattern_name.trim();
          const pcur = topPatternsMap.get(pn) ?? { pattern_name: pn, uses: 0 };
          pcur.uses += 1;
          topPatternsMap.set(pn, pcur);
        }
      }

      const bySymbolTimeframe = [...bySymbolTfMap.values()]
        .map((x) => ({
          ...x,
          ml_used_pct: x.signals > 0 ? Math.round((x.ml_used / x.signals) * 1000) / 10 : 0,
        }))
        .sort((a, b) => b.signals - a.signals)
        .slice(0, 20);

      const mlTopPatterns = [...topPatternsMap.values()]
        .sort((a, b) => b.uses - a.uses)
        .slice(0, 10);

      // Optional: ML pattern availability diagnostics for a specific symbol/timeframe.
      // Example: /ai-signals?hours=24&symbol=BTCUSD&timeframe=M15
      let mlPatternDiag: any = null;
      if (diagSymbol && diagTimeframe) {
        const base = supabase
          .from("ml_patterns")
          .select(
            "id, pattern_name, direction, confidence_score, real_trades, total_trades, win_rate, is_active",
            { count: "exact", head: false },
          )
          .eq("symbol", diagSymbol)
          .eq("timeframe", diagTimeframe)
          .eq("is_active", true);

        const [{ data: top, error: topErr }, { count: totalCount, error: countErr }, { count: buyCount }, { count: sellCount }] = await Promise.all([
          base.order("confidence_score", { ascending: false }).limit(5),
          supabase
            .from("ml_patterns")
            .select("id", { count: "exact", head: true })
            .eq("symbol", diagSymbol)
            .eq("timeframe", diagTimeframe)
            .eq("is_active", true),
          supabase
            .from("ml_patterns")
            .select("id", { count: "exact", head: true })
            .eq("symbol", diagSymbol)
            .eq("timeframe", diagTimeframe)
            .eq("is_active", true)
            .eq("direction", 1),
          supabase
            .from("ml_patterns")
            .select("id", { count: "exact", head: true })
            .eq("symbol", diagSymbol)
            .eq("timeframe", diagTimeframe)
            .eq("is_active", true)
            .eq("direction", -1),
        ]);

        mlPatternDiag = {
          symbol: diagSymbol,
          timeframe: diagTimeframe,
          active_patterns_total: totalCount ?? 0,
          active_patterns_buy: buyCount ?? 0,
          active_patterns_sell: sellCount ?? 0,
          top_patterns: topErr ? [] : (top ?? []).map((p: any) => ({
            id: p.id,
            pattern_name: p.pattern_name,
            direction: p.direction,
            confidence_score: p.confidence_score,
            real_trades: p.real_trades,
            total_trades: p.total_trades,
            win_rate: p.win_rate,
          })),
          error: (topErr || countErr) ? { message: (topErr ?? countErr)?.message } : null,
        };
      }

      return new Response(
        JSON.stringify({
          ok: true,
          service: "ai-signals",
          now: new Date().toISOString(),
          window_hours: windowHours,
          rows_sampled: signals,
          ml_used: mlUsed,
          ml_used_pct: mlUsedPct,
          by_symbol_timeframe: bySymbolTimeframe,
          ml_top_patterns: mlTopPatterns,
          ml_pattern_diagnostics: mlPatternDiag,
          latest_signal: latestSignal,
          latest_signal_error: error ? { message: error.message } : null,
        }),
        { status: 200, headers: corsHeaders() },
      );
    }

    const body = await req.json().catch(() => null);
    if (body === null) {
      return new Response(
        JSON.stringify({ error: "invalid_json_body" }),
        { status: 400, headers: corsHeaders() },
      );
    }
    
    // POST: 新規シグナル記録
    if (req.method === "POST") {
      // Minimal validation to avoid writing unusable rows
      if (!body?.symbol || typeof body.symbol !== "string" || body.symbol.trim() === "") {
        return new Response(
          JSON.stringify({ error: "symbol is required" }),
          { status: 400, headers: corsHeaders() },
        );
      }

      if (!body?.timeframe || typeof body.timeframe !== "string" || body.timeframe.trim() === "") {
        return new Response(
          JSON.stringify({ error: "timeframe is required" }),
          { status: 400, headers: corsHeaders() },
        );
      }

      if (typeof body.dir !== "number" || ![1, -1].includes(body.dir)) {
        return new Response(
          JSON.stringify({ error: "dir must be 1 or -1" }),
          { status: 400, headers: corsHeaders() },
        );
      }

      if (typeof body.win_prob !== "number" || Number.isNaN(body.win_prob)) {
        return new Response(
          JSON.stringify({ error: "win_prob is required" }),
          { status: 400, headers: corsHeaders() },
        );
      }

      const requestedActualResult = normalizeActualResult(body.actual_result) ?? "PENDING";
      const orderTicket = parseOrderTicket(body.order_ticket);
      const hasValidTicket = typeof orderTicket === "string";
      const actualResult = (requestedActualResult === "FILLED" && !hasValidTicket) ? "PENDING" : requestedActualResult;

      const entry: AISignalEntry = {
        symbol: body.symbol,
        timeframe: body.timeframe,
        dir: body.dir,
        win_prob: body.win_prob,
        atr: body.atr,
        atr_norm: body.atr_norm,
        adx: body.adx,
        di_plus: body.di_plus,
        di_minus: body.di_minus,
        bb_width: body.bb_width,
        rsi: body.rsi,
        price: body.price,
        reason: body.reason,
        instance: body.instance,
        model_version: body.model_version,

        regime: safeText(body.regime),
        strategy: safeText(body.strategy),
        regime_confidence: safeText(body.regime_confidence),
        
        // 価格情報
        bid: pgNumeric20_5(body.bid) ?? undefined,
        ask: pgNumeric20_5(body.ask) ?? undefined,
        
        // 移動平均線
        ema_25: pgNumeric20_5(body.ema_25) ?? undefined,
        sma_100: pgNumeric20_5(body.sma_100) ?? undefined,
        ma_cross: body.ma_cross,
        
        // MACD指標（ネストされたオブジェクトから抽出）
        macd_main: pgNumeric20_5(body.macd?.main) ?? undefined,
        macd_signal: pgNumeric20_5(body.macd?.signal) ?? undefined,
        macd_histogram: pgNumeric20_5(body.macd?.histogram) ?? undefined,
        macd_cross: body.macd?.cross,
        
        // 一目均衡表（ネストされたオブジェクトから抽出）
        ichimoku_tenkan: pgNumeric20_5(body.ichimoku?.tenkan) ?? undefined,
        ichimoku_kijun: pgNumeric20_5(body.ichimoku?.kijun) ?? undefined,
        ichimoku_senkou_a: pgNumeric20_5(body.ichimoku?.senkou_a) ?? undefined,
        ichimoku_senkou_b: pgNumeric20_5(body.ichimoku?.senkou_b) ?? undefined,
        ichimoku_chikou: pgNumeric20_5(body.ichimoku?.chikou) ?? undefined,
        ichimoku_tk_cross: body.ichimoku?.tk_cross,
        ichimoku_cloud_color: body.ichimoku?.cloud_color,
        ichimoku_price_vs_cloud: body.ichimoku?.price_vs_cloud,
        
        // エントリー手法
        order_ticket: orderTicket ?? undefined,
        entry_price: body.entry_price,
        entry_method: body.entry_method ?? null,
        entry_params: body.entry_params ?? null,
        method_selected_by: body.method_selected_by ?? null,
        method_confidence: isFiniteNumber(body.method_confidence) ? body.method_confidence : null,
        method_reason: body.method_reason ?? null,
        
        // MLパターントラッキング
        ml_pattern_used: body.ml_pattern_used ?? false,
        ml_pattern_id: body.ml_pattern_id ?? null,
        ml_pattern_name: body.ml_pattern_name ?? null,
        ml_pattern_confidence: pgNumeric5_2(body.ml_pattern_confidence) ?? null,

        // manual trade
        // NOTE: lot_size is numeric(10,2) in some schemas
        lot_size: pgNumeric10_2(body.lot_size) ?? undefined,

        // lot sizing telemetry
        lot_multiplier: pgNumeric5_2(body.lot_multiplier) ?? null,
        lot_level: safeText(body.lot_level),
        lot_reason: safeText(body.lot_reason),
        executed_lot: pgNumeric10_2(body.executed_lot) ?? null,

        // Virtual (paper/shadow) trade support
        is_virtual: body.is_virtual ?? false,
        planned_entry_price: body.planned_entry_price ?? null,
        planned_sl: body.planned_sl ?? null,
        planned_tp: body.planned_tp ?? null,
        planned_order_type: body.planned_order_type ?? null,
        virtual_filled_at: body.virtual_filled_at ?? null,
        
        actual_result: actualResult,
      };

      const { data, error } = await supabase
        .from("ai_signals")
        .insert(entry)
        .select()
        .single();

      if (error) {
        const code = (error as any).code ?? null;
        const msg = String((error as any).message ?? "");
        const isMissingColumn =
          code === "42703" ||
          code === "PGRST204" ||
          /column .* does not exist/i.test(msg) ||
          /schema cache/i.test(msg) ||
          /Could not find the .* column .* schema cache/i.test(msg);

        if (isMissingColumn) {
          // Backwards-compatible fallback: remote DB schema might not yet have
          // regime/strategy columns. Retry without them.
          const legacyEntry: any = { ...entry };
          legacyEntry.entry_params = mergeRegimeIntoEntryParams(
            legacyEntry.entry_params,
            entry.regime,
            entry.strategy,
            entry.regime_confidence,
          );
          delete legacyEntry.regime;
          delete legacyEntry.strategy;
          delete legacyEntry.regime_confidence;
          delete legacyEntry.lot_multiplier;
          delete legacyEntry.lot_level;
          delete legacyEntry.lot_reason;
          delete legacyEntry.executed_lot;

          const { data: legacyData, error: legacyError } = await supabase
            .from("ai_signals")
            .insert(legacyEntry)
            .select()
            .single();

          if (!legacyError) {
            console.warn("[ai-signals] Inserted legacy entry (remote schema not migrated yet)");
            return new Response(
              JSON.stringify({ success: true, signal_id: legacyData.id }),
              { status: 200, headers: corsHeaders() }
            );
          }

          console.error("[ai-signals] Legacy insert error:", legacyError);
          return new Response(
            JSON.stringify({
              error: legacyError.message,
              code: (legacyError as any).code ?? null,
              details: (legacyError as any).details ?? null,
              hint: (legacyError as any).hint ?? null,
            }),
            { status: 500, headers: corsHeaders() }
          );
        }

        console.error("[ai-signals] Insert error:", error);
        return new Response(
          JSON.stringify({
            error: error.message,
            code,
            details: (error as any).details ?? null,
            hint: (error as any).hint ?? null,
          }),
          { status: 500, headers: corsHeaders() }
        );
      }

      return new Response(
        JSON.stringify({ success: true, signal_id: data.id }),
        { status: 200, headers: corsHeaders() }
      );
    }

    // PUT: 取引結果の更新
    if (req.method === "PUT") {
      const {
        signal_id,
        order_ticket,
        // regime fields (optional)
        atr_norm,
        adx,
        di_plus,
        di_minus,
        bb_width,
        exit_price,
        profit_loss,
        actual_result,
        closed_at,
        hold_duration_minutes,
        sl_hit,
        tp_hit,
        cancelled_reason,
        // virtual
        is_virtual,
        planned_entry_price,
        planned_sl,
        planned_tp,
        planned_order_type,
        virtual_filled_at,
        // エントリー方式の後追い更新にも対応
        entry_method,
        entry_params,
        method_selected_by,
        method_confidence,
        method_reason,
      } = body;

      const parsedOrderTicket = parseOrderTicket(order_ticket);

      if (!signal_id && !parsedOrderTicket) {
        return new Response(
          JSON.stringify({ error: "signal_id or order_ticket is required" }),
          { status: 400, headers: corsHeaders() }
        );
      }

      const updateData: any = {};
  if (atr_norm !== undefined) updateData.atr_norm = atr_norm;
  if (adx !== undefined) updateData.adx = adx;
  if (di_plus !== undefined) updateData.di_plus = di_plus;
  if (di_minus !== undefined) updateData.di_minus = di_minus;
  if (bb_width !== undefined) updateData.bb_width = bb_width;
      if (exit_price !== undefined) updateData.exit_price = exit_price;
      if (profit_loss !== undefined) updateData.profit_loss = profit_loss;

      const normalizedActualResult = normalizeActualResult(actual_result);
      if (actual_result !== undefined && normalizedActualResult === null) {
        return new Response(
          JSON.stringify({ error: "invalid actual_result" }),
          { status: 400, headers: corsHeaders() }
        );
      }
      if (normalizedActualResult) updateData.actual_result = normalizedActualResult;

      if (closed_at) updateData.closed_at = closed_at;
      if (hold_duration_minutes !== undefined) updateData.hold_duration_minutes = hold_duration_minutes;
      if (sl_hit !== undefined) updateData.sl_hit = sl_hit;
      if (tp_hit !== undefined) updateData.tp_hit = tp_hit;

        if (cancelled_reason) updateData.cancelled_reason = cancelled_reason;

        // virtual fields
        if (is_virtual !== undefined) updateData.is_virtual = is_virtual;
        if (planned_entry_price !== undefined) updateData.planned_entry_price = planned_entry_price;
        if (planned_sl !== undefined) updateData.planned_sl = planned_sl;
        if (planned_tp !== undefined) updateData.planned_tp = planned_tp;
        if (planned_order_type !== undefined) updateData.planned_order_type = planned_order_type;
        if (virtual_filled_at !== undefined) updateData.virtual_filled_at = virtual_filled_at;

        if (entry_method !== undefined) updateData.entry_method = entry_method;
        if (entry_params !== undefined) updateData.entry_params = entry_params;
        if (method_selected_by !== undefined) updateData.method_selected_by = method_selected_by;
        if (method_confidence !== undefined) updateData.method_confidence = method_confidence;
        if (method_reason !== undefined) updateData.method_reason = method_reason;

      // Guard: prevent FILLED without a valid order_ticket for non-virtual trades.
      // - Real execution should always have a positive order_ticket.
      // - Virtual (paper/shadow) trades may use signal_id-based updates with no ticket.
      if (updateData.actual_result === "FILLED" && !parsedOrderTicket) {
        const virtualIntent =
          is_virtual === true ||
          updateData.is_virtual === true ||
          (typeof updateData.virtual_filled_at === "string" && updateData.virtual_filled_at.trim() !== "");

        let existingIsVirtual = false;
        if (!virtualIntent && signal_id) {
          const { data: existing, error: existingErr } = await supabase
            .from("ai_signals")
            .select("is_virtual")
            .eq("id", signal_id)
            .maybeSingle();
          if (existingErr) {
            console.warn("[ai-signals] Failed to fetch existing is_virtual:", existingErr.message);
          }
          existingIsVirtual = existing?.is_virtual === true;
        }

        if (!virtualIntent && !existingIsVirtual) {
          return new Response(
            JSON.stringify({
              error: "FILLED requires a valid order_ticket unless is_virtual=true",
            }),
            { status: 400, headers: corsHeaders() }
          );
        }
      }

      // Validate actual_result state transitions (best-effort, requires existing row).
      if (updateData.actual_result) {
        const { data: existingRow, error: existingErr } = signal_id
          ? await supabase
              .from("ai_signals")
              .select("id, actual_result")
              .eq("id", signal_id)
              .maybeSingle()
          : await supabase
              .from("ai_signals")
              .select("id, actual_result")
              .eq("order_ticket", parsedOrderTicket as string)
              .maybeSingle();

        if (existingErr) {
          console.warn("[ai-signals] Failed to fetch existing row for transition validation:", existingErr.message);
        } else if (existingRow) {
          const prev = normalizeActualResult(existingRow.actual_result) as ActualResult | null;
          const next = updateData.actual_result as ActualResult;
          if (!isAllowedActualResultTransition(prev, next)) {
            return new Response(
              JSON.stringify({
                error: "invalid actual_result transition",
                previous: prev,
                next,
              }),
              { status: 409, headers: corsHeaders() }
            );
          }
        }
      }

      let query = supabase
        .from("ai_signals")
        .update(updateData);

      query = signal_id ? query.eq("id", signal_id) : query.eq("order_ticket", parsedOrderTicket);

      const { data, error } = await query.select();

      if (error) {
        console.error("[ai-signals] Update error:", error);
        return new Response(
          JSON.stringify({ error: error.message }),
          { status: 500, headers: corsHeaders() }
        );
      }

      // Best-effort: generate postmortem tags for LOSS/CANCELLED
      try {
        const updatedRow = Array.isArray(data) && data.length > 0 ? data[0] : null;
        const shouldTag =
          updatedRow &&
          (updatedRow.actual_result === "LOSS" || updatedRow.actual_result === "CANCELLED") &&
          !updatedRow.postmortem_generated_at;

        if (shouldTag) {
          const pm = await generatePostmortem(updatedRow);
          await supabase
            .from("ai_signals")
            .update({
              postmortem_tags: pm.tags,
              postmortem_summary: pm.summary,
              postmortem_generated_at: new Date().toISOString(),
              postmortem_model: pm.model ?? null,
            })
            .eq("id", updatedRow.id);
        }
      } catch (e) {
        console.warn("[ai-signals] Postmortem tagging skipped:", String(e));
      }

      return new Response(
        JSON.stringify({ success: true, updated: data?.length || 0 }),
        { status: 200, headers: corsHeaders() }
      );
    }

    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      { status: 405, headers: corsHeaders() }
    );

  } catch (error) {
    console.error("[ai-signals] Error:", error);
    return new Response(
      JSON.stringify({ error: String(error) }),
      { status: 500, headers: corsHeaders() }
    );
  }
});
