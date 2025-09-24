// AI Trader Edge Function (Strict Consensus + Safe AI Annotation)
// - 失敗時：必ず合議制スコアで返す（AIなしでも止まらない）
// - 成功時：AIは action を一切変えず、reason に補足のみ（厳格運用）
// Deno runtime

import { serve } from "std/http/server.ts";
import OpenAI from "npm:openai";

// ====== ENV ======
const API_KEY = Deno.env.get("AI_TRADER_API_KEY") ?? "";
const LOG_REASON = (Deno.env.get("AI_TRADER_LOG_REASON") ?? "true") === "true";

// オプショナルAI（注釈のみ・アクション不変）
const ENABLE_LLM = (Deno.env.get("ENABLE_LLM") ?? "false") === "true";
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") ?? "";
const LLM_TIMEOUT_MS = Number(Deno.env.get("LLM_TIMEOUT_MS") ?? 1200);

// 時間帯フィルタ（JST）
const ENABLE_TIME_FILTER = (Deno.env.get("ENABLE_TIME_FILTER") ?? "false") === "true";
const TRADE_START_HOUR_JST = Number(Deno.env.get("TRADE_START_HOUR_JST") ?? 8);
const TRADE_END_HOUR_JST   = Number(Deno.env.get("TRADE_END_HOUR_JST") ?? 23);

// フィルタ閾値（汎用デフォルト）
const SPREAD_MAX_DEFAULT = Number(Deno.env.get("SPREAD_MAX") ?? 0);
const ATR_MIN_DEFAULT    = Number(Deno.env.get("ATR_MIN") ?? 0);

// 合議制スコアの基本しきい値（いっぺいの“厳しめ”を維持）
const RSI_BUY_MIN_DEFAULT  = Number(Deno.env.get("RSI_BUY_MIN") ?? 55);
const RSI_SELL_MAX_DEFAULT = Number(Deno.env.get("RSI_SELL_MAX") ?? 45);
const ADX_MIN_DEFAULT      = Number(Deno.env.get("ADX_MIN") ?? 22);
const SCORE_FIRE_MIN       = Number(Deno.env.get("SCORE_FIRE_MIN") ?? 4);
const SCORE_MARGIN_MIN     = Number(Deno.env.get("SCORE_MARGIN_MIN") ?? 2);

// TTL・レート制限
const TTL_SEC_DEFAULT      = Number(Deno.env.get("TTL_SEC_DEFAULT") ?? 30);
const RL_MAX_HITS_PER_MIN  = Number(Deno.env.get("RL_MAX_HITS_PER_MIN") ?? 120);

// 銘柄別上書き
type SymCfg = Partial<{
  SPREAD_MAX:number; ATR_MIN:number;
  RSI_BUY_MIN:number; RSI_SELL_MAX:number; ADX_MIN:number;
  SCORE_FIRE_MIN:number; SCORE_MARGIN_MIN:number;
}>;
const OVERRIDES: Record<string, SymCfg> = (() => {
  try {
    const raw = Deno.env.get("AI_TRADER_SYMBOL_OVERRIDES") ?? "";
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
})();

// ====== 型 ======
type InPayload = {
  symbol: string; timeframe: string; time: number;
  price: number; bid: number; ask: number;
  sma_fast: number; sma_slow: number; rsi: number; atr: number;
  macd?: number; macd_signal?: number; macd_hist?: number;
  adx?: number; plus_di?: number; minus_di?: number;
  stoch_k?: number; stoch_d?: number;
  bb_upper?: number; bb_basis?: number; bb_lower?: number;
};
type OutPayload = { action: "BUY"|"SELL"|"HOLD"; reason?: string; ttl_sec?: number; version?: string; };

function ver(){ return "ai-trader:2.2.0-strict-hybrid"; }
function okJSON(data: unknown, status=200){ return new Response(JSON.stringify(data), {status, headers:{"content-type":"application/json; charset=utf-8"}}); }
function badRequest(msg:string){ return okJSON({error:msg}, 400); }
function unauthorized(){ return okJSON({error:"unauthorized"}, 401); }

// ====== Utility ======
function inTradeSessionJST(): boolean {
  if (!ENABLE_TIME_FILTER) return true;
  const hJST = (new Date().getUTCHours() + 9) % 24;
  if (TRADE_START_HOUR_JST <= TRADE_END_HOUR_JST)
    return hJST >= TRADE_START_HOUR_JST && hJST < TRADE_END_HOUR_JST;
  return hJST >= TRADE_START_HOUR_JST || hJST < TRADE_END_HOUR_JST;
}

const rlMap = new Map<string,{count:number;slot:number}>();
function softRateLimit(key:string): boolean {
  const slot = Math.floor(Date.now()/60_000);
  const v = rlMap.get(key);
  if (!v || v.slot!==slot){ rlMap.set(key,{count:1,slot}); return true; }
  v.count++; return v.count <= RL_MAX_HITS_PER_MIN;
}

function validate(p:any): {ok:true; data:InPayload}|{ok:false; msg:string} {
  const req = ["symbol","timeframe","time","price","bid","ask","sma_fast","sma_slow","rsi","atr"];
  if (!p || typeof p!=="object") return {ok:false,msg:"invalid json"};
  for (const k of req) if(!(k in p)) return {ok:false,msg:`missing ${k}`};
  return {ok:true, data:p as InPayload};
}

function cfgForSymbol(symbol:string){
  const o:SymCfg = OVERRIDES[symbol.toUpperCase()] ?? {};
  return {
    SPREAD_MAX: o.SPREAD_MAX ?? SPREAD_MAX_DEFAULT,
    ATR_MIN:    o.ATR_MIN    ?? ATR_MIN_DEFAULT,
    RSI_BUY_MIN:  o.RSI_BUY_MIN  ?? RSI_BUY_MIN_DEFAULT,
    RSI_SELL_MAX: o.RSI_SELL_MAX ?? RSI_SELL_MAX_DEFAULT,
    ADX_MIN:      o.ADX_MIN      ?? ADX_MIN_DEFAULT,
    SCORE_FIRE_MIN:   o.SCORE_FIRE_MIN   ?? SCORE_FIRE_MIN,
    SCORE_MARGIN_MIN: o.SCORE_MARGIN_MIN ?? SCORE_MARGIN_MIN,
  };
}

// ====== 合議制スコア判定（厳格） ======
function scoreDecision(p: InPayload): OutPayload {
  const C = cfgForSymbol(p.symbol);
  const reasons:string[] = [];
  const spread = Math.max(0, p.ask - p.bid);

  if (!inTradeSessionJST()) return { action:"HOLD", reason:"out_of_session", ttl_sec:TTL_SEC_DEFAULT, version:ver() };
  if (C.SPREAD_MAX>0 && spread>C.SPREAD_MAX) return { action:"HOLD", reason:`spread>${C.SPREAD_MAX}`, ttl_sec:TTL_SEC_DEFAULT, version:ver() };
  if (C.ATR_MIN>0 && p.atr<C.ATR_MIN) return { action:"HOLD", reason:`atr<${C.ATR_MIN}`, ttl_sec:TTL_SEC_DEFAULT, version:ver() };

  let sBuy=0, sSell=0;

  // トレンド（SMA）
  if (p.sma_fast > p.sma_slow){ sBuy+=2; reasons.push("trendUp"); }
  if (p.sma_fast < p.sma_slow){ sSell+=2; reasons.push("trendDown"); }

  // RSI
  if (p.rsi >= cfgForSymbol(p.symbol).RSI_BUY_MIN){ sBuy+=2; reasons.push(`rsi>=${cfgForSymbol(p.symbol).RSI_BUY_MIN}`); }
  if (p.rsi <= cfgForSymbol(p.symbol).RSI_SELL_MAX){ sSell+=2; reasons.push(`rsi<=${cfgForSymbol(p.symbol).RSI_SELL_MAX}`); }

  // MACD
  if (Number.isFinite(p.macd) && Number.isFinite(p.macd_signal)){
    if ((p.macd ?? 0) > (p.macd_signal ?? 0)){ sBuy+=1; reasons.push("macdUp"); }
    else { sSell+=1; reasons.push("macdDn"); }
  }

  // ADX & DI
  const Cfg = cfgForSymbol(p.symbol);
  if (Number.isFinite(p.adx) && (p.adx ?? 0) >= Cfg.ADX_MIN){ sBuy+=1; sSell+=1; reasons.push(`adx>=${Cfg.ADX_MIN}`); }
  if (Number.isFinite(p.plus_di) && Number.isFinite(p.minus_di)){
    if ((p.plus_di ?? 0) > (p.minus_di ?? 0)){ sBuy+=1; reasons.push("+DI>-DI"); }
    if ((p.plus_di ?? 0) < (p.minus_di ?? 0)){ sSell+=1; reasons.push("+DI<- -DI"); }
  }

  // Stochastic
  if (Number.isFinite(p.stoch_k) && Number.isFinite(p.stoch_d)){
    const k=p.stoch_k??0, d=p.stoch_d??0;
    if (k>d && k<80){ sBuy+=1; reasons.push("stochUp"); }
    if (k<d && k>20){ sSell+=1; reasons.push("stochDn"); }
  }

  // Bollinger basis
  if (Number.isFinite(p.bb_basis)){
    if (p.price > (p.bb_basis ?? 0)){ sBuy+=1; reasons.push("bb>basis"); }
    if (p.price < (p.bb_basis ?? 0)){ sSell+=1; reasons.push("bb<basis"); }
  }

  if (sBuy >= C.SCORE_FIRE_MIN && (sBuy - sSell) >= C.SCORE_MARGIN_MIN)
    return { action:"BUY", reason:`sB=${sBuy},sS=${sSell}|${reasons.join("|")}`, ttl_sec:TTL_SEC_DEFAULT, version:ver() };
  if (sSell >= C.SCORE_FIRE_MIN && (sSell - sBuy) >= C.SCORE_MARGIN_MIN)
    return { action:"SELL", reason:`sB=${sBuy},sS=${sSell}|${reasons.join("|")}`, ttl_sec:TTL_SEC_DEFAULT, version:ver() };
  return { action:"HOLD", reason:`consensus_weak sB=${sBuy} sS=${sSell}|${reasons.join("|")}`, ttl_sec:TTL_SEC_DEFAULT, version:ver() };
}

// ====== LLM（注釈のみ・フォールバック保証） ======
async function annotateWithLLM(p: InPayload, ruleOut: OutPayload): Promise<OutPayload> {
  // AIを使って“理由文をちょい補足”するだけ。アクションは**絶対に変えない**
  if (!OPENAI_API_KEY) throw new Error("no_api_key");
  const client = new OpenAI({ apiKey: OPENAI_API_KEY });

  const controller = new AbortController();
  const timer = setTimeout(()=>controller.abort(), LLM_TIMEOUT_MS);

  try {
    const sys = "You are an FX trading assistant. Return a very short justification string in Japanese (max 120 chars). Do not suggest trades. No symbols other than plain text.";
    const user = `Symbol=${p.symbol} TF=${p.timeframe} price=${p.price} bid=${p.bid} ask=${p.ask} rsi=${p.rsi} atr=${p.atr} sma_fast=${p.sma_fast} sma_slow=${p.sma_slow} macd=${p.macd} macd_signal=${p.macd_signal} adx=${p.adx} +di=${p.plus_di} -di=${p.minus_di} stoch_k=${p.stoch_k} stoch_d=${p.stoch_d} bb_basis=${p.bb_basis}. Rule-based decision: ${ruleOut.action} (reason: ${ruleOut.reason}). Provide a short additional justification only.`;

    const resp = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{role:"system",content:sys},{role:"user",content:user}],
      temperature: 0.2,
    }, { signal: controller.signal });

    const add = resp.choices?.[0]?.message?.content?.trim();
    if (!add) return ruleOut;

    // アクションは固定、reason にだけ追記
    return {
      ...ruleOut,
      reason: `${ruleOut.reason}|llm_note:${add.replace(/\s+/g," ").slice(0,120)}`
    };
  } catch (e) {
    // 429/401/AbortError/その他 → すべてフォールバック
    console.log("openai_error", e);
    return { ...ruleOut, reason: `${ruleOut.reason}|llm_fallback` };
  } finally {
    clearTimeout(timer);
  }
}

// ====== Main ======
serve(async (req) => {
  try {
    if (req.method === "GET")
      return okJSON({ ok:true, name:"ai-trader", version:ver() });
    if (req.method !== "POST")
      return okJSON({ error:"method not allowed" }, 405);

    // 任意のAPIキー認証（SupabaseのJWT検証を切ってる前提）
    if (API_KEY) {
      const auth = req.headers.get("authorization") ?? "";
      const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
      if (token !== API_KEY) return unauthorized();
    }

    // ソフトRateLimit
    const ip = (req.headers.get("x-forwarded-for") ?? req.headers.get("cf-connecting-ip") ?? "unknown").split(",")[0].trim();
    if (!softRateLimit(ip)) return okJSON({ error:"rate_limited" }, 429);

    // JSON
    let body:any; try { body = await req.json(); } catch { return badRequest("invalid json"); }
    const v = validate(body); if (!v.ok) return badRequest(v.msg);

    // まず合議制（これが“正解”・常に返せる）
    const ruleOut = scoreDecision(v.data);

    // オプショナルAI：アクションは絶対固定、理由に補足のみ。失敗しても ruleOut を返す
    const out = (ENABLE_LLM && OPENAI_API_KEY)
      ? await annotateWithLLM(v.data, ruleOut)
      : ruleOut;

    if (LOG_REASON) {
      console.log(JSON.stringify({
        at: new Date().toISOString(),
        sym: v.data.symbol, tf: v.data.timeframe,
        rsi: v.data.rsi, atr: v.data.atr,
        macd: v.data.macd, macd_signal: v.data.macd_signal,
        adx: v.data.adx, plus_di: v.data.plus_di, minus_di: v.data.minus_di,
        stoch_k: v.data.stoch_k, stoch_d: v.data.stoch_d,
        price: v.data.price, bid: v.data.bid, ask: v.data.ask,
        action: out.action, reason: out.reason
      }));
    }
    return okJSON(out);
  } catch (e) {
    console.error("unhandled_error", e);
    return okJSON({ error:"internal_error" }, 500);
  }
});
