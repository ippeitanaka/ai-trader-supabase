// AI Trader Edge Function for EA v1.2.2// AI Trader Edge Function for EA v1.2.2// AI Trader Edge Function (Hybrid: Consensus + Optional AI Bias)

// Receives technical indicators from MT5 EA and returns AI trading signals

// Features: NUL byte removal, RSI/ATR-based logic, CORS support, console logging// Simple AI trading signal endpoint with NUL byte removal and logging// - 汎用：どの通貨ペアでも同じURLでOK（銘柄別上書き可）



import { serve } from "https://deno.land/std@0.224.0/http/server.ts";// Handles POST requests from MT5 EA, returns trading signals with win probability// - フィルタ：時間帯 / スプレッド / 低ボラ / ソフト・レート制限

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// - 合議制：SMA, RSI, MACD, ADX(DI), Stochastic, Bollinger

// ====== Environment Variables ======

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;import { serve } from "https://deno.land/std@0.224.0/http/server.ts";// - DiNapoli拡張：Fib 38.2/50/61.8 ゾーン / 3x3,7x5,25x5(擬似DMA) / MACD Predictor

const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";// - AI補助：拮抗局面だけ+1/0/-1の微バイアス & タグ/コメント（失敗時は即フォールバック）

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// - 認証：Bearer（環境変数AI_TRADER_API_KEYを設定したときだけ必須）

// ====== Types ======

interface TradeRequest {// ====== Environment Variables ======// Deno runtime

  symbol: string;

  timeframe: string;const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;

  dir: number;  // 1=BUY, -1=SELL, 0=NEUTRAL

  rsi: number;const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;import { serve } from "std/http/server.ts";

  atr: number;

  price: number;

  reason: string;

  instance?: string;const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);/* ========================= 環境変数 ========================= */

  version?: string;

}// 認証（空なら無効＝誰でも可）



interface TradeResponse {// ====== Types ======const API_KEY = Deno.env.get("AI_TRADER_API_KEY") ?? "";

  win_prob: number;

  action: number;  // 1=BUY, -1=SELL, 0=HOLDinterface TradeRequest {

  offset_factor: number;

  expiry_minutes: number;  symbol: string;// ログ

}

  timeframe: string;const LOG_REASON = (Deno.env.get("AI_TRADER_LOG_REASON") ?? "true") === "true";

// ====== Utility Functions ======

function corsHeaders() {  dir: number;  // 1=BUY, -1=SELL, 0=NEUTRAL

  return {

    "Access-Control-Allow-Origin": "*",  rsi: number;// 時間帯フィルタ（JST）

    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",

    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",  atr: number;const ENABLE_TIME_FILTER   = (Deno.env.get("ENABLE_TIME_FILTER") ?? "false") === "true";

    "Content-Type": "application/json",

  };  price: number;const TRADE_START_HOUR_JST = Number(Deno.env.get("TRADE_START_HOUR_JST") ?? 8);

}

  reason: string;const TRADE_END_HOUR_JST   = Number(Deno.env.get("TRADE_END_HOUR_JST") ?? 23);

// Simple AI logic based on technical indicators

function calculateSignal(req: TradeRequest): TradeResponse {  instance?: string;

  const { dir, rsi, atr } = req;

    version?: string;// フィルタ閾値（汎用デフォルト）

  let win_prob = 0.5;  // Base probability

  let action = 0;      // Default HOLD}const SPREAD_MAX_DEFAULT = Number(Deno.env.get("SPREAD_MAX") ?? 0); // 0=無効

  let offset_factor = 0.2;

  let expiry_minutes = 90;const ATR_MIN_DEFAULT    = Number(Deno.env.get("ATR_MIN") ?? 0);    // 0=無効

  

  // RSI-based adjustmentsinterface TradeResponse {

  if (rsi > 70) {

    // Overbought - favor SELL  win_prob: number;// 合議制しきい値

    win_prob += (dir < 0) ? 0.15 : -0.10;

  } else if (rsi < 30) {  action: number;  // 1=BUY, -1=SELL, 0=HOLDconst RSI_BUY_MIN_DEFAULT  = Number(Deno.env.get("RSI_BUY_MIN") ?? 55);

    // Oversold - favor BUY

    win_prob += (dir > 0) ? 0.15 : -0.10;  offset_factor: number;const RSI_SELL_MAX_DEFAULT = Number(Deno.env.get("RSI_SELL_MAX") ?? 45);

  } else if (rsi > 55 && rsi < 70) {

    // Bullish zone  expiry_minutes: number;const ADX_MIN_DEFAULT      = Number(Deno.env.get("ADX_MIN") ?? 22);

    win_prob += (dir > 0) ? 0.12 : -0.08;

  } else if (rsi < 45 && rsi > 30) {}

    // Bearish zone

    win_prob += (dir < 0) ? 0.12 : -0.08;// スコア採択条件

  }

  // ====== Utility Functions ======const SCORE_FIRE_MIN_DEFAULT   = Number(Deno.env.get("SCORE_FIRE_MIN") ?? 4);

  // Direction confirmation

  if (dir !== 0) {function corsHeaders() {const SCORE_MARGIN_MIN_DEFAULT = Number(Deno.env.get("SCORE_MARGIN_MIN") ?? 2);

    win_prob += 0.10;  // Bonus for having a direction

  }  return {

  

  // ATR-based volatility adjustment    "Access-Control-Allow-Origin": "*",// TTL（EA側で有効視する秒数）

  if (atr > 0) {

    if (atr > 0.001) {    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",const TTL_SEC_DEFAULT = Number(Deno.env.get("TTL_SEC_DEFAULT") ?? 30);

      offset_factor = 0.25;

    }    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",

    if (atr < 0.0005) {

      offset_factor = 0.15;    "Content-Type": "application/json",// ソフトRateLimit（インスタンス内メモリ）

      expiry_minutes = 60;

    }  };const RL_MAX_HITS_PER_MIN = Number(Deno.env.get("RL_MAX_HITS_PER_MIN") ?? 120);

  }

  }

  // Clamp probability between 0 and 1

  win_prob = Math.max(0, Math.min(1, win_prob));// 銘柄別上書き（JSON文字列）

  

  // Determine action based on direction and probability// Remove trailing NUL bytes and parse JSON safelytype SymCfg = Partial<{

  if (win_prob >= 0.70) {

    action = dir;function safeJsonParse(raw: string): any {  SPREAD_MAX:number; ATR_MIN:number;

  } else {

    action = 0;  // Remove NUL bytes (\u0000) from the string  RSI_BUY_MIN:number; RSI_SELL_MAX:number; ADX_MIN:number;

  }

    const cleaned = raw.replace(/\u0000/g, "").trim();  SCORE_FIRE_MIN:number; SCORE_MARGIN_MIN:number;

  return {

    win_prob: Math.round(win_prob * 1000) / 1000,  try {}>;

    action,

    offset_factor: Math.round(offset_factor * 1000) / 1000,    return JSON.parse(cleaned);const OVERRIDES: Record<string, SymCfg> = (() => {

    expiry_minutes,

  };  } catch (e) {  try {

}

    // Try to recover by finding the last valid JSON closing bracket    const raw = Deno.env.get("AI_TRADER_SYMBOL_OVERRIDES") ?? "";

// ====== Main Handler ======

serve(async (req: Request) => {    const lastBrace = cleaned.lastIndexOf("}");    return raw ? JSON.parse(raw) : {};

  // Handle CORS preflight

  if (req.method === "OPTIONS") {    const lastBracket = cleaned.lastIndexOf("]");  } catch { return {}; }

    return new Response(null, { status: 204, headers: corsHeaders() });

  }    const lastValid = Math.max(lastBrace, lastBracket);})();

  

  // Handle GET for health check    

  if (req.method === "GET") {

    return new Response(    if (lastValid > 0) {// ====== AI 呼び出し系（任意・安全フォールバック） ======

      JSON.stringify({ 

        ok: true,       const sliced = cleaned.slice(0, lastValid + 1);const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") ?? "";

        service: "ai-trader", 

        version: "1.2.2",      return JSON.parse(sliced);const AI_MODEL       = Deno.env.get("AI_MODEL") ?? "gpt-4o-mini";

        timestamp: new Date().toISOString()

      }),    }const AI_TIMEOUT_MS  = Number(Deno.env.get("AI_TIMEOUT_MS") ?? 1500);

      { status: 200, headers: corsHeaders() }

    );    throw e;const AI_ENABLE      = (Deno.env.get("AI_ENABLE") ?? "true") === "true";

  }

    }

  // Handle POST for trading signals

  if (req.method !== "POST") {}/* ========================= 型 ========================= */

    return new Response(

      JSON.stringify({ error: "Method not allowed" }),type InPayload = {

      { status: 405, headers: corsHeaders() }

    );// Simple AI logic based on technical indicators  symbol: string;

  }

  function calculateSignal(req: TradeRequest): TradeResponse {  timeframe: string;

  try {

    // Read request body as text and remove trailing NUL bytes  const { dir, rsi, atr, symbol, timeframe } = req;  time: number;

    const raw = await req.text();

    const safe = raw.replace(/\u0000+$/g, "");  // Remove trailing NUL    price: number;

    const body = JSON.parse(safe);

      let win_prob = 0.5;  // Base probability  bid: number;

    // Validate required fields

    const required = ["symbol", "timeframe", "dir", "rsi", "atr", "price", "reason"];  let action = 0;      // Default HOLD  ask: number;

    for (const field of required) {

      if (!(field in body)) {  let offset_factor = 0.2;  sma_fast: number;

        return new Response(

          JSON.stringify({ error: `Missing required field: ${field}` }),  let expiry_minutes = 90;  sma_slow: number;

          { status: 400, headers: corsHeaders() }

        );    rsi: number;

      }

    }  // RSI-based adjustments  atr: number;

    

    const tradeReq: TradeRequest = body;  if (rsi > 70) {

    

    // Calculate AI signal    // Overbought - favor SELL  // 任意（送れば使う）

    const response = calculateSignal(tradeReq);

        win_prob += (dir < 0) ? 0.15 : -0.10;  macd?: number;

    // Log successful processing (required by spec)

    console.log(  } else if (rsi < 30) {  macd_signal?: number;

      `[ai-trader] symbol=${tradeReq.symbol} tf=${tradeReq.timeframe} ` +

      `dir=${tradeReq.dir} win=${response.win_prob.toFixed(3)} ` +    // Oversold - favor BUY  macd_hist?: number;

      `off=${response.offset_factor.toFixed(3)} exp=${response.expiry_minutes} ` +

      `inst=${tradeReq.instance ?? "-"} ver=${tradeReq.version ?? "-"}`    win_prob += (dir > 0) ? 0.15 : -0.10;

    );

      } else if (rsi > 55 && rsi < 70) {  adx?: number;

    // Optional: Insert into ai_signals table (commented out for performance)

    // Uncomment below to enable signal history storage    // Bullish zone  plus_di?: number;

    /*

    try {    win_prob += (dir > 0) ? 0.12 : -0.08;  minus_di?: number;

      await supabase.from("ai_signals").insert({

        symbol: tradeReq.symbol,  } else if (rsi < 45 && rsi > 30) {

        timeframe: tradeReq.timeframe,

        dir: tradeReq.dir,    // Bearish zone  stoch_k?: number;

        win_prob: response.win_prob,

        atr: tradeReq.atr,    win_prob += (dir < 0) ? 0.12 : -0.08;  stoch_d?: number;

        rsi: tradeReq.rsi,

        price: tradeReq.price,  }

        reason: tradeReq.reason,

        instance: tradeReq.instance,    bb_upper?: number;

        model_version: tradeReq.version,

      });  // Direction confirmation  bb_basis?: number;

    } catch (dbError) {

      console.error("[ai-trader] DB insert error:", dbError);  if (dir !== 0) {  bb_lower?: number;

      // Continue even if DB insert fails

    }    win_prob += 0.10;  // Bonus for having a direction

    */

      }  // DiNapoli 追加入力（EAで算出）

    return new Response(

      JSON.stringify(response),    fib_leg_dir?: "UP"|"DOWN"|""; // 押し目/戻り方向

      { status: 200, headers: corsHeaders() }

    );  // ATR-based volatility adjustment  fib_retracement?: number;     // 0..1

    

  } catch (error) {  if (atr > 0) {  dma33_cross?: number;         // -1/0/+1

    console.error("[ai-trader] Error:", error);

    return new Response(    // Higher volatility = wider offset  dma75_cross?: number;

      JSON.stringify({ 

        error: "Internal server error",    if (atr > 0.001) {  dma255_cross?: number;

        message: error instanceof Error ? error.message : "Unknown error"

      }),      offset_factor = 0.25;  price_vs_dma33?: number;      // -1/0/+1

      { status: 500, headers: corsHeaders() }

    );    }  price_vs_dma75?: number;

  }

});    // Lower volatility = tighter offset  price_vs_dma255?: number;


    if (atr < 0.0005) {  macd_hist_slope?: number;     // 予測用の傾き

      offset_factor = 0.15;  macd_pred_cross?: number;     // -1/0/+1

      expiry_minutes = 60;  // Shorter expiry in low volatility};

    }

  }type OutPayload = {

    action: "BUY" | "SELL" | "HOLD";

  // Clamp probability between 0 and 1  reason?: string;

  win_prob = Math.max(0, Math.min(1, win_prob));  ttl_sec?: number;

    version?: string;

  // Determine action based on direction and probability  ai_note?: string;

  if (win_prob >= 0.70) {  ai_tags?: string[];

    action = dir;  // Follow the signal direction};

  } else {

    action = 0;  // HOLD if probability is too lowfunction ver() { return "ai-trader:2.4.0-hybrid-ai"; }

  }

  /* ========================= ユーティリティ ========================= */

  return {function okJSON(data: unknown, status = 200) {

    win_prob: Math.round(win_prob * 1000) / 1000,  return new Response(JSON.stringify(data), {

    action,    status, headers: { "content-type": "application/json; charset=utf-8" }

    offset_factor: Math.round(offset_factor * 1000) / 1000,  });

    expiry_minutes,}

  };function badRequest(msg: string) { return okJSON({ error: msg }, 400); }

}function unauthorized() { return okJSON({ error: "unauthorized" }, 401); }



// ====== Main Handler ======// JST時間帯フィルタ

serve(async (req: Request) => {function inTradeSessionJST(): boolean {

  // Handle CORS preflight  if (!ENABLE_TIME_FILTER) return true;

  if (req.method === "OPTIONS") {  const now = new Date();

    return new Response(null, { status: 204, headers: corsHeaders() });  const hUTC = now.getUTCHours();

  }  const hJST = (hUTC + 9) % 24;

    if (TRADE_START_HOUR_JST <= TRADE_END_HOUR_JST)

  // Handle GET for health check    return hJST >= TRADE_START_HOUR_JST && hJST < TRADE_END_HOUR_JST;

  if (req.method === "GET") {  return hJST >= TRADE_START_HOUR_JST || hJST < TRADE_END_HOUR_JST; // 日跨ぎ

    return new Response(}

      JSON.stringify({ 

        ok: true, // ソフトRateLimit

        service: "ai-trader", const rlMap = new Map<string, { count:number; slot:number }>();

        version: "1.2.2",function softRateLimit(key: string): boolean {

        timestamp: new Date().toISOString()  const now = Date.now();

      }),  const slot = Math.floor(now / 60_000);

      { status: 200, headers: corsHeaders() }  const v = rlMap.get(key);

    );  if (!v || v.slot !== slot) { rlMap.set(key, { count:1, slot }); return true; }

  }  v.count++;

    return v.count <= RL_MAX_HITS_PER_MIN;

  // Handle POST for trading signals}

  if (req.method !== "POST") {

    return new Response(// 必須フィールド検証

      JSON.stringify({ error: "Method not allowed" }),function validate(p: any): {ok:true; data:InPayload}|{ok:false; msg:string} {

      { status: 405, headers: corsHeaders() }  const req = ["symbol","timeframe","time","price","bid","ask","sma_fast","sma_slow","rsi","atr"];

    );  if (!p || typeof p!=="object") return {ok:false, msg:"invalid json"};

  }  for (const k of req) if (!(k in p)) return {ok:false, msg:`missing field: ${k}`};

    const nums = ["time","price","bid","ask","sma_fast","sma_slow","rsi","atr"];

  try {  for (const k of nums) if (!Number.isFinite(p[k])) return {ok:false, msg:`invalid number: ${k}`};

    // Read request body as text and remove NUL bytes  if (typeof p.symbol!=="string" || !p.symbol) return {ok:false, msg:"symbol must be string"};

    const rawBody = await req.text();  if (typeof p.timeframe!=="string" || !p.timeframe) return {ok:false, msg:"timeframe must be string"};

    const body = safeJsonParse(rawBody);  // 任意数値は存在時のみ軽くチェック

      const optNums = ["macd","macd_signal","macd_hist","adx","plus_di","minus_di","stoch_k","stoch_d",

    // Validate required fields                   "bb_upper","bb_basis","bb_lower","fib_retracement",

    const required = ["symbol", "timeframe", "dir", "rsi", "atr", "price", "reason"];                   "dma33_cross","dma75_cross","dma255_cross","price_vs_dma33","price_vs_dma75","price_vs_dma255",

    for (const field of required) {                   "macd_hist_slope","macd_pred_cross"];

      if (!(field in body)) {  for (const k of optNums) if (k in p && !Number.isFinite(p[k])) return {ok:false, msg:`invalid number: ${k}`};

        return new Response(  return {ok:true, data:p as InPayload};

          JSON.stringify({ error: `Missing required field: ${field}` }),}

          { status: 400, headers: corsHeaders() }

        );// 銘柄別の上書き適用

      }function cfgForSymbol(symbol: string) {

    }  const upper = symbol.toUpperCase();

      const o: SymCfg = OVERRIDES[upper] ?? {};

    const tradeReq: TradeRequest = body;  return {

        SPREAD_MAX:        o.SPREAD_MAX        ?? SPREAD_MAX_DEFAULT,

    // Calculate AI signal    ATR_MIN:           o.ATR_MIN           ?? ATR_MIN_DEFAULT,

    const response = calculateSignal(tradeReq);    RSI_BUY_MIN:       o.RSI_BUY_MIN       ?? RSI_BUY_MIN_DEFAULT,

        RSI_SELL_MAX:      o.RSI_SELL_MAX      ?? RSI_SELL_MAX_DEFAULT,

    // Log successful processing    ADX_MIN:           o.ADX_MIN           ?? ADX_MIN_DEFAULT,

    console.log(    SCORE_FIRE_MIN:    o.SCORE_FIRE_MIN    ?? SCORE_FIRE_MIN_DEFAULT,

      `[ai-trader] symbol=${tradeReq.symbol} tf=${tradeReq.timeframe} ` +    SCORE_MARGIN_MIN:  o.SCORE_MARGIN_MIN  ?? SCORE_MARGIN_MIN_DEFAULT,

      `dir=${tradeReq.dir} win=${response.win_prob.toFixed(3)} ` +  };

      `off=${response.offset_factor.toFixed(3)} exp=${response.expiry_minutes} ` +}

      `inst=${tradeReq.instance || "unknown"} ver=${tradeReq.version || "unknown"}`

    );/* ========================= 合議制スコア ========================= */

    function consensusScore(p: InPayload) {

    // Optional: Insert into ai_signals table (commented out by default)  const C = cfgForSymbol(p.symbol);

    /*  const reasons: string[] = [];

    try {  const spread = Math.max(0, p.ask - p.bid);

      await supabase.from("ai_signals").insert({

        symbol: tradeReq.symbol,  // セッション

        timeframe: tradeReq.timeframe,  if (!inTradeSessionJST()) {

        dir: tradeReq.dir,    return { blocked:true, blockReason:"out_of_session" as const };

        win_prob: response.win_prob,  }

        atr: tradeReq.atr,

        rsi: tradeReq.rsi,  // フィルタ：スプレッド / 低ボラ

        price: tradeReq.price,  if (C.SPREAD_MAX > 0 && spread > C.SPREAD_MAX) {

        reason: tradeReq.reason,    return { blocked:true, blockReason: `spread>${C.SPREAD_MAX.toFixed(6)}` as const };

        instance: tradeReq.instance,  }

        model_version: tradeReq.version,  if (C.ATR_MIN > 0 && p.atr < C.ATR_MIN) {

      });    return { blocked:true, blockReason: `atr<${C.ATR_MIN.toFixed(6)}` as const };

    } catch (dbError) {  }

      console.error("[ai-trader] DB insert error:", dbError);

      // Continue even if DB insert fails  let sBuy = 0, sSell = 0;

    }

    */  // トレンド（SMA）

      const trendUp   = p.sma_fast > p.sma_slow;

    return new Response(  const trendDown = p.sma_fast < p.sma_slow;

      JSON.stringify(response),  if (trendUp)   { sBuy += 2; reasons.push("trendUp"); }

      { status: 200, headers: corsHeaders() }  if (trendDown) { sSell+= 2; reasons.push("trendDown"); }

    );

      // RSI

  } catch (error) {  if (p.rsi >= C.RSI_BUY_MIN) { sBuy += 2; reasons.push(`rsi>=BUYmin`); }

    console.error("[ai-trader] Error:", error);  if (p.rsi <= C.RSI_SELL_MAX){ sSell+= 2; reasons.push(`rsi<=SELLmax`); }

    return new Response(

      JSON.stringify({   // MACD（あれば）

        error: "Internal server error",  const hasMACD = Number.isFinite(p.macd) && Number.isFinite(p.macd_signal);

        message: error instanceof Error ? error.message : "Unknown error"  if (hasMACD) {

      }),    if ((p.macd ?? 0) > (p.macd_signal ?? 0)) { sBuy += 1; reasons.push("macdUp"); }

      { status: 500, headers: corsHeaders() }    else                                      { sSell+= 1; reasons.push("macdDn"); }

    );  }

  }  // MACDヒスト傾き/予測クロス（任意）

});  if (Number.isFinite(p.macd_hist_slope)) {

    const s = p.macd_hist_slope ?? 0;
    if (s > 0) { sBuy += 1; reasons.push("macd_hist_slope_up"); }
    if (s < 0) { sSell+= 1; reasons.push("macd_hist_slope_dn"); }
  }
  if (Number.isFinite(p.macd_pred_cross)) {
    const c = p.macd_pred_cross ?? 0;
    if (c > 0) { sBuy += 1; reasons.push("macd_pred_cross_up"); }
    if (c < 0) { sSell+= 1; reasons.push("macd_pred_cross_dn"); }
  }

  // ADX / DI（あれば）
  if (Number.isFinite(p.adx)) {
    if ((p.adx ?? 0) >= C.ADX_MIN) { sBuy += 1; sSell += 1; reasons.push(`adx>=${C.ADX_MIN}`); }
  }
  if (Number.isFinite(p.plus_di) && Number.isFinite(p.minus_di)) {
    if ((p.plus_di ?? 0) > (p.minus_di ?? 0)) { sBuy += 1; reasons.push("+DI>-DI"); }
    if ((p.plus_di ?? 0) < (p.minus_di ?? 0)) { sSell+= 1; reasons.push("+DI<-DI"); }
  }

  // Stochastic（押し目・戻りで微加点）
  if (Number.isFinite(p.stoch_k) && Number.isFinite(p.stoch_d)) {
    const k = p.stoch_k ?? 0, d = p.stoch_d ?? 0;
    if (k > d && k < 80) { sBuy += 1; reasons.push("stochUp"); }
    if (k < d && k > 20) { sSell+= 1; reasons.push("stochDn"); }
  }

  // Bollinger（基準線より上/下）
  if (Number.isFinite(p.bb_basis)) {
    if (p.price > (p.bb_basis ?? 0)) { sBuy += 1; reasons.push("bb>basis"); }
    if (p.price < (p.bb_basis ?? 0)) { sSell+= 1; reasons.push("bb<basis"); }
  }

  // DiNapoli：Fibゾーン（ざっくり評価）
  if (typeof p.fib_leg_dir === "string" && Number.isFinite(p.fib_retracement)) {
    const r = p.fib_retracement ?? 0;
    if (p.fib_leg_dir === "UP") {
      if (r >= 0.35 && r <= 0.42) { sBuy += 1; reasons.push("fib_38.2"); }
      if (r >= 0.48 && r <= 0.52) { sBuy += 1; reasons.push("fib_50"); }
      if (r >= 0.58 && r <= 0.64) { sBuy += 2; reasons.push("fib_61.8"); }
    } else if (p.fib_leg_dir === "DOWN") {
      if (r >= 0.35 && r <= 0.42) { sSell += 1; reasons.push("fib_38.2"); }
      if (r >= 0.48 && r <= 0.52) { sSell += 1; reasons.push("fib_50"); }
      if (r >= 0.58 && r <= 0.64) { sSell += 2; reasons.push("fib_61.8"); }
    }
  }

  // DiNapoli：DMAクロス & 価格位置
  const x = (v?:number)=> Number.isFinite(v) ? (v as number) : 0;
  if (x(p.dma33_cross) > 0) { sBuy += 1; reasons.push("dma33_cross_up"); }
  if (x(p.dma33_cross) < 0) { sSell+= 1; reasons.push("dma33_cross_dn"); }
  if (x(p.price_vs_dma33) > 0) { sBuy += 1; reasons.push("dma33_price_above"); }
  if (x(p.price_vs_dma33) < 0) { sSell+= 1; reasons.push("dma33_price_below"); }

  if (x(p.dma75_cross) > 0) { sBuy += 1; reasons.push("dma75_cross_up"); }
  if (x(p.dma75_cross) < 0) { sSell+= 1; reasons.push("dma75_cross_dn"); }
  if (x(p.price_vs_dma75) > 0) { sBuy += 1; reasons.push("dma75_price_above"); }
  if (x(p.price_vs_dma75) < 0) { sSell+= 1; reasons.push("dma75_price_below"); }

  if (x(p.dma255_cross) > 0) { sBuy += 1; reasons.push("dma255_cross_up"); }
  if (x(p.dma255_cross) < 0) { sSell+= 1; reasons.push("dma255_cross_dn"); }
  if (x(p.price_vs_dma255) > 0) { sBuy += 1; reasons.push("dma255_price_above"); }
  if (x(p.price_vs_dma255) < 0) { sSell+= 1; reasons.push("dma255_price_below"); }

  return { blocked:false, sBuy, sSell, reasons, cfg:C };
}

/* ========================= AI 補助（任意） ========================= */
function round(n:number, d=4){ return Math.round(n * 10**d) / 10**d; }
function pctb(price:number, bb_lower?:number, bb_upper?:number) {
  if(!Number.isFinite(bb_lower)||!Number.isFinite(bb_upper)||bb_upper===bb_lower) return null;
  return round( (price - (bb_lower as number)) / ((bb_upper as number) - (bb_lower as number)), 3);
}

async function callAIIfNeeded(
  p: InPayload,
  sBuy: number,
  sSell: number,
  reasons: string[],
  cfg: ReturnType<typeof cfgForSymbol>
): Promise<null | { ai_bias:number; ai_tags:string[]; ai_note:string }> {
  if(!AI_ENABLE || !OPENAI_API_KEY) return null;

  // 価値ある局面だけ呼ぶ（拮抗＆しきい値付近）
  const nearEdge = (Math.max(sBuy, sSell) >= (cfg.SCORE_FIRE_MIN - 1))
                   && (Math.abs(sBuy - sSell) <= 1);
  if(!nearEdge) return null;

  const entropyHints = {
    trendUp: p.sma_fast > p.sma_slow,
    rsi: round(p.rsi,2),
    macd_above: (Number.isFinite(p.macd) && Number.isFinite(p.macd_signal))
      ? ((p.macd as number) > (p.macd_signal as number)) : null,
    macd_hist: Number.isFinite(p.macd_hist) ? round((p.macd_hist as number),4) : null,
    macd_hist_slope: Number.isFinite(p.macd_hist_slope) ? round((p.macd_hist_slope as number),4) : null,
    adx: Number.isFinite(p.adx) ? round(p.adx as number,2) : null,
    di_bias: (Number.isFinite(p.plus_di) && Number.isFinite(p.minus_di))
      ? round((p.plus_di as number) - (p.minus_di as number),3)
      : null,
    stoch_delta: (Number.isFinite(p.stoch_k) && Number.isFinite(p.stoch_d))
      ? round((p.stoch_k as number) - (p.stoch_d as number),3)
      : null,
    bb_pctb: pctb(p.price, p.bb_lower, p.bb_upper),
    fib: {
      dir: p.fib_leg_dir ?? null,
      retr: Number.isFinite(p.fib_retracement) ? round(p.fib_retracement as number,3) : null,
    },
    dma: {
      dma33_cross: p.dma33_cross ?? 0,
      price_vs_dma33: p.price_vs_dma33 ?? 0,
    }
  };

  const sys = `You are a trading judge that returns STRICT JSON only.
Input is multi-indicator snapshot at a closed bar (FX).
Task: decide a SMALL tilt for tie-breaking and add concise Japanese note/tags.
Return JSON:
{"ai_bias": -1|0|+1, "ai_tags":["..."], "ai_note":"<=50 tokens JP"}
Rules:
- ai_bias is small: +1 favors long, -1 favors short, 0 neutral.
- Be concise. No raw numbers. No overfitting.`;

  const user = {
    symbol: p.symbol, tf: p.timeframe,
    snapshot: entropyHints,
    consensus: { sBuy, sSell, reasons },
  };

  const controller = new AbortController();
  const timer = setTimeout(()=>controller.abort(), AI_TIMEOUT_MS);

  try {
    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method:"POST",
      headers:{
        "content-type":"application/json",
        "authorization":`Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: AI_MODEL,
        temperature: 0.3,
        max_tokens: 120,
        response_format: { type:"json_object" },
        messages: [
          { role:"system", content: sys },
          { role:"user", content: JSON.stringify(user) },
        ],
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if(!resp.ok) return null;

    const data = await resp.json();
    const content = data?.choices?.[0]?.message?.content;
    if(!content) return null;

    const parsed = JSON.parse(content);
    const ai_bias = Math.max(-1, Math.min(1, Number(parsed.ai_bias ?? 0)|0));
    const ai_tags = Array.isArray(parsed.ai_tags) ? parsed.ai_tags.slice(0,5).map((s:string)=>String(s).slice(0,24)) : [];
    const ai_note = typeof parsed.ai_note==="string" ? String(parsed.ai_note).slice(0,200) : "";

    return { ai_bias, ai_tags, ai_note };
  } catch {
    return null; // timeout/429/anything → フォールバック
  }
}

/* ========================= HTTP Handler ========================= */
serve(async (req) => {
  try {
    // GET: 説明＆疎通確認
    if (req.method === "GET") {
      return okJSON({
        ok:true, name:"ai-trader", version: ver(),
        requires: {
          method:"POST",
          contentType:"application/json",
          fields:["symbol","timeframe","time","price","bid","ask","sma_fast","sma_slow","rsi","atr"],
          optional:["macd","macd_signal","macd_hist","adx","plus_di","minus_di",
                    "stoch_k","stoch_d","bb_upper","bb_basis","bb_lower",
                    "fib_leg_dir","fib_retracement",
                    "dma33_cross","dma75_cross","dma255_cross",
                    "price_vs_dma33","price_vs_dma75","price_vs_dma255",
                    "macd_hist_slope","macd_pred_cross"]
        },
        ai: { enable: AI_ENABLE && !!OPENAI_API_KEY, model: AI_MODEL, timeout_ms: AI_TIMEOUT_MS }
      });
    }
    if (req.method !== "POST") return okJSON({error:"method not allowed"}, 405);

    // 認証（任意）
    if (API_KEY) {
      const auth = req.headers.get("authorization") ?? "";
      const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
      if (token !== API_KEY) return unauthorized();
    }

    // レート制限
    const ip = (req.headers.get("x-forwarded-for") ?? req.headers.get("cf-connecting-ip") ?? "unknown").split(",")[0].trim();
    if (!softRateLimit(ip)) return okJSON({ error:"rate_limited" }, 429);

    // JSON
    let body: any;
    try { body = await req.json(); } catch { return badRequest("invalid json body"); }
    const v = validate(body);
    if (!v.ok) return badRequest(v.msg);
    const p = v.data;

    // 合議制スコア
    const sc = consensusScore(p);
    if (sc.blocked) {
      const out: OutPayload = { action:"HOLD", reason: sc.blockReason, ttl_sec: TTL_SEC_DEFAULT, version: ver() };
      if (LOG_REASON) console.log(JSON.stringify({ at:new Date().toISOString(), sym:p.symbol, tf:p.timeframe, action:out.action, reason:out.reason }));
      return okJSON(out);
    }

    let sBuy = sc.sBuy, sSell = sc.sSell;
    const reasons = sc.reasons.slice();
    const C = sc.cfg;

    // ★ AI補助（任意・拮抗時のみ）★
    const ai = await callAIIfNeeded(p, sBuy, sSell, reasons, C);
    if (ai) {
      if (ai.ai_bias > 0) sBuy += 1;
      if (ai.ai_bias < 0) sSell+= 1;
      reasons.push(`ai_bias=${ai.ai_bias}`);
    }

    // 採択
    let out: OutPayload;
    if (sBuy >= C.SCORE_FIRE_MIN && (sBuy - sSell) >= C.SCORE_MARGIN_MIN) {
      out = { action:"BUY", reason:`st:${sBuy}/${sSell}|${reasons.join("|")}`, ttl_sec: TTL_SEC_DEFAULT, version: ver() };
    } else if (sSell >= C.SCORE_FIRE_MIN && (sSell - sBuy) >= C.SCORE_MARGIN_MIN) {
      out = { action:"SELL", reason:`st:${sBuy}/${sSell}|${reasons.join("|")}`, ttl_sec: TTL_SEC_DEFAULT, version: ver() };
    } else {
      out = { action:"HOLD", reason:`consensus_weak st:${sBuy}/${sSell}|${reasons.join("|")}`, ttl_sec: TTL_SEC_DEFAULT, version: ver() };
    }

    // AI注釈（存在時のみ添付）
    if (ai) { out.ai_note = ai.ai_note; out.ai_tags = ai.ai_tags; }

    // ログ
    if (LOG_REASON) {
      console.log(JSON.stringify({
        at: new Date().toISOString(),
        sym: p.symbol, tf: p.timeframe,
        rsi: p.rsi, atr: p.atr,
        macd: p.macd, macd_signal: p.macd_signal, macd_hist: p.macd_hist,
        adx: p.adx, plus_di: p.plus_di, minus_di: p.minus_di,
        stoch_k: p.stoch_k, stoch_d: p.stoch_d,
        bb_basis: p.bb_basis, price: p.price, bid: p.bid, ask: p.ask,
        fib_leg_dir: p.fib_leg_dir, fib_retracement: p.fib_retracement,
        dma33_cross: p.dma33_cross, price_vs_dma33: p.price_vs_dma33,
        action: out.action, reason: out.reason,
        ai_note: out.ai_note, ai_tags: out.ai_tags
      }));
    }

    return okJSON(out);
  } catch (e) {
    console.error("unhandled_error", e);
    return okJSON({ error:"internal_error" }, 500);
  }
});
