import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY")!;
const OPENAI_MODEL = Deno.env.get("OPENAI_MODEL") || "gpt-4o-mini"; // デフォルト: gpt-4o-mini (推奨)

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

export interface TradeRequest {
  symbol: string;
  timeframe: string;
  
  // 価格情報
  price: number;
  bid: number;
  ask: number;
  
  // 移動平均線
  ema_25: number;
  sma_100: number;
  ma_cross: number;  // 1=golden cross, -1=dead cross
  
  // モメンタム指標
  rsi: number;
  atr: number;
  
  // MACD
  macd: {
    main: number;
    signal: number;
    histogram: number;
    cross: number;  // 1=bullish, -1=bearish
  };
  
  // 一目均衡表
  ichimoku: {
    tenkan: number;
    kijun: number;
    senkou_a: number;
    senkou_b: number;
    chikou: number;
    tk_cross: number;       // 転換線 vs 基準線
    cloud_color: number;    // 雲の色
    price_vs_cloud: number; // 価格 vs 雲の位置
  };
  
  // EA側の判断（参考情報として）
  ea_suggestion: {
    dir: number;
    reason: string;
    ichimoku_score: number;
  };
  
  instance?: string;
  version?: string;
}

export interface TradeResponse {
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

import { calculateQuadFusionScore } from "./quad-fusion.ts";

// フォールバック計算（OpenAI失敗時用） - QuadFusionを使用
function calculateSignalFallback(req: TradeRequest): TradeResponse {
  // ★ QuadFusion分析を使用
  const analysis = calculateQuadFusionScore(req);
  const { atr } = req;
  
  let offset_factor = 0.2;
  let expiry_minutes = 90;
  
  // ATRによるリスク調整
  if (atr > 0) {
    if (atr > 0.001) {
      offset_factor = 0.25;
      expiry_minutes = 120; // 高ボラティリティは長めの有効期限
    } else if (atr < 0.0005) {
      offset_factor = 0.15;
      expiry_minutes = 60; // 低ボラティリティは短めの有効期限
    }
  }
  
  console.log(
    `[Fallback] QuadFusion: win_prob=${(analysis.win_prob * 100).toFixed(1)}% ` +
    `direction=${analysis.direction} confidence=${analysis.confidence}`
  );
  
  return {
    win_prob: Math.round(analysis.win_prob * 1000) / 1000,
    action: analysis.direction,
    offset_factor: Math.round(offset_factor * 1000) / 1000,
    expiry_minutes,
    confidence: analysis.confidence,
    reasoning: analysis.reasoning,
  };
}

// OpenAI APIを使用したAI予測
async function calculateSignalWithAI(req: TradeRequest): Promise<TradeResponse> {
  const { symbol, timeframe, rsi, atr, price, ea_suggestion } = req;
  const dir = ea_suggestion.dir;
  const reason = ea_suggestion.reason;
  const ichimoku_score = ea_suggestion.ichimoku_score;
  
  // ⭐⭐⭐ Step 2 + Step 4: ML学習済みパターンと過去実績の詳細取得 ⭐⭐⭐
  
  // 1. ML学習済みパターンをTOP3まで取得
  const { data: matchedPatterns } = await supabase
    .from("ml_patterns")
    .select("*")
    .eq("symbol", symbol)
    .eq("timeframe", timeframe)
    .eq("direction", dir)
    .eq("is_active", true)
    .gte("rsi_max", rsi)
    .lte("rsi_min", rsi)
    .gte("total_trades", 5) // 最低サンプル数
    .order("confidence_score", { ascending: false })
    .limit(3);
  
  // 2. ML推奨事項を取得
  const { data: recommendations } = await supabase
    .from("ml_recommendations")
    .select("*")
    .eq("status", "active")
    .order("priority", { ascending: true })
    .limit(3);
  
  // 3. 過去の類似トレードを取得（成功事例と失敗事例）
  const { data: historicalTrades } = await supabase
    .from("ai_signals")
    .select("*")
    .eq("symbol", symbol)
    .eq("timeframe", timeframe)
    .eq("dir", dir)
    .not("actual_result", "is", null)
    .in("actual_result", ["WIN", "LOSS"])
    .order("created_at", { ascending: false })
    .limit(30);
  
  let mlContext = "";
  let mlWinRateBoost = 0;
  let successCases = "";
  let failureCases = "";
  let recommendationsText = "";
  
  // パターンマッチング結果を整形
  if (matchedPatterns && matchedPatterns.length > 0) {
    mlContext = `\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n📚 ML学習済みパターン検出 (TOP ${matchedPatterns.length})\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;
    
    matchedPatterns.forEach((pattern: any, index: number) => {
      mlContext += `\n\n【パターン${index + 1}】${pattern.pattern_name}`;
      mlContext += `\n• 過去勝率: ${(pattern.win_rate * 100).toFixed(1)}% (${pattern.win_count}勝 ${pattern.loss_count}敗 / 全${pattern.total_trades}件)`;
      mlContext += `\n• 平均利益: +${pattern.avg_profit.toFixed(0)}, 平均損失: -${pattern.avg_loss.toFixed(0)}`;
      mlContext += `\n• プロフィットファクター: ${pattern.profit_factor.toFixed(2)}`;
      mlContext += `\n• 信頼度スコア: ${(pattern.confidence_score * 100).toFixed(1)}%`;
      mlContext += `\n• サンプル数: ${pattern.sample_size_adequate ? "✅ 十分" : "⚠️ 不足"}`;
      
      // 最も信頼できるパターンで勝率調整
      if (index === 0) {
        if (pattern.win_rate >= 0.75 && pattern.sample_size_adequate) {
          mlWinRateBoost = +0.08; // 高勝率パターン（強化）
        } else if (pattern.win_rate >= 0.65 && pattern.sample_size_adequate) {
          mlWinRateBoost = +0.03; // 中程度の勝率
        } else if (pattern.win_rate < 0.50 && pattern.sample_size_adequate) {
          mlWinRateBoost = -0.12; // 低勝率パターン（強く抑制）
        } else if (pattern.win_rate < 0.45) {
          mlWinRateBoost = -0.18; // 極めて低い勝率（非常に強く抑制）
        }
      }
    });
    
    mlContext += `\n\n⚡ ML学習の重要性: このパターンは実際の取引データに基づいています。過去勝率を最重視してください。`;
    
    console.log(`[AI] ML Pattern matched: ${matchedPatterns[0].pattern_name}, win_rate=${matchedPatterns[0].win_rate}, boost=${mlWinRateBoost}`);
  }
  
  // 過去の成功事例を抽出
  if (historicalTrades && historicalTrades.length > 0) {
    const winTrades = historicalTrades.filter((t: any) => t.actual_result === "WIN");
    const lossTrades = historicalTrades.filter((t: any) => t.actual_result === "LOSS");
    
    if (winTrades.length > 0) {
      successCases = `\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n✅ 過去の成功事例 (直近${Math.min(winTrades.length, 3)}件)\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;
      
      winTrades.slice(0, 3).forEach((trade: any, index: number) => {
        const createdDate = new Date(trade.created_at);
        successCases += `\n\n【成功${index + 1}】${createdDate.toLocaleString('ja-JP', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}`;
        successCases += `\n• RSI: ${trade.rsi?.toFixed(1) || "N/A"}, ATR: ${trade.atr?.toFixed(5) || "N/A"}`;
        successCases += `\n• 理由: ${trade.reason || "N/A"}`;
        successCases += `\n• AI予測勝率: ${(trade.win_prob * 100).toFixed(0)}%`;
        successCases += `\n• 結果: WIN 🎯 (利益: +${trade.profit_loss?.toFixed(0) || "N/A"})`;
        if (trade.tp_hit) successCases += ` ← TP到達`;
        if (trade.hold_duration_minutes) successCases += `\n• 保有時間: ${trade.hold_duration_minutes}分`;
      });
      
      successCases += `\n\n💡 成功の共通点を分析し、現在の条件と照らし合わせてください。`;
    }
    
    if (lossTrades.length > 0) {
      failureCases = `\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n❌ 過去の失敗事例 (直近${Math.min(lossTrades.length, 3)}件)\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;
      
      lossTrades.slice(0, 3).forEach((trade: any, index: number) => {
        const createdDate = new Date(trade.created_at);
        failureCases += `\n\n【失敗${index + 1}】${createdDate.toLocaleString('ja-JP', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}`;
        failureCases += `\n• RSI: ${trade.rsi?.toFixed(1) || "N/A"}, ATR: ${trade.atr?.toFixed(5) || "N/A"}`;
        failureCases += `\n• 理由: ${trade.reason || "N/A"}`;
        failureCases += `\n• AI予測勝率: ${(trade.win_prob * 100).toFixed(0)}%`;
        failureCases += `\n• 結果: LOSS 💥 (損失: ${trade.profit_loss?.toFixed(0) || "N/A"})`;
        if (trade.sl_hit) failureCases += ` ← SL損切り`;
        if (trade.hold_duration_minutes) failureCases += `\n• 保有時間: ${trade.hold_duration_minutes}分`;
      });
      
      failureCases += `\n\n⚠️ 失敗の共通点: これらと類似条件では勝率を下げるべきです。`;
    }
    
    // 全体の勝率統計
    const totalWins = winTrades.length;
    const totalLosses = lossTrades.length;
    const totalTrades = totalWins + totalLosses;
    const overallWinRate = totalTrades > 0 ? (totalWins / totalTrades * 100).toFixed(1) : "N/A";
    
    successCases += `\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n📊 直近30件の統計\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;
    successCases += `\n• WIN: ${totalWins}件, LOSS: ${totalLosses}件`;
    successCases += `\n• 勝率: ${overallWinRate}%`;
    successCases += totalTrades > 0 ? `\n• トレンド: ${parseFloat(overallWinRate) >= 60 ? "📈 好調" : parseFloat(overallWinRate) >= 50 ? "➡️ 普通" : "📉 不調"}` : "";
  }
  
  // ML推奨事項を整形
  if (recommendations && recommendations.length > 0) {
    recommendationsText = `\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n💡 ML推奨事項 (アクティブ)\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;
    
    recommendations.forEach((rec: any, index: number) => {
      const icon = rec.recommendation_type === "favor_pattern" ? "✅" : 
                   rec.recommendation_type === "avoid_pattern" ? "⚠️" : "ℹ️";
      const priority = rec.priority === "high" ? "🔴 高" : 
                       rec.priority === "medium" ? "🟡 中" : "⚫ 低";
      
      recommendationsText += `\n\n【推奨${index + 1}】${icon} ${rec.title}`;
      recommendationsText += `\n• 優先度: ${priority}`;
      recommendationsText += `\n• 内容: ${rec.description}`;
      if (rec.expected_win_rate_improvement) {
        recommendationsText += `\n• 期待勝率改善: ${rec.expected_win_rate_improvement > 0 ? "+" : ""}${(rec.expected_win_rate_improvement * 100).toFixed(0)}%`;
      }
    });
    
    recommendationsText += `\n\n⚡ これらの推奨事項を勝率予測に反映してください。`;
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
${mlContext}
${successCases}
${failureCases}
${recommendationsText}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🎯 勝率予測ガイドライン（重要度順）
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. **ML学習パターンを最優先** ⭐⭐⭐
   - ML学習パターンが検出された場合、その過去勝率を最重視
   - サンプル数が多く信頼度スコアが高いほど信頼性UP
   - プロフィットファクター > 2.0 なら更に信頼度UP
   
2. **過去の成功/失敗事例を分析** ⭐⭐⭐
   - 成功事例と類似条件 → 勝率を上げる (+5～15%)
   - 失敗事例と類似条件 → 勝率を下げる (-10～20%)
   - RSI、ATR、理由(reason)の類似性を確認
   - 直近の失敗が多い場合は慎重に判断

3. **ML推奨事項に従う** ⭐⭐
   - favor_pattern → 積極的に勝率を上げる
   - avoid_pattern → 慎重に、勝率を下げる
   - 優先度が高いほど強く反映

4. **一目均衡表スコアを考慮** ⭐⭐
   - excellent (0.9+): 基準勝率 75%～85%
   - good (0.6-0.9): 基準勝率 65%～75%
   - moderate (0.4-0.6): 基準勝率 55%～65%
   - weak (0.0-0.4): 基準勝率 50%～60%
   - conflicting (0.0): 基準勝率 40%～50% ⚠️ エントリー非推奨

5. **RSIとの相乗効果** ⭐
   - RSI 70超 + 売り方向 → +3～7%
   - RSI 30未満 + 買い方向 → +3～7%
   - RSI逆行（RSI高で買い等） → -5～10%

6. **ATRによる調整** ⭐
   - 高ボラティリティ（0.001超）→ +2～5%
   - 低ボラティリティ（0.0005未満）→ -3～5%

7. **最終調整**
   - 複数のポジティブ要因 → confidence: "high"
   - 混在 → confidence: "medium"
   - ネガティブ要因が多い → confidence: "low"
   - **勝率範囲: 0.40～0.90**（過信を防ぐため上限引き下げ）

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📋 回答形式（JSON）
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
以下のJSON形式で回答してください:
{
  "win_prob": 0.XX,  // 0.40～0.90の範囲で設定（過去の実績を重視、楽観的予測は禁止）
  "confidence": "high" | "medium" | "low",  // 不確実性が高い場合は必ず "low"
  "reasoning": "ML学習結果と過去の成功/失敗事例を踏まえた判断理由（1行、40文字以内）"
}

重要な注意事項:
• 過去の失敗事例と類似する状況では勝率を40-50%に抑える
• MLパターンの勝率が60%未満なら楽観的予測は避ける
• 成功事例が少ない場合は confidence を "low" に設定
• reasoning には必ず「ML: XX%」または「過去: 成功3件/失敗2件」等の実績データを含める`;

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,  // 環境変数で設定可能 (デフォルト: gpt-4o-mini)
        messages: [
          { 
            role: "system", 
            content: `あなたはプロの金融トレーダーです。以下の優先順位で分析してください:

⭐⭐⭐ 最優先: ML学習済みパターンの実績データ（勝率、利益率、サンプル数）
⭐⭐⭐ 最優先: 過去の成功・失敗事例から学ぶ（同じ失敗を繰り返さない）
⭐⭐ 重要: ML推奨事項（favor/avoid）に従う
⭐ 参考: テクニカル指標（一目均衡表、RSI、ATR）

重要な判断基準:
• 過去の失敗事例と類似する場合は勝率を大幅に下げる（-20%以上）
• ML学習済みパターンの勝率が50%未満の場合は慎重に（40-50%範囲で予測）
• 成功事例が多く、MLパターンも良好な場合のみ高勝率（70-85%）
• 不確実性が高い場合は必ず "low" confidence を設定

JSON形式で簡潔に回答してください。過度に楽観的な予測は避け、実績データを最重視してください。` 
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
    
    // ⭐ ML学習結果に基づく勝率調整を適用
    if (mlWinRateBoost !== 0) {
      const originalProb = win_prob;
      win_prob = win_prob + mlWinRateBoost;
      console.log(`[AI] ML adjustment applied: ${originalProb.toFixed(3)} → ${win_prob.toFixed(3)} (boost: ${mlWinRateBoost.toFixed(3)})`);
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
    
    // v1.4.0 新構造のバリデーション
    const required = ["symbol", "timeframe", "price", "rsi", "atr"];
    for (const field of required) {
      if (!(field in body)) {
        return new Response(
          JSON.stringify({ error: `Missing: ${field}` }),
          { status: 400, headers: corsHeaders() }
        );
      }
    }
    
    // ea_suggestionの存在確認
    if (!body.ea_suggestion || typeof body.ea_suggestion !== 'object') {
      return new Response(
        JSON.stringify({ error: "Missing: ea_suggestion" }),
        { status: 400, headers: corsHeaders() }
      );
    }
    
    if (!("dir" in body.ea_suggestion)) {
      return new Response(
        JSON.stringify({ error: "Missing: ea_suggestion.dir" }),
        { status: 400, headers: corsHeaders() }
      );
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
    const ichimokuInfo = tradeReq.ea_suggestion.ichimoku_score !== undefined 
      ? ` ichimoku=${tradeReq.ea_suggestion.ichimoku_score.toFixed(2)}` 
      : "";
    
    console.log(
      `[ai-trader] 📊 RESULT: ${tradeReq.symbol} ${tradeReq.timeframe} ` +
      `dir=${tradeReq.ea_suggestion.dir} win=${response.win_prob.toFixed(3)}${ichimokuInfo} ` +
      `reason="${tradeReq.ea_suggestion.reason}" method=${predictionMethod}`
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
