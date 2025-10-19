import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");

interface TestRequest {
  test_type?: "connection" | "chat" | "trade_analysis";
  message?: string;
}

serve(async (req) => {
  // CORSヘッダー
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  };

  // OPTIONSリクエストへの対応
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // APIキーの確認
    if (!OPENAI_API_KEY) {
      throw new Error("OPENAI_API_KEY environment variable is not set");
    }

    const { test_type = "connection", message = "Hello" }: TestRequest = 
      req.method === "POST" ? await req.json() : {};

    console.log(`🧪 Running test: ${test_type}`);

    // テスト1: API接続確認
    if (test_type === "connection") {
      console.log("📡 Testing OpenAI API connection...");
      
      const modelsResponse = await fetch("https://api.openai.com/v1/models", {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
      });

      if (!modelsResponse.ok) {
        const errorText = await modelsResponse.text();
        throw new Error(`OpenAI API connection failed: ${modelsResponse.status} - ${errorText}`);
      }

      const modelsData = await modelsResponse.json();
      const availableModels = modelsData.data
        .filter((model: any) => model.id.includes("gpt"))
        .map((model: any) => model.id)
        .slice(0, 10);

      return new Response(
        JSON.stringify({
          success: true,
          test: "connection",
          message: "OpenAI API connection successful",
          available_models: availableModels,
          has_gpt_4o_mini: availableModels.some((m: string) => m.includes("gpt-4o-mini")),
          has_gpt_4o: availableModels.some((m: string) => m === "gpt-4o"),
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 200,
        }
      );
    }

    // テスト2: チャット機能テスト
    if (test_type === "chat") {
      console.log("💬 Testing OpenAI Chat API...");

      const chatResponse = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [
            {
              role: "system",
              content: "あなたは金融取引のアシスタントです。簡潔に日本語で返答してください。",
            },
            {
              role: "user",
              content: message || "こんにちは。このメッセージはテストです。'接続成功'とだけ返答してください。",
            },
          ],
          max_tokens: 100,
          temperature: 0.3,
        }),
      });

      if (!chatResponse.ok) {
        const errorText = await chatResponse.text();
        throw new Error(`OpenAI Chat API failed: ${chatResponse.status} - ${errorText}`);
      }

      const chatData = await chatResponse.json();
      const aiResponse = chatData.choices[0].message.content;
      const usage = chatData.usage;

      return new Response(
        JSON.stringify({
          success: true,
          test: "chat",
          message: "Chat API test successful",
          ai_response: aiResponse,
          usage: usage,
          model: chatData.model,
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 200,
        }
      );
    }

    // テスト3: トレード分析テスト
    if (test_type === "trade_analysis") {
      console.log("📊 Testing trade analysis with OpenAI...");

      const sampleMarketData = {
        symbol: "XAUUSD",
        price: 2650.50,
        rsi: 65.5,
        atr: 15.2,
        ema_25: 2645.30,
        sma_100: 2640.10,
        macd_histogram: 2.5,
      };

      const prompt = `
以下の市場データを分析し、BUY/SELL/HOLDの判断と勝率（0.0-1.0）を提供してください。

銘柄: ${sampleMarketData.symbol}
現在価格: ${sampleMarketData.price}
RSI: ${sampleMarketData.rsi}
ATR: ${sampleMarketData.atr}
EMA25: ${sampleMarketData.ema_25}
SMA100: ${sampleMarketData.sma_100}
MACDヒストグラム: ${sampleMarketData.macd_histogram}

以下のJSON形式で返答してください:
{
  "action": "BUY" | "SELL" | "HOLD",
  "win_prob": 0.0-1.0,
  "reasoning": "判断理由（日本語、100文字以内）"
}
`;

      const analysisResponse = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [
            {
              role: "system",
              content: "あなたは経験豊富なトレードアナリストです。テクニカル分析に基づいて判断してください。JSON形式で返答してください。",
            },
            {
              role: "user",
              content: prompt,
            },
          ],
          max_tokens: 300,
          temperature: 0.3,
          response_format: { type: "json_object" },
        }),
      });

      if (!analysisResponse.ok) {
        const errorText = await analysisResponse.text();
        throw new Error(`OpenAI Analysis API failed: ${analysisResponse.status} - ${errorText}`);
      }

      const analysisData = await analysisResponse.json();
      const aiAnalysis = JSON.parse(analysisData.choices[0].message.content);
      const usage = analysisData.usage;

      return new Response(
        JSON.stringify({
          success: true,
          test: "trade_analysis",
          message: "Trade analysis test successful",
          market_data: sampleMarketData,
          ai_analysis: aiAnalysis,
          usage: usage,
          model: analysisData.model,
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 200,
        }
      );
    }

    // 不明なテストタイプ
    return new Response(
      JSON.stringify({
        success: false,
        error: `Unknown test_type: ${test_type}. Use 'connection', 'chat', or 'trade_analysis'`,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 400,
      }
    );

  } catch (error) {
    console.error("❌ Test failed:", error);
    
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message,
        details: error.stack,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      }
    );
  }
});
