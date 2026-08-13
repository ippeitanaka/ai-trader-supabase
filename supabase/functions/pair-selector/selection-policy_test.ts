import assert from "node:assert/strict";
import {
  assessRecommendationQuality,
  isHeadlineRelevantToSymbol,
  isMarketHeadline,
} from "./selection-policy.ts";

function qualityStats(overrides: Record<string, unknown> = {}) {
  return {
    symbol: "EURUSD",
    market_eligible: true,
    compatibility_score: 62,
    real_trades: 8,
    real_win_rate_bayesian: 0.54,
    real_profit_factor: 1.2,
    virtual_episode_trades: 16,
    virtual_win_rate_bayesian: 0.46,
    ...overrides,
  };
}

Deno.test("healthy evidence can qualify for an AI recommendation", () => {
  const result = assessRecommendationQuality(qualityStats());
  assert.equal(result.recommendable, true);
  assert.equal(result.hard_reject, false);
});

Deno.test("very low realized profit factor is a hard rejection", () => {
  const result = assessRecommendationQuality(
    qualityStats({ real_trades: 14, real_profit_factor: 0.08 }),
  );
  assert.equal(result.recommendable, false);
  assert.equal(result.hard_reject, true);
  assert(result.reasons.includes("real_profit_factor_too_low"));
});

Deno.test("weak score is conditional instead of a hard rejection", () => {
  const result = assessRecommendationQuality(
    qualityStats({ compatibility_score: 51 }),
  );
  assert.equal(result.recommendable, false);
  assert.equal(result.hard_reject, false);
});

Deno.test("sports headlines containing euro are excluded", () => {
  const title = "Players selected for Women's Euro Hockey Tour";
  assert.equal(isMarketHeadline("fx", title), false);
  assert.equal(isHeadlineRelevantToSymbol("EURJPY", title), false);
});

Deno.test("currency-specific headlines remain available to the matching pair", () => {
  const title = "Euro currency falls as ECB rate outlook shifts";
  assert.equal(isMarketHeadline("fx", title), true);
  assert.equal(isHeadlineRelevantToSymbol("EURJPY", title), true);
  assert.equal(isHeadlineRelevantToSymbol("GBPJPY", title), false);
});

Deno.test("silver company earnings are not treated as spot silver news", () => {
  const title = "Pan American Silver reports quarterly financial results";
  assert.equal(isMarketHeadline("metals", title), false);
  assert.equal(isHeadlineRelevantToSymbol("XAGUSD", title), false);
});
