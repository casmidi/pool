import assert from "node:assert/strict";
import {
  calculateCopyCrowdScore,
  calculateEuphoriaScore,
  calculateProfitExpectancy,
  calculateWalletTimingScore,
  evaluateAlphaEdge,
  predictLpSurvival,
} from "../lib/alpha_edge.js";

const timing = calculateWalletTimingScore({ rank: 1, score: 80 }, { ageHours: 1, pnlPct: 2 });
assert.ok(timing.score > 70);
assert.ok(timing.boost > 0);

const survivalBad = predictLpSurvival({
  volatility: 8,
  priceChangePct: 60,
  binStep: 125,
  rangeWidth: 20,
  marketRegime: { regime: "HIGH_VOLATILITY" },
});
assert.ok(survivalBad.score < 40);
assert.ok(survivalBad.penalty < 0);

const euphoria = calculateEuphoriaScore({
  priceChangePct: 72,
  volumeChangePct: 250,
  organicScore: 98,
  athPct: 95,
  crowdScore: 90,
});
assert.ok(euphoria.score >= 80);
assert.ok(euphoria.penalty < 0);

const expectancy = calculateProfitExpectancy({
  feeTvlRatio: 0.04,
  survival: { expectedHours: 4 },
  volatility: 2,
  binStep: 80,
});
assert.ok(expectancy.positive);

const alpha = evaluateAlphaEdge({
  volatility: 8,
  priceChangePct: 70,
  volumeChangePct: 250,
  organicScore: 98,
  binStep: 125,
  rangeWidth: 20,
  feeTvlRatio: 0.01,
  walletEntry: { rank: 9, score: 50 },
});
assert.equal(alpha.action, "HOLD");
assert.ok(alpha.holdReasons.length > 0);

const crowd = calculateCopyCrowdScore("missing-pool-for-test");
assert.ok(crowd.score >= 0);

console.log("alpha-edge tests passed");
