import {
  collapseTimedEpisodes,
  qualifiesForOpportunityOverride,
  resolveOpportunityGate,
} from "./opportunity-policy.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("positive-EV setup is not blocked by a stale client probability gate", () => {
  const gate = resolveOpportunityGate({
    clientMinWinProb: 0.55,
    evGateMinWinProb: 0.511,
    floor: 0.48,
  });
  assert(gate === 0.511, `expected EV-derived gate, received ${gate}`);
  assert(0.57 >= gate, "57% setup should remain executable");
});

Deno.test("opportunity gate keeps an absolute probability floor", () => {
  const gate = resolveOpportunityGate({
    clientMinWinProb: 0.45,
    evGateMinWinProb: 0.44,
    floor: 0.48,
  });
  assert(gate === 0.48, `expected 0.48 floor, received ${gate}`);
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
