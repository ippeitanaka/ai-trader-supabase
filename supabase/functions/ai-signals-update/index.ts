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

  const absThresh = 0.2;
  const relThresh = Math.abs(actual) * 0.00002; // 2 bps
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
  const tags: string[] = [row?.actual_result === "CANCELLED" ? "cancelled" : "loss"];
  if (row?.sl_hit === true) tags.push("sl_hit");
  if (row?.tp_hit === true) tags.push("tp_hit");
  if (typeof row?.entry_method === "string" && row.entry_method) tags.push(`method_${row.entry_method}`);
  if (typeof row?.cancelled_reason === "string" && row.cancelled_reason) tags.push("has_cancel_reason");
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

Trade record (some fields may be null):
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

    if (!resp.ok) return fallbackPostmortem(row);
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

interface SignalUpdateRequest {
  order_ticket: number | string;
  entry_price?: number;
  actual_result?: string;
}

function parseOrderTicket(value: unknown): string | null {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value <= 0) return null;
    if (!Number.isInteger(value)) return null;
    return String(value);
  }
  if (typeof value === "string") {
    const s = value.trim();
    if (!s) return null;
    if (!/^[0-9]+$/.test(s)) return null;
    if (s === "0") return null;
    return s;
  }
  return null;
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
  };
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }
  
  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Method not allowed, POST only" }),
      { status: 405, headers: corsHeaders() }
    );
  }
  
  try {
    const body: SignalUpdateRequest = await req.json();

    const orderTicket = parseOrderTicket(body.order_ticket);
    if (!orderTicket) {
      return new Response(
        JSON.stringify({ error: "order_ticket is required" }),
        { status: 400, headers: corsHeaders() }
      );
    }
    
    // 更新するフィールドを構築
    const updateData: any = {};
    
    if (body.entry_price !== undefined) {
      updateData.entry_price = body.entry_price;
    }
    
    if (body.actual_result) {
      updateData.actual_result = body.actual_result;
    }
    
    // フィールドが何もない場合
    if (Object.keys(updateData).length === 0) {
      return new Response(
        JSON.stringify({ error: "No fields to update" }),
        { status: 400, headers: corsHeaders() }
      );
    }
    
    // データベース更新
    const { data, error } = await supabase
      .from("ai_signals")
      .update(updateData)
      .eq("order_ticket", orderTicket)
      .select();
    
    if (error) {
      console.error("[ai-signals-update] DB error:", error);
      return new Response(
        JSON.stringify({ error: "DB update failed", details: error.message }),
        { status: 500, headers: corsHeaders() }
      );
    }
    
    if (!data || data.length === 0) {
      console.warn(`[ai-signals-update] No record found for ticket ${orderTicket}`);
      return new Response(
        JSON.stringify({ 
          ok: false, 
          message: "No matching record found",
          order_ticket: orderTicket 
        }),
        { status: 404, headers: corsHeaders() }
      );
    }

    console.log(`[ai-signals-update] Updated ticket ${orderTicket}: ${JSON.stringify(updateData)}`);

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
      console.warn("[ai-signals-update] Postmortem tagging skipped:", String(e));
    }
    
    return new Response(
      JSON.stringify({ 
        ok: true, 
        updated: data.length,
        data: data[0]
      }),
      { status: 200, headers: corsHeaders() }
    );
    
  } catch (error) {
    console.error("[ai-signals-update] Error:", error);
    return new Response(
      JSON.stringify({ error: "Internal error", details: String(error) }),
      { status: 500, headers: corsHeaders() }
    );
  }
});
