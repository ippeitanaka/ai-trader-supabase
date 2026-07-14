import {
  bayesianWinRate,
  collapseShadowEpisodes,
  finalizeSelection,
  isMarketEligible,
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
    avg_win_prob: null,
    recent_7d_trades: 0,
    recent_7d_win_rate: null,
    recent_7d_profit_loss: 0,
    ml_used_trades: 0,
    market_trades: 0,
    market_win_rate: null,
    pullback_trades: 0,
    pullback_win_rate: null,
    virtual_trades: 0,
    virtual_raw_trades: 0,
    virtual_episode_trades: 0,
    virtual_win_rate: null,
    virtual_win_rate_bayesian: 0.4,
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

Deno.test("selection backfills missing AI picks from all-symbol market scores", () => {
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

  assert(result.selected.map((item) => item.symbol).join(",") === "BTCUSD,EURUSD,GBPUSD", "expected deterministic top-N backfill");
  assert(result.meta.backfilled_count === 2, "expected two backfilled symbols");
  assert(result.meta.complete, "selection should be complete");
  assert(result.meta.excluded_market_closed.includes("XAUUSD"), "closed market should be reported");
});
