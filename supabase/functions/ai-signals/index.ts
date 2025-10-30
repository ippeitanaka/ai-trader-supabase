import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

interface AISignalEntry {
  // AI判定時の情報
  symbol: string;
  timeframe: string;
  dir: number;
  win_prob: number;
  atr?: number;
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
        order_ticket,
        exit_price,
        profit_loss,
        actual_result,
        closed_at,
        hold_duration_minutes,
        sl_hit,
        tp_hit,
        cancelled_reason,
        // エントリー方式の後追い更新にも対応
        entry_method,
        entry_params,
        method_selected_by,
        method_confidence,
        method_reason,
      } = body;

      if (!order_ticket) {
        return new Response(
          JSON.stringify({ error: "order_ticket is required" }),
          { status: 400, headers: corsHeaders() }
        );
      }

      const updateData: any = {};
      if (exit_price !== undefined) updateData.exit_price = exit_price;
      if (profit_loss !== undefined) updateData.profit_loss = profit_loss;
      if (actual_result) updateData.actual_result = actual_result;
      if (closed_at) updateData.closed_at = closed_at;
      if (hold_duration_minutes !== undefined) updateData.hold_duration_minutes = hold_duration_minutes;
      if (sl_hit !== undefined) updateData.sl_hit = sl_hit;
      if (tp_hit !== undefined) updateData.tp_hit = tp_hit;
  if (cancelled_reason) updateData.cancelled_reason = cancelled_reason;
  if (entry_method !== undefined) updateData.entry_method = entry_method;
  if (entry_params !== undefined) updateData.entry_params = entry_params;
  if (method_selected_by !== undefined) updateData.method_selected_by = method_selected_by;
  if (method_confidence !== undefined) updateData.method_confidence = method_confidence;
  if (method_reason !== undefined) updateData.method_reason = method_reason;

      const { data, error } = await supabase
        .from("ai_signals")
        .update(updateData)
        .eq("order_ticket", order_ticket)
        .select();

      if (error) {
        console.error("[ai-signals] Update error:", error);
        return new Response(
          JSON.stringify({ error: error.message }),
          { status: 500, headers: corsHeaders() }
        );
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
