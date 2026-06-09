const DEFAULT_OFFENSIVE_CONFIG = {
  edgeScore: {
    weights: {
      wallet: 0.30,
      organic: 0.20,
      feeTvl: 0.25,
      confidence: 0.15,
    },
    alphaBonus: {
      PASS: 8,
      HOLD: 0,
      AVOID: -10,
    },
    blockerPenalty: {
      blocked: 25,
      hold: 8,
    },
    caps: {
      PASS: 100,
      HOLD: 70,
      AVOID: 40,
      BLOCKED: 35,
    },
  },
  entryTiming: {
    nowConfidence: 75,
    soonConfidence: 65,
    highVolatility: 8,
  },
  marketRegime: {
    hotCandidateCount: 25,
    normalCandidateCount: 15,
    chaoticBlockedRatio: 0.35,
    chaoticBlockedCount: 5,
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

function feeToScore(value) {
  return clamp(num(value) * 100);
}

function trendAdjustedOrganic(pool = {}, roi = {}) {
  const organic = num(pool.organicScore ?? pool.organic_score ?? pool.deployArgs?.organic_score ?? pool.organic);
  const trend = roi.organicTrend || {};
  const trendBoost = trend.state === "ACCELERATING" ? 10 : trend.state === "DECELERATING" ? -12 : 0;
  return clamp(organic + trendBoost);
}

function alphaState(roi = {}) {
  return String(roi.alpha?.state || "PASS").toUpperCase();
}

function defensiveStatus(roi = {}) {
  return String(roi.status?.label || "").toUpperCase();
}

export function classifyEdgeTier(score) {
  const n = num(score);
  if (n >= 85) return { label: "ELITE EDGE", tone: "elite" };
  if (n >= 75) return { label: "STRONG EDGE", tone: "strong" };
  if (n >= 60) return { label: "GOOD EDGE", tone: "good" };
  if (n >= 45) return { label: "WEAK EDGE", tone: "weak" };
  return { label: "AVOID EDGE", tone: "avoid" };
}

export function validateSignalIntegrity(pool = {}, roi = {}, offensive = {}) {
  const violations = [];
  const alpha = alphaState(roi);
  const status = defensiveStatus(roi);
  const walletScore = num(roi.wallet?.adjustedScore ?? pool.walletScore ?? pool.wallet_score ?? pool.poolScore);
  const walletLabel = roi.wallet?.classification?.label || "";
  const edge = num(offensive.edgeScore?.score);

  if (status === "BLOCKED" && edge > 35) violations.push("blocked_with_high_edge");
  if (alpha === "AVOID" && edge > 40) violations.push("avoid_with_high_edge");
  if (alpha === "AVOID" && status === "CANDIDATE") violations.push("avoid_with_candidate_status");
  if (walletScore < 40 && alpha === "PASS") violations.push("dangerous_wallet_pass_state");
  if (walletLabel === "DANGEROUS" && alpha === "PASS") violations.push("dangerous_wallet_pass_state");
  if (status === "BLOCKED" && offensive.canRank !== false) violations.push("blocked_pool_rankable");

  return { valid: violations.length === 0, violations };
}

export function calculateEdgeScore(pool = {}, roi = {}, config = DEFAULT_OFFENSIVE_CONFIG.edgeScore) {
  const weights = config.weights || DEFAULT_OFFENSIVE_CONFIG.edgeScore.weights;
  const alpha = alphaState(roi);
  const status = String(roi.status?.label || "").toUpperCase();
  const wallet = clamp(num(roi.wallet?.adjustedScore ?? pool.walletScore ?? pool.wallet_score ?? pool.poolScore));
  const organic = trendAdjustedOrganic(pool, roi);
  const feeTvl = feeToScore(roi.feeTvl?.value ?? pool.feeTvlRatio ?? pool.fee_tvl_ratio);
  const confidence = clamp(num(roi.confidence?.total ?? pool.confidence) <= 1 ? num(roi.confidence?.total ?? pool.confidence) * 100 : num(roi.confidence?.total ?? pool.confidence));
  const blockedCount = (roi.blockers?.blockedReasons || []).length;
  const holdCount = (roi.blockers?.holdReasons || []).length;
  const alphaBonus = num(config.alphaBonus?.[alpha]);
  const blockerPenalty = blockedCount * num(config.blockerPenalty?.blocked, 18) + holdCount * num(config.blockerPenalty?.hold, 8);
  const raw = wallet * weights.wallet
    + organic * weights.organic
    + feeTvl * weights.feeTvl
    + confidence * weights.confidence
    + alphaBonus
    - blockerPenalty;
  const alphaCap = num(config.caps?.[alpha], 100);
  const statusCap = status === "BLOCKED" ? num(config.caps?.BLOCKED, 35) : alphaCap;
  const cap = Math.min(alphaCap, statusCap);
  const score = Math.round(clamp(raw, 0, cap));
  const tier = classifyEdgeTier(score);
  const parts = {
    wallet: Math.round(wallet * weights.wallet),
    organic: Math.round(organic * weights.organic),
    feeTvl: Math.round(feeTvl * weights.feeTvl),
    confidence: Math.round(confidence * weights.confidence),
    alphaBonus,
    blockerPenalty,
  };
  return { score, raw: Math.round(clamp(raw)), cap, tier, parts };
}

export function calculateEntryTiming(pool = {}, roi = {}, offensive = {}, config = DEFAULT_OFFENSIVE_CONFIG.entryTiming) {
  const alpha = alphaState(roi);
  const confidence = num(roi.confidence?.total);
  const organicTrend = roi.organicTrend?.state || "STABLE";
  const organicTrendScore = num(roi.organicTrend?.score);
  const feeTrend = roi.feeTvl?.trend || "Stable";
  const walletLabel = roi.wallet?.classification?.label || "";
  const volatility = num(pool.volatility ?? pool.volatilityScore ?? pool.deployArgs?.volatility, 0);
  const reasons = [];
  let state = "WAIT";

  if (alpha === "AVOID" || roi.status?.label === "BLOCKED") {
    reasons.push("blocked signal prevents offensive timing");
    return { state: "WAIT", tone: "watch", reasons };
  }
  if (organicTrend === "DECELERATING" || feeTrend === "Weakening" || volatility >= config.highVolatility) {
    state = "LATE";
    reasons.push(organicTrend === "DECELERATING" ? "organic trend decelerating" : null);
    reasons.push(feeTrend === "Weakening" ? "fee velocity weakening" : null);
    reasons.push(volatility >= config.highVolatility ? "volatility elevated" : null);
    return { state, tone: "late", reasons: uniq(reasons) };
  }
  if (alpha === "PASS" && confidence >= config.nowConfidence && (organicTrend === "ACCELERATING" || roi.feeTvl?.classification?.label === "EXCELLENT")) {
    state = "NOW";
    reasons.push("strong momentum with PASS alpha");
  } else if (alpha === "PASS" && confidence >= config.soonConfidence && walletLabel !== "WEAK") {
    state = "5-15 MIN";
    reasons.push("healthy setup but momentum not urgent");
  } else {
    reasons.push("mixed signal needs confirmation");
  }
  if (organicTrendScore > 0) reasons.push("organic momentum supportive");
  if (roi.feeTvl?.classification?.label === "EXCELLENT" || roi.feeTvl?.classification?.label === "STRONG") reasons.push(`fee/TVL ${roi.feeTvl.classification.label}`);
  return { state, tone: state === "NOW" ? "now" : state === "5-15 MIN" ? "soon" : "watch", reasons: uniq(reasons) };
}

export function explainTopRanking(pool = {}, roi = {}, offensive = {}) {
  const reasons = [];
  const warnings = [];
  const walletLabel = roi.wallet?.classification?.label;
  const feeLabel = roi.feeTvl?.classification?.label;
  if (walletLabel === "ELITE" || walletLabel === "STRONG") reasons.push(`wallet ${walletLabel}`);
  else if (walletLabel === "NEUTRAL") reasons.push("wallet healthy enough");
  else warnings.push(`wallet ${walletLabel || "unknown"}`);
  if (feeLabel === "EXCELLENT" || feeLabel === "STRONG") reasons.push(`fee/TVL ${feeLabel}`);
  if (roi.organicTrend?.state === "ACCELERATING") reasons.push("organic accelerating");
  else if (roi.organicTrend?.state === "STABLE") reasons.push("organic stable");
  else warnings.push("organic decelerating");
  if (num(roi.confidence?.total) >= 70) reasons.push(`confidence ${Math.round(num(roi.confidence.total))}%`);
  if ((roi.blockers?.holdReasons || []).length) warnings.push(...roi.blockers.holdReasons.slice(0, 2));
  if ((roi.blockers?.blockedReasons || []).length) warnings.push(...roi.blockers.blockedReasons.slice(0, 2));
  if (offensive.entryTiming?.state) reasons.push(`entry ${offensive.entryTiming.state}`);
  return { reasons: uniq(reasons), warnings: uniq(warnings) };
}

export function enrichOffensiveEdge(pool = {}, roi = {}, config = DEFAULT_OFFENSIVE_CONFIG) {
  const edgeScore = calculateEdgeScore(pool, roi, config.edgeScore);
  const entryTiming = calculateEntryTiming(pool, roi, { edgeScore }, config.entryTiming);
  const explanation = explainTopRanking(pool, roi, { edgeScore, entryTiming });
  const alpha = alphaState(roi);
  const status = defensiveStatus(roi);
  const canRank = alpha !== "AVOID" && status !== "BLOCKED";
  const integrity = validateSignalIntegrity(pool, roi, { edgeScore, entryTiming, explanation, canRank });
  return {
    edgeScore,
    entryTiming,
    explanation,
    canRank,
    defensiveTruth: {
      alpha,
      status: alpha === "AVOID" ? "BLOCKED" : status,
    },
    integrity,
  };
}

export function buildMarketRegime(pools = [], config = DEFAULT_OFFENSIVE_CONFIG.marketRegime) {
  const counts = pools.reduce((acc, pool) => {
    const label = pool.roi?.status?.label || "CANDIDATE";
    acc[label] = (acc[label] || 0) + 1;
    return acc;
  }, {});
  const candidateCount = counts.CANDIDATE || 0;
  const watchCount = counts.WATCH || 0;
  const blockedCount = counts.BLOCKED || 0;
  const total = pools.length || 1;
  const blockedRatio = blockedCount / total;
  let state = "COLD";
  const reasons = [];
  if (blockedCount >= config.chaoticBlockedCount && blockedRatio >= config.chaoticBlockedRatio) {
    state = "CHAOTIC";
    reasons.push("blocked ratio elevated");
  } else if (candidateCount > config.hotCandidateCount) {
    state = "HOT";
    reasons.push("candidate count above hot threshold");
  } else if (candidateCount >= config.normalCandidateCount) {
    state = "NORMAL";
    reasons.push("candidate count in normal range");
  } else {
    reasons.push("candidate count below normal range");
  }
  return { state, candidateCount, watchCount, blockedCount, total: pools.length, blockedRatio: Math.round(blockedRatio * 100), reasons };
}

export function buildTopOpportunities(pools = [], limit = 5) {
  return pools
    .filter((pool) => pool?.offensive?.edgeScore && pool.offensive.canRank !== false && pool.roi?.status?.label !== "BLOCKED")
    .slice()
    .sort((a, b) => num(b.offensive.edgeScore.score) - num(a.offensive.edgeScore.score))
    .slice(0, Math.max(3, limit))
    .map((pool, index) => ({
      rank: index + 1,
      name: pool.name || pool.poolName || pool.deployArgs?.pool_name || "--",
      status: pool.roi?.status || null,
      edgeScore: pool.offensive.edgeScore,
      entryTiming: pool.offensive.entryTiming,
      explanation: pool.offensive.explanation,
      execution: pool.execution || null,
    }));
}
