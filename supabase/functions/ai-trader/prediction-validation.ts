import { scalpExpectancy } from "./scalp-expectancy.ts";

export function isValidTradePrediction(value: unknown, scalp: boolean, rewardR: number, costR: number): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prediction = value as Record<string, unknown>;
  const direction = prediction.direction_prob;
  const win = prediction.tp_before_sl_prob ?? prediction.win_prob;
  if (typeof direction !== "number" || !Number.isFinite(direction) || direction < 0 || direction > 1 ||
      typeof win !== "number" || !Number.isFinite(win) || win < 0 || win > 1) return false;
  if (!scalp) return true;
  const outcomes = scalpExpectancy(prediction.scalp_outcomes, win, rewardR, costR);
  return outcomes !== null && Math.abs(outcomes.rawWinProbability - win) <= 0.02;
}
