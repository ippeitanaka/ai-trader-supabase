import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

interface EALogEntry {
  at: string;
  sym: string;
  tf: string;
  rsi?: number;
  atr?: number;
  price?: number;
  action?: string;
  win_prob?: number;
  offset_factor?: number;
  expiry_minutes?: number;
  reason?: string;
  instance?: string;
  version?: string;
  caller?: string;
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
    
    let body;
    try {
      body = JSON.parse(safe);
    } catch (parseError) {
      console.error("[ea-log] JSON parse error:", parseError);
      return new Response(
        JSON.stringify({ error: "Invalid JSON" }),
        { status: 400, headers: corsHeaders() }
      );
    }
    
    const logEntry: EALogEntry = {
      at: toISO(body.at),
      sym: body.sym || "UNKNOWN",
      tf: body.tf || "UNKNOWN",
      rsi: body.rsi !== undefined ? Number(body.rsi) : undefined,
      atr: body.atr !== undefined ? Number(body.atr) : undefined,
      price: body.price !== undefined ? Number(body.price) : undefined,
      action: body.action || undefined,
      win_prob: body.win_prob !== undefined ? Number(body.win_prob) : undefined,
      offset_factor: body.offset_factor !== undefined ? Number(body.offset_factor) : undefined,
      expiry_minutes: body.expiry_minutes !== undefined ? Number(body.expiry_minutes) : undefined,
      reason: body.reason || undefined,
      instance: body.instance || undefined,
      version: body.version || undefined,
      caller: body.caller || undefined,
    };
    
    let { error } = await supabase.from("ea-log").insert(logEntry);
    
    if (error && (error.message.includes("offset_factor") || error.message.includes("expiry_minutes"))) {
      console.warn("[ea-log] Retrying without new columns");
      const fallbackEntry = { ...logEntry };
      delete fallbackEntry.offset_factor;
      delete fallbackEntry.expiry_minutes;
      const result = await supabase.from("ea-log").insert(fallbackEntry);
      error = result.error;
    }
    
    if (error) {
      console.error("[ea-log] DB error:", error);
      return new Response(
        JSON.stringify({ error: "DB insert failed" }),
        { status: 500, headers: corsHeaders() }
      );
    }
    
    console.log(`[ea-log] ${logEntry.sym} ${logEntry.tf} ${logEntry.caller || "-"}`);
    
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
