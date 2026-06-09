import { buildGoldenDataset, buildLiveValidationPayload } from "./live_validation.js";
import { buildSelfPreservationPayload } from "./self_preservation.js";
import { detectSignalLoss } from "./source_truth.js";

function num(value, fallback = 0) {
  if (value === null || value === undefined || value === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function round(value, digits = 2) {
  const m = 10 ** digits;
  return Math.round(num(value) * m) / m;
}

function isoTime(value) {
  const date = new Date(value || 0);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function isClosedTruthValidTrade(trade = {}) {
  const closed = (trade.status === "closed" || trade.close_time) && Number.isFinite(Number(trade.pnl_pct ?? trade.pnlPct));
  if (!closed) return false;
  const loss = trade.signal_loss || detectSignalLoss(trade);
  return loss.state === "SIGNAL_OK" && loss.promotionAllowed !== false;
}

function isSandboxTrade(trade = {}) {
  const mode = String(
    trade.execution_mode
      || trade.entry_truth?.decision?.executionMode
      || trade.decision_snapshot?.executionMode
      || trade.mode
      || ""
  ).toUpperCase();
  return Boolean(trade.sandbox_evidence || trade.sandbox_mode || mode.includes("SANDBOX"));
}

function tradeTime(trade = {}) {
  return new Date(trade.close_time || trade.deploy_time || trade.open_time || 0).getTime();
}

export function buildSandboxCapitalEngine(liveValidation = {}, selfPreservation = {}) {
  const truthValidTrades = num(liveValidation.goldenDataset?.truthValidTrades);
  const inLockdown = selfPreservation.selfPreservation?.state === "LOCKDOWN";
  const recommendedPositionPct = truthValidTrades < 10 ? 0.25 : truthValidTrades < 30 ? 0.5 : 1;
  return {
    state: truthValidTrades < 30 ? "SANDBOX_ONLY_ACTIVE" : "SANDBOX_OPTIONAL",
    purpose: "INFORMATION_PURCHASE",
    capitalType: "SANDBOX_OR_DRY_RUN_ONLY",
    liveRiskOverride: false,
    lockdownBypass: inLockdown ? "EVIDENCE_COLLECTION_ONLY" : "NOT_NEEDED",
    recommendedPositionPct,
    maxPositionPct: 1,
    minPositionPct: 0.25,
    totalExposureCapPct: 2.5,
    dailyRiskCapPct: 1,
    rules: [
      "defensive engine always wins",
      "never exceed 1% position size",
      "no aggressive entry in sandbox evidence mode",
      "sandbox decision is measurement, not profit seeking",
    ],
  };
}

export function buildEvidenceCollectionMode(liveValidation = {}, selfPreservation = {}) {
  const truthValidTrades = num(liveValidation.goldenDataset?.truthValidTrades);
  const active = truthValidTrades < 30;
  return {
    state: active ? "EVIDENCE_COLLECTION_MODE" : "STANDARD_VALIDATION_MODE",
    active,
    truthValidTrades,
    targetTruthValidTrades: 30,
    remainingToTier1: Math.max(0, 30 - truthValidTrades),
    allowedDuringLockdown: selfPreservation.selfPreservation?.state === "LOCKDOWN",
    mandatoryGates: [
      "A+ setup only",
      "highest confidence bucket only",
      "strong FeeTVL only",
      "lowest rug probability available",
      "low OOR preferred",
      "shadow comparison mandatory",
      "immutable entry truth required",
    ],
    blockedActions: [
      "aggressive risk",
      "confidence promotion",
      "live capital escalation",
      "learning from corrupted legacy trades",
    ],
  };
}

export function buildCapitalFirewall(trades = [], sandboxCapital = {}) {
  const openSandbox = trades.filter((trade) => {
    const open = trade.status === "open" || (!trade.close_time && trade.deploy_time);
    return open && isSandboxTrade(trade);
  });
  const recentSandboxClosed = trades
    .filter((trade) => isSandboxTrade(trade) && (trade.status === "closed" || trade.close_time))
    .sort((a, b) => tradeTime(b) - tradeTime(a));
  const lossCluster = recentSandboxClosed.slice(0, 3).length === 3
    && recentSandboxClosed.slice(0, 3).every((trade) => num(trade.pnl_pct ?? trade.pnlPct) < 0);
  const assumedOpenExposurePct = round(openSandbox.length * num(sandboxCapital.recommendedPositionPct, 0.25));
  const totalExposureCapPct = num(sandboxCapital.totalExposureCapPct, 2.5);
  const maxSimultaneousPositions = 2;
  const blockers = [];
  if (assumedOpenExposurePct >= totalExposureCapPct) blockers.push("total sandbox exposure cap reached");
  if (openSandbox.length >= maxSimultaneousPositions) blockers.push("simultaneous sandbox position cap reached");
  if (lossCluster) blockers.push("abnormal sandbox loss cluster detected");
  return {
    state: "CAPITAL_FIREWALL_ACTIVE",
    newSandboxAllowed: blockers.length === 0,
    blockers,
    caps: {
      maxPositionPct: 1,
      totalExposureCapPct,
      maxSimultaneousPositions,
      dailyRiskCapPct: num(sandboxCapital.dailyRiskCapPct, 1),
    },
    current: {
      openSandboxPositions: openSandbox.length,
      assumedOpenExposurePct,
      recentSandboxClosed: recentSandboxClosed.length,
      abnormalLossCluster: lossCluster,
    },
    rule: "firewall can block sandbox evidence even when evidence mode is active",
  };
}

function infoTier(score) {
  if (score >= 80) return "CRITICAL";
  if (score >= 60) return "HIGH";
  if (score >= 35) return "MEDIUM";
  return "LOW";
}

function candidateKey(candidate = {}) {
  return candidate.id || candidate.pool || candidate.name || candidate.symbol || "unknown";
}

function scoreCandidate(candidate = {}) {
  const reasons = [];
  let score = 10;
  const action = String(candidate.suggestedAction || candidate.action || "").toUpperCase();
  const status = String(candidate.currentStatus || candidate.status || "").toUpperCase();
  const text = [
    action,
    status,
    ...(candidate.reasons || []),
    candidate.reason || "",
    candidate.walletTruth || "",
  ].join(" ").toUpperCase();

  if (action.includes("SHADOW")) {
    score += 20;
    reasons.push("shadow candidate");
  }
  if (text.includes("SOFT") || text.includes("WATCHLIST") || text.includes("TEST_POSITION")) {
    score += 20;
    reasons.push("soft-block or test-position candidate");
  }
  if (text.includes("CONTEXT")) {
    score += 15;
    reasons.push("contextual danger signal");
  }
  if (text.includes("WALLET") && (text.includes("REPAIR") || text.includes("NEUTRAL") || text.includes("FALSE"))) {
    score += 20;
    reasons.push("wallet truth repair candidate");
  }
  if (num(candidate.blockerConfidence, 100) < 70) {
    score += 10;
    reasons.push("defensive uncertainty worth measuring");
  }
  if (Number.isFinite(Number(candidate.pnlPct)) && Math.abs(num(candidate.pnlPct)) >= 10) {
    score += 10;
    reasons.push("large historical outcome gap");
  }
  if (text.includes("HARD_BLOCK") || text.includes("DANGEROUS")) {
    score -= 20;
    reasons.push("hard-danger penalty");
  }

  score = Math.max(0, Math.min(100, score));
  return { score, tier: infoTier(score), reasons };
}

export function buildHighInformationValueTrades({ shadowExperiment = {}, walletTruth = {} } = {}) {
  const candidates = [];
  for (const candidate of shadowExperiment.shadowExecution?.candidates || []) {
    candidates.push({ ...candidate, source: "shadow_execution" });
  }
  for (const candidate of walletTruth.reclassificationSamples || walletTruth.samples || []) {
    candidates.push({ ...candidate, source: "wallet_truth" });
  }
  const seen = new Set();
  const scored = candidates
    .map((candidate) => {
      const info = scoreCandidate(candidate);
      return {
        id: candidateKey(candidate),
        pool: candidate.pool || candidate.name || "unknown",
        source: candidate.source,
        informationValueScore: info.score,
        tier: info.tier,
        learningReasons: info.reasons,
        sandboxEligible: info.score >= 35 && !info.reasons.includes("hard-danger penalty"),
        note: "historical shadow candidate only; live defensive gates still required",
      };
    })
    .filter((candidate) => {
      const key = `${candidate.source}:${candidate.id}:${candidate.pool}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => b.informationValueScore - a.informationValueScore)
    .slice(0, 15);

  return {
    state: scored.length ? "INFORMATION_VALUE_AVAILABLE" : "WAITING_FOR_LIVE_CANDIDATES",
    metric: "INFORMATION_VALUE_SCORE",
    candidates: scored,
    rules: [
      "high information value is never an execution approval",
      "candidate must still pass defensive truth and capital firewall",
      "prefer disagreement cases that can teach blocker precision",
    ],
  };
}

export function buildControlledGraduation(liveValidation = {}, selfPreservation = {}) {
  const count = num(liveValidation.goldenDataset?.truthValidTrades);
  const confidence = num(liveValidation.quantConfidence?.edgeConfidence);
  const regressionSafe = selfPreservation.edgeDecay?.state === "EDGE_STABLE" || count < 30;
  let stage = "LOCKDOWN_SANDBOX_ONLY";
  let next = 30;
  if (count >= 250) {
    stage = "TRUSTED";
    next = null;
  } else if (count >= 100) {
    stage = "NORMAL_CANDIDATE";
    next = 250;
  } else if (count >= 50) {
    stage = "CAUTION";
    next = 100;
  } else if (count >= 30) {
    stage = "DEFENSIVE";
    next = 50;
  }
  return {
    stage,
    truthValidTrades: count,
    nextStageAt: next,
    nextStageNeeds: next ? Math.max(0, next - count) : 0,
    promotionAllowed: count >= 30 && confidence >= 30 && regressionSafe,
    requirements: {
      stableProfitFactor: count >= 30 ? "REQUIRED" : "PENDING_SAMPLE",
      acceptableDrawdown: count >= 30 ? "REQUIRED" : "PENDING_SAMPLE",
      signalIntegrityHealthy: liveValidation.goldenDataset?.rejectedCorruptedTrades === 0 && count > 0,
      noRegression: regressionSafe,
    },
    ladder: [
      { minTruthValidTrades: 0, stage: "LOCKDOWN_SANDBOX_ONLY" },
      { minTruthValidTrades: 30, stage: "DEFENSIVE" },
      { minTruthValidTrades: 50, stage: "CAUTION" },
      { minTruthValidTrades: 100, stage: "NORMAL_CANDIDATE" },
      { minTruthValidTrades: 250, stage: "TRUSTED" },
    ],
  };
}

export function buildSandboxVsShadowValidation(trades = []) {
  const sandboxTruth = trades.filter((trade) => isSandboxTrade(trade) && isClosedTruthValidTrade(trade));
  const driftSamples = sandboxTruth.map((trade) => {
    const shadowPnl = num(trade.entry_truth?.shadow?.expectedPnlPct ?? trade.decision_snapshot?.shadow?.expectedPnlPct, null);
    const actualPnl = num(trade.pnl_pct ?? trade.pnlPct, null);
    return {
      id: trade.id || trade.pool_name || trade.pool_address || "unknown",
      pool: trade.pool_name || trade.pool_address || "unknown",
      actualPnlPct: actualPnl,
      shadowPnlPct: shadowPnl,
      pnlDriftPct: Number.isFinite(shadowPnl) && Number.isFinite(actualPnl) ? round(actualPnl - shadowPnl) : null,
      slippagePct: trade.slippage_pct ?? null,
      timingDeviationMin: trade.timing_deviation_min ?? null,
      oorDivergenceMin: trade.oor_divergence_min ?? null,
    };
  });
  const measurableDrift = driftSamples.filter((sample) => Number.isFinite(Number(sample.pnlDriftPct)));
  const avgDrift = measurableDrift.length
    ? round(measurableDrift.reduce((sum, sample) => sum + num(sample.pnlDriftPct), 0) / measurableDrift.length)
    : null;
  let alignment = "UNKNOWN";
  if (measurableDrift.length >= 10 && Math.abs(avgDrift) <= 3) alignment = "GOOD";
  else if (measurableDrift.length >= 5 && Math.abs(avgDrift) <= 6) alignment = "WARNING";
  else if (measurableDrift.length >= 5) alignment = "BAD";
  return {
    realityAlignment: alignment,
    sampleSize: sandboxTruth.length,
    metrics: {
      avgPnlDriftPct: avgDrift,
      slippage: sandboxTruth.length ? "MEASURABLE_WHEN_RECORDED" : "NO_SANDBOX_SAMPLE",
      executionQuality: sandboxTruth.length ? "PENDING_SAMPLE_DEPTH" : "NO_SANDBOX_SAMPLE",
      timingDeviation: sandboxTruth.length ? "MEASURABLE_WHEN_RECORDED" : "NO_SANDBOX_SAMPLE",
      oorDivergence: sandboxTruth.length ? "MEASURABLE_WHEN_RECORDED" : "NO_SANDBOX_SAMPLE",
    },
    samples: driftSamples.slice(0, 20),
    rule: "shadow realism is measured from sandbox truth-valid trades only",
  };
}

export function buildLearningVelocity(trades = [], liveValidation = {}) {
  const now = Date.now();
  const truthValid = trades.filter(isClosedTruthValidTrade);
  const inLastDays = (days) => truthValid.filter((trade) => {
    const ts = tradeTime(trade);
    return Number.isFinite(ts) && now - ts <= days * 24 * 60 * 60 * 1000;
  }).length;
  const last7 = inLastDays(7);
  const last30 = inLastDays(30);
  const confidence = num(liveValidation.quantConfidence?.edgeConfidence);
  let state = "STALLED";
  if (last7 >= 6 || last30 >= 20) state = "FAST";
  else if (last7 >= 3 || last30 >= 10) state = "HEALTHY";
  else if (last7 >= 1 || last30 >= 1) state = "SLOW";
  return {
    learningState: state,
    metrics: {
      truthValidTotal: truthValid.length,
      truthValidLast7d: last7,
      truthValidLast30d: last30,
      edgeConfidence: confidence,
      blockerImprovement: truthValid.length >= 30 ? "MEASURABLE" : "PENDING_30_TRADES",
      walletTruthImprovement: truthValid.length >= 30 ? "MEASURABLE" : "PENDING_30_TRADES",
      falseBlockReduction: truthValid.length >= 50 ? "MEASURABLE" : "PENDING_50_TRADES",
    },
    interpretation: state === "STALLED"
      ? "no truth-valid evidence is arriving yet"
      : "truth-valid evidence is accumulating under firewall",
  };
}

export function buildSandboxEvidencePayload({
  trades = [],
  liveValidation = null,
  selfPreservation = null,
  shadowExperiment = {},
  walletTruth = {},
} = {}) {
  const live = liveValidation || buildLiveValidationPayload(trades);
  const self = selfPreservation || buildSelfPreservationPayload(trades);
  const golden = buildGoldenDataset(trades);
  const sandboxCapital = buildSandboxCapitalEngine(live, self);
  const evidenceCollectionMode = buildEvidenceCollectionMode(live, self);
  const capitalFirewall = buildCapitalFirewall(trades, sandboxCapital);
  const highInformationValueTrades = buildHighInformationValueTrades({ shadowExperiment, walletTruth });
  const controlledGraduation = buildControlledGraduation(live, self);
  const sandboxVsShadowValidation = buildSandboxVsShadowValidation(trades);
  const learningVelocity = buildLearningVelocity(trades, live);

  return {
    ok: true,
    layer: "CONTROLLED_EVIDENCE_COLLECTION_AND_SANDBOX_CAPITAL",
    thesis: "trade to learn, not to earn",
    defensiveTruth: {
      alwaysWins: true,
      liveRiskOverride: false,
      offensiveEngineSubordinate: true,
    },
    evidenceState: {
      lockdownParadoxDetected: self.selfPreservation?.state === "LOCKDOWN" && num(live.goldenDataset?.truthValidTrades) < 30,
      goldenDatasetQuality: live.goldenDataset?.datasetQuality || golden.datasetQuality,
      truthValidTrades: num(live.goldenDataset?.truthValidTrades),
      targetTruthValidTrades: 30,
    },
    sandboxCapital,
    evidenceCollectionMode,
    capitalFirewall,
    highInformationValueTrades,
    controlledGraduation,
    sandboxVsShadowValidation,
    learningVelocity,
    audit: {
      generatedAt: isoTime(Date.now()),
      source: "backend_only",
      noDashboardRedesign: true,
      noFakeConfidence: true,
    },
  };
}
