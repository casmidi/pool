import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { enrichRoiPriority } from "./roi_priority.js";
import { enrichOffensiveEdge } from "./offensive_edge.js";
import { enrichExecutionIntelligence } from "./execution_intelligence.js";
import {
  applyMemoryAwareConviction,
  buildExperienceMemory,
  classifyBlockStrictness,
  createSignalSignature,
  signatureKey,
} from "./experience_intelligence.js";
import { buildDefensiveTruthLayer } from "./defensive_truth.js";
import { buildShadowExperimentLayer } from "./shadow_execution.js";
import { buildWalletTruthLayer } from "./wallet_truth.js";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PNL_LOG = path.join(ROOT, "data", "pnl_log.json");

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function round(value, digits = 2) {
  const m = 10 ** digits;
  return Math.round(num(value) * m) / m;
}

function readJSON(filePath, fallback = {}) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function withinDays(trade, days) {
  if (!days || days <= 0) return true;
  const ts = new Date(trade.close_time || trade.deploy_time || 0).getTime();
  if (!Number.isFinite(ts)) return false;
  return Date.now() - ts <= days * 24 * 60 * 60 * 1000;
}

function tradeToPool(trade = {}) {
  const entry = trade.entry_truth || trade.decision_snapshot?.entryTruth || {};
  const wallet = entry.source?.wallet || {};
  const raw = entry.raw || {};
  return {
    name: trade.pool_name || trade.pool || trade.pool_address || "unknown",
    pool: trade.pool_address || null,
    walletScore: wallet.score ?? trade.source_wallet_score ?? trade.walletScore ?? trade.decision_breakdown?.raw?.walletScore ?? trade.decision_breakdown?.raw?.wallet,
    feeTvlRatio: raw.feeTvlRatio ?? trade.fee_tvl_ratio ?? trade.feeTvlRatio ?? trade.decision_breakdown?.raw?.feeTvl,
    organicScore: raw.organicScore ?? trade.organic_score ?? trade.organicScore ?? trade.decision_breakdown?.raw?.organicScore,
    confidence: raw.confidence ?? trade.decision_confidence ?? trade.confidence ?? trade.decision_breakdown?.total,
    volatility: raw.volatility ?? trade.volatility ?? trade.decision_breakdown?.raw?.volatility,
    alphaEdge: raw.alpha ?? trade.alpha_edge ?? trade.alphaEdge ?? null,
    risks: Array.isArray(trade.risks) ? trade.risks : [],
    reasons: Array.isArray(trade.reasons) ? trade.reasons : [],
    deployArgs: {
      wallet_score: wallet.score ?? trade.source_wallet_score ?? null,
      source_wallet: wallet.address ?? trade.source_wallet ?? null,
      source_signal_id: entry.source?.signalId ?? trade.source_signal_id ?? null,
      fee_tvl_ratio: raw.feeTvlRatio ?? trade.fee_tvl_ratio ?? null,
      organic_score: raw.organicScore ?? trade.organic_score ?? null,
      decision_breakdown: entry.decision?.breakdown ?? trade.decision_breakdown ?? null,
      alpha_edge: raw.alpha ?? trade.alpha_edge ?? null,
    },
  };
}

function simulateDecision(pool) {
  const roi = enrichRoiPriority(pool);
  const offensive = enrichOffensiveEdge(pool, roi);
  const execution = enrichExecutionIntelligence(pool, roi, offensive);
  const executable = execution.positionSize.suggestedPct > 0 && roi.status.label !== "BLOCKED";
  return { roi, offensive, execution, executable };
}

function maxDrawdown(values = []) {
  let equity = 0;
  let peak = 0;
  let maxDd = 0;
  for (const v of values) {
    equity += num(v);
    peak = Math.max(peak, equity);
    maxDd = Math.min(maxDd, equity - peak);
  }
  return round(maxDd);
}

function sharpeLike(values = []) {
  if (values.length < 2) return 0;
  const avg = values.reduce((s, v) => s + v, 0) / values.length;
  const variance = values.reduce((s, v) => s + (v - avg) ** 2, 0) / (values.length - 1);
  const sd = Math.sqrt(variance);
  return sd > 0 ? round(avg / sd, 3) : 0;
}

function summarizeTrades(items = []) {
  const pnl = items.map((t) => num(t.pnlPct));
  const wins = pnl.filter((v) => v > 0);
  const losses = pnl.filter((v) => v <= 0);
  const grossWin = wins.reduce((s, v) => s + v, 0);
  const grossLoss = Math.abs(losses.reduce((s, v) => s + v, 0));
  return {
    trades: items.length,
    wins: wins.length,
    losses: losses.length,
    winRate: items.length ? round((wins.length / items.length) * 100, 1) : 0,
    avgPnlPct: items.length ? round(pnl.reduce((s, v) => s + v, 0) / items.length) : 0,
    totalPnlPct: round(pnl.reduce((s, v) => s + v, 0)),
    maxDrawdownPct: maxDrawdown(pnl),
    profitFactor: grossLoss > 0 ? round(grossWin / grossLoss, 2) : (grossWin > 0 ? 99 : 0),
    sharpeLike: sharpeLike(pnl),
  };
}

function bucketContribution(rows, keyFn, label) {
  const groups = new Map();
  for (const row of rows) {
    const key = keyFn(row) || "UNKNOWN";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return [...groups.entries()].map(([bucket, items]) => ({
    feature: label,
    bucket,
    ...summarizeTrades(items),
    })).sort((a, b) => b.avgPnlPct - a.avgPnlPct);
}

function scoreBucket(value, strongLabel, neutralLabel, weakLabel) {
  const score = num(value, null);
  if (score === null) return "UNKNOWN";
  if (score >= 11) return strongLabel;
  if (score >= 7) return neutralLabel;
  return weakLabel;
}

function oorBucket(minutes) {
  const value = num(minutes, null);
  if (value === null) return "UNKNOWN";
  if (value <= 0) return "NO OOR";
  if (value <= 10) return "LOW OOR";
  if (value <= 30) return "MEDIUM OOR";
  return "HIGH OOR";
}

function featureContribution(rows = []) {
  return [
    ...bucketContribution(rows, (r) => r.roi.wallet.classification.label, "wallet"),
    ...bucketContribution(rows, (r) => r.roi.feeTvl.classification.label, "feeTvl"),
    ...bucketContribution(rows, (r) => r.roi.organicTrend.state, "organicTrend"),
    ...bucketContribution(rows, (r) => r.offensive.entryTiming.state, "timing"),
    ...bucketContribution(rows, (r) => r.roi.alpha.state, "alpha"),
    ...bucketContribution(rows, (r) => scoreBucket(r.roi.confidence.parts?.survival, "HIGH SURVIVAL", "MID SURVIVAL", "LOW SURVIVAL"), "survival"),
    ...bucketContribution(rows, (r) => scoreBucket(r.roi.confidence.parts?.antiCrowd, "LOW CROWDING", "MID CROWDING", "HIGH CROWDING"), "crowding"),
    ...bucketContribution(rows, (r) => oorBucket(r.minutesOutOfRange), "oor"),
    ...bucketContribution(rows, (r) => r.offensive.edgeScore.tier.label, "edgeTier"),
    ...bucketContribution(rows, (r) => r.execution.conviction.state, "conviction"),
    ...bucketContribution(rows, (r) => r.execution.executionState.state, "execution"),
  ];
}

function falsePositiveAnalytics(rows = []) {
  const failedPassed = rows.filter((r) => r.executable && r.pnlPct <= 0);
  const patterns = new Map();
  for (const row of failedPassed) {
    const parts = [
      `wallet:${row.roi.wallet.classification.label}`,
      `fee:${row.roi.feeTvl.classification.label}`,
      `organic:${row.roi.organicTrend.state}`,
      `edge:${row.offensive.edgeScore.tier.label}`,
      `conviction:${row.execution.conviction.state}`,
    ];
    const key = parts.join(" | ");
    patterns.set(key, (patterns.get(key) || 0) + 1);
  }
  return {
    failedPassed: failedPassed.length,
    mostCommonPatterns: [...patterns.entries()]
      .map(([pattern, count]) => ({ pattern, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5),
  };
}

function blockedOpportunityAnalytics(rows = []) {
  const blocked = rows.filter((r) => !r.executable);
  const blockedWinners = blocked.filter((r) => r.pnlPct > 0);
  const blockedLosers = blocked.filter((r) => r.pnlPct <= 0);
  return {
    blockedTrades: blocked.length,
    blockedWinners: blockedWinners.length,
    avoidedLosses: blockedLosers.length,
    avoidedLossRate: blocked.length ? round((blockedLosers.length / blocked.length) * 100, 1) : 0,
    blockedWinnerPnlPct: round(blockedWinners.reduce((s, r) => s + r.pnlPct, 0)),
    avoidedLossPnlPct: round(blockedLosers.reduce((s, r) => s + r.pnlPct, 0)),
    topBlockedWinners: blockedWinners
      .sort((a, b) => b.pnlPct - a.pnlPct)
      .slice(0, 5)
      .map((r) => ({
        id: r.id,
        pool: r.pool,
        pnlPct: r.pnlPct,
        status: r.roi.status.label,
        edge: r.offensive.edgeScore.score,
        reason: r.roi.explainability?.blocked?.slice(0, 3) || [],
      })),
  };
}

export function runBacktest({ days = 30, mode = "all" } = {}) {
  const data = readJSON(PNL_LOG, { trades: [] });
  const closed = (data.trades || [])
    .filter((t) => t.status === "closed" || t.close_time)
    .filter((t) => mode === "all" ? true : mode === "dry" ? t.is_dry_run !== false : t.is_dry_run === false)
    .filter((t) => withinDays(t, days))
    .filter((t) => Number.isFinite(Number(t.pnl_pct)));

  const rows = closed.map((trade) => {
    const pool = tradeToPool(trade);
    const decision = simulateDecision(pool);
    const signature = createSignalSignature({ ...pool, minutesOutOfRange: trade.minutes_out_of_range }, decision.roi, decision.offensive, decision.execution);
    return {
      id: trade.id,
      pool: trade.pool_name || trade.pool_address || "unknown",
      ts: trade.close_time || trade.deploy_time || null,
      pnlPct: num(trade.pnl_pct),
      actualAmountSol: trade.amount_sol ?? null,
      minutesOutOfRange: num(trade.minutes_out_of_range, null),
      sourcePool: {
        ...pool,
        source_wallet: trade.source_wallet ?? trade.wallet ?? null,
        source_wallet_score: trade.source_wallet_score ?? null,
        source_wallet_rank: trade.source_wallet_rank ?? null,
        source_wallet_grade: trade.source_wallet_grade ?? null,
        minutesOutOfRange: trade.minutes_out_of_range,
      },
      memory: {
        signature,
        signatureKey: signatureKey(signature),
        blockStrictness: classifyBlockStrictness(pool, decision.roi),
      },
      ...decision,
    };
  });

  const experienceMemory = buildExperienceMemory(rows);
  const defensiveTruth = buildDefensiveTruthLayer(rows, experienceMemory);
  Object.assign(experienceMemory, defensiveTruth);
  for (const row of rows) {
    row.execution = applyMemoryAwareConviction(
      row.sourcePool,
      row.roi,
      row.offensive,
      row.execution,
      experienceMemory
    );
    row.memory = row.execution.memory;
  }
  const shadowExperiment = buildShadowExperimentLayer(rows, experienceMemory);
  const walletTruth = buildWalletTruthLayer(rows);
  Object.assign(experienceMemory, { shadowExperiment, walletTruth });

  const simulated = rows.filter((r) => r.executable);
  const blocked = rows.filter((r) => !r.executable);
  return {
    ok: true,
    config: { days, mode },
    sample: {
      totalClosed: rows.length,
      simulatedTrades: simulated.length,
      blockedByEngine: blocked.length,
      coveragePct: rows.length ? round((simulated.length / rows.length) * 100, 1) : 0,
    },
    baseline: summarizeTrades(rows),
    simulated: summarizeTrades(simulated),
    blocked: summarizeTrades(blocked),
    featureContribution: featureContribution(simulated).slice(0, 60),
    falsePositiveAnalytics: falsePositiveAnalytics(rows),
    blockedOpportunityAnalytics: blockedOpportunityAnalytics(rows),
    experienceMemory,
    shadowExperiment,
    walletTruth,
    trades: rows.slice(-50).reverse().map((r) => ({
      id: r.id,
      pool: r.pool,
      ts: r.ts,
      pnlPct: r.pnlPct,
      minutesOutOfRange: r.minutesOutOfRange,
      status: r.roi.status.label,
      edge: r.offensive.edgeScore.score,
      conviction: r.execution.conviction.state,
      memory: r.execution.memory || null,
      sizePct: r.execution.positionSize.suggestedPct,
      executable: r.executable,
    })),
    ts: new Date().toISOString(),
  };
}
