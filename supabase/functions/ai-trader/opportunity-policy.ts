export type OpportunityOverrideInput = {
  winProb: number;
  expectedValueR: number;
  costR: number;
  strict?: boolean;
  minExpectedValueR?: number;
  maxCostR?: number;
};

export type DailyPlanMembership = "selected" | "eligible_unselected" | "avoided" | "unlisted";

export function classifyDailyPlanMembership(
  symbol: string,
  selectedSymbols: string[],
  avoidedSymbols: string[],
  universe: string[],
): DailyPlanMembership {
  const key = symbol.trim().toUpperCase();
  const includes = (symbols: string[]) => symbols.some((candidate) => candidate.trim().toUpperCase() === key);

  if (includes(selectedSymbols)) return "selected";
  if (includes(avoidedSymbols)) return "avoided";
  if (includes(universe)) return "eligible_unselected";
  return "unlisted";
}

function clampProbability(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function resolveManualProbabilityGate(
  baseGate: number,
  adjustment: number,
  minGate = 0.50,
  maxGate = 0.95,
): number {
  const resolved = Math.max(minGate, Math.min(maxGate, baseGate + adjustment));
  return Math.round(resolved * 1000) / 1000;
}

export function isMinuteWithinWindow(current: number, start: number, end: number): boolean {
  if (start <= end) return current >= start && current <= end;
  return current >= start || current <= end;
}

export function finalizeDecisionSummaryText(input: {
  summary?: string;
  action: number;
  suggestedDir?: number;
  skipReason?: string;
}): string {
  const summary = input.summary?.trim() ?? "";
  const headline = summary.match(/^(実行|見送り)\s+(BUY|SELL|HOLD)/);
  const direction = input.action > 0
    ? "BUY"
    : input.action < 0
    ? "SELL"
    : headline?.[2] ?? (input.suggestedDir && input.suggestedDir < 0 ? "SELL" : input.suggestedDir && input.suggestedDir > 0 ? "BUY" : "HOLD");
  const status = input.action === 0 ? "見送り" : "実行";
  const normalized = summary
    ? headline
      ? summary.replace(/^(実行|見送り)\s+(BUY|SELL|HOLD)/, `${status} ${direction}`)
      : `${status} ${direction} | ${summary}`
    : `${status} ${direction}`;
  if (input.action !== 0 || !input.skipReason || /(?:^|\s\|\s)skip=/.test(normalized)) return normalized;
  return `${normalized} | skip=${input.skipReason}`;
}

export function resolveOpportunityGate(input: {
  clientMinWinProb: number;
  evGateMinWinProb: number;
  floor: number;
  gateReduction?: number;
}): number {
  const advisoryGate = Math.min(input.clientMinWinProb, input.evGateMinWinProb);
  return clampProbability(
    Math.max(input.floor, advisoryGate - (input.gateReduction ?? 0)),
  );
}

export function qualifiesForOpportunityOverride(
  input: OpportunityOverrideInput,
): boolean {
  const requiredEv = input.minExpectedValueR ?? (input.strict ? 0.18 : 0.12);
  const maxCostR = input.maxCostR ?? (input.strict ? 0.18 : 0.20);
  return input.winProb >= 0.50 &&
    input.expectedValueR >= requiredEv &&
    input.costR <= maxCostR;
}

export function collapseTimedEpisodes<T extends {
  created_at: string;
  symbol: string;
  dir: number | null;
}>(rows: T[], episodeMinutes = 120): T[] {
  const sorted = [...rows].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
  const lastEpisodeAt = new Map<string, number>();
  const episodes: T[] = [];
  const episodeMs = episodeMinutes * 60 * 1000;

  for (const row of sorted) {
    const createdAt = Date.parse(row.created_at);
    if (!Number.isFinite(createdAt)) continue;
    const key = `${row.symbol}:${row.dir ?? 0}`;
    const previous = lastEpisodeAt.get(key);
    if (previous != null && createdAt - previous < episodeMs) continue;
    lastEpisodeAt.set(key, createdAt);
    episodes.push(row);
  }

  return episodes;
}
