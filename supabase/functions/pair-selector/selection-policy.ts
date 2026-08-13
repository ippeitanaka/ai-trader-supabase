export type RecommendationQualityStats = {
  symbol: string;
  market_eligible: boolean;
  compatibility_score: number;
  real_trades: number;
  real_win_rate_bayesian: number | null;
  real_profit_factor: number | null;
  virtual_episode_trades: number;
  virtual_win_rate_bayesian: number | null;
};

export type RecommendationQuality = {
  recommendable: boolean;
  hard_reject: boolean;
  reasons: string[];
};

const MIN_RECOMMENDATION_SCORE = 55;
const MIN_PROFIT_FACTOR = 0.80;

const NON_MARKET_PATTERN =
  /\b(hockey|football|soccer|rugby|basketball|baseball|tennis|tournament|championship|league|cup final|transfer window|movie|music|album|celebrity)\b/i;

function containsAny(value: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(value));
}

export function assessRecommendationQuality(
  stats: RecommendationQualityStats,
): RecommendationQuality {
  const hardReasons: string[] = [];
  const softReasons: string[] = [];

  if (!stats.market_eligible) hardReasons.push("market_closed");
  if (
    stats.real_trades >= 5 && stats.real_profit_factor !== null &&
    stats.real_profit_factor < MIN_PROFIT_FACTOR
  ) {
    hardReasons.push("real_profit_factor_too_low");
  }
  if (
    stats.real_trades >= 8 && stats.real_win_rate_bayesian !== null &&
    stats.real_win_rate_bayesian < 0.45
  ) {
    hardReasons.push("real_win_rate_too_low");
  }
  if (
    stats.virtual_episode_trades >= 16 &&
    stats.virtual_win_rate_bayesian !== null &&
    stats.virtual_win_rate_bayesian < 0.30
  ) {
    hardReasons.push("virtual_outcomes_too_weak");
  }

  if (stats.compatibility_score < MIN_RECOMMENDATION_SCORE) {
    softReasons.push("compatibility_below_recommendation_level");
  }
  if (stats.real_trades < 3 && stats.virtual_episode_trades < 8) {
    softReasons.push("evidence_too_sparse");
  }

  return {
    recommendable: hardReasons.length === 0 && softReasons.length === 0,
    hard_reject: hardReasons.length > 0,
    reasons: [...hardReasons, ...softReasons],
  };
}

export function isMarketHeadline(topic: string, title: string): boolean {
  const normalized = title.trim();
  if (!normalized || NON_MARKET_PATTERN.test(normalized)) return false;

  if (topic === "macro") {
    return containsAny(normalized, [
      /\bfederal reserve\b/i,
      /\bcentral bank\b/i,
      /\binflation\b/i,
      /\bCPI\b/,
      /\bPPI\b/,
      /\binterest rates?\b/i,
      /\btreasury yields?\b/i,
      /\bjobs report\b/i,
      /\bunemployment\b/i,
      /\brecession\b/i,
      /\bUS dollar\b/i,
    ]);
  }
  if (topic === "fx") {
    return containsAny(normalized, [
      /\bforex\b/i,
      /\bFX market\b/i,
      /\bEUR\/?USD\b/i,
      /\bUSD\/?JPY\b/i,
      /\bGBP\/?USD\b/i,
      /\byen\b/i,
      /\bsterling\b/i,
      /\bSwiss franc\b/i,
      /\beuro(?:zone)? (?:currency|rises|falls|trades|outlook)\b/i,
      /\bECB\b/,
      /\bBOJ\b/,
      /\bBOE\b/,
      /\bcurrency markets?\b/i,
    ]);
  }
  if (topic === "metals") {
    return containsAny(normalized, [
      /\bgold prices?\b/i,
      /\bsilver prices?\b/i,
      /\bgold futures?\b/i,
      /\bsilver futures?\b/i,
      /\bbullion\b/i,
      /\bXAU\/?USD\b/i,
      /\bXAG\/?USD\b/i,
      /\bprecious metals?\b/i,
    ]);
  }
  if (topic === "crypto") {
    return containsAny(normalized, [
      /\bbitcoin\b/i,
      /\bBTC\/?USD\b/i,
      /\bcrypto(?:currency)? markets?\b/i,
    ]);
  }
  return false;
}

export function isHeadlineRelevantToSymbol(
  symbol: string,
  title: string,
): boolean {
  if (NON_MARKET_PATTERN.test(title)) return false;
  const patterns: Record<string, RegExp[]> = {
    BTCUSD: [
      /\bbitcoin\b/i,
      /\bBTC\/?USD\b/i,
      /\bcrypto(?:currency)? markets?\b/i,
    ],
    XAUUSD: [
      /\bgold prices?\b/i,
      /\bgold futures?\b/i,
      /\bbullion\b/i,
      /\bXAU\/?USD\b/i,
    ],
    XAGUSD: [
      /\bsilver prices?\b/i,
      /\bsilver futures?\b/i,
      /\bbullion\b/i,
      /\bXAG\/?USD\b/i,
    ],
    USDJPY: [/\bUSD\/?JPY\b/i, /\byen\b/i, /\bBOJ\b/, /\bBank of Japan\b/i],
    EURUSD: [
      /\bEUR\/?USD\b/i,
      /\bECB\b/,
      /\bEuropean Central Bank\b/i,
      /\beuro(?:zone)? (?:currency|rises|falls|trades|outlook)\b/i,
    ],
    EURJPY: [
      /\bEUR\/?JPY\b/i,
      /\bECB\b/,
      /\bEuropean Central Bank\b/i,
      /\beuro(?:zone)? (?:currency|rises|falls|trades|outlook)\b/i,
    ],
    GBPUSD: [
      /\bGBP\/?USD\b/i,
      /\bsterling\b/i,
      /\bBritish pound\b/i,
      /\bBOE\b/,
      /\bBank of England\b/i,
    ],
    GBPJPY: [
      /\bGBP\/?JPY\b/i,
      /\bsterling\b/i,
      /\bBritish pound\b/i,
      /\bBOE\b/,
      /\bBank of England\b/i,
    ],
    USDCHF: [
      /\bUSD\/?CHF\b/i,
      /\bSwiss franc\b/i,
      /\bSNB\b/,
      /\bSwiss National Bank\b/i,
    ],
    AUDUSD: [
      /\bAUD\/?USD\b/i,
      /\bAustralian dollar\b/i,
      /\bRBA\b/,
      /\bReserve Bank of Australia\b/i,
    ],
    NZDUSD: [
      /\bNZD\/?USD\b/i,
      /\bNew Zealand dollar\b/i,
      /\bRBNZ\b/,
      /\bReserve Bank of New Zealand\b/i,
    ],
    USDCAD: [
      /\bUSD\/?CAD\b/i,
      /\bCanadian dollar\b/i,
      /\bBank of Canada\b/i,
      /\bBOC\b/,
    ],
  };
  return containsAny(title, patterns[symbol] ?? []);
}
