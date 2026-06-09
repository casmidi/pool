import "dotenv/config";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { config } from "../config.js";
import { log } from "../logger.js";
import { getWalletPositions } from "../tools/dlmm.js";
import { getPoolDetail } from "../tools/screening.js";
import { getLatestSnapshot, tagWallet } from "../ranking/ranking-db.js";
import { runRankingCycle } from "../ranking/top-performers.js";
import { analyzePositionForCopy } from "../decision/analysis-engine.js";
import { buildMasterObservation, recordMasterObservation } from "../strategies/master-strategy-db.js";
import { buildShadowDecision, getAdaptiveConfidenceCalibration } from "../lib/operator_intelligence.js";
import { evaluateAlphaEdge, recordMissedOpportunity } from "../lib/alpha_edge.js";
import { recordForensicRejection } from "../lib/forensic_scanner.js";
import { getConsecutiveLosses } from "../lib/pnl_tracker.js";
import { recordShadowCandidate, updateShadowFromMarket } from "../shadow/shadow_engine.js";
import { observeShadowV2Candidate } from "../shadow/shadow_v2_engine.js";
import { observeShadowV3WalletRescue, updateShadowV3WalletRescueFromMarket } from "../shadow/shadow_v3_wallet_rescue.js";
import { executeTool } from "../tools/executor.js";
import {
  getRecentCopySignals,
  hasRecentCopySignal,
  findRecentCopySignal,
  recordCopySignal,
  recordIgnoredCopySignal,
  updateCopySignalDeployResult,
  touchCopyRun,
  volatilityBasedTtl,
  findDedupeEntriesByPool,
} from "./copy-state.js";

function normalizeNumber(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function readOrganicScore(detail, position = {}) {
  const candidates = [
    ["detail.organic_score", detail?.organic_score],
    ["detail.organicScore", detail?.organicScore],
    ["detail.token_x.organic_score", detail?.token_x?.organic_score],
    ["detail.base.organic", detail?.base?.organic],
    ["detail.base.organic_score", detail?.base?.organic_score],
    ["detail.metrics.organic_score", detail?.metrics?.organic_score],
    ["position.organicScore", position?.organicScore],
    ["position.organic_score", position?.organic_score],
    ["position.token_x.organic_score", position?.token_x?.organic_score],
    ["position.base.organic", position?.base?.organic],
  ];
  for (const [source, value] of candidates) {
    const normalized = normalizeNumber(value);
    if (normalized != null) {
      return {
        value: Math.max(0, Math.min(100, normalized)),
        source,
      };
    }
  }
  return { value: null, source: null };
}

function summarizeRiskCounts(rows = []) {
  const counts = {};
  for (const row of rows) {
    const risks = Array.isArray(row?.risks) && row.risks.length ? row.risks : ["none"];
    for (const risk of risks) counts[risk] = (counts[risk] || 0) + 1;
  }
  return Object.fromEntries(
    Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  );
}

function snapshotAgeMs(snapshot) {
  const ts = new Date(snapshot?.ts || 0).getTime();
  return Number.isFinite(ts) ? Date.now() - ts : Infinity;
}

function snapshotFresh(snapshot, maxAgeMs) {
  return snapshotAgeMs(snapshot) <= maxAgeMs;
}

async function getTopWalletEntries({ count, mode, forceRanking = false }) {
  const maxAgeMs = Number(config.copyTrading?.rankingMaxAgeMinutes ?? 360) * 60_000;
  const hardMaxAgeMs = Number(config.copyTrading?.rankingHardMaxAgeMinutes ?? 1440) * 60_000;
  let snapshot = !forceRanking ? getLatestSnapshot() : null;
  const refreshWhenStale = config.copyTrading?.refreshRankingWhenStale !== false;

  if (!snapshotFresh(snapshot, maxAgeMs) && (forceRanking || refreshWhenStale)) {
    const reason = snapshot
      ? `ranking snapshot stale (${Math.round(snapshotAgeMs(snapshot) / 60_000)}m old)`
      : "ranking snapshot missing";
    log("copy_engine", `${reason}; refreshing ranking before copy scan`);
    const ranking = await runRankingCycle({ count: Math.max(count, config.ranking?.topN || 10), mode });
    snapshot = ranking?.snapshot || getLatestSnapshot();
  }

  if (!snapshotFresh(snapshot, hardMaxAgeMs)) {
    const reason = snapshot
      ? `ranking snapshot beyond hard max age (${Math.round(snapshotAgeMs(snapshot) / 60_000)}m old)`
      : "ranking snapshot unavailable after refresh";
    return { entries: [], diagnostics: { reason } };
  }

  const entries = (snapshot?.entries || [])
    .filter((entry) => entry?.address)
    .slice()
    .sort((a, b) => Number(a.rank || 9999) - Number(b.rank || 9999))
    .slice(0, count);
  return { entries, diagnostics: { snapshotTs: snapshot.ts, snapshotCount: snapshot.count ?? entries.length } };
}

async function enrichPosition(position) {
  const poolAddress = position.pool || position.pool_address;
  if (!poolAddress) return position;

  let detail = null;
  try {
    detail = await getPoolDetail({ pool_address: poolAddress });
  } catch (err) {
    log("copy_engine", `Pool detail unavailable for ${poolAddress.slice(0, 8)}: ${err.message}`);
  }

  // Jupiter asset enrichment: pool discovery API tidak menyediakan organic_score,
  // tapi Jupiter asset API punya. Fetch untuk organic score yang valid.
  if (detail) {
    const baseMint = detail?.token_x?.address || detail?.base?.mint || detail?.base_mint;
    if (baseMint && !detail?.token_x?.organic_score) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 5000);
        const res = await fetch(`https://datapi.jup.ag/v1/assets/search?query=${encodeURIComponent(baseMint)}`, { signal: controller.signal });
        clearTimeout(timer);
        if (res.ok) {
          const data = await res.json();
          const list = Array.isArray(data) ? data : [data];
          const match = list.find((x) => x?.id === baseMint) || list[0];
          if (match?.organicScore != null) {
            detail.token_x ??= {};
            detail.token_x.organic_score = Math.round(Math.max(0, Math.min(100, Number(match.organicScore))));
          }
        }
      } catch { /* Jupiter enrichment optional — fallback ke pool detail */ }
    }
  }

  const organic = readOrganicScore(detail, position);

  return {
    ...position,
    poolAddress,
    poolName: detail?.name || detail?.pool_name || position.pool_name || null,
    active_bin: normalizeNumber(
      detail?.active_bin ??
      detail?.activeBin ??
      detail?.current_bin ??
      detail?.currentBin ??
      detail?.dlmm_params?.active_bin,
      normalizeNumber(position.active_bin ?? position.activeBin, null)
    ),
    lower_bin: normalizeNumber(
      detail?.lower_bin ??
      detail?.lowerBin ??
      detail?.bin_range?.min,
      normalizeNumber(position.lower_bin ?? position.lowerBin, null)
    ),
    upper_bin: normalizeNumber(
      detail?.upper_bin ??
      detail?.upperBin ??
      detail?.bin_range?.max,
      normalizeNumber(position.upper_bin ?? position.upperBin, null)
    ),
    current_price: normalizeNumber(
      detail?.price ??
      detail?.current_price ??
      detail?.token_price ??
      detail?.metrics?.price,
      normalizeNumber(position.current_price ?? position.price, null)
    ),
    feeTvlRatio: normalizeNumber(
      detail?.fee_tvl_ratio ??
      detail?.fee_active_tvl_ratio ??
      detail?.metrics?.fee_tvl_ratio,
      normalizeNumber(position.fee_tvl_ratio, 0)
    ),
    volatility: normalizeNumber(
      detail?.volatility ??
      detail?.metrics?.volatility ??
      position.volatility,
      0
    ),
    binStep: detail?.bin_step ?? detail?.dlmm_params?.bin_step ?? position.bin_step ?? null,
    organicScore: organic.value,
    organicSource: organic.source,
  };
}

function buildDeployArgs({ position, walletEntry, amountSol, signalId = null }) {
  const activeBin = normalizeNumber(position.active_bin ?? position.activeBin);
  const lowerBin = normalizeNumber(position.lower_bin ?? position.lowerBin);
  const upperBin = normalizeNumber(position.upper_bin ?? position.upperBin);
  const binsBelow = activeBin != null && lowerBin != null
    ? Math.max(0, activeBin - lowerBin)
    : null;
  const binsAbove = activeBin != null && upperBin != null
    ? Math.max(0, upperBin - activeBin)
    : 0;

  return {
    pool_address: position.poolAddress || position.pool || position.pool_address,
    pool_name: position.poolName || null,
    amount_y: amountSol,
    amount_sol: amountSol,
    amount_x: 0,
    bins_below: binsBelow,
    bins_above: 0, // copy engine always deploys single-side SOL → no upside bins
    active_bin: activeBin,
    lower_bin: lowerBin,
    upper_bin: upperBin,
    bin_step: position.binStep,
    fee_tvl_ratio: position.feeTvlRatio,
    volatility: position.volatility,
    organic_score: position.organicScore,
    organic_source: position.organicSource,
    wallet_score: walletEntry.score,
    wallet_grade: walletEntry.grade,
    source_wallet: walletEntry.address,
    source_wallet_rank: walletEntry.rank,
    source_wallet_type: walletEntry.type || walletEntry.kind || "ranked_wallet",
    source_wallet_confidence: walletEntry.confidence ?? walletEntry.score ?? null,
    source_signal_id: signalId,
    source: "copy_engine",
  };
}

function recommendAmount(walletEntry, options = {}) {
  const pct = Number(config.copyTrading?.spreadSizePct);
  const walletSol = Math.max(0, Number(config.dryRunWallet) || 0);
  const hasPct = Number.isFinite(pct) && pct > 0 && walletSol > 0;

  const base = hasPct
    ? parseFloat((walletSol * pct).toFixed(4))
    : Number(config.copyTrading?.baseAmountSol ?? config.management?.deployAmountSol ?? 0.1);
  const max = Number(config.copyTrading?.maxAmountSol ?? config.risk?.maxDeployAmount ?? base);
  const rank = Number(walletEntry.rank || 10);
  const score = Math.max(0, Math.min(100, Number(walletEntry.score || 0)));
  const rankFactor = Math.max(0.5, 1.25 - (rank - 1) * 0.06);
  const scoreFactor = Math.max(0.5, score / 70);
  const amount = Math.round(Math.min(max, base * rankFactor * scoreFactor) * 1000) / 1000;
  if (options.useFloor && amount < base) {
    return hasPct ? amount : Math.round(base * 1000) / 1000;
  }
  return amount;
}

async function withTimeout(promise, ms, label) {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timeoutId);
  }
}

// ─── Shadow V2 Pool Stats ──────────────────────────────────────────────────────
const _SHADOW_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data");
const _SHADOW_PATH = path.join(_SHADOW_DIR, "shadow_v2_cases.json");
let _shadowPoolCache = null;

function getShadowPoolStats() {
  if (_shadowPoolCache) return _shadowPoolCache;
  try {
    if (!fs.existsSync(_SHADOW_PATH)) { _shadowPoolCache = {}; return _shadowPoolCache; }
    const raw = JSON.parse(fs.readFileSync(_SHADOW_PATH, "utf8"));
    const cases = Array.isArray(raw) ? raw : raw.cases || raw.shadow_cases || [];
    const stats = {};
    for (const c of cases) {
      const name = c.poolName || c.pool_name || "?";
      const pnl = Number(c.truth_pnl_sol) || 0;
      if (!stats[name]) stats[name] = { pnl: 0, wins: 0, losses: 0, zeros: 0, count: 0 };
      stats[name].pnl += pnl;
      stats[name].count += 1;
      if (pnl > 0) stats[name].wins += 1;
      else if (pnl < 0) stats[name].losses += 1;
      else stats[name].zeros += 1;
    }
    for (const name of Object.keys(stats)) {
      const s = stats[name];
      s.wr = s.count > 0 ? (s.wins / s.count) * 100 : 0;
      s.avgPnl = s.count > 0 ? s.pnl / s.count : 0;
    }
    _shadowPoolCache = stats;
  } catch { _shadowPoolCache = {}; }
  return _shadowPoolCache;
}

function rankByConviction(signals) {
  const pools = getShadowPoolStats();
  const conv = config.alphaConviction || {};
  const minConf = Number(conv.minConfidence ?? 0.70);
  const minWr = Number(conv.minShadowWr ?? 50);
  const maxPos = Math.max(1, Number(conv.maxPositions ?? 1));

  const scored = signals
    .map((s) => {
      const poolName = s.poolName || "?";
      const poolStat = pools[poolName];
      const shadowWr = poolStat?.wr ?? 0;
      const shadowPnl = poolStat?.avgPnl ?? 0;
      const confidence = Number(s.confidence) || 0;

      const cScore = confidence * 100;
      const wScore = Number(s.walletScore) || 50;
      const shadowFactor = poolStat
        ? Math.max(0.1, 1 + (shadowPnl * 10)) * (shadowWr / 100)
        : 0.5;
      const convictionScore = cScore * (wScore / 100) * shadowFactor;

      return { ...s, convictionScore, shadowWr, shadowPnl };
    })
    .filter((s) => {
      if (s.confidence < minConf) return false;
      if (minWr > 0 && s.shadowWr > 0 && s.shadowWr < minWr) return false;
      return true;
    })
    .sort((a, b) => b.convictionScore - a.convictionScore)
    .slice(0, maxPos);

  return scored;
}

async function evaluateWallet(walletEntry, options = {}) {
  const wallet = walletEntry.address;
  const skipDedupe = options.skipDedupe === true;
  const result = await withTimeout(
    getWalletPositions({ wallet_address: wallet }),
    Number(config.copyTrading?.walletFetchTimeoutMs ?? 20_000),
    `wallet position fetch ${wallet.slice(0, 8)}`
  );
  const positions = (result?.positions || []).slice(0, Number(config.copyTrading?.maxPositionsPerWallet ?? 3));
  const signals = [];
  const ignored = [];

  for (const rawPosition of positions) {
    const position = await enrichPosition(rawPosition);
    const pool = position.poolAddress || position.pool;
    const baseTtlMs = Number(config.copyTrading?.dedupeMinutes ?? 30) * 60_000;
    const dedupeTtlMs = volatilityBasedTtl(baseTtlMs, position.volatility);
    const dupeMatch = !skipDedupe && findRecentCopySignal({
      wallet,
      position: position.position,
      pool,
      ttlMs: dedupeTtlMs,
    });
    if (dupeMatch) {
      const refreshThreshold = config.copyTrading?.dupeRefreshThreshold ?? {
        feeTvlRatioDelta: 0.005,
        volatilityDelta: 0.5,
        priceChangePctDelta: 1,
        scoreDelta: 5,
        feeQualityDeltaPct: 15,
        volumeDeltaPct: 30,
        liquidityDeltaPct: 20,
        force: false,
      };
      const scoreDelta = position.walletScore != null && dupeMatch.walletScore != null
        ? Math.abs(position.walletScore - dupeMatch.walletScore) >= (refreshThreshold.scoreDelta ?? 10)
        : false;
      const feeQualityDelta = position.feeTvlRatio != null && dupeMatch.feeTvlRatio != null && dupeMatch.feeTvlRatio > 0
        ? (position.feeTvlRatio - dupeMatch.feeTvlRatio) / dupeMatch.feeTvlRatio * 100 >= (refreshThreshold.feeQualityDeltaPct ?? 20)
        : false;
      const shouldRefresh = refreshThreshold.force
        || (position.feeTvlRatio != null && dupeMatch.feeTvlRatio != null && Math.abs(position.feeTvlRatio - dupeMatch.feeTvlRatio) >= (refreshThreshold.feeTvlRatioDelta ?? 0.02))
        || (position.volatility != null && dupeMatch.volatility != null && Math.abs(position.volatility - dupeMatch.volatility) >= (refreshThreshold.volatilityDelta ?? 2))
        || scoreDelta
        || feeQualityDelta;
      const ttlExpired = Date.now() - new Date(dupeMatch.ts || 0).getTime() > baseTtlMs;
      if (shouldRefresh || ttlExpired) {
        if (ttlExpired) {
          log("copy-engine", `Dedupe bypass for ${pool}: TTL expired (${baseTtlMs / 60000}min base)`);
        } else {
          const reasons = [];
          if (scoreDelta) reasons.push("score+5");
          if (feeQualityDelta) reasons.push("fee+15%");
          log("copy-engine", `Dedupe bypass for ${pool}: material improvement (${reasons.join(", ")})`);
        }
      } else {
        const ignoredSignal = recordIgnoredCopySignal({
          wallet,
          pool,
          position: position.position,
          poolName: position.poolName,
          activeBin: position.active_bin ?? position.activeBin,
          lowerBin: position.lower_bin ?? position.lowerBin,
          upperBin: position.upper_bin ?? position.upperBin,
          binStep: position.binStep,
          feeTvlRatio: position.feeTvlRatio,
          volatility: position.volatility,
          organicScore: position.organicScore,
          walletScore: walletEntry.score,
          action: "SKIP",
          reason: "recent_duplicate_signal",
          risks: ["duplicate"],
        });
        recordForensicRejection(ignoredSignal);
        updateShadowFromMarket(ignoredSignal);
        ignored.push(ignoredSignal);
        continue;
      }
    }

    const calibration = config.decision?.adaptiveCalibrationEnabled !== false
      ? getAdaptiveConfidenceCalibration(config.operatorIntelligence?.adaptiveConfidence || {})
      : null;
    const decisionConfig = {
      ...config.decision,
      organicConfidenceWeight: calibration?.enabled
        ? calibration.organicWeight
        : config.decision?.organicConfidenceWeight,
    };
    const decision = await analyzePositionForCopy(position, walletEntry, decisionConfig);
    const alphaEdge = config.alphaEdge?.enabled !== false
      ? evaluateAlphaEdge({
          ...position,
          poolAddress: pool,
          feeTvlRatio: position.feeTvlRatio,
          binStep: position.binStep,
          organicScore: position.organicScore,
          walletEntry,
          source_wallet: wallet,
        })
      : null;
    if (alphaEdge) {
      decision.confidence = Math.max(0, Math.min(1, decision.confidence + Number(alphaEdge.confidenceAdjustment || 0)));
      decision.breakdown = {
        ...(decision.breakdown || {}),
        alpha_edge: Number(alphaEdge.confidenceAdjustment || 0),
        total: decision.confidence,
      };
      if (alphaEdge.action === "HOLD") {
        decision.action = "HOLD";
        decision.risks = [...(decision.risks || []), ...alphaEdge.holdReasons];
        decision.reasons = [...(decision.reasons || []), `Alpha edge hold: ${alphaEdge.holdReasons.join(", ")}`];
      }
    }
    const shadow = config.decision?.shadowEnabled !== false
      ? buildShadowDecision(decision, decisionConfig)
      : null;
    const action = decision.action === "COPY" && decision.confidence >= Number(decisionConfig.minConfidence ?? 0.6)
      ? "COPY"
      : decision.action;

    const signalId = `${Date.now()}_${wallet.slice(0, 8)}_${String(pool || position.position || "pool").slice(0, 8)}`;
    const signal = {
      id: signalId,
      wallet,
      walletLabel: walletEntry.label || wallet.slice(0, 8),
      walletRank: walletEntry.rank,
      walletScore: walletEntry.score,
      walletGrade: walletEntry.grade,
      pool,
      poolName: position.poolName,
      position: position.position,
      activeBin: position.active_bin ?? position.activeBin ?? null,
      active_bin: position.active_bin ?? position.activeBin ?? null,
      currentActiveBin: position.active_bin ?? position.activeBin ?? null,
      current_active_bin: position.active_bin ?? position.activeBin ?? null,
      lowerBin: position.lower_bin ?? position.lowerBin ?? null,
      lower_bin: position.lower_bin ?? position.lowerBin ?? null,
      upperBin: position.upper_bin ?? position.upperBin ?? null,
      upper_bin: position.upper_bin ?? position.upperBin ?? null,
      binStep: position.binStep ?? position.bin_step ?? null,
      bin_step: position.binStep ?? position.bin_step ?? null,
      entryPrice: position.current_price ?? position.price ?? null,
      entry_price: position.current_price ?? position.price ?? null,
      currentPrice: position.current_price ?? position.price ?? null,
      current_price: position.current_price ?? position.price ?? null,
      action,
      confidence: decision.confidence,
      breakdown: decision.breakdown || {},
      confidenceBreakdown: decision.breakdown || {},
      shadow,
      adaptiveCalibration: calibration,
      alphaEdge,
      alphaScore: alphaEdge?.alphaScore ?? null,
      alphaRank: alphaEdge?.alphaRank ?? null,
      organicScore: position.organicScore ?? null,
      organicSource: position.organicSource ?? null,
      feeTvlRatio: position.feeTvlRatio ?? null,
      volatility: position.volatility ?? null,
      reasons: decision.reasons || [],
      risks: decision.risks || [],
      deployArgs: action === "COPY"
        ? buildDeployArgs({ position, walletEntry, amountSol: recommendAmount(walletEntry, { useFloor: true }), signalId })
        : null,
      dryRun: options.dryRun ?? config.copyTrading?.dryRun ?? true,
      source: "copy_engine",
    };

    updateShadowFromMarket(signal);
    try {
      updateShadowV3WalletRescueFromMarket({
        ...position,
        ...signal,
        pool_address: pool,
        poolAddress: pool,
      });
    } catch (err) {
      log("copy_engine", `Shadow v3 market update skipped for ${position.poolName || pool}: ${err.message}`);
    }
    try {
      observeShadowV2Candidate({
        ...position,
        ...signal,
        pool_address: pool,
        poolAddress: pool,
      }, { source: "copy_engine" });
    } catch (err) {
      log("copy_engine", `Shadow v2 observe skipped for ${position.poolName || pool}: ${err.message}`);
    }

    if (signal.deployArgs) {
      signal.deployArgs.decision_confidence = decision.confidence;
      signal.deployArgs.decision_breakdown = decision.breakdown || {};
      signal.deployArgs.decision_result = {
        action,
        confidence: decision.confidence,
        breakdown: decision.breakdown || {},
        reasons: decision.reasons || [],
        risks: decision.risks || [],
      };
      signal.deployArgs.reasons = decision.reasons || [];
      signal.deployArgs.risks = decision.risks || [];
      signal.deployArgs.shadow_decision = shadow;
      signal.deployArgs.alpha_edge = alphaEdge;
    }

    try {
      if (action === "COPY" || config.masterStrategy?.observeIgnored === true) {
        recordMasterObservation(buildMasterObservation({ position, walletEntry, decision, signal }));
      }
    } catch (err) {
      log("strategy_db", `Observation skipped: ${err.message}`);
    }

    if (action === "COPY") signals.push(recordCopySignal(signal));
    else {
      recordMissedOpportunity(signal);
      const ignoredSignal = recordIgnoredCopySignal(signal);
      recordForensicRejection(ignoredSignal);
      recordShadowCandidate({
        ...ignoredSignal,
        rejection_stage: ignoredSignal.risks?.some((risk) => String(risk).includes("wallet"))
          ? "wallet_filter"
          : "decision_filter",
      });
      try {
        observeShadowV3WalletRescue({
          ...position,
          ...ignoredSignal,
          pool_address: pool,
          poolAddress: pool,
          rejection_stage: ignoredSignal.risks?.some((risk) => String(risk).includes("wallet"))
            ? "wallet_filter"
            : "decision_filter",
        }, {
          source: "copy_engine_wallet_filter",
          shadowV2Guard: config.shadowV2Guard,
        });
      } catch (err) {
        log("copy_engine", `Shadow v3 wallet rescue skipped for ${position.poolName || pool}: ${err.message}`);
      }
      ignored.push(ignoredSignal);
    }
  }

  return {
    wallet,
    totalPositions: positions.length,
    signals,
    ignored,
    error: result?.error || null,
  };
}

export async function runCopyEngineCycle(options = {}) {
  if (config.copyTrading?.enabled === false) {
    return { ok: true, skipped: true, reason: "copyTrading.enabled=false" };
  }

  const count = Number(options.count ?? config.copyTrading?.topWalletCount ?? 10);
  const mode = options.mode || config.copyTrading?.strategyMode || config.ranking?.strategyMode || "balanced";
  const { entries: topWallets, diagnostics } = await getTopWalletEntries({ count, mode, forceRanking: !!options.forceRanking });
  if (!topWallets.length) {
    const summary = {
      wallets: 0,
      signals: 0,
      ignored: 0,
      mode,
      reason: diagnostics?.reason || "no ranked wallets available",
    };
    log("copy_engine", `Scan skipped: ${summary.reason}`);
    touchCopyRun(summary);
    return { ok: true, topWallets: [], signals: [], ignored: [], summary };
  }

  // Ambil wallet dari existing COPY signals (yang sebelumnya lolos tapi belum di-deploy)
  const prevCopySignals = getRecentCopySignals({ action: "COPY", limit: 50 });
  const existingWalletSet = new Set(topWallets.map((w) => w.address));
  const prevWalletEntries = [];
  for (const signal of prevCopySignals) {
    if (!signal.wallet || existingWalletSet.has(signal.wallet)) continue;
    existingWalletSet.add(signal.wallet);
    prevWalletEntries.push({
      address: signal.wallet,
      score: Number(signal.walletScore) || 50,
      grade: signal.walletGrade || "B",
      rank: Number(signal.walletRank) || 10,
      label: signal.walletLabel || signal.wallet.slice(0, 8),
      type: "copy_signal_wallet",
      source: "prev_copy_signal",
      confidence: Number(signal.walletScore) || 50,
    });
  }

  const allWallets = [...topWallets, ...prevWalletEntries];
  log("copy_engine", `Scanning ${allWallets.length} wallet(s) for copyable DLMM positions (${topWallets.length} ranked + ${prevWalletEntries.length} from existing COPY signals)`);
  const results = await Promise.allSettled(allWallets.map((entry) =>
    evaluateWallet(entry, { ...options })
  ));
  const walletResults = results.map((r, i) => (
    r.status === "fulfilled"
      ? r.value
      : { wallet: allWallets[i]?.address, totalPositions: 0, signals: [], ignored: [], error: r.reason?.message || "unknown" }
  ));

  let signals = walletResults.flatMap((r) => r.signals || []);
  const ignored = walletResults.flatMap((r) => r.ignored || []);

  // ─── Alpha Conviction ──────────────────────────────────────────────────────
  // Rank & filter COPY signals; deploy only the top candidate with conviction sizing.
  if (config.alphaConviction?.enabled) {
    const copySignals = signals.filter((s) => s.action === "COPY" && s.deployArgs);
    const ranked = copySignals.length > 0 ? rankByConviction(copySignals) : [];
    const convictionSignal = ranked[0] || null;

    if (convictionSignal) {
      const walletSol = Math.max(0, Number(config.dryRunWallet) || 0);
      const pct = Number(config.alphaConviction.sizePct ?? 0.18);
      const convictionAmount = walletSol > 0 ? parseFloat((walletSol * pct).toFixed(3)) : 0;

      if (convictionAmount > 0) {
        // ── Airbag ────────────────────────────────────────────────────────
        // Kurangi position size jika ada kerugian beruntun.
        const consecutiveLosses = getConsecutiveLosses();
        const airbagAfter = Number(config.alphaConviction.airbagAfter ?? 2);
        const airbagFactor = Number(config.alphaConviction.airbagFactor ?? 0.50);
        const airbagMin = Number(config.alphaConviction.airbagMinPct ?? 0.04);

        let airbagMultiplier = 1;
        if (consecutiveLosses >= airbagAfter) {
          airbagMultiplier = Math.max(
            airbagMin / pct,
            1 - (consecutiveLosses - airbagAfter + 1) * (1 - airbagFactor),
          );
        }
        const finalPct = pct * airbagMultiplier;
        const finalAmount = parseFloat((walletSol * finalPct).toFixed(3));

        convictionSignal.deployArgs.amount_y = finalAmount;
        convictionSignal.deployArgs.amount_sol = finalAmount;
        convictionSignal.convictionRank = 1;
        convictionSignal.airbagMultiplier = airbagMultiplier;
        convictionSignal.consecutiveLosses = consecutiveLosses;

        log("copy_engine", `[CONVICTION] Top signal: ${convictionSignal.poolName || convictionSignal.pool} | ` +
          `score ${convictionSignal.convictionScore?.toFixed(0) || "?"} | Shadow WR ${(convictionSignal.shadowWr || 0).toFixed(0)}% | ` +
          `${finalAmount} SOL (${(finalPct * 100).toFixed(1)}% of ${walletSol} SOL)` +
          (airbagMultiplier < 1 ? ` | AIRBAG ×${airbagMultiplier.toFixed(2)} (${consecutiveLosses} consecutive losses)` : ""));

        signals = [convictionSignal];
      } else {
        log("copy_engine", `[CONVICTION] Wallet SOL ${walletSol} invalid, fallback to Spread Copy`);
      }
    } else {
      log("copy_engine", `[CONVICTION] No signal passed filters (${copySignals.length} candidates) — fallback to Spread Copy`);
    }
  }
  // ─── End Alpha Conviction ──────────────────────────────────────────────────────

  // Deploy COPY signals secara berurutan (amankan dari race condition)
  const deployedSignals = [];
  for (const signal of signals) {
    if (signal.deployArgs && signal.action === "COPY") {
      try {
        log("copy_engine", `Deploy candidate: ${signal.poolName || signal.pool} | ${signal.deployArgs.amount_y} SOL | confidence ${(signal.confidence * 100).toFixed(0)}%`);
        const deployResult = await executeTool("deploy_position", signal.deployArgs);
        if (deployResult?.would_deploy || deployResult?.success || (deployResult?.dry_run && !deployResult?.blocked && !deployResult?.error)) {
          signal.deployResult = deployResult;
          updateCopySignalDeployResult(signal, deployResult);
          deployedSignals.push({ ...signal, deployResult });
          log("copy_engine", `Deploy ${deployResult.dry_run ? 'DRY RUN' : 'LIVE'}: ${signal.poolName || signal.pool} ${signal.deployArgs.amount_y} SOL`);
        } else if (deployResult?.blocked) {
          signal.deployResult = deployResult;
          updateCopySignalDeployResult(signal, deployResult);
          log("copy_engine", `Deploy blocked: ${signal.poolName || signal.pool} — ${deployResult.reason}`);
        } else if (deployResult?.error) {
          signal.deployResult = deployResult;
          updateCopySignalDeployResult(signal, deployResult);
          log("copy_engine", `Deploy error: ${signal.poolName || signal.pool} — ${deployResult.error}`);
        }
      } catch (err) {
        log("copy_engine_error", `Deploy exception: ${signal.poolName || signal.pool} — ${err.message}`);
      }
    }
  }
  const deployCount = deployedSignals.length;

  const summary = {
    wallets: allWallets.length,
    positions: walletResults.reduce((sum, r) => sum + Number(r.totalPositions || 0), 0),
    signals: signals.length,
    deployed: deployCount,
    ignored: ignored.length,
    mode,
    rankingSnapshotTs: diagnostics?.snapshotTs || null,
    ignoredRiskSummary: summarizeRiskCounts(ignored),
  };
  touchCopyRun(summary);

  if (config.copyTrading?.autoBlacklistOnCriticalDecay) {
    for (const entry of topWallets) {
      if (entry.score != null && Number(entry.score) < Number(config.copyTrading?.autoBlacklistScoreBelow ?? 20)) {
        tagWallet(entry.address, "auto_blacklist_decay");
      }
    }
  }

  const blockers = Object.entries(summary.ignoredRiskSummary || {})
    .map(([risk, count]) => `${risk}:${count}`)
    .join(", ");
  log("copy_engine", `Scan complete: ${summary.signals} copy signal(s), ${summary.ignored} ignored${blockers ? ` | blockers ${blockers}` : ""}`);
  return { ok: true, topWallets, walletResults, signals, ignored, summary };
}

export function getCopySignals(options = {}) {
  return getRecentCopySignals(options);
}
