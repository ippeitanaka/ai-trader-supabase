// AI Config Edge Function for EA v1.2.2
// Returns dynamic configuration for EA based on instance name
// Uses maybeSingle() to handle multiple/no rows gracefully

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ====== Environment Variables ======
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// ====== Default Configuration ======
const DEFAULT_CONFIG = {
  min_win_prob: 70.0,
  risk_atr_mult: 1.5,
  reward_rr: 1.2,
  pending_offset_atr: 0.2,
  pending_expiry_min: 90,
  lots: 0.10,
  slippage_points: 1000,
  magic: 26091501,
  max_positions: 1,
  lock_to_chart_symbol: true,
  tf_entry: "M15",
  tf_recheck: "H1",
  debug_logs: true,
  log_cooldown_sec: 30,
};

// ====== Types ======
interface AIConfig {
  min_win_prob: number;
  risk_atr_mult: number;
  reward_rr: number;
  pending_offset_atr: number;
  pending_expiry_min: number;
  lots: number;
  slippage_points: number;
  magic: number;
  max_positions: number;
  lock_to_chart_symbol: boolean;
  tf_entry: string;
  tf_recheck: string;
  debug_logs: boolean;
  log_cooldown_sec: number;
  instance?: string;
  updated_at?: string;
}

// ====== Utility Functions ======
function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Content-Type": "application/json",
  };
}

// ====== Main Handler ======
serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }
  
  // Only accept GET
  if (req.method !== "GET") {
    return new Response(
      JSON.stringify({ error: "Method not allowed, GET only" }),
      { status: 405, headers: corsHeaders() }
    );
  }
  
  try {
    // Get instance from query parameter (default to "main")
    const url = new URL(req.url);
    const instance = url.searchParams.get("instance") || "main";
    
    // Query ai_config table using maybeSingle() for safe handling
    const { data, error } = await supabase
      .from("ai_config")
      .select("*")
      .eq("instance", instance)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();  // Returns null if no rows, first row if multiple
    
    if (error) {
      console.error("[ai-config] DB query error:", error);
      // Fallback to default config on error
      console.log(
        `[ai-config] fallback inst=${instance} min=${DEFAULT_CONFIG.min_win_prob.toFixed(2)} ` +
        `off=${DEFAULT_CONFIG.pending_offset_atr.toFixed(2)} exp=${DEFAULT_CONFIG.pending_expiry_min}`
      );
      return new Response(
        JSON.stringify(DEFAULT_CONFIG),
        { status: 200, headers: corsHeaders() }
      );
    }
    
    // Use data if available, otherwise use defaults
    const config: AIConfig = data ? {
      min_win_prob: data.min_win_prob ?? DEFAULT_CONFIG.min_win_prob,
      risk_atr_mult: data.risk_atr_mult ?? DEFAULT_CONFIG.risk_atr_mult,
      reward_rr: data.reward_rr ?? DEFAULT_CONFIG.reward_rr,
      pending_offset_atr: data.pending_offset_atr ?? DEFAULT_CONFIG.pending_offset_atr,
      pending_expiry_min: data.pending_expiry_min ?? DEFAULT_CONFIG.pending_expiry_min,
      lots: data.lots ?? DEFAULT_CONFIG.lots,
      slippage_points: data.slippage_points ?? DEFAULT_CONFIG.slippage_points,
      magic: data.magic ?? DEFAULT_CONFIG.magic,
      max_positions: data.max_positions ?? DEFAULT_CONFIG.max_positions,
      lock_to_chart_symbol: data.lock_to_chart_symbol ?? DEFAULT_CONFIG.lock_to_chart_symbol,
      tf_entry: data.tf_entry ?? DEFAULT_CONFIG.tf_entry,
      tf_recheck: data.tf_recheck ?? DEFAULT_CONFIG.tf_recheck,
      debug_logs: data.debug_logs ?? DEFAULT_CONFIG.debug_logs,
      log_cooldown_sec: data.log_cooldown_sec ?? DEFAULT_CONFIG.log_cooldown_sec,
      instance: data.instance,
      updated_at: data.updated_at,
    } : DEFAULT_CONFIG;
    
    // Log successful retrieval
    console.log(
      `[ai-config] ok inst=${instance} min=${config.min_win_prob.toFixed(2)} ` +
      `lots=${config.lots.toFixed(2)} max_pos=${config.max_positions}`
    );
    
    return new Response(
      JSON.stringify(config),
      { status: 200, headers: corsHeaders() }
    );
    
  } catch (error) {
    console.error("[ai-config] Error:", error);
    
    // Always return default config on any error
    console.log(
      `[ai-config] error_fallback min=${DEFAULT_CONFIG.min_win_prob.toFixed(2)} ` +
      `off=${DEFAULT_CONFIG.pending_offset_atr.toFixed(2)} exp=${DEFAULT_CONFIG.pending_expiry_min}`
    );
    
    return new Response(
      JSON.stringify(DEFAULT_CONFIG),
      { status: 200, headers: corsHeaders() }
    );
  }
});
