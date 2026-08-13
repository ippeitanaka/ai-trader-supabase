import assert from "node:assert/strict";
import {
  blendWithDirectionalEvidence,
  buildDirectionalEvidence,
  chooseDirection,
} from "./direction-policy.ts";

Deno.test("current real outcomes dominate legacy and virtual rows", () => {
  const evidence = buildDirectionalEvidence([
    ...Array.from(
      { length: 8 },
      () => ({
        actual_result: "WIN",
        is_virtual: false,
        probability_target_version: "direction_tp_v2",
      }),
    ),
    ...Array.from(
      { length: 2 },
      () => ({
        actual_result: "LOSS",
        is_virtual: false,
        probability_target_version: "direction_tp_v2",
      }),
    ),
    ...Array.from(
      { length: 20 },
      () => ({
        actual_result: "LOSS",
        is_virtual: true,
        probability_target_version: "legacy_profit_v1",
      }),
    ),
  ]);

  assert(evidence);
  assert.equal(evidence.real_samples, 10);
  assert.equal(evidence.virtual_samples, 20);
  assert(evidence.posterior_win_rate > 0.55);
  assert(evidence.blend_weight > 0);
});

Deno.test("sparse evidence does not alter the model probability", () => {
  const evidence = buildDirectionalEvidence([
    {
      actual_result: "WIN",
      is_virtual: true,
      probability_target_version: "direction_tp_v2",
    },
    {
      actual_result: "LOSS",
      is_virtual: true,
      probability_target_version: "direction_tp_v2",
    },
  ]);
  const blended = blendWithDirectionalEvidence(0.62, evidence);
  assert.deepEqual(blended, { probability: 0.62, adjustment: 0 });
});

Deno.test("supported losing history pulls an optimistic model probability down", () => {
  const evidence = buildDirectionalEvidence([
    ...Array.from(
      { length: 3 },
      () => ({
        actual_result: "WIN",
        is_virtual: false,
        probability_target_version: "direction_tp_v2",
      }),
    ),
    ...Array.from(
      { length: 12 },
      () => ({
        actual_result: "LOSS",
        is_virtual: false,
        probability_target_version: "direction_tp_v2",
      }),
    ),
  ]);
  const blended = blendWithDirectionalEvidence(0.64, evidence);
  assert(evidence);
  assert(blended.probability < 0.60);
  assert(blended.adjustment < 0);
});

Deno.test("the higher probability direction wins even when the other side is executable", () => {
  const choice = chooseDirection(
    { dir: 1, winProb: 0.57, directionProb: 0.58, action: 1 },
    { dir: -1, winProb: 0.59, directionProb: 0.61, action: 0 },
  );
  assert.equal(choice.selectedDir, -1);
  assert.equal(choice.ambiguous, false);
});

Deno.test("two executable directions with no meaningful edge are ambiguous", () => {
  const choice = chooseDirection(
    { dir: 1, winProb: 0.61, directionProb: 0.60, action: 1 },
    { dir: -1, winProb: 0.60, directionProb: 0.61, action: -1 },
  );
  assert.equal(choice.ambiguous, true);
});
