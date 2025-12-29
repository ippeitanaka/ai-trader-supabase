import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Content-Type": "application/json",
  };
}

interface TrainingResult {
  status: string;
  duration_ms: number;
  total_signals: number;
  complete_trades: number;
  patterns_discovered: number;
  patterns_updated: number;
  overall_win_rate: number;
  insights: any[];
  recommendations: any[];
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// パターン抽出ロジック
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

interface Pattern {
  pattern_name: string;
  pattern_type: string;
  symbol: string;
  timeframe: string;
  direction: number;
  rsi_min: number;
  rsi_max: number;
  adx_bucket?: string | null;
  bb_width_bucket?: string | null;
  atr_norm_bucket?: string | null;
  atr_min?: number;
  atr_max?: number;
  ichimoku_score_min?: number;
  ichimoku_score_max?: number;
  total_trades: number;
  real_trades: number;
  virtual_trades: number;
  effective_trades: number;
  win_count: number;
  loss_count: number;
  win_rate: number;
  avg_profit: number;
  avg_loss: number;
  profit_factor: number;
  confidence_score: number;
  sample_size_adequate: boolean;
}

// Virtual (paper/shadow) trades contribute to learning but with lower weight.
// This prevents ML from overfitting to simulated outcomes while still reducing blind spots.
const VIRTUAL_TRADE_WEIGHT = 0.25;

// RSIレンジを定義
const RSI_RANGES = [
  { name: "oversold", min: 0, max: 30 },
  { name: "neutral_low", min: 30, max: 45 },
  { name: "neutral", min: 45, max: 55 },
  { name: "neutral_high", min: 55, max: 70 },
  { name: "overbought", min: 70, max: 100 },
];

// MACDクロス状態
const MACD_CROSS_STATES = [
  { name: "bullish", value: 1 },
  { name: "bearish", value: -1 },
];

// 一目均衡表TKクロス状態
const ICHIMOKU_TK_CROSS_STATES = [
  { name: "bullish_tk", value: 1 },
  { name: "bearish_tk", value: -1 },
];

// 一目均衡表雲の状態
const ICHIMOKU_CLOUD_STATES = [
  { name: "bullish_cloud", value: 1 },
  { name: "bearish_cloud", value: -1 },
];

// 移動平均クロス状態
const MA_CROSS_STATES = [
  { name: "bullish_ma", value: 1 },
  { name: "bearish_ma", value: -1 },
];

// 一目均衡表スコア範囲
const ICHIMOKU_RANGES = [
  { name: "excellent", min: 0.9, max: 1.0 },   // MA+一目の両方が一致
  { name: "good", min: 0.6, max: 0.9 },        // 一目単独
  { name: "moderate", min: 0.4, max: 0.6 },    // MA単独
];

function bucketAdx(v: number | null | undefined): string | null {
  if (typeof v !== "number" || !isFinite(v)) return null;
  if (v < 15) return "low";
  if (v < 25) return "mid";
  return "high";
}

function bucketBbWidth(v: number | null | undefined): string | null {
  if (typeof v !== "number" || !isFinite(v)) return null;
  if (v < 0.003) return "squeeze";
  if (v < 0.008) return "normal";
  return "wide";
}

function bucketAtrNorm(v: number | null | undefined): string | null {
  if (typeof v !== "number" || !isFinite(v)) return null;
  if (v < 0.0005) return "low";
  if (v < 0.0012) return "mid";
  return "high";
}

async function extractPatterns(): Promise<Pattern[]> {
  console.log("[ML] Starting pattern extraction...");
  
  // 完結した取引データを取得（ビューではなく直接テーブルをクエリ）
  const { data: completeTrades, error } = await supabase
    .from("ai_signals")
    .select("*")
    .in("actual_result", ["WIN", "LOSS"])
    .not("closed_at", "is", null)
    .order("created_at", { ascending: false });
  
  if (error || !completeTrades || completeTrades.length === 0) {
    console.error("[ML] Failed to fetch complete trades:", error);
    return [];
  }
  
  console.log(`[ML] Analyzing ${completeTrades.length} complete trades...`);
  
  const patterns: Pattern[] = [];
  
  // 銘柄・時間軸・方向ごとにグループ化
  const groupedTrades = new Map<string, any[]>();
  
  for (const trade of completeTrades) {
    const key = `${trade.symbol}_${trade.timeframe}_${trade.dir}`;
    if (!groupedTrades.has(key)) {
      groupedTrades.set(key, []);
    }
    groupedTrades.get(key)!.push(trade);
  }
  
  console.log(`[ML] Found ${groupedTrades.size} unique trading groups`);
  
  // 各グループでパターンを抽出
  for (const [groupKey, trades] of groupedTrades.entries()) {
    const [symbol, timeframe, dirStr] = groupKey.split("_");
    const direction = parseInt(dirStr);
    
    if (trades.length < 3) {
      console.log(`[ML] Skipping ${groupKey}: insufficient trades (${trades.length})`);
      continue;
    }
    
    // RSI範囲ごとにパターンを抽出
    for (const rsiRange of RSI_RANGES) {
      const matchingTrades = trades.filter(
        (t) => t.rsi >= rsiRange.min && t.rsi < rsiRange.max
      );
      
      if (matchingTrades.length < 3) continue;

      // レジーム特徴量（ADX/BB幅/正規化ATR）で細分化
      const bucketGroups = new Map<string, { adx: string | null; bb: string | null; atrn: string | null; rows: any[] }>();
      for (const t of matchingTrades) {
        const adxB = bucketAdx(t.adx);
        const bbB = bucketBbWidth(t.bb_width);
        const atrnB = bucketAtrNorm(t.atr_norm);
        const key = `${adxB ?? "na"}|${bbB ?? "na"}|${atrnB ?? "na"}`;
        if (!bucketGroups.has(key)) {
          bucketGroups.set(key, { adx: adxB, bb: bbB, atrn: atrnB, rows: [] });
        }
        bucketGroups.get(key)!.rows.push(t);
      }

      for (const g of bucketGroups.values()) {
        const rows = g.rows;
        if (rows.length < 3) continue;
      
        const realTrades = rows.filter((t) => !t.is_virtual);
        const virtualTrades = rows.filter((t) => !!t.is_virtual);

        const winCount = rows.filter((t) => t.actual_result === "WIN").length;
        const lossCount = rows.filter((t) => t.actual_result === "LOSS").length;

        const weightedWins = rows
          .filter((t) => t.actual_result === "WIN")
          .reduce((sum, t) => sum + (t.is_virtual ? VIRTUAL_TRADE_WEIGHT : 1), 0);
        const weightedLosses = rows
          .filter((t) => t.actual_result === "LOSS")
          .reduce((sum, t) => sum + (t.is_virtual ? VIRTUAL_TRADE_WEIGHT : 1), 0);
        const totalWeight = weightedWins + weightedLosses;
        const winRate = totalWeight > 0 ? (weightedWins / totalWeight) : 0;
        
        // Profit/Loss statistics should be computed from REAL trades only.
        // Virtual trades are useful for label coverage, but mixing scales (money vs normalized) harms PF.
        const profits = realTrades
          .filter((t) => t.actual_result === "WIN")
          .map((t) => t.profit_loss || 0);
        const losses = realTrades
          .filter((t) => t.actual_result === "LOSS")
          .map((t) => Math.abs(t.profit_loss || 0));
        
        const avgProfit = profits.length > 0 ? profits.reduce((a, b) => a + b, 0) / profits.length : 0;
        const avgLoss = losses.length > 0 ? losses.reduce((a, b) => a + b, 0) / losses.length : 0;
        const profitFactor = avgLoss > 0 ? avgProfit / avgLoss : 0;
        
        // 信頼度スコア計算
        const effectiveTrades = realTrades.length + virtualTrades.length * VIRTUAL_TRADE_WEIGHT;
        const sampleSizeScore = Math.min(effectiveTrades / 10, 1); // 10件相当で満点
        const winRateScore = winRate;
        const profitFactorScore = Math.min(profitFactor / 2, 1); // 2.0以上で満点
        const confidenceScore = (sampleSizeScore * 0.3 + winRateScore * 0.5 + profitFactorScore * 0.2);
      
      patterns.push({
        pattern_name: `${symbol}_${timeframe}_${direction > 0 ? "BUY" : "SELL"}_RSI_${rsiRange.name}_ADX_${g.adx ?? "na"}_BB_${g.bb ?? "na"}_ATRn_${g.atrn ?? "na"}`,
        pattern_type: "technical",
        symbol,
        timeframe,
        direction,
        rsi_min: rsiRange.min,
        rsi_max: rsiRange.max,
        adx_bucket: g.adx,
        bb_width_bucket: g.bb,
        atr_norm_bucket: g.atrn,
        total_trades: rows.length,
        real_trades: realTrades.length,
        virtual_trades: virtualTrades.length,
        effective_trades: Math.round(effectiveTrades * 100) / 100,
        win_count: winCount,
        loss_count: lossCount,
        win_rate: Math.round(winRate * 1000) / 1000,
        avg_profit: Math.round(avgProfit * 100) / 100,
        avg_loss: Math.round(avgLoss * 100) / 100,
        profit_factor: Math.round(profitFactor * 100) / 100,
        confidence_score: Math.round(confidenceScore * 1000) / 1000,
        sample_size_adequate: realTrades.length >= 5,
      });
      }
    }
    
    // 一目均衡表スコア範囲ごとにパターンを抽出（v1.3.0以降のデータ）
    const tradesWithIchimoku = trades.filter(
      (t) => t.reason && t.reason.includes("一目")
    );
    
    if (tradesWithIchimoku.length >= 3) {
      for (const ichRange of ICHIMOKU_RANGES) {
        // 一目スコアは直接保存されていないため、reasonからヒューリスティックに推定
        let matchingTrades: any[] = [];
        
        if (ichRange.name === "excellent" && tradesWithIchimoku.some(t => t.reason.includes("一目"))) {
          // "MA↑+一目買" のようなパターン = excellent
          matchingTrades = tradesWithIchimoku.filter(
            (t) => t.reason.includes("MA") && t.reason.includes("一目")
          );
        } else if (ichRange.name === "good" || ichRange.name === "moderate") {
          matchingTrades = tradesWithIchimoku;
        }
        
        if (matchingTrades.length < 3) continue;
        
        const realTrades = matchingTrades.filter((t) => !t.is_virtual);
        const virtualTrades = matchingTrades.filter((t) => !!t.is_virtual);

        const winCount = matchingTrades.filter((t) => t.actual_result === "WIN").length;
        const lossCount = matchingTrades.filter((t) => t.actual_result === "LOSS").length;

        const weightedWins = matchingTrades
          .filter((t) => t.actual_result === "WIN")
          .reduce((sum, t) => sum + (t.is_virtual ? VIRTUAL_TRADE_WEIGHT : 1), 0);
        const weightedLosses = matchingTrades
          .filter((t) => t.actual_result === "LOSS")
          .reduce((sum, t) => sum + (t.is_virtual ? VIRTUAL_TRADE_WEIGHT : 1), 0);
        const totalWeight = weightedWins + weightedLosses;
        const winRate = totalWeight > 0 ? (weightedWins / totalWeight) : 0;
        
        const profits = realTrades
          .filter((t) => t.actual_result === "WIN")
          .map((t) => t.profit_loss || 0);
        const losses = realTrades
          .filter((t) => t.actual_result === "LOSS")
          .map((t) => Math.abs(t.profit_loss || 0));
        
        const avgProfit = profits.length > 0 ? profits.reduce((a, b) => a + b, 0) / profits.length : 0;
        const avgLoss = losses.length > 0 ? losses.reduce((a, b) => a + b, 0) / losses.length : 0;
        const profitFactor = avgLoss > 0 ? avgProfit / avgLoss : 0;
        
        const effectiveTrades = realTrades.length + virtualTrades.length * VIRTUAL_TRADE_WEIGHT;
        const sampleSizeScore = Math.min(effectiveTrades / 10, 1);
        const winRateScore = winRate;
        const profitFactorScore = Math.min(profitFactor / 2, 1);
        const confidenceScore = (sampleSizeScore * 0.3 + winRateScore * 0.5 + profitFactorScore * 0.2);
        
        patterns.push({
          pattern_name: `${symbol}_${timeframe}_${direction > 0 ? "BUY" : "SELL"}_ICHIMOKU_${ichRange.name}`,
          pattern_type: "ichimoku",
          symbol,
          timeframe,
          direction,
          rsi_min: 0,
          rsi_max: 100,
          ichimoku_score_min: ichRange.min,
          ichimoku_score_max: ichRange.max,
          total_trades: matchingTrades.length,
          real_trades: realTrades.length,
          virtual_trades: virtualTrades.length,
          effective_trades: Math.round(effectiveTrades * 100) / 100,
          win_count: winCount,
          loss_count: lossCount,
          win_rate: Math.round(winRate * 1000) / 1000,
          avg_profit: Math.round(avgProfit * 100) / 100,
          avg_loss: Math.round(avgLoss * 100) / 100,
          profit_factor: Math.round(profitFactor * 100) / 100,
          confidence_score: Math.round(confidenceScore * 1000) / 1000,
          sample_size_adequate: realTrades.length >= 5,
        });
      }
    }
  }
  
  console.log(`[ML] Extracted ${patterns.length} basic patterns`);
  
  // 複合パターン発見（MACD x RSI, 一目 x RSI, MA x RSI など）
  const compositePatterns = await extractCompositePatterns(completeTrades);
  patterns.push(...compositePatterns);
  
  console.log(`[ML] Total patterns (including composite): ${patterns.length}`);
  return patterns;
}

// 複合パターン発見関数
async function extractCompositePatterns(completeTrades: any[]): Promise<Pattern[]> {
  const patterns: Pattern[] = [];
  
  console.log(`[ML] Extracting composite patterns from ${completeTrades.length} trades...`);
  
  // 銘柄・時間軸・方向ごとにグループ化
  const groupedTrades = new Map<string, any[]>();
  
  for (const trade of completeTrades) {
    const key = `${trade.symbol}_${trade.timeframe}_${trade.dir}`;
    if (!groupedTrades.has(key)) {
      groupedTrades.set(key, []);
    }
    groupedTrades.get(key)!.push(trade);
  }
  
  for (const [groupKey, trades] of groupedTrades.entries()) {
    const [symbol, timeframe, dirStr] = groupKey.split("_");
    const direction = parseInt(dirStr);
    
    if (trades.length < 5) continue; // 複合パターンは最低5件必要
    
    // 1. MACDクロス x RSI パターン
    for (const macdState of MACD_CROSS_STATES) {
      for (const rsiRange of RSI_RANGES) {
        const matchingTrades = trades.filter(
          (t) => t.macd_cross === macdState.value &&
                 t.rsi >= rsiRange.min && t.rsi < rsiRange.max
        );
        
        if (matchingTrades.length >= 3) {
          const pattern = calculatePatternStats(
            matchingTrades,
            `${symbol}_${timeframe}_${direction > 0 ? "BUY" : "SELL"}_MACD_${macdState.name}_RSI_${rsiRange.name}`,
            "composite_macd_rsi",
            symbol,
            timeframe,
            direction,
            rsiRange.min,
            rsiRange.max
          );
          if (pattern) patterns.push(pattern);
        }
      }
    }
    
    // 2. 一目TKクロス x RSI パターン
    for (const ichimokuTK of ICHIMOKU_TK_CROSS_STATES) {
      for (const rsiRange of RSI_RANGES) {
        const matchingTrades = trades.filter(
          (t) => t.ichimoku_tk_cross === ichimokuTK.value &&
                 t.rsi >= rsiRange.min && t.rsi < rsiRange.max
        );
        
        if (matchingTrades.length >= 3) {
          const pattern = calculatePatternStats(
            matchingTrades,
            `${symbol}_${timeframe}_${direction > 0 ? "BUY" : "SELL"}_ICHIMOKU_TK_${ichimokuTK.name}_RSI_${rsiRange.name}`,
            "composite_ichimoku_rsi",
            symbol,
            timeframe,
            direction,
            rsiRange.min,
            rsiRange.max
          );
          if (pattern) patterns.push(pattern);
        }
      }
    }
    
    // 3. 一目雲 x MACDクロス パターン
    for (const cloudState of ICHIMOKU_CLOUD_STATES) {
      for (const macdState of MACD_CROSS_STATES) {
        const matchingTrades = trades.filter(
          (t) => t.ichimoku_cloud_color === cloudState.value &&
                 t.macd_cross === macdState.value
        );
        
        if (matchingTrades.length >= 3) {
          const pattern = calculatePatternStats(
            matchingTrades,
            `${symbol}_${timeframe}_${direction > 0 ? "BUY" : "SELL"}_CLOUD_${cloudState.name}_MACD_${macdState.name}`,
            "composite_ichimoku_macd",
            symbol,
            timeframe,
            direction,
            0,
            100
          );
          if (pattern) patterns.push(pattern);
        }
      }
    }
    
    // 4. 移動平均クロス x RSI パターン
    for (const maState of MA_CROSS_STATES) {
      for (const rsiRange of RSI_RANGES) {
        const matchingTrades = trades.filter(
          (t) => t.ma_cross === maState.value &&
                 t.rsi >= rsiRange.min && t.rsi < rsiRange.max
        );
        
        if (matchingTrades.length >= 3) {
          const pattern = calculatePatternStats(
            matchingTrades,
            `${symbol}_${timeframe}_${direction > 0 ? "BUY" : "SELL"}_MA_${maState.name}_RSI_${rsiRange.name}`,
            "composite_ma_rsi",
            symbol,
            timeframe,
            direction,
            rsiRange.min,
            rsiRange.max
          );
          if (pattern) patterns.push(pattern);
        }
      }
    }
    
    // 5. トリプル確認パターン（MACD + 一目 + MA）
    for (const macdState of MACD_CROSS_STATES) {
      for (const ichimokuTK of ICHIMOKU_TK_CROSS_STATES) {
        for (const maState of MA_CROSS_STATES) {
          const matchingTrades = trades.filter(
            (t) => t.macd_cross === macdState.value &&
                   t.ichimoku_tk_cross === ichimokuTK.value &&
                   t.ma_cross === maState.value
          );
          
          if (matchingTrades.length >= 3) {
            const pattern = calculatePatternStats(
              matchingTrades,
              `${symbol}_${timeframe}_${direction > 0 ? "BUY" : "SELL"}_TRIPLE_${macdState.name}_${ichimokuTK.name}_${maState.name}`,
              "composite_triple_confirm",
              symbol,
              timeframe,
              direction,
              0,
              100
            );
            if (pattern) patterns.push(pattern);
          }
        }
      }
    }
  }
  
  console.log(`[ML] Extracted ${patterns.length} composite patterns`);
  return patterns;
}

// パターン統計計算ヘルパー関数
function calculatePatternStats(
  matchingTrades: any[],
  patternName: string,
  patternType: string,
  symbol: string,
  timeframe: string,
  direction: number,
  rsiMin: number,
  rsiMax: number
): Pattern | null {
  if (matchingTrades.length < 3) return null;
  
  const realTrades = matchingTrades.filter((t) => !t.is_virtual);
  const virtualTrades = matchingTrades.filter((t) => !!t.is_virtual);

  const winCount = matchingTrades.filter((t) => t.actual_result === "WIN").length;
  const lossCount = matchingTrades.filter((t) => t.actual_result === "LOSS").length;

  const weightedWins = matchingTrades
    .filter((t) => t.actual_result === "WIN")
    .reduce((sum, t) => sum + (t.is_virtual ? VIRTUAL_TRADE_WEIGHT : 1), 0);
  const weightedLosses = matchingTrades
    .filter((t) => t.actual_result === "LOSS")
    .reduce((sum, t) => sum + (t.is_virtual ? VIRTUAL_TRADE_WEIGHT : 1), 0);
  const totalWeight = weightedWins + weightedLosses;
  const winRate = totalWeight > 0 ? (weightedWins / totalWeight) : 0;
  
  const profits = realTrades
    .filter((t) => t.actual_result === "WIN")
    .map((t) => t.profit_loss || 0);
  const losses = realTrades
    .filter((t) => t.actual_result === "LOSS")
    .map((t) => Math.abs(t.profit_loss || 0));
  
  const avgProfit = profits.length > 0 ? profits.reduce((a, b) => a + b, 0) / profits.length : 0;
  const avgLoss = losses.length > 0 ? losses.reduce((a, b) => a + b, 0) / losses.length : 0;
  const profitFactor = avgLoss > 0 ? avgProfit / avgLoss : 0;
  
  // 信頼度スコア計算（複合パターンは要求基準を高める）
  const effectiveTrades = realTrades.length + virtualTrades.length * VIRTUAL_TRADE_WEIGHT;
  const sampleSizeScore = Math.min(effectiveTrades / 15, 1); // 15件相当で満点
  const winRateScore = winRate;
  const profitFactorScore = Math.min(profitFactor / 2.5, 1); // 2.5以上で満点
  const confidenceScore = (sampleSizeScore * 0.3 + winRateScore * 0.5 + profitFactorScore * 0.2);
  
  return {
    pattern_name: patternName,
    pattern_type: patternType,
    symbol,
    timeframe,
    direction,
    rsi_min: rsiMin,
    rsi_max: rsiMax,
    total_trades: matchingTrades.length,
    real_trades: realTrades.length,
    virtual_trades: virtualTrades.length,
    effective_trades: Math.round(effectiveTrades * 100) / 100,
    win_count: winCount,
    loss_count: lossCount,
    win_rate: Math.round(winRate * 1000) / 1000,
    avg_profit: Math.round(avgProfit * 100) / 100,
    avg_loss: Math.round(avgLoss * 100) / 100,
    profit_factor: Math.round(profitFactor * 100) / 100,
    confidence_score: Math.round(confidenceScore * 1000) / 1000,
    sample_size_adequate: realTrades.length >= 5,
  };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// パターンの保存・更新
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function savePatterns(patterns: Pattern[]): Promise<{ discovered: number; updated: number }> {
  let discovered = 0;
  let updated = 0;
  
  for (const pattern of patterns) {
    // 既存パターンをチェック
    const { data: existing } = await supabase
      .from("ml_patterns")
      .select("id, total_trades")
      .eq("pattern_name", pattern.pattern_name)
      .single();
    
    if (existing) {
      // 更新
      const { error } = await supabase
        .from("ml_patterns")
        .update({
          ...pattern,
          updated_at: new Date().toISOString(),
        })
        .eq("id", existing.id);
      
      if (!error) updated++;
    } else {
      // 新規作成
      const { error } = await supabase
        .from("ml_patterns")
        .insert(pattern);
      
      if (!error) discovered++;
    }
  }
  
  console.log(`[ML] Saved patterns: ${discovered} new, ${updated} updated`);
  return { discovered, updated };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// インサイトと推奨事項の生成
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function generateInsights(patterns: Pattern[]) {
  const insights = [];
  const recommendations = [];
  
  // 1. 最も勝率の高いパターン
  const sortedByWinRate = [...patterns].sort((a, b) => b.win_rate - a.win_rate);
  const bestPattern = sortedByWinRate[0];
  
  if (bestPattern && bestPattern.win_rate >= 0.70 && bestPattern.sample_size_adequate) {
    insights.push({
      type: "best_pattern",
      title: `最高勝率パターン: ${bestPattern.pattern_name}`,
      win_rate: bestPattern.win_rate,
      trades: bestPattern.total_trades,
      profit_factor: bestPattern.profit_factor,
    });
    
    recommendations.push({
      recommendation_type: "favor_pattern",
      priority: "high",
      title: `${bestPattern.symbol} ${bestPattern.direction > 0 ? "買い" : "売り"}を積極的に`,
      description: `RSI ${bestPattern.rsi_min}-${bestPattern.rsi_max}の範囲で勝率${(bestPattern.win_rate * 100).toFixed(1)}%を記録。`,
      based_on_pattern_id: null, // 後でIDを設定
      supporting_data: {
        pattern_name: bestPattern.pattern_name,
        win_rate: bestPattern.win_rate,
        total_trades: bestPattern.total_trades,
      },
      expected_win_rate_improvement: 0.05,
    });
  }
  
  // 2. 勝率の低いパターン（避けるべき）
  const worstPattern = sortedByWinRate[sortedByWinRate.length - 1];
  
  if (worstPattern && worstPattern.win_rate < 0.45 && worstPattern.sample_size_adequate) {
    insights.push({
      type: "worst_pattern",
      title: `低勝率パターン: ${worstPattern.pattern_name}`,
      win_rate: worstPattern.win_rate,
      trades: worstPattern.total_trades,
    });
    
    recommendations.push({
      recommendation_type: "avoid_pattern",
      priority: "high",
      title: `${worstPattern.symbol} ${worstPattern.direction > 0 ? "買い" : "売り"}は慎重に`,
      description: `RSI ${worstPattern.rsi_min}-${worstPattern.rsi_max}の範囲で勝率${(worstPattern.win_rate * 100).toFixed(1)}%。エントリーを控えることを推奨。`,
      supporting_data: {
        pattern_name: worstPattern.pattern_name,
        win_rate: worstPattern.win_rate,
        total_trades: worstPattern.total_trades,
      },
      expected_win_rate_improvement: 0.10,
    });
  }
  
  // 3. 一目均衡表の有効性分析
  const ichimokuPatterns = patterns.filter((p) => p.pattern_type === "ichimoku");
  if (ichimokuPatterns.length > 0) {
    const avgIchimokuWinRate = ichimokuPatterns.reduce((sum, p) => sum + p.win_rate, 0) / ichimokuPatterns.length;
    const excellentPatterns = ichimokuPatterns.filter(
      (p) => p.pattern_name.includes("excellent") && p.sample_size_adequate
    );
    
    if (excellentPatterns.length > 0) {
      const avgExcellentWinRate = excellentPatterns.reduce((sum, p) => sum + p.win_rate, 0) / excellentPatterns.length;
      
      insights.push({
        type: "ichimoku_effectiveness",
        title: "一目均衡表の有効性",
        avg_win_rate: avgIchimokuWinRate,
        excellent_win_rate: avgExcellentWinRate,
        pattern_count: ichimokuPatterns.length,
      });
      
      if (avgExcellentWinRate >= 0.75) {
        recommendations.push({
          recommendation_type: "favor_pattern",
          priority: "medium",
          title: "一目均衡表の最強シグナルを重視",
          description: `MA+一目の完全一致シグナルで平均勝率${(avgExcellentWinRate * 100).toFixed(1)}%を達成。このシグナルを優先すべき。`,
          supporting_data: {
            avg_win_rate: avgExcellentWinRate,
            pattern_count: excellentPatterns.length,
          },
          expected_win_rate_improvement: 0.08,
        });
      }
    }
  }
  
  // 4. 銘柄別のパフォーマンス
  const symbolStats = new Map<string, { total: number; wins: number }>();
  for (const pattern of patterns.filter((p) => p.sample_size_adequate)) {
    const current = symbolStats.get(pattern.symbol) || { total: 0, wins: 0 };
    current.total += pattern.total_trades;
    current.wins += pattern.win_count;
    symbolStats.set(pattern.symbol, current);
  }
  
  for (const [symbol, stats] of symbolStats.entries()) {
    const winRate = stats.wins / stats.total;
    insights.push({
      type: "symbol_performance",
      symbol,
      win_rate: winRate,
      total_trades: stats.total,
    });
  }
  
  return { insights, recommendations };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// メイン学習処理
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function runTraining(triggeredBy: string = "manual"): Promise<TrainingResult> {
  const startTime = Date.now();
  console.log(`[ML] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`[ML] Starting ML training session (triggered by: ${triggeredBy})`);
  console.log(`[ML] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  
  // 1. 全シグナル数を取得
  const { count: totalSignals } = await supabase
    .from("ai_signals")
    .select("*", { count: "exact", head: true });
  
  // 2. 完結した取引数を取得（ビューではなく直接クエリ）
  const { count: completeTrades } = await supabase
    .from("ai_signals")
    .select("*", { count: "exact", head: true })
    .in("actual_result", ["WIN", "LOSS"])
    .not("closed_at", "is", null);
  
  console.log(`[ML] Total signals: ${totalSignals}, Complete trades: ${completeTrades}`);
  
  if (!completeTrades || completeTrades < 5) {
    console.warn(`[ML] Insufficient complete trades (${completeTrades}). Need at least 5.`);
    return {
      status: "insufficient_data",
      duration_ms: Date.now() - startTime,
      total_signals: totalSignals || 0,
      complete_trades: completeTrades || 0,
      patterns_discovered: 0,
      patterns_updated: 0,
      overall_win_rate: 0,
      insights: [],
      recommendations: [],
    };
  }
  
  // 3. パターン抽出
  const patterns = await extractPatterns();
  
  // 4. パターン保存
  const { discovered, updated } = await savePatterns(patterns);
  
  // 5. インサイトと推奨事項の生成
  const { insights, recommendations } = await generateInsights(patterns);
  
  // 6. 全体の勝率計算（ビューではなく直接クエリ）
  const { data: allTrades } = await supabase
    .from("ai_signals")
    .select("actual_result")
    .in("actual_result", ["WIN", "LOSS"])
    .not("closed_at", "is", null);
  
  const overallWinRate = allTrades
    ? allTrades.filter((t) => t.actual_result === "WIN").length / allTrades.length
    : 0;
  
  const bestPattern = patterns.length > 0 
    ? Math.max(...patterns.map((p) => p.win_rate))
    : 0;
  
  const worstPattern = patterns.length > 0
    ? Math.min(...patterns.map((p) => p.win_rate))
    : 0;
  
  // 7. 学習履歴を保存
  const { data: trainingHistory } = await supabase
    .from("ml_training_history")
    .insert({
      training_type: "pattern_extraction",
      duration_ms: Date.now() - startTime,
      total_signals_analyzed: totalSignals || 0,
      complete_trades_count: completeTrades || 0,
      patterns_discovered: discovered,
      patterns_updated: updated,
      overall_win_rate: Math.round(overallWinRate * 1000) / 1000,
      best_pattern_win_rate: Math.round(bestPattern * 1000) / 1000,
      worst_pattern_win_rate: Math.round(worstPattern * 1000) / 1000,
      insights: insights,
      recommendations: recommendations,
      status: "completed",
      version: "1.0.0",
      triggered_by: triggeredBy,
    })
    .select()
    .single();
  
  // 8. 推奨事項を保存
  if (trainingHistory) {
    for (const rec of recommendations) {
      await supabase.from("ml_recommendations").insert({
        ...rec,
        training_history_id: trainingHistory.id,
      });
    }
  }
  
  const duration = Date.now() - startTime;
  console.log(`[ML] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`[ML] Training completed in ${duration}ms`);
  console.log(`[ML] Patterns: ${discovered} new, ${updated} updated`);
  console.log(`[ML] Overall win rate: ${(overallWinRate * 100).toFixed(1)}%`);
  console.log(`[ML] Best pattern: ${(bestPattern * 100).toFixed(1)}%`);
  console.log(`[ML] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  
  return {
    status: "completed",
    duration_ms: duration,
    total_signals: totalSignals || 0,
    complete_trades: completeTrades || 0,
    patterns_discovered: discovered,
    patterns_updated: updated,
    overall_win_rate: Math.round(overallWinRate * 1000) / 1000,
    insights,
    recommendations,
  };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// HTTP Handler
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }
  
  if (req.method === "GET") {
    // ヘルスチェック & 最新の学習状況
    const { data: latestTraining } = await supabase
      .from("ml_training_history")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(1)
      .single();
    
    const { count: activePatterns } = await supabase
      .from("ml_patterns")
      .select("*", { count: "exact", head: true })
      .eq("is_active", true);
    
    const { count: activeRecommendations } = await supabase
      .from("ml_recommendations")
      .select("*", { count: "exact", head: true })
      .eq("status", "active");
    
    return new Response(
      JSON.stringify({
        ok: true,
        service: "ml-training",
        version: "1.0.0",
        active_patterns: activePatterns || 0,
        active_recommendations: activeRecommendations || 0,
        latest_training: latestTraining
          ? {
              date: latestTraining.created_at,
              complete_trades: latestTraining.complete_trades_count,
              patterns_discovered: latestTraining.patterns_discovered,
              overall_win_rate: latestTraining.overall_win_rate,
            }
          : null,
      }),
      { status: 200, headers: corsHeaders() }
    );
  }
  
  if (req.method === "POST") {
    try {
      const body = await req.json();
      const triggeredBy = body.triggered_by || "manual";
      
      const result = await runTraining(triggeredBy);
      
      return new Response(
        JSON.stringify(result),
        { status: 200, headers: corsHeaders() }
      );
    } catch (error) {
      console.error("[ML] Training error:", error);
      
      // エラーを履歴に記録
      await supabase.from("ml_training_history").insert({
        training_type: "pattern_extraction",
        status: "failed",
        error_message: error instanceof Error ? error.message : String(error),
        triggered_by: "manual",
      });
      
      return new Response(
        JSON.stringify({
          error: "Training failed",
          message: error instanceof Error ? error.message : String(error),
        }),
        { status: 500, headers: corsHeaders() }
      );
    }
  }
  
  return new Response(
    JSON.stringify({ error: "Method not allowed" }),
    { status: 405, headers: corsHeaders() }
  );
});
