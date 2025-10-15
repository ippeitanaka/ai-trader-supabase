import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

interface TradeRequest {
  symbol: string;
  timeframe: string;
  dir: number;
  rsi: number;
  atr: number;
  price: number;
  reason: string;
  instance?: string;
  version?: string;
}

interface TradeResponse {
  win_prob: number;
  action: number;
  offset_factor: number;
  expiry_minutes: number;
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Content-Type": "application/json",
  };
}

function calculateSignal(req: TradeRequest): TradeResponse {
  const { dir, rsi, atr } = req;
  let win_prob = 0.55; // ベース確率を55%に引き上げ
  let action = 0;
  let offset_factor = 0.2;
  let expiry_minutes = 90;
  
  // RSI条件の改善
  if (rsi > 70) {
    // 買われすぎ → 売りが有利
    win_prob += (dir < 0) ? 0.20 : -0.05;
  } else if (rsi < 30) {
    // 売られすぎ → 買いが有利
    win_prob += (dir > 0) ? 0.20 : -0.05;
  } else if (rsi >= 60 && rsi <= 70) {
    // 上昇トレンド中 → 買いが有利
    win_prob += (dir > 0) ? 0.15 : 0.0;
  } else if (rsi >= 30 && rsi <= 40) {
    // 下降トレンド中 → 売りが有利
    win_prob += (dir < 0) ? 0.15 : 0.0;
  } else if (rsi >= 50 && rsi < 60) {
    // 中立から上昇 → 買いやや有利
    win_prob += (dir > 0) ? 0.10 : 0.0;
  } else if (rsi > 40 && rsi < 50) {
    // 中立から下降 → 売りやや有利
    win_prob += (dir < 0) ? 0.10 : 0.0;
  }
  
  // トレンド方向ボーナス（MA判定があることを前提）
  if (dir !== 0) win_prob += 0.15;
  
  // ATRによるボラティリティ調整
  if (atr > 0) {
    if (atr > 0.001) {
      offset_factor = 0.25;
      win_prob += 0.05; // ボラティリティが高い = トレンドが明確
    }
    if (atr < 0.0005) {
      offset_factor = 0.15;
      expiry_minutes = 60;
      win_prob -= 0.05; // ボラティリティが低い = レンジ相場
    }
  }
  
  // 確率を0～1の範囲に制限
  win_prob = Math.max(0, Math.min(1, win_prob));
  
  // 70%以上でアクション推奨
  if (win_prob >= 0.70) action = dir;
  
  return {
    win_prob: Math.round(win_prob * 1000) / 1000,
    action,
    offset_factor: Math.round(offset_factor * 1000) / 1000,
    expiry_minutes,
  };
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }
  
  if (req.method === "GET") {
    return new Response(
      JSON.stringify({ ok: true, service: "ai-trader", version: "1.2.2" }),
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
    
    if (!raw || raw.trim().length === 0) {
      console.warn("[ai-trader] Empty body");
      return new Response(
        JSON.stringify({ error: "Empty body" }),
        { status: 400, headers: corsHeaders() }
      );
    }
    
    const safe = raw.replace(/\u0000+$/g, "");
    
    if (!safe || safe.trim().length === 0) {
      console.warn("[ai-trader] Only NUL");
      return new Response(
        JSON.stringify({ error: "Invalid body" }),
        { status: 400, headers: corsHeaders() }
      );
    }
    
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
    
    const required = ["symbol", "timeframe", "dir", "rsi", "atr", "price", "reason"];
    for (const field of required) {
      if (!(field in body)) {
        return new Response(
          JSON.stringify({ error: `Missing: ${field}` }),
          { status: 400, headers: corsHeaders() }
        );
      }
    }
    
    const tradeReq: TradeRequest = body;
    const response = calculateSignal(tradeReq);
    
    console.log(
      `[ai-trader] ${tradeReq.symbol} ${tradeReq.timeframe} ` +
      `dir=${tradeReq.dir} win=${response.win_prob.toFixed(3)}`
    );
    
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
