export type StrategyMode = "standard" | "scalp";

export type StrategyDefaults = {
  instance: "main" | "scalp";
  entryTimeframe: "M15" | "M5";
  minWinProb: number;
  rewardRR: number;
  riskAtrMult: number;
  maxCostR: number;
  directionHorizonMinutes: number;
  maxHoldMinutes: number | null;
  expiryMinutes: number;
  cooldownMinutes: number;
};

export function normalizeStrategyMode(
  value: unknown,
  timeframe?: unknown,
  instance?: unknown,
): StrategyMode {
  const raw = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (raw === "scalp" || raw === "scalp_m5" || raw === "m5") return "scalp";
  if (raw === "standard" || raw === "standard_m15" || raw === "m15") {
    return "standard";
  }

  const tf = typeof timeframe === "string"
    ? timeframe.trim().toUpperCase()
    : "";
  const eaInstance = typeof instance === "string"
    ? instance.trim().toLowerCase()
    : "";
  return tf === "M5" || eaInstance === "scalp" ? "scalp" : "standard";
}

export function strategyDefaults(mode: StrategyMode): StrategyDefaults {
  if (mode === "scalp") {
    return {
      instance: "scalp",
      entryTimeframe: "M5",
      minWinProb: 0.62,
      rewardRR: 1.1,
      riskAtrMult: 1.4,
      maxCostR: 0.12,
      directionHorizonMinutes: 20,
      maxHoldMinutes: 30,
      expiryMinutes: 30,
      cooldownMinutes: 5,
    };
  }

  return {
    instance: "main",
    entryTimeframe: "M15",
    minWinProb: 0.50,
    rewardRR: 1.5,
    riskAtrMult: 2,
    maxCostR: 0.2,
    directionHorizonMinutes: 60,
    maxHoldMinutes: null,
    expiryMinutes: 90,
    cooldownMinutes: 30,
  };
}

export function strategyMinWinProbFloor(
  mode: StrategyMode,
  globalFloor: number,
  configured?: number | null,
): number {
  if (mode === "standard") return globalFloor;
  const candidate =
    typeof configured === "number" && Number.isFinite(configured)
      ? configured
      : strategyDefaults(mode).minWinProb;
  return Math.max(globalFloor, candidate);
}
