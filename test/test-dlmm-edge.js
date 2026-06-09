import assert from "assert/strict";
import { evaluateAntiOorRangeAdaptation, planDlmmEntry } from "../strategy/dlmm-edge.js";

const config = {
  strategy: {
    minBinsBelow: 35,
    maxBinsBelow: 69,
  },
  screening: {
    minNetEVPct: 0.2,
    timeframe: "30m",
  },
};

const lowVol = planDlmmEntry({
  fee_active_tvl_ratio: 0.08,
  volatility: 1,
  active_pct: 75,
  price_change_pct: 1,
  bin_step: 80,
}, config);
assert.equal(lowVol.regime, "tight_fee_capture");
assert.ok(lowVol.bins_below >= 35);
assert.equal(lowVol.bins_above, 0);

const highVol = planDlmmEntry({
  fee_active_tvl_ratio: 0.05,
  volatility: 4,
  active_pct: 70,
  price_change_pct: 2,
  bin_step: 80,
}, config);
assert.equal(highVol.regime, "wide_defensive_bid_ask");
assert.ok(highVol.bins_below > lowVol.bins_below);

const extended = planDlmmEntry({
  fee_active_tvl_ratio: 0.08,
  volatility: 1.4,
  active_pct: 70,
  price_change_pct: 12,
  bin_step: 80,
}, config);
assert.ok(extended.warnings.some((warning) => warning.includes("extended upward")));

const lowActive = planDlmmEntry({
  fee_active_tvl_ratio: 0.08,
  volatility: 1.4,
  active_pct: 35,
  price_change_pct: 1,
  bin_step: 80,
}, config);
assert.ok(lowActive.bins_below > lowVol.bins_below);
assert.ok(lowActive.warnings.some((warning) => warning.includes("active liquidity")));

const capped = planDlmmEntry({
  fee_active_tvl_ratio: 0.02,
  volatility: 99,
  active_pct: 10,
  price_change_pct: -99,
  bin_step: 200,
}, config);
assert.equal(capped.bins_below, 69);

const badRange = evaluateAntiOorRangeAdaptation({
  bins_below: 40,
  bins_above: 0,
}, {
  dynamicRangeWidth: {
    recommendation: "WIDEN_RANGE",
    widthMultiplier: 1.25,
    suggestedWidthBins: 50,
  },
}, {
  isSingleSidedSol: true,
  config,
});
assert.equal(badRange.legal, true);
assert.equal(badRange.final_range_action, "WIDEN_RANGE");
assert.equal(badRange.bins_above, 0);
assert.equal(badRange.bins_below, 50);

console.log("dlmm-edge smoke test passed");
