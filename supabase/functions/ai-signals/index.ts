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

  try {
    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
      },
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

  // Virtual (paper/shadow) trade support
  is_virtual?: boolean | null;
  planned_entry_price?: number | null;
  planned_sl?: number | null;
  planned_tp?: number | null;
  planned_order_type?: number | null;
  virtual_filled_at?: string | null;
  
  // 注文情報
  order_ticket?: number;
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

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, PUT, OPTIONS",
    "Content-Type": "application/json",
  };
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders() });
  }

  try {
    const body = await req.json();
    
    // POST: 新規シグナル記録
    if (req.method === "POST") {
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
        
        // 価格情報
        bid: body.bid,
        ask: body.ask,
        
        // 移動平均線
        ema_25: body.ema_25,
        sma_100: body.sma_100,
        ma_cross: body.ma_cross,
        
        // MACD指標（ネストされたオブジェクトから抽出）
        macd_main: body.macd?.main,
        macd_signal: body.macd?.signal,
        macd_histogram: body.macd?.histogram,
        macd_cross: body.macd?.cross,
        
        // 一目均衡表（ネストされたオブジェクトから抽出）
        ichimoku_tenkan: body.ichimoku?.tenkan,
        ichimoku_kijun: body.ichimoku?.kijun,
        ichimoku_senkou_a: body.ichimoku?.senkou_a,
        ichimoku_senkou_b: body.ichimoku?.senkou_b,
        ichimoku_chikou: body.ichimoku?.chikou,
        ichimoku_tk_cross: body.ichimoku?.tk_cross,
        ichimoku_cloud_color: body.ichimoku?.cloud_color,
        ichimoku_price_vs_cloud: body.ichimoku?.price_vs_cloud,
        
        // エントリー手法
        order_ticket: body.order_ticket,
        entry_price: body.entry_price,
        entry_method: body.entry_method ?? null,
        entry_params: body.entry_params ?? null,
        method_selected_by: body.method_selected_by ?? null,
        method_confidence: body.method_confidence ?? null,
        method_reason: body.method_reason ?? null,
        
        // MLパターントラッキング
        ml_pattern_used: body.ml_pattern_used ?? false,
        ml_pattern_id: body.ml_pattern_id ?? null,
        ml_pattern_name: body.ml_pattern_name ?? null,
        ml_pattern_confidence: body.ml_pattern_confidence ?? null,

        // Virtual (paper/shadow) trade support
        is_virtual: body.is_virtual ?? false,
        planned_entry_price: body.planned_entry_price ?? null,
        planned_sl: body.planned_sl ?? null,
        planned_tp: body.planned_tp ?? null,
        planned_order_type: body.planned_order_type ?? null,
        virtual_filled_at: body.virtual_filled_at ?? null,
        
        actual_result: body.actual_result || 'PENDING',
      };

      const { data, error } = await supabase
        .from("ai_signals")
        .insert(entry)
        .select()
        .single();

      if (error) {
        console.error("[ai-signals] Insert error:", error);
        return new Response(
          JSON.stringify({ error: error.message }),
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

      if (!signal_id && !order_ticket) {
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
      if (actual_result) updateData.actual_result = actual_result;
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

      let query = supabase
        .from("ai_signals")
        .update(updateData);

      query = signal_id ? query.eq("id", signal_id) : query.eq("order_ticket", order_ticket);

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
