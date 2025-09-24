// AI Trader Edge Function (Hybrid: Consensus + Optional AI Bias)
// - 汎用：どの通貨ペアでも同じURLでOK（銘柄別上書き可）
// - フィルタ：時間帯 / スプレッド / 低ボラ / ソフト・レート制限
// - 合議制：SMA, RSI, MACD, ADX(DI), Stochastic, Bollinger
// - DiNapoli拡張：Fib 38.2/50/61.8 ゾーン / 3x3,7x5,25x5(擬似DMA) / MACD Predictor
// - AI補助：拮抗局面だけ+1/0/-1の微バイアス & タグ/コメント（失敗時は即フォールバック）
// - 認証：Bearer（環境変数AI_TRADER_API_KEYを設定したときだけ必須）
// Deno runtime

import { serve } from "std/http/server.ts";

/* ========================= 環境変数 ========================= */
// 認証（空なら無効＝誰でも可）
const API_KEY = Deno.env.get("AI_TRADER_API_KEY") ?? "";

// ログ
const LOG_REASON = (Deno.env.get("AI_TRADER_LOG_REASON") ?? "true") === "true";

// 時間帯フィルタ（JST）
const ENABLE_TIME_FILTER   = (Deno.env.get("ENABLE_TIME_FILTER") ?? "false") === "true";
const TRADE_START_HOUR_JST = Number(Deno.env.get("TRADE_START_HOUR_JST") ?? 8);
const TRADE_END_HOUR_JST   = Number(Deno.env.get("TRADE_END_HOUR_JST") ?? 23);

// フィルタ閾値（汎用デフォルト）
const SPREAD_MAX_DEFAULT = Number(Deno.env.get("SPREAD_MAX") ?? 0); // 0=無効
const ATR_MIN_DEFAULT    = Number(Deno.env.get("ATR_MIN") ?? 0);    // 0=無効

// 合議制しきい値
const RSI_BUY_MIN_DEFAULT  = Number(Deno.env.get("RSI_BUY_MIN") ?? 55);
const RSI_SELL_MAX_DEFAULT = Number(Deno.env.get("RSI_SELL_MAX") ?? 45);
const ADX_MIN_DEFAULT      = Number(Deno.env.get("ADX_MIN") ?? 22);

// スコア採択条件
const SCORE_FIRE_MIN_DEFAULT   = Number(Deno.env.get("SCORE_FIRE_MIN") ?? 4);
const SCORE_MARGIN_MIN_DEFAULT = Number(Deno.env.get("SCORE_MARGIN_MIN") ?? 2);

// TTL（EA側で有効視する秒数）
const TTL_SEC_DEFAULT = Number(Deno.env.get("TTL_SEC_DEFAULT") ?? 30);

// ソフトRateLimit（インスタンス内メモリ）
const RL_MAX_HITS_PER_MIN = Number(Deno.env.get("RL_MAX_HITS_PER_MIN") ?? 120);

// 銘柄別上書き（JSON文字列）
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

// ====== AI 呼び出し系（任意・安全フォールバック） ======
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") ?? "";
const AI_MODEL       = Deno.env.get("AI_MODEL") ?? "gpt-4o-mini";
const AI_TIMEOUT_MS  = Number(Deno.env.get("AI_TIMEOUT_MS") ?? 1500);
const AI_ENABLE      = (Deno.env.get("AI_ENABLE") ?? "true") === "true";

/* ========================= 型 ========================= */
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

  // 任意（送れば使う）
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

  // DiNapoli 追加入力（EAで算出）
  fib_leg_dir?: "UP"|"DOWN"|""; // 押し目/戻り方向
  fib_retracement?: number;     // 0..1
  dma33_cross?: number;         // -1/0/+1
  dma75_cross?: number;
  dma255_cross?: number;
  price_vs_dma33?: number;      // -1/0/+1
  price_vs_dma75?: number;
  price_vs_dma255?: number;
  macd_hist_slope?: number;     // 予測用の傾き
  macd_pred_cross?: number;     // -1/0/+1
};

type OutPayload = {
  action: "BUY" | "SELL" | "HOLD";
  reason?: string;
  ttl_sec?: number;
  version?: string;
  ai_note?: string;
  ai_tags?: string[];
};

function ver() { return "ai-trader:2.4.0-hybrid-ai"; }

/* ========================= ユーティリティ ========================= */
function okJSON(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status, headers: { "content-type": "application/json; charset=utf-8" }
  });
}
function badRequest(msg: string) { return okJSON({ error: msg }, 400); }
function unauthorized() { return okJSON({ error: "unauthorized" }, 401); }

// JST時間帯フィルタ
function inTradeSessionJST(): boolean {
  if (!ENABLE_TIME_FILTER) return true;
  const now = new Date();
  const hUTC = now.getUTCHours();
  const hJST = (hUTC + 9) % 24;
  if (TRADE_START_HOUR_JST <= TRADE_END_HOUR_JST)
    return hJST >= TRADE_START_HOUR_JST && hJST < TRADE_END_HOUR_JST;
  return hJST >= TRADE_START_HOUR_JST || hJST < TRADE_END_HOUR_JST; // 日跨ぎ
}

// ソフトRateLimit
const rlMap = new Map<string, { count:number; slot:number }>();
function softRateLimit(key: string): boolean {
  const now = Date.now();
  const slot = Math.floor(now / 60_000);
  const v = rlMap.get(key);
  if (!v || v.slot !== slot) { rlMap.set(key, { count:1, slot }); return true; }
  v.count++;
  return v.count <= RL_MAX_HITS_PER_MIN;
}

// 必須フィールド検証
function validate(p: any): {ok:true; data:InPayload}|{ok:false; msg:string} {
  const req = ["symbol","timeframe","time","price","bid","ask","sma_fast","sma_slow","rsi","atr"];
  if (!p || typeof p!=="object") return {ok:false, msg:"invalid json"};
  for (const k of req) if (!(k in p)) return {ok:false, msg:`missing field: ${k}`};
  const nums = ["time","price","bid","ask","sma_fast","sma_slow","rsi","atr"];
  for (const k of nums) if (!Number.isFinite(p[k])) return {ok:false, msg:`invalid number: ${k}`};
  if (typeof p.symbol!=="string" || !p.symbol) return {ok:false, msg:"symbol must be string"};
  if (typeof p.timeframe!=="string" || !p.timeframe) return {ok:false, msg:"timeframe must be string"};
  // 任意数値は存在時のみ軽くチェック
  const optNums = ["macd","macd_signal","macd_hist","adx","plus_di","minus_di","stoch_k","stoch_d",
                   "bb_upper","bb_basis","bb_lower","fib_retracement",
                   "dma33_cross","dma75_cross","dma255_cross","price_vs_dma33","price_vs_dma75","price_vs_dma255",
                   "macd_hist_slope","macd_pred_cross"];
  for (const k of optNums) if (k in p && !Number.isFinite(p[k])) return {ok:false, msg:`invalid number: ${k}`};
  return {ok:true, data:p as InPayload};
}

// 銘柄別の上書き適用
function cfgForSymbol(symbol: string) {
  const upper = symbol.toUpperCase();
  const o: SymCfg = OVERRIDES[upper] ?? {};
  return {
    SPREAD_MAX:        o.SPREAD_MAX        ?? SPREAD_MAX_DEFAULT,
    ATR_MIN:           o.ATR_MIN           ?? ATR_MIN_DEFAULT,
    RSI_BUY_MIN:       o.RSI_BUY_MIN       ?? RSI_BUY_MIN_DEFAULT,
    RSI_SELL_MAX:      o.RSI_SELL_MAX      ?? RSI_SELL_MAX_DEFAULT,
    ADX_MIN:           o.ADX_MIN           ?? ADX_MIN_DEFAULT,
    SCORE_FIRE_MIN:    o.SCORE_FIRE_MIN    ?? SCORE_FIRE_MIN_DEFAULT,
    SCORE_MARGIN_MIN:  o.SCORE_MARGIN_MIN  ?? SCORE_MARGIN_MIN_DEFAULT,
  };
}

/* ========================= 合議制スコア ========================= */
function consensusScore(p: InPayload) {
  const C = cfgForSymbol(p.symbol);
  const reasons: string[] = [];
  const spread = Math.max(0, p.ask - p.bid);

  // セッション
  if (!inTradeSessionJST()) {
    return { blocked:true, blockReason:"out_of_session" as const };
  }

  // フィルタ：スプレッド / 低ボラ
  if (C.SPREAD_MAX > 0 && spread > C.SPREAD_MAX) {
    return { blocked:true, blockReason: `spread>${C.SPREAD_MAX.toFixed(6)}` as const };
  }
  if (C.ATR_MIN > 0 && p.atr < C.ATR_MIN) {
    return { blocked:true, blockReason: `atr<${C.ATR_MIN.toFixed(6)}` as const };
  }

  let sBuy = 0, sSell = 0;

  // トレンド（SMA）
  const trendUp   = p.sma_fast > p.sma_slow;
  const trendDown = p.sma_fast < p.sma_slow;
  if (trendUp)   { sBuy += 2; reasons.push("trendUp"); }
  if (trendDown) { sSell+= 2; reasons.push("trendDown"); }

  // RSI
  if (p.rsi >= C.RSI_BUY_MIN) { sBuy += 2; reasons.push(`rsi>=BUYmin`); }
  if (p.rsi <= C.RSI_SELL_MAX){ sSell+= 2; reasons.push(`rsi<=SELLmax`); }

  // MACD（あれば）
  const hasMACD = Number.isFinite(p.macd) && Number.isFinite(p.macd_signal);
  if (hasMACD) {
    if ((p.macd ?? 0) > (p.macd_signal ?? 0)) { sBuy += 1; reasons.push("macdUp"); }
    else                                      { sSell+= 1; reasons.push("macdDn"); }
  }
  // MACDヒスト傾き/予測クロス（任意）
  if (Number.isFinite(p.macd_hist_slope)) {
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
