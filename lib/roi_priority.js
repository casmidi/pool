const DEFAULT_ROI_CONFIG = {
  wallet: {
    elite: 85,
    strong: 70,
    neutral: 55,
    weak: 40,
    suspiciousClusterWallets: 4,
    repetitiveReuseCount: 3,
    extremeConcentrationPct: 65,
    copyFarmSignals: 6,
  },
  feeTvl: {
    excellent: 1.0,
    strong: 0.7,
    healthy: 0.4,
    weak: 0.2,
    stableDelta: 0.03,
  },
  organicTrend: {
    accelerating: 18,
    decelerating: -14,
  },
  confidenceWeights: {
    wallet: 0.28,
    organic: 0.24,
    feeTvl: 0.20,
    antiCrowd: 0.14,
    survival: 0.14,
  },
};

function num(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function pct(value) {
  const n = num(value, null);
  if (n == null) return null;
  return n <= 1 ? n * 100 : n;
}

function firstNumber(...values) {
  for (const value of values) {
    const n = num(value, null);
    if (n != null) return n;
  }
  return null;
}

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value));
}

function hasRisk(pool, pattern) {
  const risks = [
    ...(Array.isArray(pool?.risks) ? pool.risks : []),
    ...(Array.isArray(pool?.reasons) ? pool.reasons : []),
    pool?.reason,
  ].filter(Boolean).join(" ").toLowerCase();
  return pattern.test(risks);
}

function collectReasons(...groups) {
  return [...new Set(groups.flat().filter(Boolean))];
}

export function classifyWalletScore(score, config = DEFAULT_ROI_CONFIG.wallet) {
  const n = num(score, 0);
  if (n >= config.elite) return { label: "ELITE", tone: "elite", score: n };
  if (n >= config.strong) return { label: "STRONG", tone: "strong", score: n };
  if (n >= config.neutral) return { label: "NEUTRAL", tone: "neutral", score: n };
  if (n >= config.weak) return { label: "WEAK", tone: "weak", score: n };
  return { label: "DANGEROUS", tone: "danger", score: n };
}

export function calculateWalletPenalty(pool = {}, config = DEFAULT_ROI_CONFIG.wallet) {
  const penalties = [];
  const clusterWallets = firstNumber(pool.clusterWalletCount, pool.walletClusterCount, pool.alphaEdge?.cluster?.walletCount);
  const reuseCount = firstNumber(pool.reuseCount, pool.walletReuseCount, pool.repeatWalletCount);
  const concentrationPct = pct(firstNumber(pool.walletConcentrationPct, pool.concentrationPct, pool.topWalletPct));
  const copySignals = firstNumber(pool.copySignalCount, pool.copySignals, pool.alphaEdge?.crowd?.walletCount);

  if ((clusterWallets ?? 0) >= config.suspiciousClusterWallets) {
    penalties.push({ type: "suspicious_clustering", points: 10, reason: `${clusterWallets} wallets clustered around the pool` });
  }
  if ((reuseCount ?? 0) >= config.repetitiveReuseCount || hasRisk(pool, /duplicate|reuse|repetitive/)) {
    penalties.push({ type: "repetitive_wallet_reuse", points: 8, reason: "wallet reuse pattern reduces independent alpha" });
  }
  if ((concentrationPct ?? 0) >= config.extremeConcentrationPct) {
    penalties.push({ type: "extreme_concentration", points: 12, reason: `top wallet concentration ${Math.round(concentrationPct)}%` });
  }
  if ((copySignals ?? 0) >= config.copyFarmSignals || hasRisk(pool, /copy.?farm|farm|saturation|crowd/)) {
    penalties.push({ type: "copy_farm_behavior", points: 14, reason: "copy crowd/farm risk detected" });
  }
  if (hasRisk(pool, /abnormal|suspicious|bot|sybil/)) {
    penalties.push({ type: "abnormal_wallet_pattern", points: 12, reason: "abnormal wallet pattern detected in risk signals" });
  }

  const total = penalties.reduce((sum, penalty) => sum + penalty.points, 0);
  return { total, penalties };
}

export function generateWalletInsights(pool = {}, config = DEFAULT_ROI_CONFIG.wallet) {
  const rawScore = firstNumber(pool.walletScore, pool.wallet_score, pool.deployArgs?.wallet_score, pool.poolScore, pool.score, 0);
  const penalty = calculateWalletPenalty(pool, config);
  const adjustedScore = clamp(rawScore - penalty.total);
  const classification = classifyWalletScore(adjustedScore, config);
  const strengths = [];
  const risks = [];

  if (rawScore >= config.strong) strengths.push(`wallet score ${Math.round(rawScore)} shows strong historical edge`);
  if ((pool.walletRank ?? pool.source_wallet_rank) && Number(pool.walletRank ?? pool.source_wallet_rank) <= 3) {
    strengths.push(`top-${Number(pool.walletRank ?? pool.source_wallet_rank)} wallet timing`);
  }
  if (pool.walletGrade) strengths.push(`wallet grade ${pool.walletGrade}`);
  if (classification.label === "ELITE") strengths.push("elite wallet tier after penalties");
  if (classification.label === "DANGEROUS" || classification.label === "WEAK") risks.push(`wallet classified ${classification.label}`);
  for (const p of penalty.penalties) risks.push(p.reason);
  if (!strengths.length) strengths.push(`wallet score ${Math.round(rawScore)} has limited alpha evidence`);

  return { strengths, risks, classification, rawScore, adjustedScore, penalty };
}

export function classifyFeeTVL(value, config = DEFAULT_ROI_CONFIG.feeTvl) {
  const n = num(value, 0);
  if (n > config.excellent) return { label: "EXCELLENT", tone: "elite", value: n };
  if (n >= config.strong) return { label: "STRONG", tone: "strong", value: n };
  if (n >= config.healthy) return { label: "HEALTHY", tone: "neutral", value: n };
  if (n >= config.weak) return { label: "WEAK", tone: "weak", value: n };
  return { label: "DANGEROUS", tone: "danger", value: n };
}

export function generateFeeTVLInsight(pool = {}, config = DEFAULT_ROI_CONFIG.feeTvl) {
  const feeTvl = firstNumber(pool.feeTvlRatio, pool.fee_tvl_ratio, pool.deployArgs?.fee_tvl_ratio, pool.feeTvl, 0);
  const previous = firstNumber(pool.previousFeeTvlRatio, pool.prevFeeTvlRatio, pool.feeTvlPrevious);
  const classification = classifyFeeTVL(feeTvl, config);
  const strengths = [];
  const warnings = [];
  let trend = "Stable";

  if (previous != null) {
    const delta = feeTvl - previous;
    if (delta > config.stableDelta) trend = "Improving";
    else if (delta < -config.stableDelta) trend = "Weakening";
  }
  if (classification.label === "EXCELLENT" || classification.label === "STRONG") {
    strengths.push(`fee/TVL ${feeTvl.toFixed(2)} supports positive carry`);
  } else if (classification.label === "HEALTHY") {
    strengths.push(`fee/TVL ${feeTvl.toFixed(2)} is viable if volatility remains controlled`);
  } else {
    warnings.push(`fee/TVL ${feeTvl.toFixed(2)} may not compensate IL and transaction cost`);
  }
  if (trend === "Improving") strengths.push("fee/TVL trend is improving");
  if (trend === "Weakening") warnings.push("fee/TVL trend is weakening");

  return { status: classification.label, strengths, warnings, trend, classification, value: feeTvl };
}

export function generateOrganicTrend(pool = {}, config = DEFAULT_ROI_CONFIG.organicTrend) {
  const raw = pool.breakdown?.raw || pool.confidenceBreakdown?.raw || pool.decision_breakdown?.raw || pool.deployArgs?.decision_breakdown?.raw || {};
  const organic = firstNumber(pool.organicScore, pool.organic_score, pool.deployArgs?.organic_score, raw.organicScore, pool.organic, 0);
  const buyAcceleration = firstNumber(pool.buyAcceleration, pool.buy_acceleration, pool.alphaEdge?.momentum?.buyAcceleration, pool.alpha_edge?.momentum?.buyAcceleration, raw.buyAcceleration);
  const walletGrowth = firstNumber(pool.walletGrowth, pool.wallet_growth, pool.alphaEdge?.wallet?.growth, pool.alpha_edge?.wallet?.growth, raw.walletGrowth);
  const volumeChange = firstNumber(pool.volumeChange, pool.volume_change, pool.alphaEdge?.volume?.change, pool.alpha_edge?.volume?.change, raw.volumeChange);
  const feeVelocity = firstNumber(pool.feeVelocity, pool.fee_velocity, pool.alphaEdge?.fee?.velocity, pool.alpha_edge?.fee?.velocity, raw.feeVelocity);
  const participationDensity = firstNumber(pool.participationDensity, pool.participation_density, pool.alphaEdge?.participation?.density, pool.alpha_edge?.participation?.density, raw.participationDensity);
  const previousOrganic = firstNumber(pool.previousOrganicScore, pool.prevOrganicScore, pool.organicPrevious, raw.previousOrganicScore);
  const inputs = { buyAcceleration, walletGrowth, volumeChange, feeVelocity, participationDensity };
  const available = Object.entries(inputs).filter(([, value]) => value != null);
  let score = 0;
  const drivers = [];
  const warnings = [];

  for (const [key, value] of available) {
    const normalized = Math.abs(value) <= 1 ? value * 100 : value;
    score += normalized;
    const label = key.replace(/[A-Z]/g, (m) => ` ${m.toLowerCase()}`);
    if (normalized >= 8) drivers.push(`${label} improving`);
    if (normalized <= -8) warnings.push(`${label} weakening`);
  }
  if (available.length) score /= available.length;
  else if (previousOrganic != null) score = organic - previousOrganic;
  else if (organic >= 75) {
    score = 8;
    drivers.push("organic quality is high");
  } else if (organic < 55 && organic > 0) {
    score = -8;
    warnings.push("organic quality is below neutral");
  }

  let state = "STABLE";
  if (score >= config.accelerating) state = "ACCELERATING";
  else if (score <= config.decelerating) state = "DECELERATING";
  if (!drivers.length && state !== "DECELERATING") drivers.push("organic momentum stable");
  if (!warnings.length && state === "DECELERATING") warnings.push("organic momentum is decelerating");

  return { state, score: Math.round(score), drivers, warnings, inputs };
}

export function generateBlockerReasons(pool = {}) {
  const wallet = generateWalletInsights(pool);
  const fee = generateFeeTVLInsight(pool);
  const organicTrend = generateOrganicTrend(pool);
  const alpha = pool.alphaEdge || pool.alpha_edge || pool.deployArgs?.alpha_edge || {};
  const blockedReasons = [];
  const holdReasons = [];
  const positiveSignals = [];
  const riskItems = Array.isArray(pool.risks) ? pool.risks : [];

  if (wallet.classification.label === "DANGEROUS") blockedReasons.push("dangerous wallet quality");
  if (wallet.classification.label === "WEAK") holdReasons.push("weak wallet quality caps alpha to HOLD");
  if (fee.classification.label === "DANGEROUS") blockedReasons.push("fee/TVL is DANGEROUS");
  if (riskItems.includes("low_wallet_score")) holdReasons.push("wallet score below minimum");
  if (riskItems.includes("out_of_range")) holdReasons.push("pool is out of range");
  if (riskItems.includes("copy_farm") || hasRisk(pool, /copy.?farm|saturation|crowd/)) holdReasons.push("crowd/copy risk increasing");
  if (hasRisk(pool, /safety|blocked|rug|honeypot/)) blockedReasons.push("hard safety blocker detected");
  if (organicTrend.state === "DECELERATING") holdReasons.push("organic momentum decelerating");
  if (Array.isArray(alpha.holdReasons)) holdReasons.push(...alpha.holdReasons.map((r) => `alpha hold: ${r}`));

  if (wallet.classification.label === "ELITE" || wallet.classification.label === "STRONG") positiveSignals.push(`wallet ${wallet.classification.label}`);
  if (wallet.classification.label === "NEUTRAL") positiveSignals.push("wallet quality healthy enough");
  if (fee.classification.label === "EXCELLENT" || fee.classification.label === "STRONG") positiveSignals.push(`fee/TVL ${fee.classification.label}`);
  if (num(pool.organicScore ?? pool.organic_score ?? pool.organic, 0) >= 75) positiveSignals.push("organic quality >= 75");
  if (organicTrend.state === "ACCELERATING") positiveSignals.push("organic trend ACCELERATING");
  if (organicTrend.state === "STABLE") positiveSignals.push("organic trend STABLE");
  if (!blockedReasons.length) positiveSignals.push("no hard blocker detected");

  return { blockedReasons, holdReasons, positiveSignals };
}

export function classifyAlphaDecision(pool = {}) {
  const blocker = generateBlockerReasons(pool);
  const wallet = generateWalletInsights(pool);
  const alpha = pool.alphaEdge || pool.alpha_edge || pool.deployArgs?.alpha_edge || {};
  const action = String(alpha.action || pool.action || "").toUpperCase();
  let state = "PASS";
  const adjustedWallet = wallet.adjustedScore;
  if (blocker.blockedReasons.length || adjustedWallet < DEFAULT_ROI_CONFIG.wallet.weak || action === "AVOID") state = "AVOID";
  else if (blocker.holdReasons.length || adjustedWallet < DEFAULT_ROI_CONFIG.wallet.neutral || action === "HOLD" || action === "SKIP") state = "HOLD";
  return {
    state,
    explanation: collectReasons(blocker.blockedReasons, blocker.holdReasons, blocker.positiveSignals),
  };
}

export function generateConfidenceBreakdown(pool = {}, config = DEFAULT_ROI_CONFIG.confidenceWeights) {
  const raw = pool.breakdown?.raw || pool.confidenceBreakdown?.raw || pool.decision_breakdown?.raw || pool.deployArgs?.decision_breakdown?.raw || {};
  const walletScore = firstNumber(pool.walletScore, pool.wallet_score, pool.deployArgs?.wallet_score, raw.walletScore, pool.poolScore, 0);
  const organic = firstNumber(pool.organicScore, pool.organic_score, pool.deployArgs?.organic_score, raw.organicScore, pool.organic, 0);
  const fee = firstNumber(pool.feeTvlRatio, pool.fee_tvl_ratio, pool.deployArgs?.fee_tvl_ratio, raw.feeTvl, 0);
  const crowdPenalty = Math.abs(num(pool.alphaEdge?.crowd?.penalty ?? pool.alpha_edge?.crowd?.penalty, 0));
  const survival = firstNumber(pool.alphaEdge?.survival?.score, pool.alpha_edge?.survival?.score, 50);
  const parts = {
    wallet: Math.round(clamp(walletScore) * config.wallet),
    organic: Math.round(clamp(organic) * config.organic),
    feeTvl: Math.round(clamp(fee * 100) * config.feeTvl),
    antiCrowd: Math.round(clamp(100 - crowdPenalty * 100) * config.antiCrowd),
    survival: Math.round(clamp(survival) * config.survival),
  };
  const total = Object.values(parts).reduce((sum, v) => sum + v, 0);
  return { total: clamp(total), rawTotal: clamp(total), parts, corrections: [] };
}

export function correctConfidence(confidence = {}, pool = {}, alpha = {}, blockers = {}, wallet = {}) {
  let total = num(confidence.total, 0);
  const rawTotal = total;
  const corrections = [];
  if ((blockers.blockedReasons || []).length) {
    total -= 15;
    corrections.push("hard blocker penalty -15");
  }
  if (num(wallet.adjustedScore, 0) < DEFAULT_ROI_CONFIG.wallet.weak) {
    total *= 0.6;
    corrections.push("dangerous wallet multiplier 0.6");
  }
  if (alpha.state === "AVOID" && total > 45) {
    total = 45;
    corrections.push("AVOID confidence cap 45%");
  }
  return {
    ...confidence,
    rawTotal: Math.round(rawTotal),
    total: Math.round(clamp(total)),
    corrections,
  };
}

export function deriveDecisionStatus({ alpha, wallet, confidence, blockers }) {
  const walletReason = wallet.classification?.label ? `wallet ${wallet.classification.label}` : null;
  const feeReason = blockers.positiveSignals?.find((r) => r.startsWith("fee/TVL")) || null;
  const organicReason = blockers.positiveSignals?.find((r) => r.startsWith("organic")) || null;
  const confidenceReason = Number.isFinite(Number(confidence.total)) ? `confidence ${Math.round(Number(confidence.total))}%` : null;
  const crowdReason = (blockers.holdReasons || []).some((r) => /crowd|copy/i.test(r)) ? "crowd risk elevated" : "crowd risk low";
  if ((blockers.blockedReasons || []).length || alpha.state === "AVOID") {
    const reasons = collectReasons(blockers.blockedReasons, walletReason, alpha.state === "AVOID" ? "alpha decision AVOID" : null, blockers.holdReasons, organicReason, confidenceReason);
    return { label: "BLOCKED", tone: "blocked", reasonLabel: "WHY BLOCKED", reasons };
  }
  if (alpha.state === "HOLD" || wallet.classification?.label === "WEAK") {
    const reasons = collectReasons(blockers.holdReasons, walletReason, alpha.state === "HOLD" ? "alpha decision HOLD" : null, feeReason, organicReason, confidenceReason);
    return { label: "WATCH", tone: "watch", reasonLabel: "WHY HOLD", reasons };
  }
  if (num(confidence.total, 0) < 45) {
    return { label: "WATCH", tone: "watch", reasonLabel: "WHY HOLD", reasons: collectReasons("confidence below trade-quality threshold", blockers.holdReasons, walletReason, feeReason, organicReason) };
  }
  return { label: "CANDIDATE", tone: "candidate", reasonLabel: "WHY PASS", reasons: collectReasons(walletReason, feeReason, organicReason, confidenceReason, crowdReason, blockers.positiveSignals, alpha.explanation) };
}

export function enrichRoiPriority(pool = {}) {
  const wallet = generateWalletInsights(pool);
  const feeTvl = generateFeeTVLInsight(pool);
  const organicTrend = generateOrganicTrend(pool);
  const blockers = generateBlockerReasons(pool);
  const alpha = classifyAlphaDecision(pool);
  const confidence = correctConfidence(generateConfidenceBreakdown(pool), pool, alpha, blockers, wallet);
  const status = deriveDecisionStatus({ alpha, wallet, confidence, blockers });
  return {
    wallet,
    feeTvl,
    organicTrend,
    blockers,
    alpha,
    confidence,
    status,
  };
}
