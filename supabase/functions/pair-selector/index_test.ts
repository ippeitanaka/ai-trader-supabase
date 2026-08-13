import {
  bayesianWinRate,
  collapseShadowEpisodes,
  finalizeSelection,
  isMarketEligible,
  normalizeTradePlan,
} from "./index.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function trade(createdAt: string) {
  return {
    symbol: "BTCUSD",
    created_at: createdAt,
    dir: 1,
    actual_result: "WIN",
    profit_loss: 1,
    closed_at: createdAt,
    win_prob: 0.6,
    ml_pattern_used: false,
    entry_method: "market",
    result_consistent: true,
  };
}

function stat(symbol: string, score: number, eligible = true) {
  return {
    symbol,
    timeframe: "M15",
    real_trades: 0,
    real_wins: 0,
    real_losses: 0,
    real_win_rate: null,
    real_total_profit_loss: 0,
    real_avg_profit_loss: null,
    real_profit_factor: null,
    avg_win_prob: null,
    recent_7d_trades: 0,
    recent_7d_win_rate: null,
    recent_7d_profit_loss: 0,
    ml_used_trades: 0,
    market_trades: 0,
    market_win_rate: null,
    pullback_trades: 0,
    pullback_win_rate: null,
    virtual_trades: 10,
    virtual_raw_trades: 10,
    virtual_episode_trades: 10,
    virtual_win_rate: 0.5,
    virtual_win_rate_bayesian: 0.45,
    virtual_total_profit_loss: 0,
    real_win_rate_bayesian: 0.45,
    market_fit_score: score,
    market_regime: "mixed" as const,
    market_eligible: eligible,
    score_components: { sample: 0, real: 0, recent: 0, virtual: 0, market: 0 },
    compatibility_score: score,
  };
}

Deno.test("market eligibility follows the FX weekend while BTC stays open", () => {
  const saturday = new Date("2026-07-18T12:00:00Z");
  const monday = new Date("2026-07-20T00:00:00Z");
  assert(!isMarketEligible("EURUSD", saturday), "FX should be closed on Saturday");
  assert(isMarketEligible("BTCUSD", saturday), "BTC should remain eligible on Saturday");
  assert(isMarketEligible("EURUSD", monday), "FX should be eligible on Monday");
});

Deno.test("Bayesian win rate shrinks a tiny sample toward its prior", () => {
  const rate = bayesianWinRate(1, 1, 0.45, 8);
  assert(rate > 0.45 && rate < 0.60, `unexpected posterior: ${rate}`);
});

Deno.test("overlapping shadow signals collapse into independent episodes", () => {
  const rows = [
    trade("2026-07-14T00:00:00Z"),
    trade("2026-07-14T00:30:00Z"),
    trade("2026-07-14T02:01:00Z"),
  ];
  const episodes = collapseShadowEpisodes(rows);
  assert(episodes.length === 2, `expected 2 episodes, received ${episodes.length}`);
});

Deno.test("selection never fills missing AI picks just to reach top N", () => {
  const stats = [
    stat("BTCUSD", 62),
    stat("EURUSD", 60),
    stat("GBPUSD", 57),
    stat("XAUUSD", 0, false),
  ];
  const result = finalizeSelection({
    summary: "test",
    selected_pairs: [{ symbol: "BTCUSD", score: 62, confidence: "low", reason: "AI pick" }],
    avoided_pairs: [],
  }, stats, 3, null);

  assert(result.selected.map((item) => item.symbol).join(",") === "BTCUSD", "only the AI-selected symbol should remain recommended");
  assert(result.meta.backfilled_count === 0, "automatic recommendation backfill must stay disabled");
  assert(result.conditional.some((item) => item.symbol === "EURUSD"), "eligible non-selected symbols should be conditional");
  assert(result.meta.complete, "a variable-size selection is complete even below the maximum");
  assert(result.meta.excluded_market_closed.includes("XAUUSD"), "closed market should be reported");
});

Deno.test("daily plan preserves AI gates and sessions for conditional pairs", () => {
  const selected = [{ symbol: "BTCUSD", score: 62, confidence: "low" as const, reason: "AI pick" }];
  const conditional = [{ symbol: "EURUSD", score: 60, confidence: "low" as const, reason: "Conditional" }];
  const plan = normalizeTradePlan({
    symbols: [{ symbol: "BTCUSD", min_win_prob: 0.57 }],
    conditional_symbols: [{
      symbol: "EURUSD",
      min_win_prob: 0.63,
      session_windows: [{ label: "Tokyo", start_utc: "00:00", end_utc: "06:00" }],
    }],
  }, selected, [stat("BTCUSD", 62), stat("EURUSD", 60)], "M15", null, "test", undefined, conditional);

  assert(plan.symbols[0].min_win_prob === 0.60, "daily AI gates should have a 60% floor");
  assert(plan.conditional_symbols[0].min_win_prob === 0.63, "conditional AI gate should be preserved");
  assert(plan.conditional_symbols[0].session_windows[0].label === "Tokyo", "conditional AI session should be preserved");
});

Deno.test("normalizing a stored plan preserves its original generation time", () => {
  const selected = [{ symbol: "BTCUSD", score: 62, confidence: "low" as const, reason: "AI pick" }];
  const generatedAt = "2026-08-13T22:00:00.000Z";
  const expiresAt = "2026-08-15T04:00:00.000Z";
  const plan = normalizeTradePlan({
    plan_version: "daily-plan-v3-reviewed-selection",
    plan_date: "2026-08-14",
    generated_at: generatedAt,
    expires_at: expiresAt,
    symbols: [{ symbol: "BTCUSD", min_win_prob: 0.64 }],
  }, selected, [stat("BTCUSD", 62)], "M15", null, "test");

  assert(plan.generated_at === generatedAt, "dashboard reads must not regenerate the plan timestamp");
  assert(plan.expires_at === expiresAt, "dashboard reads must preserve the plan expiry");
});
