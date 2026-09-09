// Conditional net payouts keep profitable timed exits distinct from full TP wins.
export type ScalpOutcomes = {
  tp_probability: number;
  sl_probability: number;
  timeout_win_probability: number;
  timeout_loss_probability: number;
  timeout_win_net_r: number;
  timeout_loss_net_r: number;
};

export function scalpExpectancy(value: unknown, finalWinProbability: number, rewardR: number, costR: number) {
  if (!value || typeof value !== "object") return null;
  const v = value as ScalpOutcomes;
  const probabilities = [v.tp_probability, v.sl_probability, v.timeout_win_probability, v.timeout_loss_probability];
  if (probabilities.some(p => typeof p !== "number" || !Number.isFinite(p) || p < 0 || p > 1)) return null;
  if (Math.abs(probabilities.reduce((a, b) => a + b, 0) - 1) > 0.01) return null;
  if (![finalWinProbability, rewardR, costR, v.timeout_win_net_r, v.timeout_loss_net_r].every(Number.isFinite)) return null;
  if (finalWinProbability < 0 || finalWinProbability > 1 || costR < 0 || rewardR <= costR) return null;
  if (v.timeout_win_net_r < 0 || v.timeout_win_net_r > rewardR - costR || v.timeout_loss_net_r > 0 || v.timeout_loss_net_r < -1 - costR) return null;
  const winMass = v.tp_probability + v.timeout_win_probability;
  const lossMass = v.sl_probability + v.timeout_loss_probability;
  if (winMass <= 0 || lossMass <= 0) return null;
  const winR = (v.tp_probability * (rewardR - costR) + v.timeout_win_probability * v.timeout_win_net_r) / winMass;
  const lossR = (v.sl_probability * (-1 - costR) + v.timeout_loss_probability * v.timeout_loss_net_r) / lossMass;
  return { expectedValueR: Math.round((finalWinProbability * winR + (1 - finalWinProbability) * lossR) * 1000) / 1000,
    rawWinProbability: winMass, conditionalWinR: winR, conditionalLossR: lossR };
}
