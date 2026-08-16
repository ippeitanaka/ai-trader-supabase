import assert from "node:assert/strict";
import {
  normalizeStrategyMode,
  strategyDefaults,
  strategyMinWinProbFloor,
} from "./strategy-mode.ts";

Deno.test("explicit strategy mode takes precedence", () => {
  assert.equal(normalizeStrategyMode("scalp", "M15", "main"), "scalp");
  assert.equal(normalizeStrategyMode("standard", "M5", "scalp"), "standard");
});

Deno.test("legacy requests infer scalp only from M5 or scalp instance", () => {
  assert.equal(normalizeStrategyMode(undefined, "M5", "main"), "scalp");
  assert.equal(normalizeStrategyMode(undefined, "M15", "scalp"), "scalp");
  assert.equal(normalizeStrategyMode(undefined, "M15", "main"), "standard");
});

Deno.test("scalp defaults are shorter and stricter on costs", () => {
  const standard = strategyDefaults("standard");
  const scalp = strategyDefaults("scalp");
  assert.equal(scalp.entryTimeframe, "M5");
  assert.equal(scalp.minWinProb, 0.62);
  assert(scalp.maxCostR < standard.maxCostR);
  assert(scalp.directionHorizonMinutes < standard.directionHorizonMinutes);
  assert.equal(scalp.maxHoldMinutes, 30);
});

Deno.test("scalp keeps a precision floor until a dashboard override is applied", () => {
  assert.equal(strategyMinWinProbFloor("standard", 0.50, 0.62), 0.50);
  assert.equal(strategyMinWinProbFloor("scalp", 0.50, null), 0.62);
  assert.equal(strategyMinWinProbFloor("scalp", 0.50, 0.65), 0.65);
});
