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
  ichimoku_score?: number;  // ⭐ NEW: 一目均衡表スコア (0.0-1.0)
  instance?: string;
  version?: string;
}

interface TradeResponse {
  win_prob: number;
  action: number;
  offset_factor: number;
  expiry_minutes: number;
  confidence?: string;
  reasoning?: string;
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
  const { dir, rsi, atr, ichimoku_score } = req;
  let win_prob = 0.55;
  let action = 0;
  let offset_factor = 0.2;
  let expiry_minutes = 90;
  
  // RSIによる調整
  if (rsi > 70) win_prob += (dir < 0) ? 0.20 : -0.05;
  else if (rsi < 30) win_prob += (dir > 0) ? 0.20 : -0.05;
  else if (rsi >= 60 && rsi <= 70) win_prob += (dir > 0) ? 0.15 : 0.0;
  else if (rsi >= 30 && rsi <= 40) win_prob += (dir < 0) ? 0.15 : 0.0;
  
  if (dir !== 0) win_prob += 0.15;
  
  // ⭐ 一目均衡表スコアによる調整（NEW）
  if (ichimoku_score !== undefined && ichimoku_score !== null) {
    // ichimoku_score: 1.0 = 両指標一致（最強）, 0.7 = 一目のみ, 0.5 = MAのみ, 0.0 = 矛盾
    if (ichimoku_score >= 0.9) {
      // MA + 一目の両方が一致 → 高い信頼度
      win_prob += 0.15;
      console.log(`[Fallback] Ichimoku boost: +15% (score=${ichimoku_score})`);
    } else if (ichimoku_score >= 0.6) {
      // 一目のみまたは強めのシグナル
      win_prob += 0.10;
      console.log(`[Fallback] Ichimoku boost: +10% (score=${ichimoku_score})`);
    } else if (ichimoku_score >= 0.4) {
      // MAのみまたは弱めのシグナル
      win_prob += 0.05;
      console.log(`[Fallback] Ichimoku boost: +5% (score=${ichimoku_score})`);
    }
    // ichimoku_score = 0.0（矛盾）の場合は加算なし
  }
  
  // ATRによる調整
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
  
  // 一目スコアに基づく最終ログ
  const ichimokuQuality = ichimoku_score !== undefined 
    ? ichimoku_score >= 0.9 ? "excellent" : ichimoku_score >= 0.6 ? "good" : ichimoku_score >= 0.4 ? "moderate" : ichimoku_score > 0 ? "weak" : "conflicting"
    : "N/A";
  
  console.log(
    `[Fallback] Final calculation: win_prob=${(win_prob * 100).toFixed(1)}% ` +
    `action=${action} ichimoku_quality=${ichimokuQuality} ` +
    `(RSI=${rsi.toFixed(1)}, ATR=${atr.toFixed(5)})`
  );
  
  return {
    win_prob: Math.round(win_prob * 1000) / 1000,
    action,
    offset_factor: Math.round(offset_factor * 1000) / 1000,
    expiry_minutes,
  };
}

// OpenAI APIを使用したAI予測
async function calculateSignalWithAI(req: TradeRequest): Promise<TradeResponse> {
  const { symbol, timeframe, dir, rsi, atr, price, reason, ichimoku_score } = req;
  
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
    const winRate = historicalData.filter((d: any) => d.actual_result === "WIN").length / historicalData.length;
    historicalContext = `\n過去50件の取引での勝率: ${(winRate * 100).toFixed(1)}%`;
  }
  
  // ⭐ 一目均衡表スコアの詳細分析を追加
  let ichimokuContext = "";
  let signalQuality = "unknown";
  let confidenceBoost = 0;
  
  if (ichimoku_score !== undefined && ichimoku_score !== null) {
    if (ichimoku_score >= 0.9) {
      // 最強シグナル: MA + 一目の両方が完全一致
      signalQuality = "excellent";
      confidenceBoost = 15;
      ichimokuContext = `
- 一目均衡表分析: **最強シグナル（信頼度95%）**
  * 移動平均線（EMA25 vs SMA100）が${dir > 0 ? "上昇" : "下降"}トレンドを示す
  * 一目均衡表の転換線が基準線を${dir > 0 ? "上" : "下"}抜け
  * 価格が雲の${dir > 0 ? "上" : "下"}に位置（強いトレンド）
  * 雲が${dir > 0 ? "青色（陽転）" : "赤色（陰転）"}でトレンドを確認
  → 複数の独立したテクニカル指標が同一方向を示す極めて強いシグナル`;
    } else if (ichimoku_score >= 0.6) {
      // 一目のみが強シグナル
      signalQuality = "good";
      confidenceBoost = 10;
      ichimokuContext = `
- 一目均衡表分析: **強シグナル（信頼度80%）**
  * 一目均衡表が明確な${dir > 0 ? "買い" : "売り"}シグナル
  * 転換線・基準線・雲の3要素が揃っている
  * 移動平均線は中立だが、一目が強い方向性を示す
  → 一目均衡表単独でも信頼できるシグナル`;
    } else if (ichimoku_score >= 0.4) {
      // MAのみが強シグナル
      signalQuality = "moderate";
      confidenceBoost = 5;
      ichimokuContext = `
- 一目均衡表分析: **中程度シグナル（信頼度65%）**
  * 移動平均線が${dir > 0 ? "上昇" : "下降"}トレンドを示す
  * 一目均衡表は中立（雲の中または転換・基準線が接近）
  * トレンド初期または調整局面の可能性
  → 移動平均線のみのシグナルのため慎重に判断`;
    } else if (ichimoku_score > 0) {
      // 弱いシグナル
      signalQuality = "weak";
      confidenceBoost = 0;
      ichimokuContext = `
- 一目均衡表分析: **弱シグナル（信頼度50%）**
  * 指標間の一致度が低い
  * トレンドが不明瞭またはレンジ相場
  → エントリーは慎重に、勝率は低めに見積もるべき`;
    } else {
      // シグナル矛盾
      signalQuality = "conflicting";
      confidenceBoost = -10;
      ichimokuContext = `
- 一目均衡表分析: **⚠️ シグナル矛盾（信頼度30%）**
  * 移動平均線と一目均衡表が逆方向を示している
  * 相場の転換点またはダマシの可能性が高い
  * 例: MAは買いだが、価格が雲の下にある
  → **エントリー非推奨**: 複数指標が矛盾する局面は避けるべき`;
    }
  }
  
  const prompt = `あなたはプロの金融トレーダー兼AIアナリストです。複数のテクニカル指標を総合的に分析し、取引の成功確率（勝率）を0.0～1.0の範囲で予測してください。

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📊 市場情報
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
• 銘柄: ${symbol}
• 時間軸: ${timeframe}
• エントリー方向: ${dir > 0 ? "買い（ロング）" : dir < 0 ? "売り（ショート）" : "中立"}
• 現在価格: ${price}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📈 テクニカル指標
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
• RSI: ${rsi.toFixed(2)} ${rsi > 70 ? "⚠️ 買われすぎ（70超）→ 売りシグナル強化" : rsi < 30 ? "⚠️ 売られすぎ（30未満）→ 買いシグナル強化" : "✓ 中立圏（30-70）"}
• ATR: ${atr.toFixed(5)} ${atr > 0.001 ? "（高ボラティリティ→トレンド明確）" : atr < 0.0005 ? "（低ボラティリティ→レンジ相場）" : "（通常ボラティリティ）"}
• 総合判定: ${reason}
${ichimokuContext}
${historicalContext ? `\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n📊 過去実績${historicalContext}` : ""}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🎯 勝率予測ガイドライン
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. **一目均衡表スコアを最重視**（最も信頼性の高い指標）
   - excellent (0.9+): 基準勝率 85%～95%
   - good (0.6-0.9): 基準勝率 75%～85%
   - moderate (0.4-0.6): 基準勝率 65%～75%
   - weak (0.0-0.4): 基準勝率 55%～65%
   - conflicting (0.0): 基準勝率 40%～55% ⚠️ エントリー非推奨

2. **RSIとの相乗効果**
   - RSI 70超 + 売り方向 → +5～10%
   - RSI 30未満 + 買い方向 → +5～10%
   - RSI逆行（RSI高で買い等） → -5～10%

3. **ATRによる調整**
   - 高ボラティリティ（0.001超）→ トレンド明確 → +3～5%
   - 低ボラティリティ（0.0005未満）→ レンジ相場 → -3～5%

4. **過去実績の反映**
   - 過去勝率が高い → +2～5%
   - 過去勝率が低い → -2～5%

5. **最終調整**
   - 複数指標が完全一致 → 高信頼度 → confidence: "high"
   - 一部指標のみ一致 → 中信頼度 → confidence: "medium"
   - 指標が矛盾 → 低信頼度 → confidence: "low"
   - **勝率範囲: 0.40～0.95**（現実的な範囲）

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📋 回答形式（JSON）
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
以下のJSON形式で回答してください（説明文は不要）:
{
  "win_prob": 0.XX,
  "confidence": "high" | "medium" | "low",
  "reasoning": "一目均衡表の状態、RSIとの相乗効果、過去実績を踏まえた簡潔な判断理由（1行、30文字以内）"
}`;

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",  // または "gpt-4o" for better analysis
        messages: [
          { 
            role: "system", 
            content: "あなたはプロの金融トレーダーです。テクニカル指標を総合的に分析し、特に一目均衡表を重視して勝率を予測します。JSON形式で簡潔に回答してください。" 
          },
          { role: "user", content: prompt }
        ],
        temperature: 0.2,  // より一貫性のある予測のため低めに設定
        max_tokens: 250,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[AI] OpenAI API error: ${response.status} - ${errorText}`);
      console.warn("[AI] Falling back to rule-based calculation");
      return calculateSignalFallback(req);
    }

    const data = await response.json();
    const content = data.choices[0].message.content;
    
    // JSONを抽出（マークダウンコードブロックを除去）
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error("[AI] No JSON in response. Raw content:", content.substring(0, 200));
      console.warn("[AI] Falling back to rule-based calculation");
      return calculateSignalFallback(req);
    }
    
    const aiResult = JSON.parse(jsonMatch[0]);
    let win_prob = parseFloat(aiResult.win_prob);
    
    // 安全性チェック
    if (isNaN(win_prob) || win_prob < 0 || win_prob > 1) {
      console.error("[AI] Invalid win_prob:", win_prob, "from AI response:", JSON.stringify(aiResult));
      console.warn("[AI] Falling back to rule-based calculation");
      return calculateSignalFallback(req);
    }
    
    // 一目スコアに基づく範囲調整
    let minProb = 0.40;
    let maxProb = 0.95;
    if (ichimoku_score !== undefined && ichimoku_score !== null) {
      if (ichimoku_score >= 0.9) {
        minProb = 0.70;  // 最強シグナルは70%から
      } else if (ichimoku_score <= 0.1) {
        maxProb = 0.65;  // シグナル矛盾は65%まで
      }
    }
    
    win_prob = Math.max(minProb, Math.min(maxProb, win_prob));
    
    const confidence = aiResult.confidence || "unknown";
    const reasoning = aiResult.reasoning || "N/A";
    
    // 詳細ログ出力
    console.log(
      `[AI] OpenAI GPT-4 prediction: ${(win_prob * 100).toFixed(1)}% (${confidence}) - ${reasoning} | ` +
      `ichimoku=${ichimoku_score?.toFixed(2) || "N/A"} quality=${signalQuality}`
    );
    
    return {
      win_prob: Math.round(win_prob * 1000) / 1000,
      action: win_prob >= 0.70 ? dir : 0,
      offset_factor: atr > 0.001 ? 0.25 : 0.2,
      expiry_minutes: 90,
      confidence: confidence,
      reasoning: reasoning,
    } as any;
    
  } catch (error) {
    console.error("[AI] OpenAI exception:", error instanceof Error ? error.message : String(error));
    console.error("[AI] Stack trace:", error instanceof Error ? error.stack : "N/A");
    console.warn("[AI] Falling back to rule-based calculation");
    return calculateSignalFallback(req);
  }
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }
  
  if (req.method === "GET") {
    // OpenAI API KEY の詳細確認
    const hasKey = OPENAI_API_KEY && OPENAI_API_KEY.length > 10 && !OPENAI_API_KEY.includes("YOUR_");
    const keyStatus = OPENAI_API_KEY 
      ? (hasKey ? `configured (${OPENAI_API_KEY.length} chars)` : "invalid or placeholder")
      : "NOT SET";
    
    return new Response(
      JSON.stringify({ 
        ok: true, 
        service: "ai-trader with OpenAI + Ichimoku", 
        version: "2.2.0",
        ai_enabled: hasKey,
        openai_key_status: keyStatus,
        fallback_available: true,
        features: ["ichimoku_score", "openai_gpt", "ml_learning", "detailed_logging"]
      }),
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
    
    // ⭐ OpenAI API KEY の存在確認とログ
    const hasOpenAIKey = OPENAI_API_KEY && OPENAI_API_KEY.length > 10 && !OPENAI_API_KEY.includes("YOUR_");
    
    if (!hasOpenAIKey) {
      console.warn(`[ai-trader] ⚠️ OPENAI_API_KEY not properly configured!`);
      console.warn(`[ai-trader] Key status: ${OPENAI_API_KEY ? `exists (length=${OPENAI_API_KEY.length})` : "NOT SET"}`);
      console.warn(`[ai-trader] Using FALLBACK calculation only`);
    } else {
      console.log(`[ai-trader] ✓ OpenAI API KEY configured (length=${OPENAI_API_KEY.length})`);
    }
    
    // OpenAI_API_KEYが設定されていればAI使用、なければフォールバック
    let response;
    let predictionMethod = "UNKNOWN";
    
    if (hasOpenAIKey) {
      console.log(`[ai-trader] 🤖 Attempting OpenAI GPT prediction...`);
      try {
        response = await calculateSignalWithAI(tradeReq);
        predictionMethod = "OpenAI-GPT";
        console.log(`[ai-trader] ✓ OpenAI prediction successful`);
      } catch (aiError) {
        console.error(`[ai-trader] ❌ OpenAI prediction failed:`, aiError);
        console.warn(`[ai-trader] Switching to fallback calculation...`);
        response = calculateSignalFallback(tradeReq);
        predictionMethod = "Fallback-AfterAI-Error";
      }
    } else {
      console.warn(`[ai-trader] ⚠️ Using rule-based FALLBACK (no OpenAI key)`);
      response = calculateSignalFallback(tradeReq);
      predictionMethod = "Fallback-NoKey";
    }
    
    // ⭐ 詳細ログ出力（判定方法を明示）
    const ichimokuInfo = tradeReq.ichimoku_score !== undefined 
      ? ` ichimoku=${tradeReq.ichimoku_score.toFixed(2)}` 
      : "";
    
    console.log(
      `[ai-trader] 📊 RESULT: ${tradeReq.symbol} ${tradeReq.timeframe} ` +
      `dir=${tradeReq.dir} win=${response.win_prob.toFixed(3)}${ichimokuInfo} ` +
      `reason="${tradeReq.reason}" method=${predictionMethod}`
    );
    
    // ⚠️ フォールバックの場合は警告
    if (predictionMethod.startsWith("Fallback")) {
      console.warn(`[ai-trader] ⚠️ WARNING: Using fallback calculation! Check OpenAI API key configuration.`);
    }
    
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
