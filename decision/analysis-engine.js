/**
 * Decision Analysis Engine
 * Evaluates whether a master wallet's position is worth copying.
 */
import { DEFAULT_DECISION_CONFIG } from "./types.js";

/**
 * Analyze a position from a top wallet and determine if it's copy-worthy.
 * @param {Object} position - Position data from the wallet
 * @param {Object} walletMetrics - Overall wallet metrics (score, grade, etc.)
 * @param {Object} [config] - Decision config overrides
 * @returns {Promise<{action: string, confidence: number, breakdown: Object, reasons: string[], risks: string[]}>}
 */
export async function analyzePositionForCopy(position, walletMetrics, config = {}) {
  const cfg = { ...DEFAULT_DECISION_CONFIG, ...config };
  const reasons = [];
  const risks = [];

  if (!position) {
    return decisionResult("SKIP", 0, {}, ["No position data available"], ["missing_data"]);
  }

  const walletScore = walletMetrics?.score ?? walletMetrics?._score ?? 0;
  if (walletScore < cfg.minScoreToCopy) {
    reasons.push(`Wallet score ${walletScore} below minimum ${cfg.minScoreToCopy}`);
    return decisionResult("SKIP", 0.1, { raw: { walletScore } }, reasons, ["low_wallet_score"]);
  }
  reasons.push(`Wallet score ${walletScore} >= ${cfg.minScoreToCopy}`);

  const rangeQuality = assessRangeQuality(position);
  if (rangeQuality < cfg.minRangeQuality) {
    risks.push(`Range quality ${rangeQuality}% below minimum ${cfg.minRangeQuality}%`);
    reasons.push(`Range quality ${rangeQuality}% below threshold`);
    return decisionResult("HOLD", 0.3, { raw: { walletScore, rangeQuality } }, reasons, ["poor_range_quality"]);
  }
  reasons.push(`Range quality ${rangeQuality}% ok`);

  const feeTvl = position.feeTvlRatio ?? position.fee_active_tvl_ratio ?? position.fee_tvl_ratio ?? 0;
  if (feeTvl < cfg.minFeeTvlForCopy) {
    risks.push(`Fee/TVL ${feeTvl} below minimum ${cfg.minFeeTvlForCopy}`);
    reasons.push(`Fee/TVL ${feeTvl} low yield`);
    return decisionResult("HOLD", 0.35, { raw: { walletScore, rangeQuality, feeTvl } }, reasons, ["low_fee_tvl"]);
  }
  reasons.push(`Fee/TVL ${feeTvl} ok`);

  const organicScore = getOrganicScore(position);
  const minOrganic = Number(cfg.minOrganicForCopy ?? cfg.minOrganic ?? 70);
  if (organicScore > 0 && organicScore < minOrganic) {
    reasons.push(`Organic ${organicScore}% below threshold ${minOrganic}%`);
    return decisionResult("HOLD", 0.3, {
      raw: { walletScore, rangeQuality, feeTvl, organicScore },
    }, reasons, ["low_organic"]);
  }
  reasons.push(`Organic ${organicScore}% ${organicScore > 0 ? "ok" : "(data unavailable, skipped)"}`);

  const volatility = position.volatility ?? 0;
  if (volatility > cfg.maxVolatilityForCopy) {
    risks.push(`Volatility ${volatility} exceeds max ${cfg.maxVolatilityForCopy}`);
    reasons.push(`Volatility ${volatility} high IL risk`);
    return decisionResult("HOLD", 0.4, {
      raw: { walletScore, rangeQuality, feeTvl, organicScore, volatility },
    }, reasons, ["high_volatility"]);
  }
  reasons.push(`Volatility ${volatility} ok`);

  if (position.inRange === false || position.in_range === false) {
    const oorMinutes = position.minutesOutOfRange ?? position.minutes_out_of_range ?? 0;
    risks.push(`Position is out of range (${oorMinutes}m)`);
    reasons.push(`OOR ${oorMinutes}m; waiting for re-entry`);
    return decisionResult("HOLD", 0.45, {
      raw: { walletScore, rangeQuality, feeTvl, organicScore, volatility, oorMinutes },
    }, reasons, ["out_of_range"]);
  }
  reasons.push("In range ok");

  const ageHours = position.ageHours ?? (position.age_minutes != null ? position.age_minutes / 60 : null);
  const pnlPct = position.pnlPct ?? position.pnl_pct ?? 0;
  if (ageHours != null && ageHours < 1 && pnlPct > 10) {
    reasons.push(`New position (${ageHours.toFixed(1)}h) with high early PnL ${pnlPct}%; monitoring`);
    return decisionResult("HOLD", 0.5, {
      raw: { walletScore, rangeQuality, feeTvl, organicScore, volatility, ageHours, pnlPct },
    }, reasons, ["early_position"]);
  }

  const feesSol = position.feesEarnedSol ?? position.fees_earned_sol ?? position.unclaimed_fees_usd ?? null;
  if (ageHours != null && feesSol != null && feesSol < 0.01 && ageHours > 6) {
    reasons.push(`Low fee earnings ${feesSol} SOL after ${ageHours?.toFixed(1) ?? "?"}h`);
    return decisionResult("HOLD", 0.3, {
      raw: { walletScore, rangeQuality, feeTvl, organicScore, volatility, ageHours, feesSol },
    }, reasons, ["low_fees"]);
  }

  const { confidence, breakdown } = computeCopyConfidence(
    walletScore,
    rangeQuality,
    feeTvl,
    volatility,
    ageHours,
    organicScore,
    cfg.organicConfidenceWeight,
  );
  reasons.push("All quality checks passed");
  return decisionResult("COPY", confidence, breakdown, reasons, risks);
}

function decisionResult(action, confidence, breakdown, reasons, risks) {
  return {
    action,
    confidence: round4(Math.max(0, Math.min(1, Number(confidence) || 0))),
    breakdown: normalizeBreakdown(breakdown, confidence),
    reasons,
    risks,
  };
}

function round4(value) {
  return Math.round(value * 10000) / 10000;
}

function normalizeBreakdown(breakdown = {}, confidence = 0) {
  return {
    ...breakdown,
    total: round4(breakdown.total ?? confidence ?? 0),
  };
}

function getOrganicScore(position) {
  const value = position.organicScore
    ?? position.organic_score
    ?? position.base?.organic
    ?? position.token_x?.organic_score
    ?? 0;
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 0;
}

/**
 * Assess the quality of a position's bin range.
 * @param {Object} position
 * @returns {number} Range quality score 0-100
 */
export function assessRangeQuality(position) {
  const lowerBin = position.lowerBin ?? position.lower_bin;
  const upperBin = position.upperBin ?? position.upper_bin;
  const activeBin = position.activeBin ?? position.active_bin;

  if (lowerBin == null || upperBin == null || activeBin == null) return 50;

  const totalBins = Math.abs(upperBin - lowerBin);
  if (totalBins < 10) return 30;
  if (totalBins > 500) return 40;

  const inRange = activeBin >= lowerBin && activeBin <= upperBin;
  const distanceFromActive = inRange ? 0 : Math.min(
    Math.abs(activeBin - lowerBin),
    Math.abs(activeBin - upperBin),
  );

  let score = 70;
  if (totalBins >= 35 && totalBins <= 100) score += 15;
  if (totalBins > 100 && totalBins <= 200) score += 5;
  if (inRange) score += 10;
  if (!inRange && distanceFromActive > 50) score -= 20;

  return Math.max(0, Math.min(100, score));
}

/**
 * Compute overall confidence score for copying a position.
 * Existing confidence signals keep their relative influence, scaled to reserve
 * 15% for organic quality.
 * @param {number} walletScore - Wallet quality score 0-100
 * @param {number} rangeQuality - Range quality 0-100
 * @param {number} feeTvl - Fee/TVL ratio
 * @param {number} volatility - Pool volatility
 * @param {number|null} ageHours - Position age in hours
 * @param {number} organicScore - Jupiter organic score 0-100
 * @param {number} organicWeight - Organic contribution weight 0-1
 * @returns {{confidence: number, breakdown: Object}}
 */
export function computeCopyConfidence(walletScore, rangeQuality, feeTvl, volatility, ageHours, organicScore = 0, organicWeight = 0.15) {
  const components = {};
  const organicW = Math.max(0.12, Math.min(0.20, Number(organicWeight) || 0.15));
  const nonOrganicScale = 1 - organicW;

  components.wallet = (0.30 * nonOrganicScale) * (Math.min(walletScore, 100) / 100);
  components.range = (0.25 * nonOrganicScale) * (rangeQuality / 100);

  const feeScore = Math.min(feeTvl / 0.05, 1);
  components.fee_tvl = (0.25 * nonOrganicScale) * feeScore;

  const volScore = volatility <= 0 ? 0.5 : Math.max(0, 1 - (volatility / 10));
  components.volatility = (0.20 * nonOrganicScale) * volScore;
  components.organic = organicW * (Math.min(Math.max(Number(organicScore) || 0, 0), 100) / 100);
  components.age = 0;

  if (ageHours != null) {
    if (ageHours >= 4 && ageHours <= 72) components.age += 0.05;
    if (ageHours > 168) components.age -= 0.05;
  }

  const confidence = Math.max(0, Math.min(1, Object.values(components).reduce((sum, v) => sum + v, 0)));
  return {
    confidence: round4(confidence),
    breakdown: {
      wallet: round4(components.wallet),
      range: round4(components.range),
      fee_tvl: round4(components.fee_tvl),
      volatility: round4(components.volatility),
      organic: round4(components.organic),
      age: round4(components.age),
      total: round4(confidence),
      raw: {
        walletScore,
        rangeQuality,
        feeTvl,
        volatility,
        organicScore,
        organicWeight: organicW,
        ageHours,
      },
    },
  };
}

/**
 * Analyze a complete wallet and all its positions for copy suitability.
 * @param {Object} wallet - Complete wallet data with positions
 * @param {Object} [config]
 * @returns {Promise<{action: string, confidence: number, bestPosition: Object|null, breakdown: Object, reasons: string[], risks: string[]}>}
 */
export async function analyzeWalletForCopy(wallet, config = {}) {
  if (!wallet?.address) {
    return { action: "SKIP", confidence: 0, bestPosition: null, breakdown: { total: 0 }, reasons: ["No wallet address"], risks: ["missing_data"] };
  }

  const positions = wallet.positions ?? wallet.rawData?.positions ?? [];
  if (!positions.length) {
    return { action: "HOLD", confidence: 0.2, bestPosition: null, breakdown: { total: 0.2 }, reasons: ["No LP positions found"], risks: ["no_positions"] };
  }

  const walletMetrics = {
    score: wallet.score ?? wallet._score ?? 0,
    grade: wallet.grade ?? wallet._grade ?? "N/A",
  };

  const results = await Promise.allSettled(
    positions.map(pos => analyzePositionForCopy(pos, walletMetrics, config)),
  );

  const bestResult = results.reduce((best, r, i) => {
    if (r.status !== "fulfilled" || !r.value) return best;
    const result = r.value;
    if (result.action === "COPY" && result.confidence > (best?.confidence ?? 0)) {
      return { ...result, bestPosition: positions[i] };
    }
    return best;
  }, null);

  if (bestResult) return bestResult;

  const bestHold = results.reduce((best, r, i) => {
    if (r.status !== "fulfilled" || !r.value) return best;
    if ((r.value.confidence ?? 0) > (best?.confidence ?? 0)) {
      return { ...r.value, bestPosition: positions[i] };
    }
    return best;
  }, null);

  return bestHold || {
    action: "SKIP",
    confidence: 0,
    bestPosition: null,
    breakdown: { total: 0 },
    reasons: ["No copy-worthy position found"],
    risks: ["all_positions_rejected"],
  };
}
