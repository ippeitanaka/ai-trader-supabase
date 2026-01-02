import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// Simplified interface - only essential columns for ea-log table
interface EALogEntry {
  at: string;                    // トレード判断日時
  sym: string;                   // 銘柄
  tf?: string;                   // タイムフレーム（補足情報）
  action?: string;               // 売買の判断 (BUY/SELL/HOLD)
  tech_action?: string;          // テクニカル起点の方向（検証用）
  suggested_action?: string;     // AIがより良いと見た方向（検証用）
  suggested_dir?: number;        // suggested_actionの数値版（1/-1）
  buy_win_prob?: number;         // dir=0両方向評価のBUY勝率（0-1）
  sell_win_prob?: number;        // dir=0両方向評価のSELL勝率（0-1）
  trade_decision?: string;       // 実際の取引状況
  win_prob?: number;             // AIの算出した勝率
  ai_reasoning?: string;         // AIの判断根拠
  order_ticket?: number;         // 注文番号
}

// Full interface for backwards compatibility (accepts all fields from EA)
interface EALogInput {
  at: string;
  sym: string;
  tf?: string;
  rsi?: number;
  atr?: number;
  price?: number;
  bid?: number;
  ask?: number;
  action?: string;
  tech_action?: string;
  suggested_action?: string;
  suggested_dir?: number;
  buy_win_prob?: number;
  sell_win_prob?: number;
  win_prob?: number;
  offset_factor?: number;
  expiry_minutes?: number;
  reason?: string;
  instance?: string;
  version?: string;
  caller?: string;
  ai_confidence?: string;
  ai_reasoning?: string;
  trade_decision?: string;
  threshold_met?: boolean;
  current_positions?: number;
  order_ticket?: number;
  ema25s2?: number;
  ma100?: number;
  ma200?: number;
  spread?: number;
  bar_ts?: string;
  account_login?: string;
  broker?: string;
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
  };
}

function toISO(value: any): string {
  if (!value) return new Date().toISOString();
  if (typeof value === "string") {
    if (/^\d{4}-\d{2}-\d{2}T/.test(value)) {
      const d = new Date(value);
      return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
    }
    const d = new Date(value);
    return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
  }
  if (typeof value === "number") {
    const ms = value > 1e12 ? value : value * 1000;
    const d = new Date(ms);
    return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
  }
  return new Date().toISOString();
}

function normalizeSym(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim();
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
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
    // NOTE: This function uses the service role key for DB writes.
    // Require a matching Bearer token to prevent random internet traffic from inserting junk rows.
    const auth = req.headers.get("authorization") || "";
    const expectedBearer = Deno.env.get("EA_LOG_BEARER_TOKEN") || SUPABASE_SERVICE_ROLE_KEY;
    if (auth !== `Bearer ${expectedBearer}`) {
      console.warn("[ea-log] Unauthorized request");
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: corsHeaders() },
      );
    }

    const raw = await req.text();
    
    if (!raw || raw.trim().length === 0) {
      console.warn("[ea-log] Empty request body");
      return new Response(
        JSON.stringify({ error: "Empty request body" }),
        { status: 400, headers: corsHeaders() }
      );
    }
    
    const safe = raw.replace(/\u0000+$/g, "");
    
    if (!safe || safe.trim().length === 0) {
      console.warn("[ea-log] Only NUL bytes");
      return new Response(
        JSON.stringify({ error: "Invalid body (only NUL)" }),
        { status: 400, headers: corsHeaders() }
      );
    }
    
    let body: EALogInput;
    try {
      body = JSON.parse(safe);
    } catch (parseError) {
      console.error("[ea-log] JSON parse error:", parseError);
      return new Response(
        JSON.stringify({ error: "Invalid JSON" }),
        { status: 400, headers: corsHeaders() }
      );
    }

    const sym = normalizeSym((body as any).sym);
    if (!sym) {
      console.warn("[ea-log] Missing or empty sym");
      return new Response(
        JSON.stringify({ error: "Missing required field: sym" }),
        { status: 400, headers: corsHeaders() },
      );
    }

    const hasAnyMeaningfulField =
      isNonEmptyString((body as any).action) ||
      isNonEmptyString((body as any).trade_decision) ||
      (typeof (body as any).win_prob === "number" && Number.isFinite((body as any).win_prob));
    if (!hasAnyMeaningfulField) {
      console.warn(`[ea-log] Rejecting low-signal payload sym=${sym}`);
      return new Response(
        JSON.stringify({ error: "Missing required fields (action/trade_decision/win_prob)" }),
        { status: 400, headers: corsHeaders() },
      );
    }
    
    // Extract only essential columns for simplified ea-log table
    // EA can send all fields, but we only store what's needed for monitoring
    const logEntry: EALogEntry = {
      at: toISO(body.at),
      sym,
      tf: body.tf || undefined,
      action: body.action || undefined,
      tech_action: body.tech_action || undefined,
      suggested_action: body.suggested_action || undefined,
      suggested_dir: body.suggested_dir !== undefined ? Number(body.suggested_dir) : undefined,
      buy_win_prob: body.buy_win_prob !== undefined ? Number(body.buy_win_prob) : undefined,
      sell_win_prob: body.sell_win_prob !== undefined ? Number(body.sell_win_prob) : undefined,
      trade_decision: body.trade_decision || undefined,
      win_prob: body.win_prob !== undefined ? Number(body.win_prob) : undefined,
      ai_reasoning: body.ai_reasoning || undefined,
      order_ticket: body.order_ticket !== undefined ? Number(body.order_ticket) : undefined,
    };

    // Prefer extended schema insert; fall back to the legacy minimal columns if remote DB
    // has not yet been migrated (e.g., missing tech_action/suggested_action/buy_win_prob columns).
    const { error: insertError } = await supabase.from("ea-log").insert(logEntry);
    if (insertError) {
      const msg = String(insertError.message || "");
      const isMissingColumn = /column .* does not exist/i.test(msg) || /42703/.test(msg);
      if (!isMissingColumn) {
        console.error("[ea-log] DB error:", insertError);
        return new Response(
          JSON.stringify({ error: "DB insert failed", details: insertError.message }),
          { status: 500, headers: corsHeaders() }
        );
      }

      const legacyEntry: Pick<EALogEntry, "at" | "sym" | "tf" | "action" | "trade_decision" | "win_prob" | "ai_reasoning" | "order_ticket"> = {
        at: logEntry.at,
        sym: logEntry.sym,
        tf: logEntry.tf,
        action: logEntry.action,
        trade_decision: logEntry.trade_decision,
        win_prob: logEntry.win_prob,
        ai_reasoning: logEntry.ai_reasoning,
        order_ticket: logEntry.order_ticket,
      };

      const { error: legacyError } = await supabase.from("ea-log").insert(legacyEntry);
      if (legacyError) {
        console.error("[ea-log] DB legacy insert error:", legacyError);
        return new Response(
          JSON.stringify({ error: "DB insert failed", details: legacyError.message }),
          { status: 500, headers: corsHeaders() }
        );
      }

      console.warn("[ea-log] Inserted legacy entry (remote schema not migrated yet)");
    }
    
    console.log(`[ea-log] ${logEntry.sym} ${logEntry.tf || "?"} ${body.caller || "-"} ${logEntry.action || "?"}`);
    
    return new Response(
      JSON.stringify({ ok: true }),
      { status: 200, headers: corsHeaders() }
    );
    
  } catch (error) {
    console.error("[ea-log] Error:", error);
    return new Response(
      JSON.stringify({ error: "Internal error" }),
      { status: 500, headers: corsHeaders() }
    );
  }
});
