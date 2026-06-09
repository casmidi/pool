function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function round(value, digits = 2) {
  const m = 10 ** digits;
  return Math.round(num(value) * m) / m;
}

function hashString(value = "") {
  let h = 2166136261;
  const s = String(value);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h >>> 0);
}

function maxDrawdown(values = []) {
  let equity = 0;
  let peak = 0;
  let maxDd = 0;
  for (const value of values) {
    equity += num(value);
    peak = Math.max(peak, equity);
    maxDd = Math.min(maxDd, equity - peak);
  }
  return round(maxDd);
}

function summarize(rows = []) {
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
    maxDrawdownPct: maxDrawdown(pnl),
    profitFactor: grossLoss > 0 ? round(grossWin / grossLoss, 2) : (grossWin > 0 ? 99 : 0),
  };
}

function betaPosterior(wins, losses) {
  const alpha = 1 + num(wins);
  const beta = 1 + num(losses);
  const total = alpha + beta;
  const mean = total ? alpha / total : 0.5;
  const variance = (alpha * beta) / ((total ** 2) * (total + 1));
  const sd = Math.sqrt(variance);
  return {
    alpha,
    beta,
    expectedWinRate: round(mean * 100, 1),
    conservativeWinRate: round(Math.max(0, mean - 1.64 * sd) * 100, 1),
    confidence: round(Math.min(100, Math.max(0, (total - 2) * 4))),
  };
}

function bucketName(row = {}) {
  const key = row.id || row.pool || row.ts || "";
  const h = hashString(key) % 100;
  if (h < 50) return "CONTROL_CHAMPION";
  if (h < 80) return "CHALLENGER_CONTEXTUAL";
  return "CHALLENGER_MEMORY";
}

export function buildExperimentBuckets(rows = []) {
  const buckets = {};
  for (const row of rows) {
    const bucket = bucketName(row);
    if (!buckets[bucket]) buckets[bucket] = [];
    buckets[bucket].push(row);
  }
  return Object.entries(buckets).map(([bucket, items]) => ({
    bucket,
    allocationPct: bucket === "CONTROL_CHAMPION" ? 50 : bucket === "CHALLENGER_CONTEXTUAL" ? 30 : 20,
    ...summarize(items),
    bayesian: betaPosterior(items.filter((r) => num(r.pnlPct) > 0).length, items.filter((r) => num(r.pnlPct) <= 0).length),
  })).sort((a, b) => a.bucket.localeCompare(b.bucket));
}

function eligibleShadow(row = {}) {
  const context = row.execution?.memory?.contextualDanger || row.memory?.contextualDanger || {};
  const strictness = row.execution?.memory?.blockStrictness || row.memory?.blockStrictness || {};
  if (row.executable) return false;
  if (strictness.tier === "HARD_BLOCK") return false;
  return ["SOFT_BLOCK", "WATCHLIST", "TEST_POSITION"].includes(context.recommendedStrictness || strictness.tier);
}

export function buildShadowExecution(rows = []) {
  const candidates = rows.filter(eligibleShadow);
  return {
    mode: "SHADOW_ONLY",
    realMoney: false,
    rule: "no order is sent; defensive engine remains source of live truth",
    candidates: candidates.map((row) => {
      const context = row.execution?.memory?.contextualDanger || row.memory?.contextualDanger || {};
      const suggestedAction = context.recommendedStrictness === "TEST_POSITION"
        ? "SHADOW_TEST_POSITION"
        : context.recommendedStrictness === "WATCHLIST"
          ? "SHADOW_WATCHLIST"
          : "SHADOW_SOFT_BLOCK_REVIEW";
      return {
        id: row.id,
        pool: row.pool,
        pnlPct: row.pnlPct,
        currentStatus: row.roi?.status?.label || null,
        currentExecutable: row.executable,
        suggestedAction,
        contextScore: context.contextScore ?? null,
        blockerConfidence: context.blockerConfidence?.maxConfidence ?? null,
        reasons: context.explanation || [],
      };
    }),
    summary: summarize(candidates),
  };
}

export function buildChallengerVsChampion(rows = []) {
  const champion = rows.filter((r) => r.executable);
  const challenger = rows.filter(eligibleShadow);
  const championSummary = summarize(champion);
  const challengerSummary = summarize(challenger);
  return {
    champion: {
      name: "CHAMPION_CURRENT_DEFENSIVE",
      ...championSummary,
      bayesian: betaPosterior(championSummary.wins, championSummary.losses),
    },
    challenger: {
      name: "CHALLENGER_CONTEXTUAL_DEFENSIVE_SHADOW",
      ...challengerSummary,
      bayesian: betaPosterior(challengerSummary.wins, challengerSummary.losses),
    },
    delta: {
      trades: challengerSummary.trades - championSummary.trades,
      winRate: round(challengerSummary.winRate - championSummary.winRate, 1),
      avgPnlPct: round(challengerSummary.avgPnlPct - championSummary.avgPnlPct),
      totalPnlPct: round(challengerSummary.totalPnlPct - championSummary.totalPnlPct),
      maxDrawdownPct: round(challengerSummary.maxDrawdownPct - championSummary.maxDrawdownPct),
      profitFactor: round(challengerSummary.profitFactor - championSummary.profitFactor),
    },
  };
}

export function buildBayesianLearning(rows = []) {
  const buckets = buildExperimentBuckets(rows);
  return {
    prior: "Beta(1,1)",
    buckets,
    interpretation: buckets.map((b) => ({
      bucket: b.bucket,
      expectedWinRate: b.bayesian.expectedWinRate,
      conservativeWinRate: b.bayesian.conservativeWinRate,
      confidence: b.bayesian.confidence,
      verdict: b.trades < 30
        ? "INSUFFICIENT_SAMPLE"
        : b.bayesian.conservativeWinRate >= 55
          ? "PROMISING"
          : "WEAK_OR_UNPROVEN",
    })),
  };
}

export function buildRegressionSafety(rows = [], memory = {}, challengerVsChampion = {}) {
  const warnings = [];
  const regression = memory.regressionDetection || {};
  const champion = challengerVsChampion.champion || {};
  const challenger = challengerVsChampion.challenger || {};

  if (regression.state === "DEFENSIVE_REGRESSION_DETECTED") warnings.push("defensive regression already detected; promotion requires extra evidence");
  if (num(challenger.trades) < 30) warnings.push(`challenger sample ${num(challenger.trades)} < 30`);
  if (num(challenger.maxDrawdownPct) < num(champion.maxDrawdownPct) - 5) warnings.push("challenger drawdown materially worse");
  if (num(challenger.winRate) < num(champion.winRate) - 5) warnings.push("challenger win rate worse than champion");
  if (num(challenger.profitFactor) < 1.3) warnings.push("challenger profit factor below promotion floor");

  return {
    state: warnings.length ? "PROMOTION_BLOCKED" : "PROMOTION_SAFE_TO_REVIEW",
    rollbackRequired: true,
    rollbackPlan: [
      "keep champion as live decision source",
      "disable challenger by ignoring /api/shadow-execution recommendations",
      "revert promotion only through backend config after 30+ additional closed samples",
    ],
    warnings,
  };
}

export function buildSafePromotion(challengerVsChampion = {}, bayesian = {}, regressionSafety = {}) {
  const challenger = challengerVsChampion.challenger || {};
  const champion = challengerVsChampion.champion || {};
  const challengerBayes = challenger.bayesian || {};
  const requirements = [
    { key: "no_real_money", passed: true, detail: "shadow-only engine" },
    { key: "min_30_challenger_samples", passed: num(challenger.trades) >= 30, detail: `${num(challenger.trades)} challenger samples` },
    { key: "conservative_wr_55", passed: num(challengerBayes.conservativeWinRate) >= 55, detail: `${num(challengerBayes.conservativeWinRate)}% conservative WR` },
    { key: "beats_champion_avg_pnl", passed: num(challenger.avgPnlPct) > num(champion.avgPnlPct), detail: `${num(challenger.avgPnlPct)}% vs ${num(champion.avgPnlPct)}%` },
    { key: "regression_safe", passed: regressionSafety.state === "PROMOTION_SAFE_TO_REVIEW", detail: regressionSafety.state || "unknown" },
  ];
  const promoted = requirements.every((r) => r.passed);
  return {
    state: promoted ? "PROMOTION_CANDIDATE_SHADOW_ONLY" : "NOT_PROMOTED",
    promoted,
    requirements,
    decision: promoted
      ? "eligible for human review only; still no real-money auto-promotion"
      : "keep champion live; continue shadow collection",
  };
}

export function buildShadowExperimentLayer(rows = [], memory = {}) {
  const shadowExecution = buildShadowExecution(rows);
  const experimentBuckets = buildExperimentBuckets(rows);
  const challengerVsChampion = buildChallengerVsChampion(rows);
  const bayesianLearning = buildBayesianLearning(rows);
  const regressionSafety = buildRegressionSafety(rows, memory, challengerVsChampion);
  const safePromotion = buildSafePromotion(challengerVsChampion, bayesianLearning, regressionSafety);
  return {
    shadowExecution,
    experimentBuckets,
    challengerVsChampion,
    bayesianLearning,
    safePromotion,
    regressionSafety,
  };
}
