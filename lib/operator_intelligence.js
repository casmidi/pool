import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "data");
const PNL_LOG = path.join(DATA_DIR, "pnl_log.json");
const TRADE_REPLAY = path.join(DATA_DIR, "trade_replay.json");
const INCIDENT_REPORT = path.join(DATA_DIR, "incident_report.md");

const REGIMES = {
  TRENDING_UP: "TRENDING_UP",
  TRENDING_DOWN: "TRENDING_DOWN",
  SIDEWAYS: "SIDEWAYS",
  HIGH_VOLATILITY: "HIGH_VOLATILITY",
  LOW_ACTIVITY: "LOW_ACTIVITY",
};

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readJSON(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJSON(filePath, data) {
  ensureDataDir();
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
}

function num(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function round(value, places = 4) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const m = 10 ** places;
  return Math.round(n * m) / m;
}

function getTrades() {
  return readJSON(PNL_LOG, { trades: [] }).trades || [];
}

function getClosedTrades(limit = 50) {
  return getTrades()
    .filter((t) => t.status === "closed" || t.close_time)
    .sort((a, b) => new Date(b.close_time || 0) - new Date(a.close_time || 0))
    .slice(0, limit);
}

function getLatestStreak(closedTrades) {
  let type = null;
  let count = 0;
  for (const trade of closedTrades) {
    const pnl = num(trade.pnl_pct ?? trade.pnl_sol ?? trade.pnl_usd, 0);
    const nextType = pnl < 0 ? "loss" : pnl > 0 ? "win" : "flat";
    if (nextType === "flat") break;
    if (!type) type = nextType;
    if (nextType !== type) break;
    count += 1;
  }
  return { type, count };
}

export function detectMarketRegime(input = {}, cfg = {}) {
  const volatility = num(input.volatility, 0);
  const feeTvl = num(input.feeTvlRatio ?? input.fee_tvl_ratio ?? input.fee_active_tvl_ratio, 0);
  const volume = num(input.volume ?? input.volume_window, null);
  const priceChange = num(input.priceChangePct ?? input.price_change_pct ?? input.price_change_24h_pct, 0);
  const highVol = num(cfg.highVolatilityThreshold, 5);
  const minFee = num(cfg.minFeeTvlForCopy ?? cfg.minFeeActiveTvlRatio, 0.02);
  const minVolume = num(cfg.minVolume, null);

  let regime = REGIMES.SIDEWAYS;
  let deployMultiplier = 1;
  let confidenceBoost = 0;
  let reason = "pool conditions look LP-friendly";

  if (volatility >= highVol) {
    regime = REGIMES.HIGH_VOLATILITY;
    deployMultiplier = 0.5;
    confidenceBoost = 0.08;
    reason = `volatility ${volatility} >= ${highVol}`;
  } else if ((minVolume != null && volume != null && volume < minVolume) || feeTvl < minFee) {
    regime = REGIMES.LOW_ACTIVITY;
    deployMultiplier = 0.7;
    confidenceBoost = 0.05;
    reason = `fee/TVL ${feeTvl} below ${minFee}${volume != null && minVolume != null ? ` or volume ${volume} below ${minVolume}` : ""}`;
  } else if (priceChange >= 12 || volatility >= highVol * 0.75) {
    regime = REGIMES.TRENDING_UP;
    deployMultiplier = 0.75;
    confidenceBoost = 0.05;
    reason = `uptrend/fast market signal, priceChange=${priceChange}, volatility=${volatility}`;
  } else if (priceChange <= -12) {
    regime = REGIMES.TRENDING_DOWN;
    deployMultiplier = 0.65;
    confidenceBoost = 0.08;
    reason = `downtrend signal, priceChange=${priceChange}`;
  }

  return { regime, deployMultiplier, confidenceBoost, reason };
}

export function getCapitalProtectionState(cfg = {}) {
  const closed = getClosedTrades(20);
  const streak = getLatestStreak(closed);
  const lossTrigger = num(cfg.lossTrigger, 3);
  const winRecovery = num(cfg.winRecovery, 3);
  const active = streak.type === "loss" && streak.count >= lossTrigger;
  const recovered = streak.type === "win" && streak.count >= winRecovery;
  return {
    active,
    recovered,
    streak,
    deployMultiplier: active ? num(cfg.deployMultiplier, 0.5) : 1,
    confidenceBoost: active ? num(cfg.confidenceBoost, 0.10) : 0,
    reason: active
      ? `${streak.count} consecutive losing closes`
      : recovered
        ? `${streak.count} consecutive winning closes`
        : "normal",
  };
}

export function calculatePoolTrustScore(poolAddress, trades = getTrades()) {
  const poolTrades = trades
    .filter((t) => poolAddress && t.pool_address === poolAddress && (t.status === "closed" || t.close_time))
    .slice(-20);
  if (!poolTrades.length) {
    return { score: 50, samples: 0, reason: "no pool history" };
  }
  const avgPnl = poolTrades.reduce((sum, t) => sum + num(t.pnl_pct, 0), 0) / poolTrades.length;
  const wins = poolTrades.filter((t) => num(t.pnl_pct, 0) > 0).length;
  const winRate = wins / poolTrades.length;
  const oorRate = poolTrades.filter((t) => num(t.minutes_out_of_range, 0) > 0 || /out.of.range|oor/i.test(String(t.close_reason || ""))).length / poolTrades.length;
  const rugPenalty = poolTrades.some((t) => /rug|wash|dev sold|scam/i.test(String(t.close_reason || ""))) ? 25 : 0;
  const feeValues = poolTrades.map((t) => num(t.fee_tvl_ratio)).filter((v) => v != null);
  const avgFee = feeValues.length ? feeValues.reduce((s, v) => s + v, 0) / feeValues.length : 0;
  const redeployPenalty = poolTrades.length >= 3 && winRate < 0.34 ? 12 : 0;
  const raw = 50 + winRate * 25 + Math.max(-20, Math.min(20, avgPnl)) + Math.min(10, avgFee * 200) - oorRate * 20 - rugPenalty - redeployPenalty;
  const caps = [];
  let score = Math.max(0, Math.min(100, Math.round(raw)));
  if (poolTrades.length < 3) {
    score = Math.min(score, 50);
    caps.push(`sparse samples ${poolTrades.length}<3`);
  }
  if (oorRate >= 0.8) {
    score = Math.min(score, 40);
    caps.push("critical OOR history");
  } else if (oorRate >= 0.5) {
    score = Math.min(score, 45);
    caps.push("high OOR history");
  }
  if (poolTrades.length < 3 && avgPnl <= 1) {
    score = Math.min(score, 45);
    caps.push("low edge with sparse history");
  }
  return {
    score,
    samples: poolTrades.length,
    winRate: round(winRate * 100, 1),
    avgPnlPct: round(avgPnl, 2),
    oorRate: round(oorRate * 100, 1),
    reason: `winRate=${round(winRate * 100, 1)}%, avgPnl=${round(avgPnl, 2)}%, oor=${round(oorRate * 100, 1)}%${caps.length ? `, capped: ${caps.join("; ")}` : ""}`,
  };
}

export function getAdaptiveConfidenceCalibration(cfg = {}) {
  const closed = getClosedTrades(80).filter((t) => num(t.decision_confidence) != null);
  const minSamples = num(cfg.minSamples, 10);
  if (closed.length < minSamples) {
    return { enabled: false, organicWeight: 0.15, samples: closed.length, reason: "not enough closed samples" };
  }
  const winners = closed.filter((t) => num(t.pnl_pct, 0) > 0);
  const losers = closed.filter((t) => num(t.pnl_pct, 0) <= 0);
  const avgOrganic = (items) => {
    const values = items.map((t) => num(t.organic_score)).filter((v) => v != null);
    return values.length ? values.reduce((s, v) => s + v, 0) / values.length : null;
  };
  const winOrganic = avgOrganic(winners);
  const loseOrganic = avgOrganic(losers);
  if (winOrganic == null || loseOrganic == null) {
    return { enabled: false, organicWeight: 0.15, samples: closed.length, reason: "organic history incomplete" };
  }
  const lift = winOrganic - loseOrganic;
  const organicWeight = Math.max(0.12, Math.min(0.20, 0.15 + lift / 500));
  return {
    enabled: true,
    organicWeight: round(organicWeight, 4),
    samples: closed.length,
    lift: round(lift, 2),
    reason: `winner organic lift ${round(lift, 2)} pts`,
  };
}

export function buildShadowDecision(decision, cfg = {}) {
  const minConfidence = num(cfg.minConfidence, 0.55);
  const shadowThreshold = Math.min(0.95, minConfidence + num(cfg.shadowConfidenceAdd, 0.08));
  const hardRisks = new Set(["low_organic", "high_volatility", "poor_range_quality", "low_wallet_score"]);
  const risks = Array.isArray(decision?.risks) ? decision.risks : [];
  const hasHardRisk = risks.some((risk) => hardRisks.has(String(risk)));
  const shadowAction = decision?.action === "COPY" && !hasHardRisk && num(decision?.confidence, 0) >= shadowThreshold
    ? "COPY"
    : "HOLD";
  return {
    engine: "conservative_shadow_v1",
    action: shadowAction,
    threshold: round(shadowThreshold, 4),
    wouldDiffer: shadowAction !== decision?.action,
    reasons: hasHardRisk
      ? ["hard risk present"]
      : [`requires confidence >= ${round(shadowThreshold, 2)}`],
  };
}

export function appendTradeReplayEvent(trade, event) {
  if (!trade) return null;
  const store = readJSON(TRADE_REPLAY, { version: 1, trades: [] });
  const key = trade.position_address || trade.id || trade.pool_address;
  let replay = store.trades.find((x) => x.key === key);
  if (!replay) {
    replay = {
      key,
      poolAddress: trade.pool_address || null,
      poolName: trade.pool_name || null,
      confidence: trade.decision_confidence ?? null,
      organic: trade.organic_score ?? null,
      breakdown: trade.decision_breakdown ?? null,
      timeline: [],
      result: null,
    };
    store.trades.push(replay);
  }
  replay.timeline.push({ ts: new Date().toISOString(), ...event });
  if (event.type === "close") {
    replay.result = {
      pnlPct: trade.pnl_pct ?? null,
      pnlUsd: trade.pnl_usd ?? null,
      feesUsd: trade.fees_usd ?? null,
      reason: trade.close_reason ?? null,
    };
  }
  store.trades = store.trades.slice(-500);
  writeJSON(TRADE_REPLAY, store);
  return replay;
}

export function generateIncidentReport(trade) {
  if (!trade || num(trade.pnl_pct, 0) >= 0) return null;
  ensureDataDir();
  const entryTruth = trade.entry_truth || {};
  const decision = entryTruth.decision || {};
  const deployArgs = entryTruth.deployArgs || {};
  const antiOor = deployArgs.anti_oor_intelligence || trade.anti_oor_intelligence || {};
  const oorPrediction = antiOor.oorPrediction || {};
  const timingDelay = antiOor.entryTimingDelay || {};
  const dynamicRange = antiOor.dynamicRangeWidth || {};
  const poolTrust = decision.poolTrust || deployArgs.pool_trust || {};
  const capitalProtection = decision.capitalProtection || deployArgs.capital_protection || {};
  const shadowDecision = decision.shadow || trade.shadow_decision || decision.decision_result?.shadow || null;
  const entryTime = trade.deploy_time || trade.open_time || entryTruth.createdAt || null;
  const closeTime = trade.close_time || null;
  const minutesHeld = num(trade.minutes_held, null);
  const inRangeAtClose = (
    num(trade.exit_bin ?? trade.active_bin, null) !== null &&
    num(trade.lower_bin, null) !== null &&
    num(trade.upper_bin, null) !== null
  )
    ? Number(trade.exit_bin ?? trade.active_bin) >= Number(trade.lower_bin) &&
      Number(trade.exit_bin ?? trade.active_bin) <= Number(trade.upper_bin)
    : null;
  const antiOorRisk = oorPrediction.oorRisk || null;
  const antiOorAction = antiOor.finalRecommendation || oorPrediction.action || timingDelay.action || null;
  const antiOorReasons = Array.isArray(oorPrediction.reasons) ? oorPrediction.reasons : [];
  const redFlags = [
    antiOorRisk && ["HIGH", "CRITICAL"].includes(String(antiOorRisk).toUpperCase())
      ? `Anti-OOR predicted ${antiOorRisk} (${antiOorAction || "no action"}) before/at entry.`
      : null,
    poolTrust.samples != null && Number(poolTrust.samples) < 3
      ? `Pool trust used sparse history (${poolTrust.samples} sample).`
      : null,
    poolTrust.oorRate != null && Number(poolTrust.oorRate) >= 50
      ? `Pool trust OOR rate was high (${poolTrust.oorRate}%).`
      : null,
    capitalProtection.active
      ? `Capital protection was active: ${capitalProtection.reason || "loss streak"}.`
      : null,
    inRangeAtClose === true && /stop-loss/i.test(String(trade.close_reason || ""))
      ? "Position was still inside configured range at close; loss came from PnL stop-loss, not OOR wait."
      : null,
  ].filter(Boolean);
  const primaryFinding = antiOorRisk && ["HIGH", "CRITICAL"].includes(String(antiOorRisk).toUpperCase())
    ? "Anti-OOR warning should have prevented this deploy. Treat as pre-entry guard failure or legacy trade before hard-block."
    : inRangeAtClose === true
      ? "Stop-loss fired while position was still in range. Inspect momentum/timing and PnL mark, not only OOR close logic."
      : "Loss needs manual review; incident report did not find a single dominant guard failure.";
  const lines = [
    "# Meridian Incident Report",
    "",
    `Generated: ${new Date().toISOString()}`,
    `Trace ID: ${trade.forensic_trace_id || "unknown"}`,
    `Pool: ${trade.pool_name || trade.pool_address || "unknown"}`,
    `Pool Address: ${trade.pool_address || "unknown"}`,
    `Position: ${trade.position_address || "unknown"}`,
    `Mode: ${trade.is_dry_run ? "DRY RUN" : "LIVE/UNKNOWN"}`,
    `Strategy: ${trade.strategy || "unknown"}`,
    `Entry Time: ${entryTime || "unknown"}`,
    `Close Time: ${closeTime || "unknown"}`,
    `Minutes Held: ${minutesHeld != null ? minutesHeld : "unknown"}`,
    `Amount: ${trade.amount_sol ?? "unknown"} SOL`,
    `Confidence: ${trade.decision_confidence != null ? `${Math.round(Number(trade.decision_confidence) * 100)}%` : "unknown"}`,
    `Organic: ${trade.organic_score ?? "unknown"}`,
    `PnL: ${trade.pnl_pct ?? "unknown"}%`,
    `PnL SOL: ${trade.pnl_sol ?? "unknown"}`,
    `PnL USD: ${trade.pnl_usd ?? "unknown"}`,
    `Fees: ${trade.fees_usd ?? "unknown"} USD`,
    `OOR minutes: ${trade.minutes_out_of_range ?? 0}`,
    `Close reason: ${trade.close_reason || "unknown"}`,
    "",
    "## Primary Finding",
    "",
    primaryFinding,
    "",
    "## Entry / Exit Geometry",
    "",
    `- Entry bin: ${trade.entry_bin ?? deployArgs.active_bin ?? "unknown"}`,
    `- Exit/active bin at close: ${trade.exit_bin ?? trade.active_bin ?? "unknown"}`,
    `- Range: ${trade.lower_bin ?? deployArgs.lower_bin ?? "unknown"} -> ${trade.upper_bin ?? deployArgs.upper_bin ?? "unknown"}`,
    `- Bins below/above: ${trade.bins_below ?? deployArgs.bins_below ?? "unknown"} / ${trade.bins_above ?? deployArgs.bins_above ?? "unknown"}`,
    `- In range at close: ${inRangeAtClose === null ? "unknown" : inRangeAtClose ? "yes" : "no"}`,
    `- Entry price: ${trade.entry_price ?? "unknown"}`,
    "",
    "## Anti-OOR Snapshot",
    "",
    `- Risk: ${antiOorRisk || "unknown"}`,
    `- Recommendation: ${antiOorAction || "unknown"}`,
    `- Timing action: ${timingDelay.action || "unknown"}`,
    `- Wait minutes: ${timingDelay.waitMinutes ?? "unknown"}`,
    `- Range recommendation: ${dynamicRange.recommendation || "unknown"}`,
    `- Directional bias: ${dynamicRange.directionalBias || "unknown"}`,
    ...(antiOorReasons.length ? ["- Reasons:", ...antiOorReasons.slice(0, 8).map((r) => `  - ${r}`)] : ["- Reasons: none recorded"]),
    "",
    "## Risk Context",
    "",
    `- Pool trust score: ${poolTrust.score ?? "unknown"}`,
    `- Pool trust samples: ${poolTrust.samples ?? "unknown"}`,
    `- Pool trust win rate: ${poolTrust.winRate ?? "unknown"}%`,
    `- Pool trust OOR rate: ${poolTrust.oorRate ?? "unknown"}%`,
    `- Capital protection: ${capitalProtection.active ? `active (${capitalProtection.reason || "unknown"})` : "inactive/unknown"}`,
    `- Shadow v1 decision: ${shadowDecision ? `${shadowDecision.action || "unknown"} (threshold ${shadowDecision.threshold ?? "unknown"}, differs=${shadowDecision.wouldDiffer ?? "unknown"})` : "unknown"}`,
    "",
    "## Red Flags",
    "",
    ...(redFlags.length ? redFlags.map((r) => `- ${r}`) : ["- No explicit red flag captured by the incident generator."]),
    "",
    "## Confidence Breakdown",
    "```json",
    JSON.stringify(trade.decision_breakdown || {}, null, 2),
    "```",
    "",
    "## Root Cause Hints",
    `- ${num(trade.minutes_out_of_range, 0) > 0 ? "Out-of-range behavior contributed to the loss." : "No recorded OOR minutes; inspect price movement, momentum, and stop-loss mark."}`,
    `- ${num(trade.organic_score, 100) < 70 ? "Organic quality was below recommended floor." : "Organic score passed the configured floor."}`,
    `- ${num(trade.fee_tvl_ratio, 0) < 0.02 ? "Fee/TVL was weak relative to target." : "Fee/TVL was acceptable at entry."}`,
    `- ${antiOorRisk ? `Anti-OOR risk was ${antiOorRisk}.` : "Anti-OOR risk snapshot missing from this trade."}`,
    "",
    "## Recommendations",
    "- Keep Anti-OOR HIGH/CRITICAL as hard pre-entry block.",
    "- Do not let sparse pool trust samples boost confidence above neutral.",
    "- If stop-loss fires while in range, review momentum timing and PnL mark quality.",
    "- Avoid immediate redeploy if pool trust score is deteriorating or OOR history is high.",
    "- Compare this trade against future Shadow v2 exit-route and cluster-risk evidence.",
    "",
  ];
  fs.writeFileSync(INCIDENT_REPORT, lines.join("\n"), "utf8");
  return INCIDENT_REPORT;
}

export function buildOperatorIntelligenceSnapshot(cfg = {}) {
  const trades = getTrades();
  const closed = getClosedTrades(30);
  const recent = closed.slice(0, 10);
  const losses = recent.filter((t) => num(t.pnl_pct, 0) < 0).length;
  const wins = recent.filter((t) => num(t.pnl_pct, 0) > 0).length;
  const oor = recent.filter((t) => num(t.minutes_out_of_range, 0) > 0 || /out.of.range|oor/i.test(String(t.close_reason || ""))).length;
  const highConfidenceLosses = recent.filter((t) => num(t.decision_confidence, 0) >= 0.75 && num(t.pnl_pct, 0) < 0).length;
  const avgPnl = recent.length ? recent.reduce((s, t) => s + num(t.pnl_pct, 0), 0) / recent.length : 0;
  const winRate = recent.length ? wins / recent.length : 0.5;
  const oorRate = recent.length ? oor / recent.length : 0;
  const protection = getCapitalProtectionState(cfg.capitalProtection || {});
  const calibration = getAdaptiveConfidenceCalibration(cfg.adaptiveConfidence || {});
  const healthRaw = 55 + winRate * 25 + Math.max(-15, Math.min(15, avgPnl)) - oorRate * 15 - highConfidenceLosses * 5 - (protection.active ? 12 : 0);
  const healthScore = Math.max(0, Math.min(100, Math.round(healthRaw)));
  const alerts = [];
  if (highConfidenceLosses >= 2) alerts.push({ type: "confidence_drift", severity: "warn", message: "High confidence losing; inspect confidence calibration." });
  if (oor >= 5) alerts.push({ type: "oor_storm", severity: "danger", message: `${oor} recent trades had OOR behavior.` });
  if (protection.active) alerts.push({ type: "capital_warning", severity: "danger", message: `Capital protection active: ${protection.reason}.` });
  if (recent.length >= 5 && losses / recent.length >= 0.6) alerts.push({ type: "daily_loss_pressure", severity: "warn", message: "Recent loss pressure elevated." });
  return {
    health: {
      score: healthScore,
      label: healthScore >= 80 ? "GOOD" : healthScore >= 60 ? "WATCH" : "RISK",
      winRate: round(winRate * 100, 1),
      avgPnlPct: round(avgPnl, 2),
      oorRate: round(oorRate * 100, 1),
      highConfidenceLosses,
    },
    alerts,
    protection,
    calibration,
    replayPath: TRADE_REPLAY,
    incidentReportPath: INCIDENT_REPORT,
    totalTrades: trades.length,
  };
}

export { REGIMES };
