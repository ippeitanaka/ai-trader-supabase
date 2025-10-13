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
  min_win_prob: 0.70,
  pending_offset_atr: 0.20,
  pending_expiry_min: 90,
};

// ====== Types ======
interface AIConfig {
  min_win_prob: number;
  pending_offset_atr: number;
  pending_expiry_min: number;
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
      pending_offset_atr: data.pending_offset_atr ?? DEFAULT_CONFIG.pending_offset_atr,
      pending_expiry_min: data.pending_expiry_min ?? DEFAULT_CONFIG.pending_expiry_min,
      instance: data.instance,
      updated_at: data.updated_at,
    } : DEFAULT_CONFIG;
    
    // Log successful retrieval
    console.log(
      `[ai-config] ok inst=${instance} min=${config.min_win_prob.toFixed(2)} ` +
      `off=${config.pending_offset_atr.toFixed(2)} exp=${config.pending_expiry_min}`
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
