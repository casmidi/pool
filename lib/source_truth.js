function num(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clone(value) {
  if (value == null) return null;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return null;
  }
}

function stableHash(value) {
  const s = JSON.stringify(value ?? null);
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

export function validateEntryTruth(truth = {}) {
  const issues = [];
  const wallet = truth.source?.wallet || {};
  const raw = truth.raw || {};

  if (!wallet.address) issues.push({ field: "source_wallet", severity: "CRITICAL", reason: "missing source wallet identity" });
  if (wallet.score == null) issues.push({ field: "source_wallet_score", severity: "CRITICAL", reason: "missing wallet score" });
  if (wallet.score != null && (wallet.score < 0 || wallet.score > 100)) issues.push({ field: "source_wallet_score", severity: "HIGH", reason: "wallet score outside 0-100" });
  if (!truth.source?.signalId) issues.push({ field: "source_signal_id", severity: "HIGH", reason: "missing source signal id" });
  if (raw.feeTvlRatio == null) issues.push({ field: "fee_tvl_ratio", severity: "MEDIUM", reason: "missing raw FeeTVL" });
  if (raw.confidence == null) issues.push({ field: "decision_confidence", severity: "MEDIUM", reason: "missing raw confidence" });
  if (!truth.decision?.action) issues.push({ field: "decision.action", severity: "HIGH", reason: "missing frozen decision action" });

  const severityRank = { LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4 };
  const maxSeverity = issues.reduce((max, issue) => (
    severityRank[issue.severity] > severityRank[max] ? issue.severity : max
  ), "LOW");

  return {
    valid: !issues.some((issue) => issue.severity === "CRITICAL" || issue.severity === "HIGH"),
    status: issues.length ? "SOURCE_CORRUPTED" : "SOURCE_VALID",
    maxSeverity: issues.length ? maxSeverity : "LOW",
    issues,
  };
}

export function createSourceTruth({
  poolAddress,
  poolName,
  amountSol,
  feeTvlRatio,
  volatility,
  organicScore,
  holderCount,
  sourceWallet,
  sourceWalletRank,
  sourceWalletScore,
  sourceWalletGrade,
  sourceWalletType,
  sourceWalletConfidence,
  copyEngineSource,
  sourceSignalId,
  decisionConfidence,
  decisionBreakdown,
  shadowDecision,
  marketRegime,
  capitalProtection,
  poolTrust,
  alphaEdge,
  masterStrategy,
  deployArgs,
  executionMode,
  strategy,
  binsBelow,
  activeBin,
  lowerBin,
  upperBin,
} = {}) {
  const ts = new Date().toISOString();
  const source = {
    wallet: {
      address: sourceWallet ?? deployArgs?.source_wallet ?? null,
      rank: sourceWalletRank ?? deployArgs?.source_wallet_rank ?? null,
      score: num(sourceWalletScore ?? deployArgs?.wallet_score, null),
      grade: sourceWalletGrade ?? deployArgs?.wallet_grade ?? null,
      type: sourceWalletType ?? deployArgs?.source_wallet_type ?? null,
      confidence: num(sourceWalletConfidence ?? deployArgs?.source_wallet_confidence, null),
    },
    copyEngineSource: copyEngineSource ?? deployArgs?.source ?? "unknown",
    signalId: sourceSignalId ?? deployArgs?.source_signal_id ?? deployArgs?.signal_id ?? null,
  };
  const raw = {
    feeTvlRatio: num(feeTvlRatio ?? deployArgs?.fee_tvl_ratio, null),
    alpha: clone(alphaEdge ?? deployArgs?.alpha_edge),
    timing: {
      binsBelow: binsBelow ?? deployArgs?.bins_below ?? null,
      activeBin: activeBin ?? deployArgs?.active_bin ?? null,
      lowerBin: lowerBin ?? deployArgs?.lower_bin ?? null,
      upperBin: upperBin ?? deployArgs?.upper_bin ?? null,
    },
    oor: {
      binsBelow: binsBelow ?? deployArgs?.bins_below ?? null,
      binsAbove: deployArgs?.bins_above ?? null,
    },
    crowding: clone(alphaEdge?.crowd ?? deployArgs?.alpha_edge?.crowd),
    confidence: num(decisionConfidence ?? deployArgs?.decision_confidence, null),
    edge: clone(alphaEdge ?? deployArgs?.alpha_edge),
    organicScore: num(organicScore ?? deployArgs?.organic_score, null),
    volatility: num(volatility ?? deployArgs?.volatility, null),
    holderCount: num(holderCount ?? deployArgs?.holder_count, null),
  };
  const decision = {
    action: deployArgs?.decision_result?.action ?? deployArgs?.action ?? null,
    confidence: raw.confidence,
    breakdown: clone(decisionBreakdown ?? deployArgs?.decision_breakdown),
    blockerReasons: clone(deployArgs?.risks ?? deployArgs?.decision_result?.risks) ?? [],
    reasons: clone(deployArgs?.reasons ?? deployArgs?.decision_result?.reasons) ?? [],
    shadow: clone(shadowDecision ?? deployArgs?.shadow_decision),
    marketRegime: clone(marketRegime ?? deployArgs?.market_regime),
    capitalProtection: clone(capitalProtection ?? deployArgs?.capital_protection),
    poolTrust: clone(poolTrust ?? deployArgs?.pool_trust),
    masterStrategy: clone(masterStrategy ?? deployArgs?.master_strategy),
    executionMode: executionMode ?? (deployArgs?.dry_run ? "DRY_RUN" : "UNKNOWN"),
  };
  const truth = {
    version: 1,
    createdAt: ts,
    immutable: true,
    pool: { address: poolAddress ?? deployArgs?.pool_address ?? null, name: poolName ?? deployArgs?.pool_name ?? null },
    amountSol: num(amountSol ?? deployArgs?.amount_sol ?? deployArgs?.amount_y, null),
    strategy: strategy ?? deployArgs?.strategy ?? null,
    source,
    raw,
    decision,
    deployArgs: clone(deployArgs),
  };
  const validation = validateEntryTruth(truth);
  return {
    ...truth,
    validation,
    snapshotHash: stableHash({ ...truth, validation: undefined, snapshotHash: undefined }),
  };
}

export function createDecisionSnapshot(params = {}) {
  const entryTruth = createSourceTruth(params);
  return {
    version: 1,
    immutable: true,
    createdAt: entryTruth.createdAt,
    entryTruth,
    walletTruth: entryTruth.source.wallet,
    feeTvl: entryTruth.raw.feeTvlRatio,
    alpha: entryTruth.raw.alpha,
    timing: entryTruth.raw.timing,
    oor: entryTruth.raw.oor,
    crowding: entryTruth.raw.crowding,
    blockerReasons: entryTruth.decision.blockerReasons,
    conviction: params.deployArgs?.execution?.conviction ?? null,
    confidence: entryTruth.raw.confidence,
    executionMode: entryTruth.decision.executionMode,
    copyEngineState: {
      source: entryTruth.source.copyEngineSource,
      signalId: entryTruth.source.signalId,
    },
    memoryState: clone(params.deployArgs?.memory ?? params.deployArgs?.experienceMemory),
    defensiveState: {
      action: entryTruth.decision.action,
      reasons: entryTruth.decision.reasons,
      risks: entryTruth.decision.blockerReasons,
    },
    snapshotHash: entryTruth.snapshotHash,
  };
}

export function detectSignalLoss(trade = {}) {
  const truth = trade.entry_truth || trade.decision_snapshot?.entryTruth || null;
  const issues = [];
  if (!truth) issues.push({ field: "entry_truth", severity: "CRITICAL", reason: "missing immutable entry truth" });
  if (!trade.decision_snapshot) issues.push({ field: "decision_snapshot", severity: "CRITICAL", reason: "missing immutable decision snapshot" });
  if (truth?.validation?.issues?.length) issues.push(...truth.validation.issues);
  if (truth?.snapshotHash && trade.decision_snapshot?.snapshotHash && truth.snapshotHash !== trade.decision_snapshot.snapshotHash) {
    issues.push({ field: "snapshotHash", severity: "CRITICAL", reason: "entry truth and snapshot hash mismatch" });
  }
  const severityRank = { LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4 };
  const maxSeverity = issues.reduce((max, issue) => (
    severityRank[issue.severity] > severityRank[max] ? issue.severity : max
  ), "LOW");
  return {
    state: issues.some((i) => i.severity === "CRITICAL") ? "CRITICAL_SIGNAL_LOSS" : issues.length ? "SIGNAL_LOSS_DETECTED" : "SIGNAL_OK",
    severity: issues.length ? maxSeverity : "LOW",
    issues,
    promotionAllowed: !issues.some((i) => i.severity === "CRITICAL" || i.severity === "HIGH"),
  };
}

export function buildSignalForensics(trade = {}) {
  const truth = trade.entry_truth || trade.decision_snapshot?.entryTruth || null;
  const loss = detectSignalLoss(trade);
  const pnl = num(trade.pnl_pct, null);
  const decision = truth?.decision?.action || trade.decision_snapshot?.defensiveState?.action || "UNKNOWN";
  let verdict = "UNCLASSIFIED";
  if (loss.state === "CRITICAL_SIGNAL_LOSS") verdict = "FORENSICS_INCOMPLETE";
  else if (decision === "COPY" && pnl != null && pnl > 0) verdict = "PASS_WIN";
  else if (decision === "COPY" && pnl != null && pnl <= 0) verdict = "PASS_LOSS";
  else if (decision !== "COPY" && pnl != null && pnl > 0) verdict = "MISCLASSIFIED_BLOCKED_WINNER";
  else if (decision !== "COPY" && pnl != null && pnl <= 0) verdict = "CORRECT_BLOCK_OR_AVOIDED_LOSS";
  return {
    id: trade.id,
    pool: trade.pool_name || trade.pool_address || "unknown",
    entryTruth: truth,
    decision,
    reasons: truth?.decision?.reasons || [],
    blockers: truth?.decision?.blockerReasons || [],
    outcome: {
      pnlPct: pnl,
      durationMinutes: trade.minutes_held ?? null,
      minutesOutOfRange: trade.minutes_out_of_range ?? null,
      closeReason: trade.close_reason ?? null,
    },
    shadowComparison: truth?.decision?.shadow || trade.shadow_decision || null,
    signalLoss: loss,
    verdict,
  };
}

export function buildForensicsReport(trades = []) {
  const forensics = trades.map(buildSignalForensics);
  const states = {};
  const verdicts = {};
  for (const item of forensics) {
    states[item.signalLoss.state] = (states[item.signalLoss.state] || 0) + 1;
    verdicts[item.verdict] = (verdicts[item.verdict] || 0) + 1;
  }
  return {
    total: forensics.length,
    stateCounts: states,
    verdictCounts: verdicts,
    critical: forensics.filter((f) => f.signalLoss.state === "CRITICAL_SIGNAL_LOSS").slice(0, 20),
    samples: forensics.slice(-50).reverse(),
  };
}
