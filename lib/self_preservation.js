import { buildGoldenDataset, buildLiveValidationPayload, buildMarketRegimeDetection } from "./live_validation.js";

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function round(value, digits = 2) {
  const m = 10 ** digits;
  return Math.round(num(value) * m) / m;
}

function summarize(trades = []) {
  const pnl = trades.map((t) => num(t.pnl_pct ?? t.pnlPct));
  const wins = pnl.filter((v) => v > 0);
  const losses = pnl.filter((v) => v <= 0);
  const grossWin = wins.reduce((s, v) => s + v, 0);
  const grossLoss = Math.abs(losses.reduce((s, v) => s + v, 0));
  let equity = 0;
  let peak = 0;
  let maxDd = 0;
  for (const v of pnl) {
    equity += v;
    peak = Math.max(peak, equity);
    maxDd = Math.min(maxDd, equity - peak);
  }
  return {
    trades: trades.length,
    winRate: trades.length ? round((wins.length / trades.length) * 100, 1) : 0,
    expectancyPct: trades.length ? round(pnl.reduce((s, v) => s + v, 0) / trades.length) : 0,
    totalPnlPct: round(pnl.reduce((s, v) => s + v, 0)),
    maxDrawdownPct: round(maxDd),
    profitFactor: grossLoss > 0 ? round(grossWin / grossLoss, 2) : (grossWin > 0 ? 99 : 0),
  };
}

function rollingWindows(trades = []) {
  const sorted = trades.slice().sort((a, b) => new Date(a.close_time || a.deploy_time || 0) - new Date(b.close_time || b.deploy_time || 0));
  return {
    last10: summarize(sorted.slice(-10)),
    last30: summarize(sorted.slice(-30)),
    last50: summarize(sorted.slice(-50)),
  };
}

export function buildEdgeDecayDetection(goldenDataset = {}, liveValidation = {}) {
  const trades = goldenDataset.trades || [];
  const windows = rollingWindows(trades);
  const warnings = [];
  const count = num(goldenDataset.truthValidTrades);

  if (count < 10) warnings.push("insufficient rolling sample for edge decay");
  if (count >= 10 && windows.last10.profitFactor < 1.1) warnings.push("PF collapse in last 10 trades");
  if (count >= 10 && windows.last10.winRate < 45) warnings.push("WR collapse in last 10 trades");
  if (count >= 10 && windows.last10.expectancyPct <= 0) warnings.push("expectancy non-positive in last 10 trades");
  if (count >= 30 && Math.abs(windows.last30.maxDrawdownPct) >= 20) warnings.push("drawdown spike in last 30 trades");
  if (liveValidation.statisticalHonesty?.statisticalWarning === "NOT_ENOUGH_EVIDENCE") warnings.push("statistical evidence not mature");

  let state = "EDGE_STABLE";
  if (count < 10) state = "EDGE_CRITICAL";
  else if (warnings.length >= 3) state = "EDGE_DECAY_DETECTED";
  else if (warnings.length) state = "EDGE_WEAKENING";

  return {
    state,
    windows,
    warnings,
    metrics: {
      truthValidTrades: count,
      edgeConfidence: liveValidation.quantConfidence?.edgeConfidence ?? 0,
      edgeState: liveValidation.liveEdgeValidation?.edgeState || "UNPROVEN",
    },
  };
}

function healthCategory(score) {
  if (score >= 90) return "HEALTHY";
  if (score >= 70) return "STABLE";
  if (score >= 50) return "WARNING";
  if (score >= 30) return "DETERIORATING";
  return "CRITICAL";
}

export function buildStrategyHealth(edgeDecay = {}, liveValidation = {}) {
  const confidence = num(liveValidation.quantConfidence?.edgeConfidence);
  const sample = num(liveValidation.goldenDataset?.truthValidTrades);
  const drawdown = Math.abs(num(liveValidation.liveEdgeValidation?.summary?.maxDrawdownPct));
  const regime = liveValidation.marketRegimeDetection?.state || "UNKNOWN";
  const integrity = sample > 0 && liveValidation.goldenDataset?.rejectedCorruptedTrades === 0 ? 20 : 0;
  const pf = num(liveValidation.liveEdgeValidation?.summary?.profitFactor);
  const pfScore = sample >= 30 ? (pf >= 1.5 && pf <= 2.5 ? 20 : pf >= 1.1 ? 12 : 0) : 0;
  const ddScore = sample >= 30 ? (drawdown <= 10 ? 15 : drawdown <= 20 ? 9 : 0) : 0;
  const regimeScore = regime !== "UNKNOWN" && regime !== "CHAOTIC" ? 10 : 0;
  const decayPenalty = edgeDecay.state === "EDGE_STABLE" ? 0 : edgeDecay.state === "EDGE_WEAKENING" ? -10 : edgeDecay.state === "EDGE_DECAY_DETECTED" ? -25 : -35;
  const score = Math.max(0, Math.min(100, Math.round(confidence * 0.35 + integrity + pfScore + ddScore + regimeScore + decayPenalty)));
  return {
    score,
    category: healthCategory(score),
    factors: {
      confidence,
      truthValidSample: sample,
      signalIntegrityScore: integrity,
      pfScore,
      drawdownScore: ddScore,
      regimeScore,
      decayPenalty,
    },
  };
}

export function buildAutoRiskCompression(strategyHealth = {}) {
  const category = strategyHealth.category || "CRITICAL";
  const map = {
    HEALTHY: { multiplier: 1.0, maxPositionPct: 5, action: "NORMAL_RISK_CAP" },
    STABLE: { multiplier: 0.75, maxPositionPct: 3.5, action: "COMPRESS_25%" },
    WARNING: { multiplier: 0.5, maxPositionPct: 2.5, action: "COMPRESS_50%" },
    DETERIORATING: { multiplier: 0.25, maxPositionPct: 1, action: "COMPRESS_75%" },
    CRITICAL: { multiplier: 0, maxPositionPct: 0, action: "NO_NEW_TRADE" },
  };
  return {
    ...map[category],
    rule: "risk compression only; never auto-increase beyond configured live caps",
    reason: `strategy health ${category}`,
  };
}

export function buildSurvivalMode(edgeDecay = {}, strategyHealth = {}, liveValidation = {}) {
  const regime = liveValidation.marketRegimeDetection?.state || "UNKNOWN";
  const triggers = [];
  if (regime === "CHAOTIC" || regime === "UNKNOWN") triggers.push(`regime ${regime}`);
  if (edgeDecay.state === "EDGE_CRITICAL" || edgeDecay.state === "EDGE_DECAY_DETECTED") triggers.push(edgeDecay.state);
  if (strategyHealth.category === "CRITICAL" || strategyHealth.category === "DETERIORATING") triggers.push(`health ${strategyHealth.category}`);
  if (liveValidation.goldenDataset?.truthValidTrades < 30) triggers.push("golden dataset below 30 trades");

  const active = triggers.length > 0;
  return {
    active,
    state: active ? "SURVIVAL_MODE" : "NORMAL_MODE",
    triggers,
    rules: active
      ? ["only A+ setups", "smaller size", "lower frequency", "pause aggressive experiments", "defensive engine always wins"]
      : ["normal defensive gates", "no aggressive auto-risk increase"],
  };
}

export function buildRecoveryDetection(edgeDecay = {}, strategyHealth = {}, liveValidation = {}) {
  const count = num(liveValidation.goldenDataset?.truthValidTrades);
  const edge = liveValidation.liveEdgeValidation || {};
  const regime = liveValidation.marketRegimeDetection?.state || "UNKNOWN";
  const detected = count >= 30
    && edgeDecay.state === "EDGE_STABLE"
    && num(edge.summary?.profitFactor) >= 1.3
    && num(edge.summary?.expectancyPct) > 0
    && !["CHAOTIC", "UNKNOWN", "DEAD"].includes(regime)
    && ["STABLE", "HEALTHY"].includes(strategyHealth.category);
  return {
    state: detected ? "RECOVERY_DETECTED" : "NO_RECOVERY",
    slowRecoveryOnly: true,
    reasons: detected
      ? ["PF stabilized", "positive expectancy", "regime normalized", "health stable"]
      : ["recovery evidence insufficient"],
  };
}

export function buildRegimeSpecificBrain(liveValidation = {}, strategyHealth = {}) {
  const regime = liveValidation.marketRegimeDetection?.state || "UNKNOWN";
  const presets = {
    BULLISH: { walletStrictness: "normal", feeTvlFloor: "normal", blockerStrictness: "normal", convictionBias: "allow only proven A setups", shadowWeight: "normal" },
    RISK_ON: { walletStrictness: "normal+", feeTvlFloor: "normal+", blockerStrictness: "slightly tighter", convictionBias: "selective", shadowWeight: "reduced" },
    CHOPPY: { walletStrictness: "tight", feeTvlFloor: "higher", blockerStrictness: "tighter", convictionBias: "A setups only", shadowWeight: "low" },
    CHAOTIC: { walletStrictness: "very tight", feeTvlFloor: "high", blockerStrictness: "defense-first", convictionBias: "survival", shadowWeight: "paused" },
    DEAD: { walletStrictness: "very tight", feeTvlFloor: "very high", blockerStrictness: "minimal trade", convictionBias: "cash is position", shadowWeight: "paused" },
    UNKNOWN: { walletStrictness: "conservative", feeTvlFloor: "higher", blockerStrictness: "defensive", convictionBias: "truth collection only", shadowWeight: "paused" },
  };
  const preset = presets[regime] || presets.UNKNOWN;
  return {
    regime,
    health: strategyHealth.category || "CRITICAL",
    preset,
    rule: "context adjusts thresholds; defensive engine preserved; no automatic aggressive risk increase",
  };
}

export function buildSelfPreservationState(edgeDecay = {}, strategyHealth = {}, riskCompression = {}, survivalMode = {}, recovery = {}) {
  let state = "NORMAL";
  if (riskCompression.action === "NO_NEW_TRADE") state = "LOCKDOWN";
  else if (survivalMode.active) state = "SURVIVAL";
  else if (strategyHealth.category === "DETERIORATING") state = "DEFENSIVE";
  else if (strategyHealth.category === "WARNING" || edgeDecay.state === "EDGE_WEAKENING") state = "CAUTION";
  if (recovery.state === "RECOVERY_DETECTED" && state === "SURVIVAL") state = "DEFENSIVE";
  return {
    state,
    shouldTradeLess: state !== "NORMAL",
    shouldCompressRisk: riskCompression.multiplier < 1,
    shouldPauseChallenger: ["SURVIVAL", "LOCKDOWN"].includes(state),
    shouldStopExperiments: state === "LOCKDOWN",
    reasons: [
      `edge ${edgeDecay.state}`,
      `health ${strategyHealth.category}`,
      `risk ${riskCompression.action}`,
      survivalMode.active ? "survival mode active" : null,
    ].filter(Boolean),
  };
}

export function buildSelfPreservationPayload(trades = []) {
  const liveValidation = buildLiveValidationPayload(trades);
  const goldenWithTrades = buildGoldenDataset(trades);
  const regime = buildMarketRegimeDetection(goldenWithTrades.trades);
  liveValidation.marketRegimeDetection = regime;
  const edgeDecay = buildEdgeDecayDetection(goldenWithTrades, liveValidation);
  const strategyHealth = buildStrategyHealth(edgeDecay, liveValidation);
  const autoRiskCompression = buildAutoRiskCompression(strategyHealth);
  const survivalMode = buildSurvivalMode(edgeDecay, strategyHealth, liveValidation);
  const recoveryDetection = buildRecoveryDetection(edgeDecay, strategyHealth, liveValidation);
  const regimeSpecificBrain = buildRegimeSpecificBrain(liveValidation, strategyHealth);
  const selfPreservation = buildSelfPreservationState(edgeDecay, strategyHealth, autoRiskCompression, survivalMode, recoveryDetection);
  return {
    edgeDecay,
    strategyHealth,
    autoRiskCompression,
    survivalMode,
    recoveryDetection,
    regimeSpecificBrain,
    selfPreservation,
    liveValidation: {
      goldenDataset: liveValidation.goldenDataset,
      quantConfidence: liveValidation.quantConfidence,
      statisticalHonesty: liveValidation.statisticalHonesty,
    },
  };
}
