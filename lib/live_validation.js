import { detectSignalLoss } from "./source_truth.js";

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function round(value, digits = 2) {
  const m = 10 ** digits;
  return Math.round(num(value) * m) / m;
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

function summarizeTrades(trades = []) {
  const pnl = trades.map((t) => num(t.pnl_pct ?? t.pnlPct));
  const wins = pnl.filter((v) => v > 0);
  const losses = pnl.filter((v) => v <= 0);
  const grossWin = wins.reduce((s, v) => s + v, 0);
  const grossLoss = Math.abs(losses.reduce((s, v) => s + v, 0));
  return {
    trades: trades.length,
    wins: wins.length,
    losses: losses.length,
    winRate: trades.length ? round((wins.length / trades.length) * 100, 1) : 0,
    avgPnlPct: trades.length ? round(pnl.reduce((s, v) => s + v, 0) / trades.length) : 0,
    totalPnlPct: round(pnl.reduce((s, v) => s + v, 0)),
    expectancyPct: trades.length ? round(pnl.reduce((s, v) => s + v, 0) / trades.length) : 0,
    maxDrawdownPct: maxDrawdown(pnl),
    profitFactor: grossLoss > 0 ? round(grossWin / grossLoss, 2) : (grossWin > 0 ? 99 : 0),
  };
}

function datasetTier(count) {
  if (count >= 250) return { tier: "TIER_4", quality: "TRUSTED", next: null };
  if (count >= 100) return { tier: "TIER_3", quality: "HIGH", next: 250 - count };
  if (count >= 50) return { tier: "TIER_2", quality: "MEDIUM", next: 100 - count };
  if (count >= 30) return { tier: "TIER_1", quality: "LOW", next: 50 - count };
  return { tier: "PRE_TIER", quality: "INSUFFICIENT", next: 30 - count };
}

function isClosedTrade(trade = {}) {
  return (trade.status === "closed" || trade.close_time) && Number.isFinite(Number(trade.pnl_pct));
}

function hasTruthIntegrity(trade = {}) {
  const loss = trade.signal_loss || detectSignalLoss(trade);
  return loss.state === "SIGNAL_OK" && loss.promotionAllowed !== false;
}

export function buildGoldenDataset(trades = []) {
  const closed = trades.filter(isClosedTrade);
  const golden = closed.filter(hasTruthIntegrity);
  const rejected = closed.filter((trade) => !hasTruthIntegrity(trade));
  const tier = datasetTier(golden.length);
  return {
    datasetQuality: tier.quality,
    tier: tier.tier,
    nextTierNeeds: tier.next,
    totalClosed: closed.length,
    truthValidTrades: golden.length,
    rejectedCorruptedTrades: rejected.length,
    rejectionReasons: rejected.reduce((acc, trade) => {
      const loss = trade.signal_loss || detectSignalLoss(trade);
      acc[loss.state] = (acc[loss.state] || 0) + 1;
      return acc;
    }, {}),
    trades: golden,
  };
}

function pfStability(summary = {}, count = 0) {
  if (count < 30) return 0;
  const pf = num(summary.profitFactor);
  if (pf < 1) return 5;
  if (pf <= 2.5) return 22;
  return 12;
}

export function buildMarketRegimeDetection(trades = []) {
  if (!trades.length) {
    return {
      state: "UNKNOWN",
      confidence: 0,
      reasons: ["no truth-valid trades"],
      metrics: {},
    };
  }
  const avgVolatility = round(trades.reduce((s, t) => s + num(t.entry_truth?.raw?.volatility ?? t.volatility), 0) / trades.length);
  const avgFee = round(trades.reduce((s, t) => s + num(t.entry_truth?.raw?.feeTvlRatio ?? t.fee_tvl_ratio), 0) / trades.length, 4);
  const oorRate = round((trades.filter((t) => num(t.minutes_out_of_range) > 0).length / trades.length) * 100, 1);
  const activeRate = round((trades.filter((t) => num(t.entry_truth?.raw?.feeTvlRatio ?? t.fee_tvl_ratio) >= 0.7).length / trades.length) * 100, 1);
  let state = "CHOPPY";
  const reasons = [];
  if (avgFee >= 1 && oorRate < 25 && avgVolatility < 8) {
    state = "BULLISH";
    reasons.push("high fee activity with low OOR");
  } else if (avgFee >= 0.7 && oorRate < 40) {
    state = "RISK_ON";
    reasons.push("healthy fee activity");
  } else if (oorRate >= 60 || avgVolatility >= 12) {
    state = "CHAOTIC";
    reasons.push("high OOR or volatility");
  } else if (avgFee < 0.2 && activeRate < 20) {
    state = "DEAD";
    reasons.push("low fee activity");
  } else {
    reasons.push("mixed activity");
  }
  return {
    state,
    confidence: Math.min(100, trades.length * 3),
    reasons,
    metrics: { avgVolatility, avgFeeTvlRatio: avgFee, oorRate, activeRate },
  };
}

export function buildQuantConfidence(goldenDataset = {}, summary = {}, regime = {}) {
  const count = num(goldenDataset.truthValidTrades);
  const sampleScore = count >= 250 ? 35 : count >= 100 ? 28 : count >= 50 ? 20 : count >= 30 ? 12 : 0;
  const pfScore = pfStability(summary, count);
  const drawdownScore = count >= 30 && Math.abs(num(summary.maxDrawdownPct)) <= 20 ? 15 : count >= 30 ? 6 : 0;
  const signalIntegrityScore = goldenDataset.rejectedCorruptedTrades === 0 && count > 0 ? 15 : count > 0 ? 8 : 0;
  const regimeScore = count >= 30 && regime.state !== "UNKNOWN" ? 13 : 0;
  const edgeConfidence = Math.min(100, sampleScore + pfScore + drawdownScore + signalIntegrityScore + regimeScore);
  let label = "LOW_CONFIDENCE";
  if (count >= 250) label = "TRUSTED";
  else if (count >= 100) label = "HIGHER_CONFIDENCE";
  else if (count >= 50) label = "MODERATE_CONFIDENCE";
  else if (count >= 30) label = "EARLY_SIGNAL";
  return {
    edgeConfidence,
    label,
    components: { sampleScore, pfScore, drawdownScore, signalIntegrityScore, regimeScore },
    sampleSize: count,
  };
}

export function buildLiveEdgeValidation(goldenDataset = {}, regime = {}) {
  const summary = summarizeTrades(goldenDataset.trades || []);
  const count = num(goldenDataset.truthValidTrades);
  let edgeState = "UNPROVEN";
  if (count >= 250 && summary.profitFactor >= 1.8 && summary.expectancyPct > 0 && Math.abs(summary.maxDrawdownPct) <= 20) edgeState = "STRONG";
  else if (count >= 100 && summary.profitFactor >= 1.4 && summary.expectancyPct > 0) edgeState = "BELIEVABLE";
  else if (count >= 30 && summary.profitFactor >= 1.2 && summary.expectancyPct > 0) edgeState = "PROMISING";
  if (count >= 30 && (summary.profitFactor < 1 || summary.expectancyPct <= 0)) edgeState = "REGRESSION";
  return {
    edgeState,
    summary,
    survival: {
      closedTrades: count,
      enoughSample: count >= 30,
    },
    oorStability: {
      rate: regime.metrics?.oorRate ?? 0,
      state: (regime.metrics?.oorRate ?? 100) <= 40 ? "STABLE" : "UNSTABLE",
    },
    blockerPrecision: "PENDING_TRUTH_VALID_SAMPLE",
    walletTruthAccuracy: goldenDataset.truthValidTrades > 0 ? "MEASURABLE" : "NO_VALID_SAMPLE",
  };
}

export function buildStatisticalHonesty(goldenDataset = {}, edge = {}, confidence = {}, regime = {}) {
  const warnings = [];
  const count = num(goldenDataset.truthValidTrades);
  if (count < 30) warnings.push(`NOT ENOUGH EVIDENCE: ${count}/30 truth-valid trades`);
  if (goldenDataset.rejectedCorruptedTrades > 0) warnings.push(`${goldenDataset.rejectedCorruptedTrades} legacy/corrupted trades excluded`);
  if (edge.summary?.profitFactor > 2.5 && count < 100) warnings.push("profit factor too high for small sample; treat as unstable");
  if (regime.state === "UNKNOWN") warnings.push("market regime unknown due insufficient valid data");
  if (confidence.edgeConfidence < 30) warnings.push("edge confidence below 30");
  return {
    statisticalWarning: warnings.length ? "NOT_ENOUGH_EVIDENCE" : "STATISTICALLY_USABLE",
    warnings,
    canClaimEdge: count >= 30 && confidence.edgeConfidence >= 30 && edge.edgeState !== "UNPROVEN",
    alphaClaimAllowed: count >= 100 && confidence.edgeConfidence >= 60 && edge.edgeState === "BELIEVABLE",
  };
}

export function buildLiveLearningFoundation(goldenDataset = {}, edge = {}, confidence = {}, regime = {}) {
  return {
    status: goldenDataset.truthValidTrades > 0 ? "COLLECTING_TRUTH_VALID_EVIDENCE" : "WAITING_FOR_FIRST_TRUTH_VALID_TRADE",
    tracks: {
      blockerEffectiveness: goldenDataset.truthValidTrades >= 30 ? "READY" : "PENDING_30_TRADES",
      walletTruthImprovement: goldenDataset.truthValidTrades >= 30 ? "READY" : "PENDING_30_TRADES",
      shadowCandidateOutcome: goldenDataset.truthValidTrades >= 30 ? "READY" : "PENDING_30_TRADES",
      challengerEvolution: goldenDataset.truthValidTrades >= 50 ? "READY" : "PENDING_50_TRADES",
      confidenceEvolution: confidence.label,
      regimeContext: regime.state,
    },
    guardrails: [
      "no adaptation from corrupted legacy trades",
      "no promotion before minimum truth-valid sample",
      "defensive engine remains live source of truth",
      "learning is measurement-first, not auto-overfit",
    ],
  };
}

export function buildLiveValidationPayload(trades = []) {
  const goldenDataset = buildGoldenDataset(trades);
  const regimeDetection = buildMarketRegimeDetection(goldenDataset.trades);
  const liveEdgeValidation = buildLiveEdgeValidation(goldenDataset, regimeDetection);
  const quantConfidence = buildQuantConfidence(goldenDataset, liveEdgeValidation.summary, regimeDetection);
  const statisticalHonesty = buildStatisticalHonesty(goldenDataset, liveEdgeValidation, quantConfidence, regimeDetection);
  const liveLearningFoundation = buildLiveLearningFoundation(goldenDataset, liveEdgeValidation, quantConfidence, regimeDetection);
  return {
    goldenDataset: {
      ...goldenDataset,
      trades: undefined,
    },
    quantConfidence,
    liveEdgeValidation,
    marketRegimeDetection: regimeDetection,
    statisticalHonesty,
    liveLearningFoundation,
  };
}
