import assert from "node:assert/strict";
import { DEFAULT_WEIGHTS, DEFAULT_PENALTY_CONFIG, scorePool } from "../strategy/pool-scorer.js";
import { evaluatePosition } from "../strategy/position-manager.js";
import { REGIMES, detectMarketRegime, applyRegimeAdjustments } from "../intelligence/market-regime.js";
import { learnFromOutcomes, applyAdaptiveWeights } from "../intelligence/darwin-intelligence.js";
import { predictPoolDecay } from "../intelligence/pool-decay.js";
import { evaluateOpportunityCost } from "../intelligence/capital-allocator.js";
import { recommendPositionSize } from "../intelligence/position-sizing.js";
import { analyzeCrowding } from "../intelligence/crowding-engine.js";
import { explainPoolIntelligence } from "../intelligence/explainable-intelligence.js";

const pools = [
  {
    pool: "pool-a",
    name: "ALPHA-SOL",
    fee_active_tvl_ratio: 0.07,
    volume_window: 100000,
    fee_change_pct: 85,
    volume_change_pct: 35,
    active_pct: 82,
    volatility: 2.2,
    organic_score: 90,
    holders: 5000,
    token_age_hours: 120,
    price_vs_ath_pct: 88,
  },
  {
    pool: "pool-b",
    name: "BETA-SOL",
    fee_active_tvl_ratio: 0.05,
    volume_window: 60000,
    fee_change_pct: 70,
    volume_change_pct: 22,
    active_pct: 75,
    volatility: 2.5,
    organic_score: 84,
    holders: 3000,
    token_age_hours: 140,
  },
];

const regime = detectMarketRegime(pools, [{ pnl_pct: 4 }, { pnl_pct: 1 }]);
assert.equal(regime.regime, REGIMES.EUPHORIC);
assert.ok(regime.confidence >= 45);
assert.ok(regime.adjustments.weightMultipliers);

const adjusted = applyRegimeAdjustments(
  DEFAULT_WEIGHTS,
  DEFAULT_PENALTY_CONFIG,
  { minPoolScore: 30 },
  regime,
  { maxWeightAdjustment: 0.25 },
);
assert.notEqual(adjusted.weights.organic_score, DEFAULT_WEIGHTS.organic_score);
assert.equal(adjusted.thresholds.minPoolScore, 35);

const learned = learnFromOutcomes([
  { fee_active_tvl_ratio: 0.01, organic_score: 70, pnl_pct: -5 },
  { fee_active_tvl_ratio: 0.03, organic_score: 80, pnl_pct: 3 },
  { fee_active_tvl_ratio: 0.05, organic_score: 92, pnl_pct: 8 },
  { fee_active_tvl_ratio: 0.04, organic_score: 89, pnl_pct: 5 },
]);
const adaptive = applyAdaptiveWeights(DEFAULT_WEIGHTS, learned);
assert.ok(adaptive.fee_active_tvl_ratio > 0);
assert.ok(adaptive.organic_score > 0);

const decay = predictPoolDecay({
  fee_change_pct: -55,
  volume_change_pct: -40,
  active_pct: 28,
  volatility: 7,
  fee_active_tvl_ratio: 0.01,
});
assert.ok(decay.decay_risk > 40);
assert.ok(decay.expected_half_life_hours > 0);

const allocation = evaluateOpportunityCost(
  [{ pool: "old", pool_score: 35, pnl_usd: 1, fees_earned_usd: 1 }],
  [{ pool: "new", name: "NEW-SOL", pool_score: 68 }],
  { minScoreGap: 10, minNetGain: 8 },
);
assert.equal(allocation.redeployCandidates.length, 1);

const crowded = analyzeCrowding({
  competing_pool_count: 4,
  lp_count: 120,
  top_lp_share_pct: 45,
  fee_active_tvl_ratio: 0.005,
});
assert.ok(crowded.crowding_score >= 45);

const sizing = recommendPositionSize(
  { pool_score: 70, confidence: 0.8, decay, crowding: crowded },
  { winRate: 0.6 },
  { baseAmountSol: 0.1, maxAmountSol: 0.3 },
);
assert.ok(sizing.amountSol > 0);
assert.ok(sizing.conviction > 0);

const explanation = explainPoolIntelligence(pools[0], { pools });
assert.equal(explanation.marketRegime.regime, REGIMES.EUPHORIC);
assert.ok(explanation.explainability.length >= 3);

const baseScore = scorePool(pools[0], DEFAULT_WEIGHTS, DEFAULT_PENALTY_CONFIG);
const advisoryScore = scorePool(pools[0], DEFAULT_WEIGHTS, DEFAULT_PENALTY_CONFIG);
assert.deepEqual(advisoryScore, baseScore);

const defaultPosition = evaluatePosition(
  { pool: "old", deployed_at: new Date().toISOString(), pnl_usd: 0, fees_earned_usd: 0, deploy_amount_usd: 100 },
  { pool: "old", pool_score: 50, fee_change_pct: -80, volume_change_pct: -60, active_pct: 20, volatility: 8 },
  150,
);
assert.equal(defaultPosition.action, "HOLD");
assert.ok(defaultPosition.position_summary.decay);

const enforcedPosition = evaluatePosition(
  { pool: "old", deployed_at: new Date().toISOString(), pnl_usd: 0, fees_earned_usd: 0, deploy_amount_usd: 100 },
  { pool: "old", pool_score: 50, fee_change_pct: -80, volume_change_pct: -60, active_pct: 20, volatility: 8 },
  150,
  { applyIntelligenceDecayRules: true, maxDecayRiskToHold: 30 },
);
assert.equal(enforcedPosition.action, "EXIT");

console.log("intelligence-layer tests passed");
