import { buildAntiOorPayload } from "./anti_oor_intelligence.js";

function num(value, fallback = 0) {
  if (value === null || value === undefined || value === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function round(value, digits = 2) {
  const m = 10 ** digits;
  return Math.round(num(value) * m) / m;
}

function isClosed(trade = {}) {
  return trade.status === "closed" || Boolean(trade.close_time);
}

function isMomentumRider(trade = {}) {
  return String(trade.strategy || trade.entry_truth?.strategy || "").toLowerCase() === "momentum_rider"
    || Boolean(trade.momentum_rider);
}

function summarize(trades = []) {
  const closed = trades.filter(isClosed);
  const pnl = closed.map((trade) => num(trade.pnl_pct ?? trade.pnlPct));
  const wins = pnl.filter((v) => v > 0);
  const losses = pnl.filter((v) => v <= 0);
  const grossWin = wins.reduce((sum, v) => sum + v, 0);
  const grossLoss = Math.abs(losses.reduce((sum, v) => sum + v, 0));
  const oor = closed.filter((trade) => num(trade.minutes_out_of_range, 0) > 0 || String(trade.close_reason || "").toLowerCase().includes("oor") || String(trade.close_reason || "").toLowerCase().includes("out-of-range"));
  const hold = closed.map((trade) => num(trade.minutes_held, null)).filter((v) => v !== null);
  return {
    totalTrades: closed.length,
    wins: wins.length,
    losses: losses.length,
    winRate: closed.length ? round((wins.length / closed.length) * 100, 1) : 0,
    pf: grossLoss > 0 ? round(grossWin / grossLoss) : (grossWin > 0 ? 99 : 0),
    avgPnlPct: closed.length ? round(pnl.reduce((sum, v) => sum + v, 0) / closed.length) : 0,
    oorRate: closed.length ? round((oor.length / closed.length) * 100, 1) : 0,
    avgHoldMinutes: hold.length ? round(hold.reduce((sum, v) => sum + v, 0) / hold.length) : 0,
  };
}

export function buildMomentumRiderDecision({ trades = [], candidate = {}, normalSizeSol = null } = {}) {
  const anti = buildAntiOorPayload({ trades, candidate });
  const feeTvl = num(candidate.fee_tvl_ratio ?? candidate.feeTvlRatio, null);
  const organic = num(candidate.organic_score ?? candidate.organicScore, null);
  const walletScore = num(candidate.wallet_score ?? candidate.walletScore ?? candidate.source_wallet_score, null);
  const risk = anti.oorPrediction?.oorRisk || "LOW";
  const checks = [
    { key: "momentum_breakout_up", passed: anti.momentumEscape?.state === "MOMENTUM_BREAKOUT_UP", detail: anti.momentumEscape?.state || "unknown" },
    { key: "upward_escape_pattern", passed: anti.antiOorIntelligence?.oorPattern === "UPWARD_ESCAPE", detail: anti.antiOorIntelligence?.oorPattern || "unknown" },
    { key: "fee_tvl_good", passed: feeTvl === null ? null : feeTvl >= 0.25, detail: feeTvl },
    { key: "organic_strong", passed: organic === null ? null : organic >= 75, detail: organic },
    { key: "wallet_healthy", passed: walletScore === null ? null : walletScore >= 60, detail: walletScore },
    { key: "old_strategy_high_risk", passed: ["HIGH", "CRITICAL"].includes(risk), detail: risk },
  ];
  const knownChecks = checks.filter((check) => check.passed !== null);
  const passedKnown = knownChecks.every((check) => check.passed);
  const missing = checks.filter((check) => check.passed === null).map((check) => check.key);
  const marketReady = anti.momentumEscape?.state === "MOMENTUM_BREAKOUT_UP"
    && anti.antiOorIntelligence?.oorPattern === "UPWARD_ESCAPE"
    && ["HIGH", "CRITICAL"].includes(risk);
  const candidateReady = marketReady && passedKnown && missing.length === 0;
  const sizeBase = num(normalSizeSol ?? candidate.amount_sol ?? candidate.amount_y, null);
  const suggestedSizeSol = sizeBase === null ? null : round(sizeBase * 0.15, 4);

  return {
    strategy: "momentum_rider",
    status: candidateReady ? "SANDBOX_READY" : marketReady ? "SANDBOX_WATCH" : "OFF",
    mode: candidateReady || marketReady ? "SANDBOX" : "OFF",
    liveAllowed: false,
    executableByCurrentDeployStack: false,
    reason: candidateReady
      ? "conditions match, but current deploy stack is single-side SOL; keep as sandbox/shadow plan until upside-range support exists"
      : marketReady
        ? "fast market detected; waiting for candidate-level fee/organic/wallet confirmation"
        : "momentum rider inactive",
    activationChecks: checks,
    missingCandidateInputs: missing,
    rangePlan: {
      bias: "UPWARD",
      binsBelow: 10,
      binsAbove: 55,
      expectedBehavior: "range starts near current active bin and rides upward breakout",
    },
    sizing: {
      mode: "tiny_size_mode",
      normalSizeSol: sizeBase,
      multiplier: 0.15,
      suggestedSizeSol,
      allowedRangePctOfNormal: "10-25%",
    },
    entryRules: [
      "breakout persistence must remain positive",
      "spread quality must be acceptable",
      "FeeTVL must stay healthy",
      "acceleration must not reverse",
      "fallback is NO_DEPLOY",
    ],
    exitRules: [
      "close if momentum dies for 10-15 minutes",
      "close immediately on MOMENTUM_BREAKOUT_DOWN",
      "lock early profit when fee plus unrealized gain is strong",
    ],
    antiOor: {
      momentumState: anti.momentumEscape?.state,
      oorPattern: anti.antiOorIntelligence?.oorPattern,
      oorRisk: risk,
      finalRecommendation: anti.finalRecommendation,
    },
  };
}

export function buildMomentumRiderPayload({ trades = [], candidates = [] } = {}) {
  const riderTrades = trades.filter(isMomentumRider);
  const marketDecision = buildMomentumRiderDecision({ trades });
  const candidatePlans = candidates
    .map((candidate) => buildMomentumRiderDecision({ trades, candidate, normalSizeSol: candidate.amount_sol ?? candidate.amount_y }))
    .filter((plan) => plan.status !== "OFF")
    .slice(0, 12);
  const stats = summarize(riderTrades);
  return {
    ok: true,
    layer: "FAST_MARKET_MOMENTUM_RIDER",
    status: candidatePlans.some((plan) => plan.status === "SANDBOX_READY")
      ? "SANDBOX"
      : marketDecision.status === "SANDBOX_WATCH"
        ? "SANDBOX_WATCH"
        : "OFF",
    mode: "SANDBOX_ONLY",
    liveAllowed: false,
    currentDeployLimitation: "single-side SOL deploy cannot use bins_above; momentum rider requires upside range support before real execution",
    marketDecision,
    candidatePlans,
    stats,
    safetyRules: [
      "does not replace old strategy",
      "does not enable live deployment",
      "sandbox/shadow first for 30-50 samples",
      "defensive engine always wins",
      "if unsure, fallback NO_DEPLOY",
    ],
  };
}
