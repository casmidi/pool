import assert from "node:assert/strict";
import {
  buildShadowDecision,
  detectMarketRegime,
  REGIMES,
} from "../lib/operator_intelligence.js";

const highVol = detectMarketRegime({ volatility: 6, feeTvlRatio: 0.04 }, { highVolatilityThreshold: 5 });
assert.equal(highVol.regime, REGIMES.HIGH_VOLATILITY);
assert.equal(highVol.deployMultiplier, 0.5);
assert.ok(highVol.confidenceBoost > 0);

const lowActivity = detectMarketRegime({ volatility: 1, feeTvlRatio: 0.005, volume: 10 }, { minFeeActiveTvlRatio: 0.02, minVolume: 500 });
assert.equal(lowActivity.regime, REGIMES.LOW_ACTIVITY);
assert.ok(lowActivity.deployMultiplier < 1);

const sideways = detectMarketRegime({ volatility: 2, feeTvlRatio: 0.04, priceChangePct: 1 }, { highVolatilityThreshold: 5 });
assert.equal(sideways.regime, REGIMES.SIDEWAYS);
assert.equal(sideways.deployMultiplier, 1);

const shadowHold = buildShadowDecision({ action: "COPY", confidence: 0.58, risks: [] }, { minConfidence: 0.55, shadowConfidenceAdd: 0.08 });
assert.equal(shadowHold.action, "HOLD");
assert.equal(shadowHold.wouldDiffer, true);

const shadowCopy = buildShadowDecision({ action: "COPY", confidence: 0.7, risks: [] }, { minConfidence: 0.55, shadowConfidenceAdd: 0.08 });
assert.equal(shadowCopy.action, "COPY");
assert.equal(shadowCopy.wouldDiffer, false);

console.log("operator-intelligence tests passed");
