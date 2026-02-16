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
  regime?: string;               // 相場状態（trend/range/uncertain）
  strategy?: string;             // 戦略（trend_follow/mean_revert/none）
  regime_confidence?: string;    // 判定信頼度（high/medium/low）
  action?: string;               // 売買の判断 (BUY/SELL/HOLD)
  tech_action?: string;          // テクニカル起点の方向（検証用）
  suggested_action?: string;     // AIがより良いと見た方向（検証用）
  suggested_dir?: number;        // suggested_actionの数値版（1/-1）
  buy_win_prob?: number;         // dir=0両方向評価のBUY勝率（0-1）
  sell_win_prob?: number;        // dir=0両方向評価のSELL勝率（0-1）
  trade_decision?: string;       // 実際の取引状況
  win_prob?: number;             // AIの算出した勝率
  lot_multiplier?: number;       // AI/ML suggested lot multiplier
  lot_level?: string;            // Lot sizing level label
  lot_reason?: string;           // Reason for lot multiplier
  executed_lot?: number;         // Final lot sent to broker
  ai_reasoning?: string;         // AIの判断根拠
  order_ticket?: number;         // 注文番号
}

// Full interface for backwards compatibility (accepts all fields from EA)
interface EALogInput {
  at: string;
  sym: string;
  tf?: string;
  regime?: string;
  strategy?: string;
  regime_confidence?: string;
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
  lot_multiplier?: number;
  lot_level?: string;
  lot_reason?: string;
  executed_lot?: number;
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

function pickAiReasoning(body: any): string | undefined {
  // Prefer the richest field that contains gate diagnostics (GATE/costSrc).
  // Some EA clients send a short 'ai_reasoning' but keep the full ai-trader output under other keys.
  const candidates: Array<{ key: string; value: unknown }> = [
    { key: "ai_reasoning", value: body?.ai_reasoning },
    { key: "reasoning", value: body?.reasoning },
    { key: "reason", value: body?.reason },
    { key: "ai_trader_reasoning", value: body?.ai_trader_reasoning },
    { key: "ai.reasoning", value: body?.ai?.reasoning },
    { key: "aiTrader.reasoning", value: body?.aiTrader?.reasoning },
    { key: "ai_trader_response.reasoning", value: body?.ai_trader_response?.reasoning },
    { key: "ai_trader_response.ai_reasoning", value: body?.ai_trader_response?.ai_reasoning },
    { key: "response.reasoning", value: body?.response?.reasoning },
  ];

  const texts = candidates
    .map((c) => ({ key: c.key, text: typeof c.value === "string" ? c.value.trim() : "" }))
    .filter((c) => c.text.length > 0);
  if (texts.length === 0) return undefined;

  // 1) Prefer explicit gate diagnostics.
  const withGate = texts.find((c) => /\bGATE\(/i.test(c.text) || /\bcostSrc\s*=/i.test(c.text));
  if (withGate) return withGate.text;

  // 2) Otherwise take the longest text (likely the most informative).
  texts.sort((a, b) => b.text.length - a.text.length);
  return texts[0].text;
}

function pickRegimeFields(body: any, reasoning?: string): {
  regime?: string;
  strategy?: string;
  regime_confidence?: string;
} {
  const pickString = (v: unknown): string | undefined => {
    if (typeof v !== "string") return undefined;
    const t = v.trim();
    return t.length > 0 ? t : undefined;
  };

  // 1) Prefer explicit top-level fields.
  let regime = pickString(body?.regime);
  let strategy = pickString(body?.strategy);
  let regime_confidence = pickString(body?.regime_confidence);

  // 2) Fallback: some clients send the full ai-trader response nested.
  const nestedCandidates = [
    body?.ai_trader_response,
    body?.response,
    body?.ai,
    body?.aiTrader,
  ];
  for (const n of nestedCandidates) {
    if (!regime) regime = pickString(n?.regime);
    if (!strategy) strategy = pickString(n?.strategy);
    if (!regime_confidence) regime_confidence = pickString(n?.regime_confidence);
    if (regime && strategy && regime_confidence) break;
  }

  // 3) Fallback: parse from reasoning prefix (e.g. "[regime=trend strategy=trend_follow conf=high] ...").
  const text = typeof reasoning === "string" ? reasoning : "";
  if (text) {
    if (!regime) {
      const m = text.match(/\bregime\s*=\s*([a-z_]+)/i);
      if (m) regime = m[1];
    }
    if (!strategy) {
      const m = text.match(/\bstrategy\s*=\s*([a-z_]+)/i);
      if (m) strategy = m[1];
    }
    if (!regime_confidence) {
      const m = text.match(/\bconf\s*=\s*([a-z_]+)/i);
      if (m) regime_confidence = m[1];
    }
  }

  return { regime, strategy, regime_confidence };
}

function buildRegimePrefix(regime?: string, strategy?: string, conf?: string): string {
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

function attachRegimeToReasoning(reasoning: unknown, regime?: string, strategy?: string, conf?: string): string | undefined {
  const prefix = buildRegimePrefix(regime, strategy, conf);
  if (!prefix) return typeof reasoning === "string" ? reasoning : undefined;

  const text = typeof reasoning === "string" ? reasoning.trim() : "";
  // Avoid duplicating if already prefixed
  if (text.startsWith("[regime=") || text.startsWith(prefix)) return text || prefix;
  return text ? `${prefix} ${text}` : prefix;
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
    const configuredBearer = (Deno.env.get("EA_LOG_BEARER_TOKEN") || "").trim();
    const allowed = new Set<string>();
    if (configuredBearer) allowed.add(`Bearer ${configuredBearer}`);
    // Keep accepting service role bearer for backwards compatibility with existing EA setups.
    allowed.add(`Bearer ${SUPABASE_SERVICE_ROLE_KEY}`);
    if (!allowed.has(auth)) {
      console.warn("[ea-log] Unauthorized request (bearer mismatch)");
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
    const pickedReasoning = pickAiReasoning(body as any);
    const pickedRegime = pickRegimeFields(body as any, pickedReasoning);
    const normalizedReasoning = attachRegimeToReasoning(
      pickedReasoning,
      pickedRegime.regime ?? body.regime,
      pickedRegime.strategy ?? body.strategy,
      pickedRegime.regime_confidence ?? body.regime_confidence,
    );

    const logEntry: EALogEntry = {
      at: toISO(body.at),
      sym,
      tf: body.tf || undefined,
      regime: (pickedRegime.regime ?? body.regime) || undefined,
      strategy: (pickedRegime.strategy ?? body.strategy) || undefined,
      regime_confidence: (pickedRegime.regime_confidence ?? body.regime_confidence) || undefined,
      action: body.action || undefined,
      tech_action: body.tech_action || undefined,
      suggested_action: body.suggested_action || undefined,
      suggested_dir: body.suggested_dir !== undefined ? Number(body.suggested_dir) : undefined,
      buy_win_prob: body.buy_win_prob !== undefined ? Number(body.buy_win_prob) : undefined,
      sell_win_prob: body.sell_win_prob !== undefined ? Number(body.sell_win_prob) : undefined,
      trade_decision: body.trade_decision || undefined,
      win_prob: body.win_prob !== undefined ? Number(body.win_prob) : undefined,
      lot_multiplier: body.lot_multiplier !== undefined ? Number(body.lot_multiplier) : undefined,
      lot_level: body.lot_level || undefined,
      lot_reason: body.lot_reason || undefined,
      executed_lot: body.executed_lot !== undefined ? Number(body.executed_lot) : undefined,
      ai_reasoning: normalizedReasoning,
      order_ticket: body.order_ticket !== undefined ? Number(body.order_ticket) : undefined,
    };

    // Prefer extended schema insert; fall back to the legacy minimal columns if remote DB
    // has not yet been migrated (e.g., missing tech_action/suggested_action/buy_win_prob columns).
    const { error: insertError } = await supabase.from("ea-log").insert(logEntry);
    if (insertError) {
      const msg = String(insertError.message || "");
      const code = String((insertError as any).code ?? "");
      const isMissingColumn =
        code === "42703" ||
        code === "PGRST204" ||
        /column .* does not exist/i.test(msg) ||
        /schema cache/i.test(msg) ||
        /Could not find the .* column .* schema cache/i.test(msg);
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
        ai_reasoning: normalizedReasoning,
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
    
    console.log(
      `[ea-log] sym=${logEntry.sym} tf=${logEntry.tf || "?"} caller=${body.caller || "-"} action=${logEntry.action || "?"} decision=${logEntry.trade_decision || "-"} ticket=${logEntry.order_ticket ?? "-"} win_prob=${logEntry.win_prob ?? "-"}`,
    );
    
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
