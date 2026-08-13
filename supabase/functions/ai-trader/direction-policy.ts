export type DirectionEvidenceRow = {
  actual_result: string;
  is_virtual?: boolean | null;
  probability_target_version?: string | null;
};

export type DirectionalEvidence = {
  real_samples: number;
  virtual_samples: number;
  effective_samples: number;
  weighted_wins: number;
  weighted_losses: number;
  posterior_win_rate: number;
  conservative_win_rate: number;
  blend_weight: number;
};

export type DirectionCandidate = {
  dir: 1 | -1;
  winProb: number;
  directionProb?: number;
  action: number;
};

export type DirectionChoice = {
  selectedDir: 1 | -1;
  edge: number;
  ambiguous: boolean;
  buyScore: number;
  sellScore: number;
};

function clampProbability(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function rowWeight(row: DirectionEvidenceRow): number {
  const currentTarget = row.probability_target_version === "direction_tp_v2";
  if (row.is_virtual) return currentTarget ? 0.25 : 0.08;
  return currentTarget ? 1 : 0.35;
}

export function buildDirectionalEvidence(
  rows: DirectionEvidenceRow[],
): DirectionalEvidence | null {
  let realSamples = 0;
  let virtualSamples = 0;
  let weightedWins = 0;
  let weightedLosses = 0;

  for (const row of rows) {
    if (row.actual_result !== "WIN" && row.actual_result !== "LOSS") continue;
    if (row.is_virtual) virtualSamples += 1;
    else realSamples += 1;

    const weight = rowWeight(row);
    if (row.actual_result === "WIN") weightedWins += weight;
    else weightedLosses += weight;
  }

  const effectiveSamples = weightedWins + weightedLosses;
  if (effectiveSamples < 1) return null;

  // A mildly conservative 45% prior prevents sparse or all-virtual history
  // from manufacturing a high-confidence direction.
  const priorStrength = 10;
  const priorWins = 4.5;
  const posteriorWinRate = (priorWins + weightedWins) /
    (priorStrength + effectiveSamples);
  const posteriorN = priorStrength + effectiveSamples;
  const standardError = Math.sqrt(
    Math.max(0, posteriorWinRate * (1 - posteriorWinRate) / (posteriorN + 1)),
  );
  const conservativeWinRate = clampProbability(
    posteriorWinRate - standardError,
  );

  const sampleFactor = effectiveSamples / (effectiveSamples + 20);
  const maxBlend = realSamples >= 8 ? 0.60 : realSamples > 0 ? 0.45 : 0.30;
  const blendWeight = Math.min(maxBlend, sampleFactor * maxBlend);

  return {
    real_samples: realSamples,
    virtual_samples: virtualSamples,
    effective_samples: Math.round(effectiveSamples * 100) / 100,
    weighted_wins: Math.round(weightedWins * 100) / 100,
    weighted_losses: Math.round(weightedLosses * 100) / 100,
    posterior_win_rate: Math.round(posteriorWinRate * 1000) / 1000,
    conservative_win_rate: Math.round(conservativeWinRate * 1000) / 1000,
    blend_weight: Math.round(blendWeight * 1000) / 1000,
  };
}

export function blendWithDirectionalEvidence(
  modelProbability: number,
  evidence: DirectionalEvidence | null,
): { probability: number; adjustment: number } {
  const model = clampProbability(modelProbability);
  if (
    !evidence || evidence.effective_samples < 4 || evidence.blend_weight <= 0
  ) {
    return { probability: model, adjustment: 0 };
  }

  const probability = clampProbability(
    model * (1 - evidence.blend_weight) +
      evidence.posterior_win_rate * evidence.blend_weight,
  );
  return {
    probability: Math.round(probability * 1000) / 1000,
    adjustment: Math.round((probability - model) * 1000) / 1000,
  };
}

function candidateScore(candidate: DirectionCandidate): number {
  // Execution success is TP-before-SL, so direction choice must optimize the
  // same target instead of mixing in the separate 60-minute direction label.
  return clampProbability(candidate.winProb);
}

export function chooseDirection(
  buy: DirectionCandidate,
  sell: DirectionCandidate,
  minimumEdge = 0.025,
): DirectionChoice {
  const buyScore = candidateScore(buy);
  const sellScore = candidateScore(sell);

  const selectedDir: 1 | -1 = buyScore >= sellScore ? 1 : -1;
  const edge = Math.abs(buyScore - sellScore);
  const selectedAction = selectedDir === 1 ? buy.action : sell.action;
  return {
    selectedDir,
    edge,
    ambiguous: selectedAction !== 0 && edge < minimumEdge,
    buyScore,
    sellScore,
  };
}
