import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

interface SignalUpdateRequest {
  order_ticket: number;
  entry_price?: number;
  actual_result?: string;
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
    
    if (!body.order_ticket) {
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
      .eq("order_ticket", body.order_ticket)
      .select();
    
    if (error) {
      console.error("[ai-signals-update] DB error:", error);
      return new Response(
        JSON.stringify({ error: "DB update failed", details: error.message }),
        { status: 500, headers: corsHeaders() }
      );
    }
    
    if (!data || data.length === 0) {
      console.warn(`[ai-signals-update] No record found for ticket ${body.order_ticket}`);
      return new Response(
        JSON.stringify({ 
          ok: false, 
          message: "No matching record found",
          order_ticket: body.order_ticket 
        }),
        { status: 404, headers: corsHeaders() }
      );
    }
    
    console.log(`[ai-signals-update] Updated ticket ${body.order_ticket}: ${JSON.stringify(updateData)}`);
    
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
