import { assertEquals, assertAlmostEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { scalpExpectancy } from "./scalp-expectancy.ts";
const outcomes = { tp_probability: 0.3, sl_probability: 0.2, timeout_win_probability: 0.3, timeout_loss_probability: 0.2, timeout_win_net_r: 0.2, timeout_loss_net_r: -0.2 };
Deno.test("timed small wins do not receive full TP reward", () => {
  const result = scalpExpectancy(outcomes, 0.6, 1.1, 0.1)!;
  assertEquals(result.expectedValueR, 0.1);
  assertAlmostEquals(result.conditionalWinR, 0.6);
  assertAlmostEquals(result.conditionalLossR, -0.65);
});
Deno.test("calibration changes win mass, not conditional payouts", () => {
  assertEquals(scalpExpectancy(outcomes, 0.5, 1.1, 0.1)!.expectedValueR, -0.025);
});
Deno.test("missing or invalid scenario estimates cannot produce EV", () => {
  for (const value of [null, {}, {...outcomes, tp_probability: 0.8}, {...outcomes, timeout_win_net_r: 3}, {...outcomes, timeout_loss_net_r: NaN}]) assertEquals(scalpExpectancy(value, 0.6, 1.1, 0.1), null);
});
Deno.test("pure TP/SL case matches net binary EV exactly", () => {
  assertEquals(scalpExpectancy({...outcomes, tp_probability:0.6,sl_probability:0.4,timeout_win_probability:0,timeout_loss_probability:0}, 0.6,1.1,0.1)!.expectedValueR, 0.16);
});
