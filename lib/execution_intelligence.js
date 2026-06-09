const DEFAULT_EXECUTION_CONFIG = {
  conviction: {
    extreme: 85,
    high: 72,
    medium: 55,
    low: 35,
  },
  sizing: {
    EXTREME: [12, 15],
    HIGH: [8, 12],
    MEDIUM: [4, 8],
    LOW: [1, 3],
    "NO TRADE": [0, 0],
  },
  riskBudget: {
    moderate: 35,
    high: 60,
    overexposed: 80,
    allocationCaps: {
      SAFE: 60,
      MODERATE: 45,
      "HIGH RISK": 30,
      OVEREXPOSED: 20,
    },
    perPositionCaps: {
      SAFE: 15,
      MODERATE: 12,
      "HIGH RISK": 8,
      OVEREXPOSED: 4,
    },
  },
};

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value));
}

function uniq(items) {
  return [...new Set(items.filter(Boolean))];
}

function alphaState(roi = {}) {
  return String(roi.alpha?.state || "").toUpperCase();
}

function statusLabel(roi = {}) {
  return String(roi.status?.label || "").toUpperCase();
}

function feeScore(roi = {}) {
  return clamp(num(roi.feeTvl?.value) * 100);
}

function organicScore(pool = {}, roi = {}) {
  const base = num(pool.organicScore ?? pool.organic_score ?? pool.deployArgs?.organic_score ?? pool.organic);
  const boost = roi.organicTrend?.state === "ACCELERATING" ? 8 : roi.organicTrend?.state === "DECELERATING" ? -12 : 0;
  return clamp(base + boost);
}

export function calculateConviction(pool = {}, roi = {}, offensive = {}, config = DEFAULT_EXECUTION_CONFIG.conviction, { advisoryMode = false } = {}) {
  const status = statusLabel(roi);
  const alpha = alphaState(roi);
  const hardBlockers = roi.blockers?.blockedReasons || [];
  if (status === "BLOCKED" || alpha === "AVOID" || hardBlockers.length) {
    const baseReasons = uniq(["defensive engine blocks execution", ...hardBlockers, alpha === "AVOID" ? "alpha AVOID" : null]);
    if (advisoryMode) {
      // In advisory mode, emit a low-score warning instead of hard NO TRADE.
      return {
        score: 25,
        state: "LOW",
        tone: "advisory-warning",
        advisory: true,
        warnings: baseReasons,
        reasons: uniq([...baseReasons, "advisory mode: blocked signals converted to warnings"]),
      };
    }
    return {
      score: 0,
      state: "NO TRADE",
      tone: "blocked",
      reasons: baseReasons,
    };
  }

  const wallet = clamp(num(roi.wallet?.adjustedScore ?? pool.walletScore ?? pool.wallet_score));
  const edge = clamp(num(offensive.edgeScore?.score));
  const confidence = clamp(num(roi.confidence?.total ?? pool.confidence) <= 1 ? num(roi.confidence?.total ?? pool.confidence) * 100 : num(roi.confidence?.total ?? pool.confidence));
  const fee = feeScore(roi);
  const organic = organicScore(pool, roi);
  const holdPenalty = (roi.blockers?.holdReasons || []).length * 8;
  const riskPenalty = (Array.isArray(pool.risks) ? pool.risks.length : 0) * 4;
  const alphaBonus = alpha === "PASS" ? 6 : alpha === "HOLD" ? -10 : -25;
  const score = Math.round(clamp(
    wallet * 0.22 +
    edge * 0.30 +
    confidence * 0.20 +
    fee * 0.14 +
    organic * 0.14 +
    alphaBonus -
    holdPenalty -
    riskPenalty
  ));
  let state = "LOW";
  if (score >= config.extreme) state = "EXTREME";
  else if (score >= config.high) state = "HIGH";
  else if (score >= config.medium) state = "MEDIUM";
  else if (score < config.low) state = "LOW";
  const reasons = [];
  if (wallet >= 70) reasons.push("wallet quality strong");
  else if (wallet >= 55) reasons.push("wallet quality neutral");
  else reasons.push("wallet quality weak");
  if (edge >= 75) reasons.push("edge score strong");
  if (confidence >= 70) reasons.push(`confidence ${Math.round(confidence)}%`);
  if (fee >= 70) reasons.push("fee/TVL supports carry");
  if (roi.organicTrend?.state) reasons.push(`organic ${roi.organicTrend.state}`);
  if (holdPenalty > 0) reasons.push("hold risk reduces conviction");
  return { score, state, tone: state.toLowerCase().replace(/\s+/g, "-"), reasons: uniq(reasons) };
}

export function calculatePositionSize(conviction = {}, roi = {}, config = DEFAULT_EXECUTION_CONFIG.sizing, { advisoryMode = false } = {}) {
  const status = statusLabel(roi);
  if (status === "BLOCKED" || conviction.state === "NO TRADE") {
    if (advisoryMode) {
      // In advisory mode, suggest a small test position instead of 0%.
      const range = config.LOW;
      const [minPct, maxPct] = range;
      const score = clamp(num(conviction.score));
      const span = maxPct - minPct;
      const suggestedPct = Math.round((minPct + span * (score / 100)) * 10) / 10;
      return {
        minPct,
        maxPct,
        suggestedPct,
        label: `${suggestedPct}%`,
        reason: "advisory mode: blocked pool converted to small test position",
        advisory: true,
      };
    }
    return { minPct: 0, maxPct: 0, suggestedPct: 0, label: "0%", reason: "blocked pool always 0%" };
  }
  const range = config[conviction.state] || config.LOW;
  const [minPct, maxPct] = range;
  const score = clamp(num(conviction.score));
  const span = maxPct - minPct;
  const suggestedPct = Math.round((minPct + span * (score / 100)) * 10) / 10;
  return {
    minPct,
    maxPct,
    suggestedPct,
    label: `${suggestedPct}%`,
    reason: `${conviction.state} conviction allocation band`,
  };
}

export function calculateExecutionState(conviction = {}, positionSize = {}, roi = {}, offensive = {}, { advisoryMode = false } = {}) {
  if (statusLabel(roi) === "BLOCKED" || conviction.state === "NO TRADE" || num(positionSize.suggestedPct) === 0) {
    if (advisoryMode) {
      return {
        state: "ADVISORY_ONLY",
        tone: "advisory",
        advisory: true,
        recommendedAction: "SMALL_TEST_POSITION",
        warnings: ["defensive engine flagged entry — deploy continues with advisory sizing"],
        reasons: ["advisory mode: blocked entry converted to advisory warning"],
      };
    }
    return { state: "NO ENTRY", tone: "blocked", reasons: ["defensive engine blocks entry"] };
  }
  const edge = num(offensive.edgeScore?.score);
  if ((conviction.state === "EXTREME" || conviction.state === "HIGH") && edge >= 75) {
    return { state: "AGGRESSIVE ENTRY", tone: "aggressive", reasons: ["high conviction with strong edge"] };
  }
  if (conviction.state === "MEDIUM" || (conviction.state === "HIGH" && edge < 75)) {
    return { state: "NORMAL ENTRY", tone: "normal", reasons: ["valid setup with controlled size"] };
  }
  return { state: "SMALL TEST POSITION", tone: "test", reasons: ["mixed or low conviction setup"] };
}

export function calculateRiskReward(pool = {}, roi = {}, offensive = {}, conviction = {}, { advisoryMode = false } = {}) {
  const isBlocked = statusLabel(roi) === "BLOCKED" || conviction.state === "NO TRADE";
  if (isBlocked && !advisoryMode) {
    return { expectedRiskPct: 0, expectedRewardPct: 0, rr: 0, label: "NO TRADE", reasons: ["blocked trade has no projection"] };
  }
  const edge = num(offensive.edgeScore?.score);
  const fee = feeScore(roi);
  const confidence = num(roi.confidence?.total);
  const holdRisks = (roi.blockers?.holdReasons || []).length;
  const volatility = num(pool.volatility ?? pool.volatilityScore ?? pool.deployArgs?.volatility, 4);
  const expectedRiskPct = -Math.round((4 + volatility * 0.7 + holdRisks * 1.5) * 10) / 10;
  const expectedRewardPct = Math.round((6 + edge * 0.12 + fee * 0.05 + confidence * 0.04) * 10) / 10;
  const rr = Math.round((expectedRewardPct / Math.max(1, Math.abs(expectedRiskPct))) * 10) / 10;
  return {
    expectedRiskPct,
    expectedRewardPct,
    rr,
    label: `${rr}x`,
    advisory: isBlocked && advisoryMode ? true : undefined,
    reasons: [`edge ${Math.round(edge)}`, `confidence ${Math.round(confidence)}%`, `risk ${expectedRiskPct}%`],
  };
}

export function enrichExecutionIntelligence(pool = {}, roi = {}, offensive = {}, config = DEFAULT_EXECUTION_CONFIG, { advisoryMode = false } = {}) {
  const conviction = calculateConviction(pool, roi, offensive, config.conviction, { advisoryMode });
  const positionSize = calculatePositionSize(conviction, roi, config.sizing, { advisoryMode });
  const executionState = calculateExecutionState(conviction, positionSize, roi, offensive, { advisoryMode });
  const riskReward = calculateRiskReward(pool, roi, offensive, conviction, { advisoryMode });
  const wasBlocked = statusLabel(roi) === "BLOCKED" || (roi.blockers?.blockedReasons || []).length > 0 || alphaState(roi) === "AVOID";
  const advisoryLog = advisoryMode ? {
    event: "execution_intelligence_advisory_override",
    mode: "advisory",
    originalState: wasBlocked ? "BLOCKED/NO_TRADE" : null,
    effectiveState: executionState.state,
    recommendedAction: executionState.recommendedAction || null,
    conviction: conviction.score,
    warnings: [...(conviction.warnings || []), ...(executionState.warnings || [])],
  } : null;
  return { conviction, positionSize, executionState, riskReward, advisoryLog };
}

function portfolioExecutionState(baseState, adjustedPct, budgetState) {
  if (adjustedPct <= 0) return "NO ENTRY";
  if (budgetState === "OVEREXPOSED") return "SMALL TEST POSITION";
  if (budgetState === "HIGH RISK" && baseState === "AGGRESSIVE ENTRY") return "NORMAL ENTRY";
  return baseState;
}

export function buildCapitalAllocation(pools = [], limit = 6, riskBudget = {}, config = DEFAULT_EXECUTION_CONFIG.riskBudget) {
  const ranked = pools
    .filter((p) => p.execution?.positionSize && p.execution.positionSize.suggestedPct > 0)
    .slice()
    .sort((a, b) => {
      const bs = num(b.execution.positionSize.suggestedPct) - num(a.execution.positionSize.suggestedPct);
      if (bs !== 0) return bs;
      return num(b.offensive?.edgeScore?.score) - num(a.offensive?.edgeScore?.score);
    })
    .slice(0, limit);
  const budgetState = riskBudget.state || "SAFE";
  const allocationCap = num(riskBudget.allocationCapPct ?? config.allocationCaps?.[budgetState], 60);
  const perPositionCap = num(config.perPositionCaps?.[budgetState], 15);
  let remaining = allocationCap;
  return ranked.map((pool, index) => {
    const rawSuggestedPct = num(pool.execution.positionSize.suggestedPct);
    const suggestedPct = Math.round(Math.max(0, Math.min(rawSuggestedPct, perPositionCap, remaining)) * 10) / 10;
    remaining = Math.max(0, Math.round((remaining - suggestedPct) * 10) / 10);
    const executionState = portfolioExecutionState(pool.execution.executionState.state, suggestedPct, budgetState);
    return {
      rank: index + 1,
      name: pool.name || pool.poolName || pool.deployArgs?.pool_name || "--",
      rawSuggestedPct,
      suggestedPct,
      label: `${suggestedPct}%`,
      conviction: pool.execution.conviction.state,
      executionState,
      budgetState,
      edge: pool.offensive?.edgeScore?.score ?? null,
    };
  });
}

export function buildPortfolioRiskBudget(pools = [], config = DEFAULT_EXECUTION_CONFIG.riskBudget) {
  const executable = pools.filter((p) => p.execution?.positionSize?.suggestedPct > 0);
  const riskExposure = Math.round(executable.reduce((sum, p) => {
    const size = num(p.execution.positionSize.suggestedPct);
    const conviction = p.execution.conviction?.state;
    const riskWeight = conviction === "LOW" ? 1.5 : conviction === "MEDIUM" ? 1.1 : 0.85;
    return sum + size * riskWeight;
  }, 0) * 10) / 10;
  let state = "SAFE";
  if (riskExposure >= config.overexposed) state = "OVEREXPOSED";
  else if (riskExposure >= config.high) state = "HIGH RISK";
  else if (riskExposure >= config.moderate) state = "MODERATE";
  const allocationCapPct = num(config.allocationCaps?.[state], 60);
  return {
    state,
    riskExposurePct: riskExposure,
    allocationCapPct,
    executableCount: executable.length,
    excludedBlocked: pools.filter((p) => p.roi?.status?.label === "BLOCKED").length,
    reasons: [`${executable.length} executable pools`, `${riskExposure}% raw exposure`, `${allocationCapPct}% portfolio cap`],
  };
}

export function applyPortfolioAllocation(pools = [], allocation = []) {
  const byName = new Map(allocation.map((row) => [String(row.name || "").toUpperCase(), row]));
  for (const pool of pools) {
    const name = String(pool.name || pool.poolName || pool.deployArgs?.pool_name || "").toUpperCase();
    const row = byName.get(name);
    const adjustedPct = row?.suggestedPct ?? 0;
    const adjustedState = row?.executionState || "NO ENTRY";
    pool.execution = {
      ...(pool.execution || {}),
      portfolioAllocation: {
        adjustedPct,
        label: `${adjustedPct}%`,
        rawSuggestedPct: pool.execution?.positionSize?.suggestedPct ?? 0,
        budgetState: row?.budgetState || null,
        executionState: adjustedState,
      },
    };
  }
  return pools;
}
