import { scoreContextualDanger } from "./defensive_truth.js";

const DEFAULT_MEMORY_CONFIG = {
  minSamples: 3,
  strongWinRate: 65,
  weakWinRate: 45,
  positiveAvgPnl: 1,
  negativeAvgPnl: -0.25,
  maxBoost: 8,
  maxPenalty: 12,
};

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function round(value, digits = 2) {
  const m = 10 ** digits;
  return Math.round(num(value) * m) / m;
}

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value));
}

function uniq(items) {
  return [...new Set(items.filter(Boolean))];
}

function statusLabel(roi = {}) {
  return String(roi.status?.label || "").toUpperCase();
}

function alphaState(roi = {}) {
  return String(roi.alpha?.state || "").toUpperCase();
}

function summarizeRows(rows = []) {
  const pnl = rows.map((r) => num(r.pnlPct));
  const wins = pnl.filter((v) => v > 0);
  const losses = pnl.filter((v) => v <= 0);
  const grossWin = wins.reduce((s, v) => s + v, 0);
  const grossLoss = Math.abs(losses.reduce((s, v) => s + v, 0));
  return {
    trades: rows.length,
    wins: wins.length,
    losses: losses.length,
    winRate: rows.length ? round((wins.length / rows.length) * 100, 1) : 0,
    avgPnlPct: rows.length ? round(pnl.reduce((s, v) => s + v, 0) / rows.length) : 0,
    totalPnlPct: round(pnl.reduce((s, v) => s + v, 0)),
    profitFactor: grossLoss > 0 ? round(grossWin / grossLoss, 2) : (grossWin > 0 ? 99 : 0),
  };
}

function scoreBucket(value, highLabel, midLabel, lowLabel) {
  const score = num(value, null);
  if (score === null) return "UNKNOWN";
  if (score >= 11) return highLabel;
  if (score >= 7) return midLabel;
  return lowLabel;
}

function oorBucket(minutes) {
  const value = num(minutes, null);
  if (value === null) return "UNKNOWN";
  if (value <= 0) return "NO OOR";
  if (value <= 10) return "LOW OOR";
  if (value <= 30) return "MEDIUM OOR";
  return "HIGH OOR";
}

export function createSignalSignature(pool = {}, roi = {}, offensive = {}, execution = {}) {
  return {
    wallet: roi.wallet?.classification?.label || "UNKNOWN",
    feeTvl: roi.feeTvl?.classification?.label || "UNKNOWN",
    organic: roi.organicTrend?.state || "UNKNOWN",
    timing: offensive.entryTiming?.state || "UNKNOWN",
    alpha: roi.alpha?.state || "UNKNOWN",
    edgeTier: offensive.edgeScore?.tier?.label || "UNKNOWN",
    conviction: execution.conviction?.state || "UNKNOWN",
    survival: scoreBucket(roi.confidence?.parts?.survival, "HIGH SURVIVAL", "MID SURVIVAL", "LOW SURVIVAL"),
    crowding: scoreBucket(roi.confidence?.parts?.antiCrowd, "LOW CROWDING", "MID CROWDING", "HIGH CROWDING"),
    oor: oorBucket(pool.minutesOutOfRange ?? pool.minutes_out_of_range),
  };
}

export function signatureKey(signature = {}) {
  return [
    `wallet:${signature.wallet || "UNKNOWN"}`,
    `fee:${signature.feeTvl || "UNKNOWN"}`,
    `organic:${signature.organic || "UNKNOWN"}`,
    `timing:${signature.timing || "UNKNOWN"}`,
    `edge:${signature.edgeTier || "UNKNOWN"}`,
    `conviction:${signature.conviction || "UNKNOWN"}`,
  ].join(" | ");
}

export function classifyBlockStrictness(pool = {}, roi = {}) {
  const blockedReasons = roi.blockers?.blockedReasons || [];
  const holdReasons = roi.blockers?.holdReasons || [];
  const risks = [
    ...(Array.isArray(pool.risks) ? pool.risks : []),
    ...(Array.isArray(pool.reasons) ? pool.reasons : []),
    ...(blockedReasons || []),
  ].join(" ").toLowerCase();
  const status = statusLabel(roi);
  const alpha = alphaState(roi);
  const hardPatterns = [
    /rug/,
    /honeypot/,
    /hard safety/,
    /safety blocker/,
    /fee\/tvl is dangerous/,
    /blacklist/,
    /exploit/,
  ];
  const isHard = hardPatterns.some((pattern) => pattern.test(risks));

  if (status !== "BLOCKED" && alpha !== "AVOID") {
    return {
      tier: "NO_BLOCK",
      canOverride: false,
      recoveryEligible: false,
      reasons: holdReasons,
      hardReasons: [],
      softReasons: holdReasons,
    };
  }

  if (isHard) {
    return {
      tier: "HARD_BLOCK",
      canOverride: false,
      recoveryEligible: false,
      reasons: blockedReasons.length ? blockedReasons : ["hard defensive truth"],
      hardReasons: blockedReasons.length ? blockedReasons : ["hard defensive truth"],
      softReasons: holdReasons,
    };
  }

  return {
    tier: "SOFT_BLOCK",
    canOverride: false,
    recoveryEligible: true,
    reasons: uniq([...blockedReasons, ...holdReasons, alpha === "AVOID" ? "alpha AVOID without hard safety proof" : null]),
    hardReasons: [],
    softReasons: uniq([...blockedReasons, ...holdReasons]),
  };
}

function groupRows(rows = [], keyFn) {
  const groups = new Map();
  for (const row of rows) {
    const key = keyFn(row);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return [...groups.entries()].map(([key, items]) => ({ key, ...summarizeRows(items) }));
}

export function buildMarketMemory(rows = [], config = DEFAULT_MEMORY_CONFIG) {
  const bySignature = groupRows(rows, (row) => row.memory?.signatureKey || "UNKNOWN")
    .sort((a, b) => b.totalPnlPct - a.totalPnlPct);
  const positivePatterns = bySignature
    .filter((p) => p.trades >= config.minSamples && p.winRate >= config.strongWinRate && p.avgPnlPct >= config.positiveAvgPnl)
    .slice(0, 10);
  const negativePatterns = bySignature
    .filter((p) => p.trades >= config.minSamples && (p.winRate < config.weakWinRate || p.avgPnlPct <= config.negativeAvgPnl))
    .sort((a, b) => a.avgPnlPct - b.avgPnlPct)
    .slice(0, 10);
  return {
    sample: summarizeRows(rows),
    signatures: bySignature.slice(0, 30),
    positivePatterns,
    negativePatterns,
  };
}

export function buildFailureMemory(rows = [], config = DEFAULT_MEMORY_CONFIG) {
  const failedPassed = rows.filter((r) => r.executable && r.pnlPct <= 0);
  const patterns = groupRows(failedPassed, (row) => row.memory?.signatureKey || "UNKNOWN")
    .sort((a, b) => b.trades - a.trades || a.avgPnlPct - b.avgPnlPct);
  const weakThresholds = [];
  for (const row of failedPassed) {
    const signature = row.memory?.signature || {};
    if (signature.feeTvl === "WEAK" || signature.feeTvl === "DANGEROUS") weakThresholds.push("feeTvl weak can still pass");
    if (signature.conviction === "MEDIUM" || signature.conviction === "LOW") weakThresholds.push("medium/low conviction loss passed");
    if (signature.oor === "MEDIUM OOR" || signature.oor === "HIGH OOR") weakThresholds.push("OOR exposure degraded outcome");
  }
  return {
    failedPassed: failedPassed.length,
    patterns: patterns.slice(0, 10),
    weakThresholds: uniq(weakThresholds),
  };
}

function missedWinnerCause(row = {}) {
  const strictness = row.memory?.blockStrictness || {};
  const signature = row.memory?.signature || {};
  const causes = [];
  if (strictness.tier === "SOFT_BLOCK") causes.push("soft defensive block captured historical winner");
  if (signature.feeTvl === "EXCELLENT" || signature.feeTvl === "STRONG") causes.push("fee/TVL positive carry was underweighted");
  if (signature.wallet === "ELITE" || signature.wallet === "STRONG") causes.push("wallet quality was underweighted");
  if (signature.oor === "NO OOR" || signature.oor === "LOW OOR") causes.push("range health did not justify full block");
  if (num(row.offensive?.edgeScore?.score) <= 10) causes.push("offensive edge collapsed despite positive outcome");
  if (!causes.length) causes.push("insufficient fields to explain missed winner");
  return causes;
}

export function buildMissedWinnerInvestigation(rows = []) {
  const missed = rows.filter((r) => !r.executable && r.pnlPct > 0);
  const byStrictness = groupRows(missed, (row) => row.memory?.blockStrictness?.tier || "UNKNOWN")
    .sort((a, b) => b.totalPnlPct - a.totalPnlPct);
  return {
    missedWinners: missed.length,
    totalMissedPnlPct: round(missed.reduce((sum, row) => sum + row.pnlPct, 0)),
    byStrictness,
    topMissedWinners: missed
      .slice()
      .sort((a, b) => b.pnlPct - a.pnlPct)
      .slice(0, 10)
      .map((row) => ({
        id: row.id,
        pool: row.pool,
        pnlPct: row.pnlPct,
        blockTier: row.memory?.blockStrictness?.tier || "UNKNOWN",
        signature: row.memory?.signatureKey || "UNKNOWN",
        suspectedCauses: missedWinnerCause(row),
      })),
  };
}

export function buildCounterfactualReplay(rows = []) {
  const softBlocked = rows.filter((r) => !r.executable && r.memory?.blockStrictness?.tier === "SOFT_BLOCK");
  const hardBlocked = rows.filter((r) => !r.executable && r.memory?.blockStrictness?.tier === "HARD_BLOCK");
  const softSummary = summarizeRows(softBlocked);
  return {
    rule: "hard defensive blocks are never released; soft blocks are audit-only candidates",
    softBlockReplay: {
      ...softSummary,
      releaseCandidateCount: softBlocked.length,
      hypotheticalRecoveredPnlPct: softSummary.totalPnlPct,
      verdict: softBlocked.length && softSummary.totalPnlPct > 0 ? "SOFT_BLOCK_REVIEW_NEEDED" : "NO_SOFT_BLOCK_EDGE",
    },
    hardBlockReplay: {
      blockedCount: hardBlocked.length,
      releasedCount: 0,
      reason: "hard defensive truth always wins",
    },
  };
}

export function buildExperienceMemory(rows = [], config = DEFAULT_MEMORY_CONFIG) {
  return {
    marketMemory: buildMarketMemory(rows, config),
    failureMemory: buildFailureMemory(rows, config),
    missedWinnerInvestigation: buildMissedWinnerInvestigation(rows),
    counterfactualReplay: buildCounterfactualReplay(rows),
  };
}

function patternAdjustment(signatureKeyValue, memory = {}, config = DEFAULT_MEMORY_CONFIG) {
  const positives = memory.marketMemory?.positivePatterns || [];
  const negatives = memory.marketMemory?.negativePatterns || [];
  const positive = positives.find((p) => p.key === signatureKeyValue);
  const negative = negatives.find((p) => p.key === signatureKeyValue);
  if (negative) {
    const penalty = Math.min(config.maxPenalty, Math.max(4, Math.round(Math.abs(negative.avgPnlPct) + (config.weakWinRate - negative.winRate) / 8)));
    return { delta: -penalty, reason: `memory penalty: weak historical pattern ${negative.key}` };
  }
  if (positive) {
    const boost = Math.min(config.maxBoost, Math.max(2, Math.round(positive.avgPnlPct + (positive.winRate - config.strongWinRate) / 10)));
    return { delta: boost, reason: `memory boost: profitable historical pattern ${positive.key}` };
  }
  return { delta: 0, reason: "memory neutral: no reliable pattern" };
}

function convictionState(score) {
  if (score >= 85) return "EXTREME";
  if (score >= 72) return "HIGH";
  if (score >= 55) return "MEDIUM";
  if (score < 35) return "LOW";
  return "LOW";
}

function resizePosition(positionSize = {}, state = "LOW", score = 0) {
  const bands = {
    EXTREME: [12, 15],
    HIGH: [8, 12],
    MEDIUM: [4, 8],
    LOW: [1, 3],
    "NO TRADE": [0, 0],
  };
  if (num(positionSize.suggestedPct) <= 0) return positionSize;
  const [minPct, maxPct] = bands[state] || bands.LOW;
  const span = maxPct - minPct;
  const suggestedPct = Math.round((minPct + span * (clamp(score) / 100)) * 10) / 10;
  return {
    ...positionSize,
    minPct,
    maxPct,
    suggestedPct,
    label: `${suggestedPct}%`,
    reason: `${state} conviction allocation band after memory adjustment`,
  };
}

function executionStateFor(conviction = {}, positionSize = {}, offensive = {}, current = {}) {
  if (conviction.state === "NO TRADE" || num(positionSize.suggestedPct) <= 0) return current;
  const edge = num(offensive.edgeScore?.score);
  if ((conviction.state === "EXTREME" || conviction.state === "HIGH") && edge >= 75) {
    return { state: "AGGRESSIVE ENTRY", tone: "aggressive", reasons: uniq([...(current.reasons || []), "memory-adjusted high conviction with strong edge"]) };
  }
  if (conviction.state === "MEDIUM" || (conviction.state === "HIGH" && edge < 75)) {
    return { state: "NORMAL ENTRY", tone: "normal", reasons: uniq([...(current.reasons || []), "memory-adjusted valid setup"]) };
  }
  return { state: "SMALL TEST POSITION", tone: "test", reasons: uniq([...(current.reasons || []), "memory-adjusted low conviction setup"]) };
}

export function applyMemoryAwareConviction(pool = {}, roi = {}, offensive = {}, execution = {}, memory = {}, config = DEFAULT_MEMORY_CONFIG) {
  const blockStrictness = classifyBlockStrictness(pool, roi);
  const signature = createSignalSignature(pool, roi, offensive, execution);
  const key = signatureKey(signature);
  const baseConviction = execution.conviction || {};
  const contextualDanger = scoreContextualDanger(pool, roi, offensive, {
    ...execution,
    memory: { signature, signatureKey: key, blockStrictness },
  }, memory);

  if (blockStrictness.tier === "HARD_BLOCK") {
    return {
      ...execution,
      memory: {
        signature,
        signatureKey: key,
        blockStrictness,
        contextualDanger,
        convictionAdjustment: {
          baseScore: num(baseConviction.score),
          adjustedScore: 0,
          delta: 0,
          applied: false,
          reason: "hard defensive block overrides memory",
        },
      },
    };
  }

  const adjustment = blockStrictness.tier === "SOFT_BLOCK"
    ? { delta: 0, reason: "soft block is audit-only; no live override" }
    : patternAdjustment(key, memory, config);
  const adjustedScore = clamp(num(baseConviction.score) + adjustment.delta);
  const adjustedState = convictionState(adjustedScore);
  const adjustedConviction = {
    ...baseConviction,
    score: adjustedScore,
    state: adjustedState,
    tone: adjustedState.toLowerCase().replace(/\s+/g, "-"),
    memoryAdjusted: adjustment.delta !== 0,
    memoryDelta: adjustment.delta,
    reasons: uniq([...(baseConviction.reasons || []), adjustment.reason]),
  };
  const adjustedPositionSize = resizePosition(execution.positionSize, adjustedState, adjustedScore);
  const adjustedExecutionState = executionStateFor(adjustedConviction, adjustedPositionSize, offensive, execution.executionState);

  return {
    ...execution,
    conviction: adjustedConviction,
    positionSize: adjustedPositionSize,
    executionState: adjustedExecutionState,
    memory: {
      signature,
      signatureKey: key,
      blockStrictness,
      contextualDanger,
      convictionAdjustment: {
        baseScore: num(baseConviction.score),
        adjustedScore,
        delta: adjustment.delta,
        applied: adjustment.delta !== 0,
        reason: adjustment.reason,
      },
    },
  };
}
