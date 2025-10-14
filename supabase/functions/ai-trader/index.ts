import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY")!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

interface TradeRequest {
  symbol: string;
  timeframe: string;
  dir: number;
  rsi: number;
  atr: number;
  price: number;
  reason: string;
  instance?: string;
  version?: string;
}

interface TradeResponse {
  win_prob: number;
  action: number;
  offset_factor: number;
  expiry_minutes: number;
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Content-Type": "application/json",
  };
}

// フォールバック計算（OpenAI失敗時用）
function calculateSignalFallback(req: TradeRequest): TradeResponse {
  const { dir, rsi, atr } = req;
  let win_prob = 0.55;
  let action = 0;
  let offset_factor = 0.2;
  let expiry_minutes = 90;
  
  if (rsi > 70) win_prob += (dir < 0) ? 0.20 : -0.05;
  else if (rsi < 30) win_prob += (dir > 0) ? 0.20 : -0.05;
  else if (rsi >= 60 && rsi <= 70) win_prob += (dir > 0) ? 0.15 : 0.0;
  else if (rsi >= 30 && rsi <= 40) win_prob += (dir < 0) ? 0.15 : 0.0;
  
  if (dir !== 0) win_prob += 0.15;
  
  if (atr > 0) {
    if (atr > 0.001) {
      offset_factor = 0.25;
      win_prob += 0.05;
    }
    if (atr < 0.0005) {
      offset_factor = 0.15;
      expiry_minutes = 60;
      win_prob -= 0.05;
    }
  }
  
  win_prob = Math.max(0, Math.min(1, win_prob));
  if (win_prob >= 0.70) action = dir;
  
  return {
    win_prob: Math.round(win_prob * 1000) / 1000,
    action,
    offset_factor: Math.round(offset_factor * 1000) / 1000,
    expiry_minutes,
  };
}

// OpenAI APIを使用したAI予測
async function calculateSignalWithAI(req: TradeRequest): Promise<TradeResponse> {
  const { symbol, timeframe, dir, rsi, atr, price, reason } = req;
  
  // 過去の取引データを取得（ML学習データ）
  const { data: historicalData, error } = await supabase
    .from("ai_signals")
    .select("win_prob, rsi, atr, actual_result")
    .eq("symbol", symbol)
    .not("actual_result", "is", null)
    .order("created_at", { ascending: false })
    .limit(50);
  
  let historicalContext = "";
  if (historicalData && historicalData.length > 0) {
    const winRate = historicalData.filter(d => d.actual_result === "WIN").length / historicalData.length;
    historicalContext = `\n過去50件の取引での勝率: ${(winRate * 100).toFixed(1)}%`;
  }
  
  const prompt = `あなたは金融市場の取引予測AIです。以下の情報から勝率を0.0～1.0の範囲で予測してください。

【市場情報】
- 銘柄: ${symbol}
- 時間軸: ${timeframe}
- 方向: ${dir > 0 ? "買い" : dir < 0 ? "売り" : "中立"}
- RSI: ${rsi.toFixed(2)} ${rsi > 70 ? "(買われすぎ)" : rsi < 30 ? "(売られすぎ)" : "(中立)"}
- ATR: ${atr.toFixed(5)} (ボラティリティ)
- 現在価格: ${price}
- テクニカル理由: ${reason}
${historicalContext}

【予測ルール】
1. RSI 70以上で売り、30以下で買いは高勝率
2. トレンドと方向が一致すれば勝率UP
3. ボラティリティが高い時はトレンドが明確
4. 過去の勝率も考慮
5. 勝率は0.50～0.95の範囲で現実的に

以下のJSON形式で回答してください（説明不要）:
{
  "win_prob": 0.75,
  "confidence": "high",
  "reasoning": "理由を1行で"
}`;

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",  // または "gpt-3.5-turbo"
        messages: [
          { role: "system", content: "あなたは金融市場の予測AIです。JSON形式で簡潔に回答します。" },
          { role: "user", content: prompt }
        ],
        temperature: 0.3,
        max_tokens: 200,
      }),
    });

    if (!response.ok) {
      console.error("[AI] OpenAI API error:", response.status);
      return calculateSignalFallback(req);
    }

    const data = await response.json();
    const content = data.choices[0].message.content;
    
    // JSONを抽出（マークダウンコードブロックを除去）
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error("[AI] No JSON in response");
      return calculateSignalFallback(req);
    }
    
    const aiResult = JSON.parse(jsonMatch[0]);
    let win_prob = parseFloat(aiResult.win_prob);
    
    // 安全性チェック
    if (isNaN(win_prob) || win_prob < 0 || win_prob > 1) {
      console.error("[AI] Invalid win_prob:", win_prob);
      return calculateSignalFallback(req);
    }
    
    win_prob = Math.max(0.5, Math.min(0.95, win_prob)); // 50%～95%に制限
    
    console.log(`[AI] OpenAI prediction: ${(win_prob * 100).toFixed(1)}% (${aiResult.confidence}) - ${aiResult.reasoning}`);
    
    return {
      win_prob: Math.round(win_prob * 1000) / 1000,
      action: win_prob >= 0.70 ? dir : 0,
      offset_factor: atr > 0.001 ? 0.25 : 0.2,
      expiry_minutes: 90,
    };
    
  } catch (error) {
    console.error("[AI] OpenAI error:", error);
    return calculateSignalFallback(req);
  }
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }
  
  if (req.method === "GET") {
    return new Response(
      JSON.stringify({ ok: true, service: "ai-trader with OpenAI", version: "2.0.0" }),
      { status: 200, headers: corsHeaders() }
    );
  }
  
  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      { status: 405, headers: corsHeaders() }
    );
  }
  
  try {
    const raw = await req.text();
    const safe = raw.replace(/\u0000+$/g, "");
    
    let body;
    try {
      body = JSON.parse(safe);
    } catch (parseError) {
      console.error("[ai-trader] JSON parse error:", parseError);
      return new Response(
        JSON.stringify({ error: "Invalid JSON" }),
        { status: 400, headers: corsHeaders() }
      );
    }
    
    const required = ["symbol", "timeframe", "dir", "rsi", "atr", "price", "reason"];
    for (const field of required) {
      if (!(field in body)) {
        return new Response(
          JSON.stringify({ error: `Missing: ${field}` }),
          { status: 400, headers: corsHeaders() }
        );
      }
    }
    
    const tradeReq: TradeRequest = body;
    
    // OpenAI_API_KEYが設定されていればAI使用、なければフォールバック
    const response = OPENAI_API_KEY 
      ? await calculateSignalWithAI(tradeReq)
      : calculateSignalFallback(tradeReq);
    
    console.log(
      `[ai-trader] ${tradeReq.symbol} ${tradeReq.timeframe} ` +
      `dir=${tradeReq.dir} win=${response.win_prob.toFixed(3)}`
    );
    
    return new Response(
      JSON.stringify(response),
      { status: 200, headers: corsHeaders() }
    );
    
  } catch (error) {
    console.error("[ai-trader] Error:", error);
    return new Response(
      JSON.stringify({ error: "Internal error" }),
      { status: 500, headers: corsHeaders() }
    );
  }
});
