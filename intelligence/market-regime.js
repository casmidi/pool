const REGIMES = Object.freeze({
  EUPHORIC: "EUPHORIC",
  TRENDING: "TRENDING",
  DEFENSIVE: "DEFENSIVE",
  DEAD_MARKET: "DEAD_MARKET",
});

function finite(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function avg(values) {
  const nums = values.map((v) => Number(v)).filter(Number.isFinite);
  if (nums.length === 0) return 0;
  return nums.reduce((sum, v) => sum + v, 0) / nums.length;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function getPoolMetrics(pools = []) {
  const list = Array.isArray(pools) ? pools : [];
  return {
    count: list.length,
    avgVolatility: avg(list.map((p) => p.volatility ?? p.volatility_pct)),
    avgFeeTvl: avg(list.map((p) => p.fee_active_tvl_ratio ?? p.fee_tvl_ratio)),
    avgVolumeChange: avg(list.map((p) => p.volume_change_pct)),
    avgFeeChange: avg(list.map((p) => p.fee_change_pct)),
    avgActivePct: avg(list.map((p) => p.active_pct)),
    avgOrganic: avg(list.map((p) => p.organic_score ?? p.base?.organic)),
    highAthShare: list.length
      ? list.filter((p) => finite(p.price_vs_ath_pct) >= 80).length / list.length
      : 0,
  };
}

function getHistoryMetrics(history = []) {
  const list = Array.isArray(history) ? history : [];
  return {
    count: list.length,
    avgPnlPct: avg(list.map((t) => t.pnl_pct ?? t.net_return_pct ?? t.pnlPercent)),
    winRate: list.length
      ? list.filter((t) => finite(t.pnl_pct ?? t.net_return_pct ?? t.pnlPercent) > 0).length / list.length
      : 0,
  };
}

function buildAdjustments(regime) {
  if (regime === REGIMES.EUPHORIC) {
    return {
      weightMultipliers: { organic_score: 1.15, active_pct: 1.1, fee_active_tvl_ratio: 0.9, volume_window: 0.9 },
      penaltyMultiplier: 1.2,
      thresholdDelta: 5,
      exitAggressiveness: 1.2,
    };
  }
  if (regime === REGIMES.TRENDING) {
    return {
      weightMultipliers: { fee_change_pct: 1.15, volume_change_pct: 1.1, price_trend: 1.1 },
      penaltyMultiplier: 1.0,
      thresholdDelta: 0,
      exitAggressiveness: 1.0,
    };
  }
  if (regime === REGIMES.DEAD_MARKET) {
    return {
      weightMultipliers: { fee_active_tvl_ratio: 1.15, volume_window: 1.1, active_pct: 0.9 },
      penaltyMultiplier: 1.05,
      thresholdDelta: 3,
      exitAggressiveness: 1.1,
    };
  }
  return {
    weightMultipliers: { organic_score: 1.1, active_pct: 1.1, volatility_zone: 0.9 },
    penaltyMultiplier: 1.15,
    thresholdDelta: 4,
    exitAggressiveness: 1.15,
  };
}

export { REGIMES };

export function detectMarketRegime(pools = [], history = [], options = {}) {
  const p = getPoolMetrics(pools);
  const h = getHistoryMetrics(history);
  const highVolatility = finite(options.highVolatilityThreshold, 5);
  const lowFeeTvl = finite(options.lowFeeTvlThreshold, 0.01);
  const highFeeTvl = finite(options.highFeeTvlThreshold, 0.06);
  const lowActivityPct = finite(options.lowActivityPct, 35);

  let regime = REGIMES.TRENDING;
  const reasons = [];

  if (p.avgFeeTvl < lowFeeTvl && p.avgActivePct < lowActivityPct) {
    regime = REGIMES.DEAD_MARKET;
    reasons.push("fee/active-TVL and in-range activity are weak");
  } else if (p.avgVolatility >= highVolatility || h.avgPnlPct < -2) {
    regime = REGIMES.DEFENSIVE;
    reasons.push("volatility or recent realized PnL points to defensive handling");
  } else if (p.avgFeeTvl >= highFeeTvl || p.highAthShare >= 0.35 || p.avgFeeChange >= 60) {
    regime = REGIMES.EUPHORIC;
    reasons.push("fee spike, ATH pressure, or rapid fee growth suggests euphoria");
  } else {
    reasons.push("activity is present without extreme risk pressure");
  }

  const confidence = clamp(
    45 +
      Math.min(25, p.count * 2) +
      Math.min(15, h.count) +
      Math.min(15, Math.abs(p.avgFeeChange) / 4),
    45,
    95,
  );

  return {
    regime,
    confidence: Math.round(confidence),
    metrics: p,
    history: h,
    adjustments: buildAdjustments(regime),
    explanation: reasons.join("; "),
    recommended_strategy:
      regime === REGIMES.EUPHORIC
        ? "tighten risk review and prefer durable organic pools"
        : regime === REGIMES.DEAD_MARKET
          ? "prefer only pools with clear fee sustainability"
          : regime === REGIMES.DEFENSIVE
            ? "reduce exposure pressure and monitor exits closely"
            : "normal scoring posture",
  };
}

export function applyRegimeAdjustments(weights = {}, penaltyConfig = {}, thresholds = {}, regimeResult = {}, options = {}) {
  const maxAdjustment = clamp(finite(options.maxWeightAdjustment, 0.25), 0, 1);
  const adjustments = regimeResult.adjustments ?? buildAdjustments(regimeResult.regime);
  const adjustedWeights = { ...weights };

  for (const [key, multiplier] of Object.entries(adjustments.weightMultipliers ?? {})) {
    if (adjustedWeights[key] == null) continue;
    const capped = clamp(finite(multiplier, 1), 1 - maxAdjustment, 1 + maxAdjustment);
    adjustedWeights[key] = Math.round(finite(adjustedWeights[key]) * capped * 10) / 10;
  }

  const penaltyMultiplier = clamp(
    finite(adjustments.penaltyMultiplier, 1),
    1 - maxAdjustment,
    1 + maxAdjustment,
  );
  const adjustedPenalties = Object.fromEntries(
    Object.entries(penaltyConfig).map(([key, value]) => [key, Math.round(finite(value) * penaltyMultiplier * 10) / 10]),
  );
  const adjustedThresholds = {
    ...thresholds,
    minPoolScore:
      thresholds.minPoolScore == null
        ? thresholds.minPoolScore
        : finite(thresholds.minPoolScore) + finite(adjustments.thresholdDelta),
  };

  return {
    weights: adjustedWeights,
    penaltyConfig: adjustedPenalties,
    thresholds: adjustedThresholds,
    exitAggressiveness: adjustments.exitAggressiveness,
  };
}
