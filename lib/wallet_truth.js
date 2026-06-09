function num(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function round(value, digits = 2) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  const m = 10 ** digits;
  return Math.round(n * m) / m;
}

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value));
}

function summarize(rows = []) {
  const wins = rows.filter((r) => num(r.pnlPct, 0) > 0);
  const losses = rows.filter((r) => num(r.pnlPct, 0) <= 0);
  return {
    trades: rows.length,
    wins: wins.length,
    losses: losses.length,
    winRate: rows.length ? round((wins.length / rows.length) * 100, 1) : 0,
    avgPnlPct: rows.length ? round(rows.reduce((s, r) => s + num(r.pnlPct, 0), 0) / rows.length) : 0,
    totalPnlPct: round(rows.reduce((s, r) => s + num(r.pnlPct, 0), 0)),
  };
}

function walletScoreSources(row = {}) {
  const pool = row.sourcePool || {};
  const raw = pool.deployArgs?.decision_breakdown?.raw || {};
  return {
    sourceWalletScore: num(pool.source_wallet_score, null),
    walletScore: num(pool.walletScore ?? pool.wallet_score, null),
    deployWalletScore: num(pool.deployArgs?.wallet_score, null),
    rawWalletScore: num(raw.walletScore ?? raw.wallet, null),
    poolScore: num(pool.poolScore ?? pool.score, null),
    roiRawScore: num(row.roi?.wallet?.rawScore, null),
    roiAdjustedScore: num(row.roi?.wallet?.adjustedScore, null),
  };
}

function primaryWalletScore(sources = {}) {
  for (const key of ["sourceWalletScore", "walletScore", "deployWalletScore", "rawWalletScore"]) {
    if (sources[key] != null) return { key, value: sources[key], fallback: false };
  }
  for (const key of ["poolScore", "roiRawScore", "roiAdjustedScore"]) {
    if (sources[key] != null) return { key, value: sources[key], fallback: true };
  }
  return { key: "missing", value: null, fallback: true };
}

export function auditWalletNormalization(row = {}) {
  const sources = walletScoreSources(row);
  const primary = primaryWalletScore(sources);
  const available = Object.entries(sources).filter(([, value]) => value != null);
  const issues = [];

  if (primary.value == null) issues.push("missing_wallet_score");
  if (primary.fallback) issues.push("fallback_usage");
  if (available.some(([, value]) => value < 0 || value > 100)) issues.push("malformed_score_range");
  if (sources.roiRawScore != null && primary.value != null && Math.abs(sources.roiRawScore - primary.value) >= 20) issues.push("normalization_mismatch");
  if (sources.roiAdjustedScore != null && sources.roiRawScore != null && Math.abs(sources.roiAdjustedScore - sources.roiRawScore) >= 20) issues.push("score_drift_after_penalty");
  if (!row.sourcePool?.source_wallet && !row.sourcePool?.deployArgs?.source_wallet && !row.sourcePool?.wallet) issues.push("missing_source_wallet_identity");
  if (primary.value === 0 && issues.includes("missing_source_wallet_identity")) issues.push("zero_score_without_wallet_identity");

  const status = issues.some((i) => ["missing_wallet_score", "malformed_score_range", "normalization_mismatch", "zero_score_without_wallet_identity"].includes(i))
    ? "SOURCE_CORRUPTED"
    : "NORMALIZED";

  return {
    status,
    sources,
    primary,
    issues,
  };
}

export function buildWalletNormalizationAudit(rows = []) {
  const audits = rows.map((row) => ({ row, audit: auditWalletNormalization(row) }));
  const issueCounts = {};
  for (const { audit } of audits) {
    for (const issue of audit.issues) issueCounts[issue] = (issueCounts[issue] || 0) + 1;
  }
  const corrupted = audits.filter((a) => a.audit.status === "SOURCE_CORRUPTED");
  const fallback = audits.filter((a) => a.audit.issues.includes("fallback_usage"));
  return {
    total: rows.length,
    normalized: audits.filter((a) => a.audit.status === "NORMALIZED").length,
    corrupted: corrupted.length,
    fallbackUsage: fallback.length,
    issueCounts,
    corruptedSamples: corrupted.slice(0, 10).map(({ row, audit }) => ({
      id: row.id,
      pool: row.pool,
      pnlPct: row.pnlPct,
      status: row.roi?.status?.label || null,
      issues: audit.issues,
      primary: audit.primary,
    })),
  };
}

function hasText(row = {}, pattern) {
  const pool = row.sourcePool || {};
  const text = [
    ...(pool.risks || []),
    ...(pool.reasons || []),
    ...(row.roi?.blockers?.blockedReasons || []),
    ...(row.roi?.blockers?.holdReasons || []),
    row.memory?.signatureKey || "",
  ].join(" ").toLowerCase();
  return pattern.test(text);
}

export function classifyDangerousWallet(row = {}, walletAudit = auditWalletNormalization(row)) {
  const walletLabel = row.roi?.wallet?.classification?.label || row.memory?.signature?.wallet || "UNKNOWN";
  if (walletLabel !== "DANGEROUS") {
    return { taxonomy: walletLabel, action: "KEEP_CURRENT", hardProtection: false, reasons: [`wallet ${walletLabel}`] };
  }

  const reasons = [];
  const pnl = num(row.pnlPct, 0);
  const fee = row.roi?.feeTvl?.classification?.label || row.memory?.signature?.feeTvl;
  const oor = row.memory?.signature?.oor;
  const positiveMemory = row.execution?.memory?.contextualDanger?.positiveContext || [];

  if (hasText(row, /rug|honeypot|blacklist|exploit|malicious|dump/)) {
    return { taxonomy: "TOXIC_DANGEROUS", action: "HARD_BLOCK", hardProtection: true, reasons: ["hard malicious/rug text detected"] };
  }
  if (walletAudit.status === "SOURCE_CORRUPTED") reasons.push("wallet source corrupted");
  if (fee === "EXCELLENT" || fee === "STRONG") reasons.push(`positive fee context ${fee}`);
  if (oor === "NO OOR" || oor === "LOW OOR") reasons.push(`range context ${oor}`);
  if (pnl >= 10 || positiveMemory.length) reasons.push("historical profitable outcome");

  if (pnl >= 10 || positiveMemory.length) return { taxonomy: "ELITE_DANGEROUS", action: "CONTEXT_REVIEW", hardProtection: false, reasons };
  if (fee === "EXCELLENT" || fee === "STRONG" || walletAudit.status === "SOURCE_CORRUPTED") {
    return { taxonomy: "AGGRESSIVE_DANGEROUS", action: "SOFT_BLOCK_OR_WATCHLIST", hardProtection: false, reasons };
  }
  return { taxonomy: "TOXIC_DANGEROUS", action: "HARD_BLOCK", hardProtection: true, reasons: reasons.length ? reasons : ["dangerous wallet with no positive context"] };
}

export function buildDangerousWalletTaxonomy(rows = []) {
  const dangerous = rows.filter((row) => row.roi?.wallet?.classification?.label === "DANGEROUS");
  const classified = dangerous.map((row) => {
    const walletAudit = auditWalletNormalization(row);
    return { row, walletAudit, taxonomy: classifyDangerousWallet(row, walletAudit) };
  });
  const groups = {};
  for (const item of classified) {
    const key = item.taxonomy.taxonomy;
    if (!groups[key]) groups[key] = [];
    groups[key].push(item.row);
  }
  return {
    dangerousCount: dangerous.length,
    groups: Object.entries(groups).map(([taxonomy, items]) => ({ taxonomy, ...summarize(items) })),
    samples: classified.slice(0, 20).map(({ row, walletAudit, taxonomy }) => ({
      id: row.id,
      pool: row.pool,
      pnlPct: row.pnlPct,
      taxonomy,
      walletAudit,
    })),
  };
}

export function buildWalletReputation(rows = []) {
  const byWallet = new Map();
  for (const row of rows) {
    const pool = row.sourcePool || {};
    const wallet = pool.source_wallet || pool.deployArgs?.source_wallet || pool.wallet || pool.defensiveSignal?.wallet || "UNKNOWN_WALLET";
    if (!byWallet.has(wallet)) byWallet.set(wallet, []);
    byWallet.get(wallet).push(row);
  }
  return [...byWallet.entries()].map(([wallet, items]) => {
    const summary = summarize(items);
    const rugAssociation = items.filter((row) => hasText(row, /rug|honeypot|exploit|blacklist/)).length;
    const volatility = items.length ? round(items.reduce((s, r) => s + Math.abs(num(r.pnlPct, 0) - summary.avgPnlPct), 0) / items.length) : 0;
    const repeatSuccess = items.filter((r) => num(r.pnlPct, 0) > 0).length;
    let reputation = "UNSTABLE";
    if (rugAssociation) reputation = "TOXIC";
    else if (summary.trades >= 3 && summary.winRate >= 70 && summary.avgPnlPct >= 5) reputation = "ELITE";
    else if (summary.winRate >= 60 && summary.avgPnlPct > 0) reputation = "TRUSTED";
    else if (volatility >= 8 && summary.avgPnlPct > 0) reputation = "AGGRESSIVE";
    return {
      wallet,
      reputation,
      rugAssociation,
      volatility,
      repeatSuccess,
      ...summary,
    };
  }).sort((a, b) => b.totalPnlPct - a.totalPnlPct).slice(0, 50);
}

export function repairMissingSource(row = {}) {
  const audit = auditWalletNormalization(row);
  if (!audit.issues.includes("missing_wallet_score") && !audit.issues.includes("fallback_usage") && audit.status !== "SOURCE_CORRUPTED") {
    return { repaired: false, recommendation: "KEEP_CURRENT", reason: "wallet source present", repairedScore: audit.primary.value };
  }
  const fee = row.roi?.feeTvl?.classification?.label || row.memory?.signature?.feeTvl;
  const context = row.execution?.memory?.contextualDanger || {};
  let repairedScore = 45;
  const reasons = ["wallet score missing/fallback"];
  if (fee === "EXCELLENT" || fee === "STRONG") {
    repairedScore += 12;
    reasons.push(`fee context ${fee}`);
  }
  if ((context.positiveContext || []).length) {
    repairedScore += 10;
    reasons.push("positive memory context");
  }
  repairedScore = clamp(repairedScore);
  return {
    repaired: true,
    recommendation: repairedScore >= 55 ? "CONTEXT_REVIEW" : "SOFT_BLOCK",
    reason: reasons.join("; "),
    repairedScore,
  };
}

export function buildShadowWalletReclassification(rows = []) {
  const currentDangerous = rows.filter((row) => row.roi?.wallet?.classification?.label === "DANGEROUS");
  const shadow = currentDangerous.map((row) => {
    const audit = auditWalletNormalization(row);
    const taxonomy = classifyDangerousWallet(row, audit);
    const repair = repairMissingSource(row);
    const shadowAction = taxonomy.hardProtection
      ? "SHADOW_HARD_BLOCK"
      : taxonomy.taxonomy === "ELITE_DANGEROUS"
        ? "SHADOW_CONTEXT_REVIEW"
        : "SHADOW_SOFT_BLOCK";
    return { row, audit, taxonomy, repair, shadowAction };
  });
  const reviewed = shadow.filter((item) => item.shadowAction !== "SHADOW_HARD_BLOCK").map((item) => item.row);
  return {
    mode: "SHADOW_ONLY",
    realMoney: false,
    currentDangerous: currentDangerous.length,
    shadowReviewed: reviewed.length,
    reviewedSummary: summarize(reviewed),
    samples: shadow.slice(0, 20).map((item) => ({
      id: item.row.id,
      pool: item.row.pool,
      pnlPct: item.row.pnlPct,
      current: "DANGEROUS",
      shadowAction: item.shadowAction,
      taxonomy: item.taxonomy,
      repair: item.repair,
      auditStatus: item.audit.status,
    })),
  };
}

export function detectWalletTruthRegression(rows = [], walletLayer = {}) {
  const dangerous = rows.filter((row) => row.roi?.wallet?.classification?.label === "DANGEROUS");
  const dangerousWinners = dangerous.filter((row) => num(row.pnlPct, 0) > 0);
  const falseDangerRate = dangerous.length ? round((dangerousWinners.length / dangerous.length) * 100, 1) : 0;
  const corruptedRate = rows.length ? round((num(walletLayer.normalizationAudit?.corrupted, 0) / rows.length) * 100, 1) : 0;
  const warnings = [];
  if (falseDangerRate >= 55 && dangerous.length >= 5) warnings.push(`dangerous wallet false winner rate ${falseDangerRate}%`);
  if (corruptedRate >= 20) warnings.push(`wallet source corruption ${corruptedRate}%`);
  const reviewed = walletLayer.shadowWalletReclassification?.reviewedSummary || {};
  if (num(reviewed.trades) > 0 && num(reviewed.avgPnlPct) < -1) warnings.push("shadow repaired wallet cohort loses money");
  return {
    state: warnings.length ? "WALLET_REGRESSION_DETECTED" : "WALLET_TRUTH_STABLE",
    falseDangerRate,
    corruptedRate,
    rollback: warnings.length ? "keep current defensive live logic; use repaired wallet truth only in shadow" : "no rollback needed",
    warnings,
  };
}

export function buildWalletTruthLayer(rows = []) {
  const normalizationAudit = buildWalletNormalizationAudit(rows);
  const dangerousTaxonomy = buildDangerousWalletTaxonomy(rows);
  const walletReputation = buildWalletReputation(rows);
  const missingSourceRepair = {
    repaired: rows.map((row) => ({ row, repair: repairMissingSource(row) }))
      .filter((x) => x.repair.repaired)
      .slice(0, 20)
      .map(({ row, repair }) => ({ id: row.id, pool: row.pool, pnlPct: row.pnlPct, repair })),
  };
  const shadowWalletReclassification = buildShadowWalletReclassification(rows);
  const layer = {
    normalizationAudit,
    dangerousTaxonomy,
    walletReputation,
    missingSourceRepair,
    shadowWalletReclassification,
  };
  return {
    ...layer,
    walletTruthRegression: detectWalletTruthRegression(rows, layer),
  };
}
