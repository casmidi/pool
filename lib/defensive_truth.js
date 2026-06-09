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

function summarize(rows = []) {
  const wins = rows.filter((r) => num(r.pnlPct) > 0);
  const losses = rows.filter((r) => num(r.pnlPct) <= 0);
  return {
    trades: rows.length,
    wins: wins.length,
    losses: losses.length,
    winRate: rows.length ? round((wins.length / rows.length) * 100, 1) : 0,
    avgPnlPct: rows.length ? round(rows.reduce((s, r) => s + num(r.pnlPct), 0) / rows.length) : 0,
    totalPnlPct: round(rows.reduce((s, r) => s + num(r.pnlPct), 0)),
  };
}

function allReasonText(row = {}) {
  const roi = row.roi || {};
  const memory = row.memory || row.execution?.memory || {};
  return [
    ...(roi.blockers?.blockedReasons || []),
    ...(roi.blockers?.holdReasons || []),
    ...(roi.status?.reasons || []),
    ...(row.sourcePool?.risks || []),
    ...(row.sourcePool?.reasons || []),
    memory.signatureKey || "",
  ].join(" ").toLowerCase();
}

export function extractBlockerEvents(row = {}) {
  const text = allReasonText(row);
  const sig = row.memory?.signature || row.execution?.memory?.signature || {};
  const blockers = [];

  if (sig.wallet === "DANGEROUS" || /dangerous wallet|wallet classified dangerous/.test(text)) blockers.push("wallet");
  if (sig.feeTvl === "DANGEROUS" || /fee\/tvl is dangerous|fee:t?dangerous/.test(text)) blockers.push("feeTvl");
  if (sig.alpha === "AVOID" || /alpha avoid|alpha decision avoid/.test(text)) blockers.push("alpha");
  if (/out.?of.?range|oor|pool is out of range/.test(text) || sig.oor === "HIGH OOR") blockers.push("oor");
  if (/crowd|copy.?farm|saturation/.test(text)) blockers.push("crowding");
  if (sig.timing === "WAIT" || /timing:wait|entry wait/.test(text)) blockers.push("timing");
  if (/rug/.test(text)) blockers.push("rug");
  if (/honeypot|safety|blacklist|exploit/.test(text)) blockers.push("safety");

  return uniq(blockers.length ? blockers : ["unknown"]);
}

export function buildBlockerConfidence(blocker = {}, sampleSize = 0) {
  const blockCount = num(blocker.blockCount);
  const avoidedLossRate = num(blocker.avoidedLossRate);
  const falseBlockRate = num(blocker.falseBlockRate);
  const missedWinnerPnlPct = num(blocker.missedWinnerPnlPct);
  let confidence = avoidedLossRate;

  if (blocker.blocker === "rug" || blocker.blocker === "safety") confidence = Math.max(confidence, 92);
  if (blocker.blocker === "feeTvl" && avoidedLossRate >= 50) confidence += 8;
  if (blocker.blocker === "wallet" && falseBlockRate >= 50) confidence -= 18;
  if (missedWinnerPnlPct > 10) confidence -= Math.min(25, missedWinnerPnlPct / 4);
  if (blockCount < 3 || sampleSize < 30) confidence *= 0.75;

  confidence = round(clamp(confidence));
  const tier = confidence < 40 ? "LOW" : confidence < 70 ? "MEDIUM" : "HIGH";
  return {
    confidence,
    tier,
    interpretation: tier === "HIGH"
      ? "blocker historically protects capital"
      : tier === "MEDIUM"
        ? "blocker is mixed and needs context"
        : "blocker is low-confidence / over-aggressive in current sample",
  };
}

export function buildDefensiveTruthAudit(rows = []) {
  const blocked = rows.filter((r) => !r.executable);
  const byBlocker = new Map();
  for (const row of blocked) {
    for (const blocker of extractBlockerEvents(row)) {
      if (!byBlocker.has(blocker)) byBlocker.set(blocker, []);
      byBlocker.get(blocker).push(row);
    }
  }

  const blockers = [...byBlocker.entries()].map(([blocker, items]) => {
    const missedWinners = items.filter((r) => num(r.pnlPct) > 0);
    const avoidedLosses = items.filter((r) => num(r.pnlPct) <= 0);
    const missedWinnerPnlPct = round(missedWinners.reduce((s, r) => s + num(r.pnlPct), 0));
    const avoidedLossPnlPct = round(avoidedLosses.reduce((s, r) => s + num(r.pnlPct), 0));
    const blockCount = items.length;
    const avoidedLossRate = blockCount ? round((avoidedLosses.length / blockCount) * 100, 1) : 0;
    const falseBlockRate = blockCount ? round((missedWinners.length / blockCount) * 100, 1) : 0;
    const base = {
      blocker,
      blockCount,
      avoidedLosses: avoidedLosses.length,
      missedWinners: missedWinners.length,
      avoidedLossRate,
      falseBlockRate,
      blockerAccuracy: avoidedLossRate,
      missedWinnerPnlPct,
      avoidedLossPnlPct,
      sample: summarize(items),
    };
    const confidence = buildBlockerConfidence(base, rows.length);
    let verdict = "BLOCKER_INCONCLUSIVE";
    if (confidence.tier === "HIGH" && falseBlockRate <= 35) verdict = "BLOCKER_STRONG";
    else if (falseBlockRate >= 55 || missedWinnerPnlPct > Math.abs(avoidedLossPnlPct) * 3) verdict = "BLOCKER_INCONSISTENT";
    else if (confidence.tier === "LOW") verdict = "BLOCKER_WEAK";
    return { ...base, blockerConfidence: confidence, verdict };
  }).sort((a, b) => b.missedWinnerPnlPct - a.missedWinnerPnlPct);

  return {
    sample: {
      totalRows: rows.length,
      blocked: blocked.length,
      executable: rows.filter((r) => r.executable).length,
    },
    blockers,
  };
}

export function buildBlockerAttribution(rows = []) {
  const audit = buildDefensiveTruthAudit(rows);
  const totalMissed = audit.blockers.reduce((s, b) => s + Math.max(0, b.missedWinnerPnlPct), 0);
  const totalAvoided = Math.abs(audit.blockers.reduce((s, b) => s + Math.min(0, b.avoidedLossPnlPct), 0));
  return {
    totalMissedWinnerPnlPct: round(totalMissed),
    totalAvoidedLossPnlPct: round(totalAvoided),
    contributors: audit.blockers.map((b) => ({
      blocker: b.blocker,
      falseBlockContributionPct: totalMissed ? round((Math.max(0, b.missedWinnerPnlPct) / totalMissed) * 100, 1) : 0,
      avoidedLossContributionPct: totalAvoided ? round((Math.abs(Math.min(0, b.avoidedLossPnlPct)) / totalAvoided) * 100, 1) : 0,
      blockerPrecision: b.blockerAccuracy,
      blockerRecall: b.blockCount ? round((b.avoidedLosses / b.blockCount) * 100, 1) : 0,
      blockerReliability: b.blockerConfidence.tier,
      verdict: b.verdict,
    })),
  };
}

function bestPatternForSignature(signatureKey, memory = {}) {
  const positives = memory.marketMemory?.positivePatterns || [];
  const negatives = memory.marketMemory?.negativePatterns || [];
  return {
    positive: positives.find((p) => p.key === signatureKey) || null,
    negative: negatives.find((p) => p.key === signatureKey) || null,
  };
}

export function scoreContextualDanger(pool = {}, roi = {}, offensive = {}, execution = {}, memory = {}) {
  const mem = execution.memory || {};
  const signature = mem.signature || {};
  const signatureKey = mem.signatureKey || "";
  const patterns = bestPatternForSignature(signatureKey, memory);
  const blockerEvents = extractBlockerEvents({ roi, sourcePool: pool, execution, memory: mem });
  const auditBlockers = memory.defensiveTruthAudit?.blockers || [];
  const confidences = blockerEvents.map((name) => {
    const hit = auditBlockers.find((b) => b.blocker === name);
    return hit?.blockerConfidence || buildBlockerConfidence({ blocker: name, blockCount: 0 }, 0);
  });
  const maxConfidence = confidences.reduce((m, c) => Math.max(m, num(c.confidence)), 0);
  const hardSafety = blockerEvents.some((b) => b === "rug" || b === "safety" || b === "feeTvl");
  let contextScore = 0;
  const positiveContext = [];
  const negativeContext = [];

  if (signature.feeTvl === "EXCELLENT" || signature.feeTvl === "STRONG") {
    contextScore += 18;
    positiveContext.push(`fee/TVL ${signature.feeTvl}`);
  }
  if (signature.timing === "NOW") {
    contextScore += 12;
    positiveContext.push("entry timing NOW");
  }
  if (signature.oor === "NO OOR" || signature.oor === "LOW OOR") {
    contextScore += 10;
    positiveContext.push(`${signature.oor}`);
  }
  if (patterns.positive) {
    contextScore += Math.min(22, Math.max(8, num(patterns.positive.avgPnlPct)));
    positiveContext.push(`positive memory ${patterns.positive.winRate}% WR`);
  }
  if (patterns.negative) {
    contextScore -= 18;
    negativeContext.push(`negative memory ${patterns.negative.winRate}% WR`);
  }
  if (signature.wallet === "DANGEROUS") {
    contextScore -= 22;
    negativeContext.push("wallet DANGEROUS");
  }
  if (signature.feeTvl === "DANGEROUS" || signature.oor === "HIGH OOR") {
    contextScore -= 18;
    negativeContext.push(signature.feeTvl === "DANGEROUS" ? "fee/TVL DANGEROUS" : "HIGH OOR");
  }

  contextScore = round(contextScore);
  let recommendedStrictness = "HARD_BLOCK";
  if (!hardSafety && maxConfidence < 40 && contextScore >= -5) recommendedStrictness = "SOFT_BLOCK";
  if (!hardSafety && maxConfidence < 40 && contextScore >= 15) recommendedStrictness = "WATCHLIST";
  if (!hardSafety && maxConfidence < 35 && contextScore >= 25) recommendedStrictness = "TEST_POSITION";
  if (hardSafety || maxConfidence >= 70) recommendedStrictness = "HARD_BLOCK";

  return {
    blockerEvents,
    contextScore,
    blockerConfidence: {
      maxConfidence: round(maxConfidence),
      tier: maxConfidence < 40 ? "LOW" : maxConfidence < 70 ? "MEDIUM" : "HIGH",
      details: confidences,
    },
    recommendedStrictness,
    hardSafetyPreserved: hardSafety || maxConfidence >= 70,
    positiveContext,
    negativeContext,
    explanation: [
      `recommended ${recommendedStrictness}`,
      maxConfidence ? `blocker confidence ${round(maxConfidence)}%` : "no blocker history",
      contextScore ? `context score ${contextScore}` : "neutral context",
    ],
  };
}

export function buildExplainableDefensiveTruth(rows = [], memory = {}) {
  return rows.filter((r) => !r.executable).slice(-50).reverse().map((row) => ({
    id: row.id,
    pool: row.pool,
    pnlPct: row.pnlPct,
    currentStatus: row.roi?.status?.label || null,
    currentBlockTier: row.memory?.blockStrictness?.tier || null,
    contextualDanger: scoreContextualDanger(row.sourcePool || {}, row.roi, row.offensive, row.execution, memory),
  }));
}

export function detectDefensiveRegression(rows = [], memory = {}) {
  const blocked = rows.filter((r) => !r.executable);
  const missed = blocked.filter((r) => num(r.pnlPct) > 0);
  const avoided = blocked.filter((r) => num(r.pnlPct) <= 0);
  const falseBlockRate = blocked.length ? round((missed.length / blocked.length) * 100, 1) : 0;
  const avoidedLossRate = blocked.length ? round((avoided.length / blocked.length) * 100, 1) : 0;
  const missedWinnerPnlPct = round(missed.reduce((s, r) => s + num(r.pnlPct), 0));
  const avoidedLossPnlPct = round(avoided.reduce((s, r) => s + num(r.pnlPct), 0));
  const warnings = [];

  if (falseBlockRate >= 55) warnings.push(`false block rate ${falseBlockRate}% >= 55%`);
  if (missedWinnerPnlPct > Math.abs(avoidedLossPnlPct) * 3 && missedWinnerPnlPct > 5) {
    warnings.push(`missed winner pnl ${missedWinnerPnlPct}% dominates avoided loss ${avoidedLossPnlPct}%`);
  }
  if (avoidedLossRate < 30 && blocked.length >= 5) warnings.push(`avoided loss rate ${avoidedLossRate}% < 30%`);
  const inconsistent = (memory.defensiveTruthAudit?.blockers || []).filter((b) => b.verdict === "BLOCKER_INCONSISTENT");
  if (inconsistent.length) warnings.push(`${inconsistent.length} blocker(s) inconsistent`);

  return {
    state: warnings.length ? "DEFENSIVE_REGRESSION_DETECTED" : "DEFENSIVE_STABLE",
    falseBlockRate,
    avoidedLossRate,
    missedWinnerPnlPct,
    avoidedLossPnlPct,
    warnings,
  };
}

export function buildDefensiveTruthLayer(rows = [], baseMemory = {}) {
  const defensiveTruthAudit = buildDefensiveTruthAudit(rows);
  const blockerAttribution = buildBlockerAttribution(rows);
  const memory = { ...baseMemory, defensiveTruthAudit, blockerAttribution };
  const explainableDefensiveTruth = buildExplainableDefensiveTruth(rows, memory);
  const regressionDetection = detectDefensiveRegression(rows, memory);
  return {
    defensiveTruthAudit,
    contextualDanger: {
      rule: "context adjusts strictness only; hard protection is preserved",
      reviewedBlocked: explainableDefensiveTruth.length,
      summary: explainableDefensiveTruth.slice(0, 10),
    },
    blockerAttribution,
    blockerConfidence: defensiveTruthAudit.blockers.map((b) => ({
      blocker: b.blocker,
      blockCount: b.blockCount,
      confidence: b.blockerConfidence.confidence,
      tier: b.blockerConfidence.tier,
      verdict: b.verdict,
    })),
    explainableDefensiveTruth,
    regressionDetection,
  };
}
