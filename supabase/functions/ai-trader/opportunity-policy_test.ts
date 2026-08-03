import {
  classifyDailyPlanMembership,
  collapseTimedEpisodes,
  finalizeDecisionSummaryText,
  isMinuteWithinWindow,
  qualifiesForOpportunityOverride,
  resolveAbsoluteManualProbabilityGate,
  resolveDetailedFinalProbability,
  resolveManualProbabilityGate,
  resolveOpportunityGate,
} from "./opportunity-policy.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("execution gate respects the configured probability floor", () => {
  const gate = resolveOpportunityGate({
    clientMinWinProb: 0.55,
    evGateMinWinProb: 0.511,
    floor: 0.50,
  });
  assert(gate === 0.511, `expected EV-derived gate, received ${gate}`);
  assert(0.57 >= gate, "57% setup should remain executable when the daily gate permits it");
});

Deno.test("opportunity gate keeps an absolute probability floor", () => {
  const gate = resolveOpportunityGate({
    clientMinWinProb: 0.45,
    evGateMinWinProb: 0.44,
    floor: 0.50,
  });
  assert(gate === 0.50, `expected 0.50 floor, received ${gate}`);
});

Deno.test("detailed final probability preserves calibrated variation around 50 percent", () => {
  assert(resolveDetailedFinalProbability(0.537) === 0.537, "53.7% must not be collapsed to 50%");
  assert(resolveDetailedFinalProbability(0.482) === 0.482, "48.2% must remain distinguishable from 50%");
});

Deno.test("manual probability adjustment supports one-point changes", () => {
  assert(resolveManualProbabilityGate(0.58, -0.01) === 0.57, "manual -1pt should produce a 57% gate");
  assert(resolveManualProbabilityGate(0.58, 0.01) === 0.59, "manual +1pt should produce a 59% gate");
  assert(resolveManualProbabilityGate(0.50, -0.01) === 0.50, "manual gate should keep the 50% lower bound");
});

Deno.test("absolute manual gate is rounded to one-percent increments", () => {
  assert(resolveAbsoluteManualProbabilityGate(0.584) === 0.58, "58.4% should round to 58%");
  assert(resolveAbsoluteManualProbabilityGate(0.586) === 0.59, "58.6% should round to 59%");
  assert(resolveAbsoluteManualProbabilityGate(0.49) === 0.50, "manual gate should not go below 50%");
});

Deno.test("manual JST window supports ranges that cross midnight", () => {
  const start = 22 * 60;
  const end = 2 * 60;
  assert(isMinuteWithinWindow(23 * 60, start, end), "23:00 JST should be inside the overnight window");
  assert(isMinuteWithinWindow(60, start, end), "01:00 JST should be inside the overnight window");
  assert(!isMinuteWithinWindow(12 * 60, start, end), "12:00 JST should be outside the overnight window");
});

Deno.test("daily plan membership keeps selected pairs highest priority", () => {
  const membership = classifyDailyPlanMembership(
    "EURUSD",
    ["eurusd"],
    ["EURUSD"],
    ["EURUSD", "USDJPY"],
  );
  assert(membership === "selected", `expected selected, received ${membership}`);
});

Deno.test("daily plan membership blocks explicitly avoided pairs", () => {
  const membership = classifyDailyPlanMembership("GBPUSD", ["EURUSD"], ["gbpusd"], ["EURUSD", "GBPUSD"]);
  assert(membership === "avoided", `expected avoided, received ${membership}`);
});

Deno.test("daily plan membership permits unselected pairs in the selector universe", () => {
  const membership = classifyDailyPlanMembership("USDJPY", ["EURUSD"], ["GBPUSD"], ["EURUSD", "GBPUSD", "USDJPY"]);
  assert(membership === "eligible_unselected", `expected eligible_unselected, received ${membership}`);
});

Deno.test("daily plan membership blocks symbols outside the selector universe", () => {
  const membership = classifyDailyPlanMembership("XAUUSD", ["EURUSD"], ["GBPUSD"], ["EURUSD", "GBPUSD", "USDJPY"]);
  assert(membership === "unlisted", `expected unlisted, received ${membership}`);
});

Deno.test("final decision summary reflects a guard that changed execution to hold", () => {
  const summary = finalizeDecisionSummaryText({
    summary: "実行 BUY | p=0.5 | gate=0.493 | chart_block=spread_atr_too_high",
    action: 0,
    suggestedDir: 1,
    skipReason: "spread_atr_too_high",
  });
  assert(summary.startsWith("見送り BUY"), `unexpected final headline: ${summary}`);
  assert(summary.includes("skip=spread_atr_too_high"), "final skip reason should be included");
});

Deno.test("strong low-cost EV can override soft planning guards", () => {
  assert(
    qualifiesForOpportunityOverride({
      winProb: 0.52,
      expectedValueR: 0.12,
      costR: 0.18,
    }),
    "low-cost positive-EV setup should qualify",
  );
});

Deno.test("overlapping predictions collapse into independent episodes", () => {
  const rows = [
    { created_at: "2026-07-16T00:00:00Z", symbol: "EURUSD", dir: 1 },
    { created_at: "2026-07-16T00:15:00Z", symbol: "EURUSD", dir: 1 },
    { created_at: "2026-07-16T02:01:00Z", symbol: "EURUSD", dir: 1 },
  ];
  assert(collapseTimedEpisodes(rows).length === 2, "expected two independent episodes");
});

Deno.test("negative EV cannot override planning guards", () => {
  assert(
    !qualifiesForOpportunityOverride({
      winProb: 0.48,
      expectedValueR: -0.084,
      costR: 0.284,
    }),
    "negative-EV AUDUSD example must remain blocked",
  );
});
