// supabase/functions/ai-reason/index.ts
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
/** -------- CORS -------- */ function cors(extra = {}) {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "*",
    "Access-Control-Allow-Methods": "POST,OPTIONS",
    "Content-Type": "application/json",
    ...extra
  };
}
/** -------- Utils -------- */ function safeJsonParse(raw) {
  // MT5のWebRequestで稀に混ざる制御文字を除去してパース
  const cleaned = raw.replace(/\u0000/g, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch  {
    const i = Math.max(cleaned.lastIndexOf("}"), cleaned.lastIndexOf("]"));
    if (i > 0) return JSON.parse(cleaned.slice(0, i + 1));
    throw new Error("bad_json");
  }
}
const toNum = (x)=>{
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
};
function trendOf(price, ma100, ma200) {
  if (price < ma100 && ma100 < ma200) return "down";
  if (price > ma100 && ma100 > ma200) return "up";
  return "flat";
}
/** ---- 可変しきい値（必要なら後でEA側から送って拡張可） ---- */ const BUY_RSI_MIN = 60; // upトレンド時のBUY閾値
const SELL_RSI_MAX = 40; // downトレンド時のSELL閾値
/** ---- ここからエンドポイント ---- */ serve(async (req)=>{
  if (req.method === "OPTIONS") return new Response(null, { headers: cors() });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "POST only" }), { status: 405, headers: cors() });
  }
  // （任意）APIキー検証：ダッシュボードの Function secrets に EDGE_DECISION_KEY を入れてる場合のみ有効化
  const requiredKey = Deno.env.get("EDGE_DECISION_KEY");
  if (requiredKey) {
    const got = req.headers.get("x-api-key") ?? "";
    if (got !== requiredKey) {
      return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: cors() });
    }
  }
  let r;
  try {
    const raw = await req.text();
    const body = safeJsonParse(raw);
    r = Array.isArray(body) ? body[0] : body;
  } catch (e) {
    return new Response(JSON.stringify({ action: "HOLD", reason: "bad_json" }), { status: 200, headers: cors() });
  }
  // 入力取得
  const sym = String(r?.sym ?? "");
  const tf = String(r?.tf ?? "");
  const rsi = toNum(r?.rsi);
  const atr = toNum(r?.atr);
  const price = toNum(r?.price);
  const ema25 = toNum(r?.ema25s2 ?? r?.ema25); // 互換キー
  const ma100 = toNum(r?.ma100);
  const ma200 = toNum(r?.ma200);
  // 入力不足はHOLD＋理由明記で返す（必ず reason あり）
  const missing = [];
  if (rsi === null) missing.push("rsi");
  if (price === null) missing.push("price");
  if (ma100 === null) missing.push("ma100");
  if (ma200 === null) missing.push("ma200");
  if (missing.length) {
    return new Response(JSON.stringify({
      action: "HOLD",
      reason: `insufficient_inputs: ${missing.join(", ")}`,
      sym,
      tf,
      st: "ai-reason-v1"
    }), { headers: cors() });
  }
  // トレンド & 説明パーツ
  const tr = trendOf(price, ma100, ma200);
  const bits = [
    `trend=${tr}`,
    `rsi=${rsi.toFixed(2)}`,
    `price${ema25 === null ? "~" : price >= ema25 ? ">=" : "<"}EMA25`
  ];
  if (atr !== null) bits.push(`atr=${atr.toFixed(3)}`);
  // ここで判定
  let action = "HOLD";
  if (tr === "up" && rsi >= BUY_RSI_MIN && (ema25 === null || price >= ema25)) {
    action = "BUY";
    bits.push(`rule=up&rsi>=${BUY_RSI_MIN}${ema25 !== null ? "; price>=EMA25" : ""}`);
  } else if (tr === "down" && rsi <= SELL_RSI_MAX && (ema25 === null || price <= ema25)) {
    action = "SELL";
    bits.push(`rule=down&rsi<=${SELL_RSI_MAX}${ema25 !== null ? "; price<=EMA25" : ""}`);
  } else {
    // HOLDの“明確な理由”
    if (tr === "up" && rsi < BUY_RSI_MIN) bits.push(`hold_reason=rsi<${BUY_RSI_MIN}`);
    if (tr === "down" && rsi > SELL_RSI_MAX) bits.push(`hold_reason=rsi>${SELL_RSI_MAX}`);
    if (tr === "flat") bits.push("hold_reason=trend=flat");
  }
  const reason = bits.join("; ");
  return new Response(JSON.stringify({ action, reason, sym, tf, st: "ai-reason-v1" }), { headers: cors() });
});
