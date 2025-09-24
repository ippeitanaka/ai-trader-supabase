// AI Trader Edge Function with DiNapoli extensions
// - SMA/RSI/MACD/ADX/Stoch/BB + DiNapoli Fibonacci/DMA/MACD Predictor
// - Fallback: always consensus scoring, AIは注釈のみ (クレジット切れでも安全)

// Deno runtime
import { serve } from "std/http/server.ts";

// ====== 環境変数 ======
const LOG_REASON = (Deno.env.get("AI_TRADER_LOG_REASON") ?? "true") === "true";

// 基本フィルタ
const SPREAD_MAX_DEFAULT = Number(Deno.env.get("SPREAD_MAX") ?? 0);
const ATR_MIN_DEFAULT    = Number(Deno.env.get("ATR_MIN") ?? 0);

// 合議制基本閾値
const RSI_BUY_MIN_DEFAULT  = Number(Deno.env.get("RSI_BUY_MIN") ?? 55);
const RSI_SELL_MAX_DEFAULT = Number(Deno.env.get("RSI_SELL_MAX") ?? 45);
const ADX_MIN_DEFAULT      = Number(Deno.env.get("ADX_MIN") ?? 22);

// スコア採択基準
const SCORE_FIRE_MIN   = Number(Deno.env.get("SCORE_FIRE_MIN") ?? 4);
const SCORE_MARGIN_MIN = Number(Deno.env.get("SCORE_MARGIN_MIN") ?? 2);

// TTL
const TTL_SEC_DEFAULT  = Number(Deno.env.get("TTL_SEC_DEFAULT") ?? 30);

// DiNapoli 関連閾値
const FIB_TOLERANCE     = Number(Deno.env.get("FIB_TOLERANCE") ?? 0.008);
const DMA_CROSS_WEIGHT  = Number(Deno.env.get("DMA_CROSS_WEIGHT") ?? 1);
const DMA_POS_WEIGHT    = Number(Deno.env.get("DMA_POS_WEIGHT") ?? 1);
const FIB_WEIGHT_382    = Number(Deno.env.get("FIB_WEIGHT_382") ?? 1);
const FIB_WEIGHT_500    = Number(Deno.env.get("FIB_WEIGHT_500") ?? 1);
const FIB_WEIGHT_618    = Number(Deno.env.get("FIB_WEIGHT_618") ?? 2);
const MACD_PRED_SLOPE_MIN = Number(Deno.env.get("MACD_PRED_SLOPE_MIN") ?? 0.0);

// ===========================================================================

type InPayload = {
  symbol: string;
  timeframe: string;
  time: number;
  price: number;
  bid: number;
  ask: number;
  sma_fast: number;
  sma_slow: number;
  rsi: number;
  atr: number;

  // 任意インジ
  macd?: number;
  macd_signal?: number;
  macd_hist?: number;
  adx?: number;
  plus_di?: number;
  minus_di?: number;
  stoch_k?: number;
  stoch_d?: number;
  bb_upper?: number;
  bb_basis?: number;
  bb_lower?: number;

  // DiNapoli追加
  fib_leg_high?: number;
  fib_leg_low?: number;
  fib_leg_dir?: "UP" | "DOWN";
  fib_retracement?: number;
  dma33_cross?: number;
  dma75_cross?: number;
  dma255_cross?: number;
  price_vs_dma33?: number;
  price_vs_dma75?: number;
  price_vs_dma255?: number;
  macd_hist_slope?: number;
  macd_pred_cross?: number;
};

type OutPayload = {
  action: "BUY" | "SELL" | "HOLD";
  reason?: string;
  ttl_sec?: number;
  version?: string;
};

function ver() { return "ai-trader:2.3.0-dinapoli"; }

function okJSON(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status, headers: { "content-type": "application/json; charset=utf-8" }
  });
}
function badRequest(msg: string) { return okJSON({ error: msg }, 400); }

// ===========================================================================

function scoreDecision(p: InPayload): OutPayload {
  const reasons: string[] = [];
  const spread = Math.max(0, p.ask - p.bid);

  // フィルタ
  if (SPREAD_MAX_DEFAULT > 0 && spread > SPREAD_MAX_DEFAULT) {
    return { action: "HOLD", reason: `spread>${SPREAD_MAX_DEFAULT}`, ttl_sec: TTL_SEC_DEFAULT, version: ver() };
  }
  if (ATR_MIN_DEFAULT > 0 && p.atr < ATR_MIN_DEFAULT) {
    return { action: "HOLD", reason: `atr<${ATR_MIN_DEFAULT}`, ttl_sec: TTL_SEC_DEFAULT, version: ver() };
  }

  let sBuy = 0, sSell = 0;

  // SMAトレンド
  if (p.sma_fast > p.sma_slow) { sBuy += 2; reasons.push("trendUp"); }
  if (p.sma_fast < p.sma_slow) { sSell+= 2; reasons.push("trendDown"); }

  // RSI
  if (p.rsi >= RSI_BUY_MIN_DEFAULT) { sBuy += 2; reasons.push("rsi>=BUYmin"); }
  if (p.rsi <= RSI_SELL_MAX_DEFAULT){ sSell+= 2; reasons.push("rsi<=SELLmax"); }

  // MACD
  if (Number.isFinite(p.macd) && Number.isFinite(p.macd_signal)) {
    if ((p.macd ?? 0) > (p.macd_signal ?? 0)) { sBuy++; reasons.push("macdUp"); }
    else { sSell++; reasons.push("macdDn"); }
  }

  // ADX +DI/-DI
  if (Number.isFinite(p.adx) && (p.adx ?? 0) >= ADX_MIN_DEFAULT) { sBuy++; sSell++; reasons.push("adxStrong"); }
  if (Number.isFinite(p.plus_di) && Number.isFinite(p.minus_di)) {
    if ((p.plus_di ?? 0) > (p.minus_di ?? 0)) { sBuy++; reasons.push("+DI>-DI"); }
    if ((p.plus_di ?? 0) < (p.minus_di ?? 0)) { sSell++; reasons.push("+DI<- -DI"); }
  }

  // Stochastic
  if (Number.isFinite(p.stoch_k) && Number.isFinite(p.stoch_d)) {
    if ((p.stoch_k ?? 0) > (p.stoch_d ?? 0) && (p.stoch_k ?? 0) < 80) { sBuy++; reasons.push("stochUp"); }
    if ((p.stoch_k ?? 0) < (p.stoch_d ?? 0) && (p.stoch_k ?? 0) > 20) { sSell++; reasons.push("stochDn"); }
  }

  // Bollinger
  if (Number.isFinite(p.bb_basis)) {
    if (p.price > (p.bb_basis ?? 0)) { sBuy++; reasons.push("bb>basis"); }
    if (p.price < (p.bb_basis ?? 0)) { sSell++; reasons.push("bb<basis"); }
  }

  // ===== DiNapoli =====

  // Fibonacci retracement
  if (Number.isFinite(p.fib_retracement) && p.fib_leg_dir) {
    const r = p.fib_retracement ?? 0;
    const near = (x:number) => Math.abs(r - x) <= FIB_TOLERANCE;
    if (p.fib_leg_dir === "UP") {
      if (near(0.382)) { sBuy += FIB_WEIGHT_382; reasons.push("fib_38.2"); }
      if (near(0.500)) { sBuy += FIB_WEIGHT_500; reasons.push("fib_50"); }
      if (near(0.618)) { sBuy += FIB_WEIGHT_618; reasons.push("fib_61.8"); }
    } else if (p.fib_leg_dir === "DOWN") {
      if (near(0.382)) { sSell += FIB_WEIGHT_382; reasons.push("fib_38.2"); }
      if (near(0.500)) { sSell += FIB_WEIGHT_500; reasons.push("fib_50"); }
      if (near(0.618)) { sSell += FIB_WEIGHT_618; reasons.push("fib_61.8"); }
    }
  }

  // DMA (3×3,7×5,25×5)
  const addDma = (cross?:number,pos?:number,tag="dma")=>{
    if (Number.isFinite(cross)) {
      if ((cross ?? 0) > 0) { sBuy += DMA_CROSS_WEIGHT; reasons.push(`${tag}_cross_up`); }
      if ((cross ?? 0) < 0) { sSell+= DMA_CROSS_WEIGHT; reasons.push(`${tag}_cross_dn`); }
    }
    if (Number.isFinite(pos)) {
      if ((pos ?? 0) > 0) { sBuy += DMA_POS_WEIGHT; reasons.push(`${tag}_price_above`); }
      if ((pos ?? 0) < 0) { sSell+= DMA_POS_WEIGHT; reasons.push(`${tag}_price_below`); }
    }
  };
  addDma(p.dma33_cross,p.price_vs_dma33,"dma33");
  addDma(p.dma75_cross,p.price_vs_dma75,"dma75");
  addDma(p.dma255_cross,p.price_vs_dma255,"dma255");

  // MACD Predictor-ish
  if (Number.isFinite(p.macd_hist_slope)) {
    if ((p.macd_hist_slope ?? 0) > MACD_PRED_SLOPE_MIN) { sBuy++; reasons.push("macd_pred_up"); }
    if ((p.macd_hist_slope ?? 0) < -MACD_PRED_SLOPE_MIN) { sSell++; reasons.push("macd_pred_dn"); }
  }
  if (Number.isFinite(p.macd_pred_cross)) {
    if ((p.macd_pred_cross ?? 0) > 0) { sBuy++; reasons.push("macd_pred_cross_up"); }
    if ((p.macd_pred_cross ?? 0) < 0) { sSell++; reasons.push("macd_pred_cross_dn"); }
  }

  // ===== 判定 =====
  if (sBuy >= SCORE_FIRE_MIN && (sBuy - sSell) >= SCORE_MARGIN_MIN) {
    return { action: "BUY", reason: `sB=${sBuy},sS=${sSell}|${reasons.join("|")}`, ttl_sec: TTL_SEC_DEFAULT, version: ver() };
  }
  if (sSell >= SCORE_FIRE_MIN && (sSell - sBuy) >= SCORE_MARGIN_MIN) {
    return { action: "SELL", reason: `sB=${sBuy},sS=${sSell}|${reasons.join("|")}`, ttl_sec: TTL_SEC_DEFAULT, version: ver() };
  }
  return { action: "HOLD", reason: `consensus_weak sB=${sBuy} sS=${sSell}|${reasons.join("|")}`, ttl_sec: TTL_SEC_DEFAULT, version: ver() };
}

// ===========================================================================

serve(async (req) => {
  try {
    if (req.method === "GET") {
      return okJSON({ ok:true, name:"ai-trader", version:ver() });
    }
    if (req.method !== "POST") return okJSON({ error:"method not allowed" }, 405);

    let body:any;
    try { body = await req.json(); } catch { return badRequest("invalid json body"); }

    const out = scoreDecision(body);

    if (LOG_REASON) console.log(JSON.stringify({at:new Date().toISOString(),...body,...out}));
    return okJSON(out);
  } catch(e) {
    console.error("unhandled_error",e);
    return okJSON({ error:"internal_error" },500);
  }
});
