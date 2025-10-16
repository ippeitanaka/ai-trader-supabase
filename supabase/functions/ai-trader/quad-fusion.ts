// AI判定ロジック - 全テクニカル指標を独自に評価
// v1.4.0: Quad Fusion - 4つの指標を融合してAIが判断

import { TradeRequest, TradeResponse } from "./index.ts";

// 各テクニカル指標のスコアを計算
interface TechnicalScores {
  trend: number;      // トレンドスコア (-1.0 ~ 1.0)
  momentum: number;   // モメンタムスコア (-1.0 ~ 1.0)
  volatility: number; // ボラティリティスコア (0.0 ~ 1.0)
  ichimoku: number;   // 一目スコア (-1.0 ~ 1.0)
}

// 1. トレンドスコア計算（移動平均線 + MACD）
export function calculateTrendScore(req: TradeRequest): number {
  let score = 0;
  
  // MA クロス判定（重要度: 高）
  if (req.ma_cross === 1) {
    // ゴールデンクロス
    score += 0.4;
    
    // 価格がEMA25より上ならさらに強気
    if (req.price > req.ema_25) score += 0.1;
  } else if (req.ma_cross === -1) {
    // デッドクロス
    score -= 0.4;
    
    // 価格がEMA25より下ならさらに弱気
    if (req.price < req.ema_25) score -= 0.1;
  }
  
  // MACD判定（重要度: 中）
  if (req.macd.cross === 1) {
    // MACDが上昇トレンド
    score += 0.3;
    
    // ヒストグラムが拡大していれば強気
    if (req.macd.histogram > 0) score += 0.1;
  } else if (req.macd.cross === -1) {
    // MACDが下降トレンド
    score -= 0.3;
    
    // ヒストグラムが拡大していれば弱気
    if (req.macd.histogram < 0) score -= 0.1;
  }
  
  // スコアを -1.0 ~ 1.0 に正規化
  return Math.max(-1, Math.min(1, score));
}

// 2. モメンタムスコア計算（RSI）
export function calculateMomentumScore(req: TradeRequest): number {
  const rsi = req.rsi;
  let score = 0;
  
  // RSI > 70: 買われすぎ（売りシグナル）
  if (rsi > 70) {
    score = -0.8;
    if (rsi > 80) score = -1.0; // 極端な買われすぎ
  }
  // RSI < 30: 売られすぎ（買いシグナル）
  else if (rsi < 30) {
    score = 0.8;
    if (rsi < 20) score = 1.0; // 極端な売られすぎ
  }
  // RSI 50-60: 適度な上昇モメンタム
  else if (rsi >= 50 && rsi <= 60) {
    score = 0.3;
  }
  // RSI 40-50: 適度な下降モメンタム
  else if (rsi >= 40 && rsi < 50) {
    score = -0.3;
  }
  // RSI 40-60: 中立
  else {
    score = 0;
  }
  
  return score;
}

// 3. ボラティリティスコア計算（ATR）
export function calculateVolatilityScore(req: TradeRequest): number {
  const atr = req.atr;
  
  // ATRが大きい = ボラティリティが高い = 利益チャンスだがリスクも高い
  if (atr > 0.001) {
    return 0.8; // 高ボラティリティ（トレードに適している）
  } else if (atr > 0.0005) {
    return 0.5; // 中程度のボラティリティ
  } else {
    return 0.2; // 低ボラティリティ（レンジ相場）
  }
}

// 4. 一目均衡表スコア計算
export function calculateIchimokuScore(req: TradeRequest): number {
  const { ichimoku, price, atr } = req;
  let score = 0;
  
  // 転換線と基準線のクロス（最も重要）
  if (ichimoku.tk_cross === 1) {
    score += 0.4; // 転換線 > 基準線（買いシグナル）
  } else if (ichimoku.tk_cross === -1) {
    score -= 0.4; // 転換線 < 基準線（売りシグナル）
  }
  
  // 価格と雲の位置関係
  if (ichimoku.price_vs_cloud === 1) {
    score += 0.3; // 価格が雲の上（強気）
  } else if (ichimoku.price_vs_cloud === -1) {
    score -= 0.3; // 価格が雲の下（弱気）
  } else {
    // 雲の中 = 不確実性が高い
    score *= 0.5; // スコアを半減
  }
  
  // 雲の色
  if (ichimoku.cloud_color === 1) {
    score += 0.2; // 陽転（上昇雲）
  } else if (ichimoku.cloud_color === -1) {
    score -= 0.2; // 陰転（下降雲）
  }
  
  // 雲の厚さ（薄い雲は突破しやすい）
  const kumo_thickness = Math.abs(ichimoku.senkou_a - ichimoku.senkou_b);
  if (atr > 0 && kumo_thickness < atr * 0.5) {
    // 薄い雲 -> 中立に近づける
    score *= 0.7;
  }
  
  // スコアを -1.0 ~ 1.0 に正規化
  return Math.max(-1, Math.min(1, score));
}

// 総合判定: 4つの指標を融合
export function calculateQuadFusionScore(req: TradeRequest): {
  scores: TechnicalScores;
  total_score: number;
  direction: number; // 1=買い, -1=売り, 0=中立
  win_prob: number;
  confidence: string;
  reasoning: string;
} {
  // 各指標のスコアを計算
  const scores: TechnicalScores = {
    trend: calculateTrendScore(req),
    momentum: calculateMomentumScore(req),
    volatility: calculateVolatilityScore(req),
    ichimoku: calculateIchimokuScore(req),
  };
  
  console.log(`[QuadFusion] Individual scores: trend=${scores.trend.toFixed(2)} momentum=${scores.momentum.toFixed(2)} volatility=${scores.volatility.toFixed(2)} ichimoku=${scores.ichimoku.toFixed(2)}`);
  
  // 重み付け総合スコア
  // トレンド 30%, モメンタム 20%, ボラティリティ 10%, 一目 40%
  const total_score = (
    scores.trend * 0.30 +
    scores.momentum * 0.20 +
    scores.volatility * 0.10 +
    scores.ichimoku * 0.40
  );
  
  // 方向性決定
  let direction = 0;
  if (total_score > 0.3) direction = 1;      // 買い
  else if (total_score < -0.3) direction = -1; // 売り
  
  // 勝率計算（シグモイド関数で0.5〜0.95の範囲に変換）
  const win_prob = 0.5 + 0.45 * Math.tanh(total_score * 2);
  
  // 信頼度判定
  let confidence = "LOW";
  if (Math.abs(total_score) > 0.7) confidence = "VERY_HIGH";
  else if (Math.abs(total_score) > 0.5) confidence = "HIGH";
  else if (Math.abs(total_score) > 0.3) confidence = "MEDIUM";
  
  // EA判断との比較
  const ea_agrees = (req.ea_suggestion.dir === direction);
  const ea_comparison = ea_agrees 
    ? "✓ EA判断と一致" 
    : `⚠ EA判断(${req.ea_suggestion.dir > 0 ? "買い" : req.ea_suggestion.dir < 0 ? "売り" : "中立"})と不一致`;
  
  // 理由の詳細化
  const reasoning = `
QuadFusion分析結果:
- トレンド: ${scores.trend > 0 ? "上昇" : scores.trend < 0 ? "下降" : "中立"} (${(scores.trend * 100).toFixed(0)}%)
- モメンタム: ${scores.momentum > 0 ? "買い優勢" : scores.momentum < 0 ? "売り優勢" : "中立"} (RSI=${req.rsi.toFixed(1)})
- ボラティリティ: ${scores.volatility > 0.6 ? "高い" : scores.volatility > 0.4 ? "中程度" : "低い"} (ATR=${req.atr.toFixed(5)})
- 一目均衡表: ${scores.ichimoku > 0 ? "買い" : scores.ichimoku < 0 ? "売り" : "中立"} (${(scores.ichimoku * 100).toFixed(0)}%)

総合スコア: ${(total_score * 100).toFixed(1)}%
判定: ${direction > 0 ? "買い" : direction < 0 ? "売り" : "見送り"}
勝率予測: ${(win_prob * 100).toFixed(1)}%
${ea_comparison}
EA理由: ${req.ea_suggestion.reason}
  `.trim();
  
  return {
    scores,
    total_score,
    direction,
    win_prob,
    confidence,
    reasoning,
  };
}
