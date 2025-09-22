import { serve } from "https://deno.land/std/http/server.ts"

function toNum(v: unknown, d = 0): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : d
}

serve(async (req) => {
  if (req.method === "POST") {
    try {
      const body = await req.json()

      const price     = toNum(body.price)
      const bid       = toNum(body.bid)
      const ask       = toNum(body.ask)
      const sma_fast  = toNum(body.sma_fast, price)
      const sma_slow  = toNum(body.sma_slow, price)
      const rsi       = toNum(body.rsi, 50)
      const atr_in    = toNum(body.atr, Math.abs(ask - bid) || (price * 0.001))
      const ob        = toNum(body.ob_imbalance, 0)

      if (!price || !bid || !ask) {
        return new Response(JSON.stringify({ action: "HOLD", confidence: 0, reason: "invalid price/bid/ask" }), {
          headers: { "Content-Type": "application/json" }
        })
      }

      let st = (sma_fast > sma_slow ? 1 : -1)
      st += (rsi < 30 ? 0.5 : (rsi > 70 ? -0.5 : 0.0))
      const so = ob
      const score = 0.6 * st + 0.3 * so
      const conf = Math.min(1, Math.max(0, 0.25 * Math.abs(score)))

      let action: "BUY" | "SELL" | "HOLD" = "HOLD"
      let sl: number | null = null
      let tp: number | null = null

      if (score > 0.4) {
        action = "BUY";  sl = price - 1.5 * atr_in; tp = price + 2.0 * atr_in
      } else if (score < -0.4) {
        action = "SELL"; sl = price + 1.5 * atr_in; tp = price - 2.0 * atr_in
      }

      return new Response(JSON.stringify({ action, sl, tp, confidence: conf, reason: `score=${score.toFixed(2)}` }), {
        headers: { "Content-Type": "application/json" }
      })
    } catch (e) {
      return new Response(JSON.stringify({ action: "HOLD", reason: "error " + (e?.message ?? e) }), {
        headers: { "Content-Type": "application/json" }, status: 400
      })
    }
  }
  return new Response("AI Trader API (Supabase) running")
})
