import assert from "node:assert/strict";
import { analyzePositionForCopy } from "../decision/analysis-engine.js";

const basePosition = {
  lowerBin: 100,
  upperBin: 160,
  activeBin: 130,
  feeTvlRatio: 0.04,
  volatility: 3,
  inRange: true,
  ageHours: 8,
  organicScore: 85,
};

const wallet = { score: 70, grade: "A" };
const cfg = {
  minScoreToCopy: 50,
  minConfidence: 0.55,
  minRangeQuality: 50,
  maxVolatilityForCopy: 7,
  minFeeTvlForCopy: 0.02,
  minOrganicForCopy: 70,
};

const copy = await analyzePositionForCopy(basePosition, wallet, cfg);
assert.equal(copy.action, "COPY");
assert.ok(copy.confidence >= cfg.minConfidence);
assert.ok(copy.breakdown.organic > 0);
assert.equal(copy.risks.length, 0);

const lowOrganic = await analyzePositionForCopy({ ...basePosition, organicScore: 45 }, wallet, cfg);
assert.equal(lowOrganic.action, "HOLD");
assert.equal(lowOrganic.confidence, 0.3);
assert.deepEqual(lowOrganic.risks, ["low_organic"]);
assert.match(lowOrganic.reasons.join(" "), /Organic 45% below threshold 70%/);

const lowWallet = await analyzePositionForCopy(basePosition, { score: 45 }, cfg);
assert.equal(lowWallet.action, "SKIP");
assert.deepEqual(lowWallet.risks, ["low_wallet_score"]);

console.log("decision-engine tests passed");
