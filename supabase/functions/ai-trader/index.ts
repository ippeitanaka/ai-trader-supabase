// supabase/functions/ai-trader/index.ts
// Gemini APIを使ったトレードシグナル生成

import "jsr:@supabase/functions-js/edge-runtime/v2";

type Signal = { action: "BUY" | "SELL" | "HOLD"; sl?: number; tp?: number; reason?: string };

const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY") ?? "";
const GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent";

function json(res: unknown, status = 200) {
  return new Response(JSON.stringify(res), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// 最低限のサーバーサイド安全弁
function preFilter(body: any): string | null {
  const bid = Number(body?.bid ?? 0);
  const ask = Number(body?.ask ?? 0);
  const atr = Number(body?.atr ?? 0);
  if (!isFinite(bid) || !isFinite(ask) || bid <= 0 || ask <= 0) return "bad_price";
  if (!isFinite(atr) || atr <= 0) return "atr_invalid";
  const spread = Math.abs(ask - bid);
  if (spread <= 0) return "bad_spread";
  return null;
}

Deno.serve(async (req) => {
  let body: any = {};
  try { body = await req.json(); } catch { return json({ action: "HOLD", reason: "invalid_json" }); }

  // 0) 早期フィルタ
  const ng = preFilter(body);
  if (ng) return json({ action: "HOLD", reason: ng });

  if (!GEMINI_API_KEY) {
    return json({ action: "HOLD", reason: "no_gemini_key" });
  }

  // 1) Geminiに渡すプロンプト
  const prompt = `
あなたはトレードシグナル生成AIです。必ず以下のJSONだけを返してください。
{ "action": "BUY" | "SELL" | "HOLD", "sl": number, "tp": number, "reason": string }

ルール:
- RSI, SMA fast/slow, ATR を用いて判断。
- ATRやスプレッドが小さい時はHOLD。
- 不確実な時はHOLD。
- BUYなら sl < bid, tp > ask。
- SELLなら sl > ask, tp < bid。
- 数値は必ず数値型で返す。
入力データ:
${JSON.stringify(body)}
`;

  try {
    const resp = await fetch(`${GEMINI_API_URL}?key=${GEMINI_API_KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.2 },
      }),
    });

    if (!resp.ok) {
      const txt = await resp.text();
      console.log("gemini_error", resp.status, txt);
      return json({ action: "HOLD", reason: `gemini_${resp.status}` });
    }

    const data = await resp.json();
    const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    let parsed: Signal | null = null;
    try { parsed = JSON.parse(raw); } catch { parsed = null; }

    if (!parsed || !["BUY","SELL","HOLD"].includes(parsed.action)) {
      return json({ action: "HOLD", reason: "parse_error", raw });
    }

    return json(parsed);

  } catch (e) {
    console.log("gemini_exception", String(e));
    return json({ action: "HOLD", reason: "exception" });
  }
});
