// AI Trader Edge Function (All-in-one Pack)
// - 汎用：どの通貨ペアでも同じURLでOK（シンボル別しきい値の上書きも可）
// - フィルタ：時間帯 / スプレッド / 低ボラ / レート制限
// - 合議制スコア：SMA, RSI, MACD, ADX(DI), Stochastic, Bollinger
// - ログ：理由テキストを返却＆console出力
// - 認証：Bearer (任意)
// Deno runtime

import { serve } from "std/http/server.ts";

// ====== 環境変数（必要に応じてダッシュボードで設定） =========================
// 認証（空なら無効）
const API_KEY = Deno.env.get("AI_TRADER_API_KEY") ?? "";

// ログ
const LOG_REASON = (Deno.env.get("AI_TRADER_LOG_REASON") ?? "true") === "true";

// 時間帯フィルタ（JSTで扱う）
const ENABLE_TIME_FILTER = (Deno.env.get("ENABLE_TIME_FILTER") ?? "false") === "true";
const TRADE_START_HOUR_JST = Number(Deno.env.get("TRADE_START_HOUR_JST") ?? 8);
const TRADE_END_HOUR_JST   = Number(Deno.env.get("TRADE_END_HOUR_JST") ?? 23);

// フィルタ閾値（汎用デフォルト）
const SPREAD_MAX_DEFAULT = Number(Deno.env.get("SPREAD_MAX") ?? 0); // 価格差。0で無効
const ATR_MIN_DEFAULT    = Number(Deno.env.get("ATR_MIN") ?? 0);    // 低ボラ回避。0で無効

// 合議制スコアの基本しきい値
const RSI_BUY_MIN_DEFAULT  = Number(Deno.env.get("RSI_BUY_MIN") ?? 55);
const RSI_SELL_MAX_DEFAULT = Number(Deno.env.get("RSI_SELL_MAX") ?? 45);
const ADX_MIN_DEFAULT      = Number(Deno.env.get("ADX_MIN") ?? 22);

// スコアの採択条件
const SCORE_FIRE_MIN       = Number(Deno.env.get("SCORE_FIRE_MIN") ?? 4);
const SCORE_MARGIN_MIN     = Number(Deno.env.get("SCORE_MARGIN_MIN") ?? 2);

// TTL（EA側で有効視する秒数）
const TTL_SEC_DEFAULT      = Number(Deno.env.get("TTL_SEC_DEFAULT") ?? 30);

// ソフトRateLimit（インスタンス内メモリ）
const RL_MAX_HITS_PER_MIN  = Number(Deno.env.get("RL_MAX_HITS_PER_MIN") ?? 120);

// ---- 銘柄別の上書き（JSON文字列、例は下） -------------------------------
// 例:
// AI_TRADER_SYMBOL_OVERRIDES='{
//   "USDJPY":{"SPREAD_MAX":0.03,"ATR_MIN":0.02,"RSI_BUY_MIN":54,"RSI_SELL_MAX":46,"ADX_MIN":20},
//   "XAUUSD":{"SPREAD_MAX":0.6,"ATR_MIN":0.8,"RSI_BUY_MIN":56,"RSI_SELL_MAX":44,"ADX_MIN":18}
// }'
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

  // 任意（送ってこれたら使う）
  macd?: number;
  macd_signal?: number;
  macd_hist?: number;

  adx?: number;        // ADX本体
  plus_di?: number;    // +DI
  minus_di?: number;   // -DI

  stoch_k?: number;
  stoch_d?: number;

  bb_upper?: number;
  bb_basis?: number;
  bb_lower?: number;
};

type OutPayload = {
  action: "BUY" | "SELL" | "HOLD";
  reason?: string;
  ttl_sec?: number;
  version?: string;
};

function ver() { return "ai-trader:2.0.0-allin"; }

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
  // 任意項目は存在するなら数値かだけ軽くチェック
  const optNums = ["macd","macd_signal","macd_hist","adx","plus_di","minus_di","stoch_k","stoch_d","bb_upper","bb_basis","bb_lower"];
  for (const k of optNums) if (k in p && !Number.isFinite(p[k])) return {ok:false, msg:`invalid number: ${k}`};
  return {ok:true, data:p as InPayload};
}

// 銘柄別の上書き適用
function cfgForSymbol(symbol: string) {
  const upper = symbol.toUpperCase();
  const o: SymCfg = OVERRIDES[upper] ?? {};
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

// 合議制スコア判定
function scoreDecision(p: InPayload): OutPayload {
  const C = cfgForSymbol(p.symbol);
  const reasons: string[] = [];
  const spread = Math.max(0, p.ask - p.bid);

  // セッション
  if (!inTradeSessionJST()) {
    return { action: "HOLD", reason: "out_of_session", ttl_sec: TTL_SEC_DEFAULT, version: ver() };
  }

  // フィルタ：スプレッド / 低ボラ
  if (C.SPREAD_MAX > 0 && spread > C.SPREAD_MAX) {
    return { action: "HOLD", reason: `spread>${C.SPREAD_MAX.toFixed(6)}`, ttl_sec: TTL_SEC_DEFAULT, version: ver() };
  }
  if (C.ATR_MIN > 0 && p.atr < C.ATR_MIN) {
    return { action: "HOLD", reason: `atr<${C.ATR_MIN.toFixed(6)}`, ttl_sec: TTL_SEC_DEFAULT, version: ver() };
  }

  // スコアリング
  let sBuy = 0, sSell = 0;

  // トレンド（SMA）
  const trendUp   = p.sma_fast > p.sma_slow;
  const trendDown = p.sma_fast < p.sma_slow;
  if (trendUp)   { sBuy += 2; reasons.push("trendUp"); }
  if (trendDown) { sSell+= 2; reasons.push("trendDown"); }

  // RSI
  if (p.rsi >= C.RSI_BUY_MIN) { sBuy += 2; reasons.push(`rsi>=${C.RSI_BUY_MIN}`); }
  if (p.rsi <= C.RSI_SELL_MAX){ sSell+= 2; reasons.push(`rsi<=${C.RSI_SELL_MAX}`); }

  // MACD（あれば）
  const hasMACD = Number.isFinite(p.macd) && Number.isFinite(p.macd_signal);
  if (hasMACD) {
    if ((p.macd ?? 0) > (p.macd_signal ?? 0)) { sBuy += 1; reasons.push("macdUp"); }
    else                                      { sSell+= 1; reasons.push("macdDn"); }
  }

  // ADX（あれば：+DIと-DIもあれば順張り強化）
  if (Number.isFinite(p.adx)) {
    if ((p.adx ?? 0) >= C.ADX_MIN) { sBuy += 1; sSell += 1; reasons.push(`adx>=${C.ADX_MIN}`); }
  }
  if (Number.isFinite(p.plus_di) && Number.isFinite(p.minus_di)) {
    if ((p.plus_di ?? 0) > (p.minus_di ?? 0)) { sBuy += 1; reasons.push("+DI>-DI"); }
    if ((p.plus_di ?? 0) < (p.minus_di ?? 0)) { sSell+= 1; reasons.push("+DI<- -DI"); }
  }

  // Stochastic（押し目・戻り目で微加点）
  if (Number.isFinite(p.stoch_k) && Number.isFinite(p.stoch_d)) {
    const k = p.stoch_k ?? 0, d = p.stoch_d ?? 0;
    if (k > d && k < 80) { sBuy += 1; reasons.push("stochUp"); }
    if (k < d && k > 20) { sSell+= 1; reasons.push("stochDn"); }
  }

  // Bollinger（バンドウォークのヒント：価格がbasisより上/下）
  if (Number.isFinite(p.bb_basis)) {
    if (p.price > (p.bb_basis ?? 0)) { sBuy += 1; reasons.push("bb>basis"); }
    if (p.price < (p.bb_basis ?? 0)) { sSell+= 1; reasons.push("bb<basis"); }
  }

  // 採択基準
  if (sBuy >= C.SCORE_FIRE_MIN && (sBuy - sSell) >= C.SCORE_MARGIN_MIN) {
    return { action: "BUY", reason: `sB=${sBuy},sS=${sSell}|${reasons.join("|")}`, ttl_sec: TTL_SEC_DEFAULT, version: ver() };
  }
  if (sSell >= C.SCORE_FIRE_MIN && (sSell - sBuy) >= C.SCORE_MARGIN_MIN) {
    return { action: "SELL", reason: `sB=${sBuy},sS=${sSell}|${reasons.join("|")}`, ttl_sec: TTL_SEC_DEFAULT, version: ver() };
  }
  return { action: "HOLD", reason: `consensus_weak sB=${sBuy} sS=${sSell}|${reasons.join("|")}`, ttl_sec: TTL_SEC_DEFAULT, version: ver() };
}

serve(async (req) => {
  try {
    // 説明＆疎通確認
    if (req.method === "GET") {
      return okJSON({
        ok:true, name:"ai-trader", version: ver(),
        requires: {
          method:"POST",
          contentType:"application/json",
          fields:["symbol","timeframe","time","price","bid","ask","sma_fast","sma_slow","rsi","atr"],
          optional:["macd","macd_signal","macd_hist","adx","plus_di","minus_di","stoch_k","stoch_d","bb_upper","bb_basis","bb_lower"]
        }
      });
    }
    if (req.method !== "POST") return okJSON({error:"method not allowed"}, 405);

    // 認証（任意）
    if (API_KEY) {
      const auth = req.headers.get("authorization") ?? "";
      const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
      if (token !== API_KEY) return unauthorized();
    }

    // レート制限（ざっくり）
    const ip = (req.headers.get("x-forwarded-for") ?? req.headers.get("cf-connecting-ip") ?? "unknown").split(",")[0].trim();
    if (!softRateLimit(ip)) return okJSON({ error:"rate_limited" }, 429);

    // JSON
    let body: any;
    try { body = await req.json(); } catch { return badRequest("invalid json body"); }
    const v = validate(body);
    if (!v.ok) return badRequest(v.msg);

    // 判定
    const out = scoreDecision(v.data);

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
