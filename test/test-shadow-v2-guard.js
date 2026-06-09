import assert from "assert/strict";
import { evaluateShadowV2EngineGuard } from "../lib/shadow_v2_guard.js";

function pool(overrides = {}) {
  return {
    pool_name: "GUARD-SOL",
    pool_address: "GuardPool111111111111111111111111111111111",
    active_tvl: 42000,
    volume_window: 18000,
    active_pct: 72,
    fee_active_tvl_ratio: 0.22,
    volatility: 1.1,
    active_bin: 1000,
    bin_step: 25,
    ...overrides,
  };
}

const cfg = {
  enabled: true,
  enforce: true,
  hardBlockLevels: ["HIGH", "CRITICAL"],
  hardBlockExitRoutes: ["NO_ROUTE", "UNSTABLE"],
  watchPenalty: 8,
  thinRoutePenalty: 6,
  maxPenalty: 40,
};

const clean = evaluateShadowV2EngineGuard(pool(), cfg);
assert.equal(clean.action, "PASS");
assert.equal(clean.hard_block, false);
assert.equal(clean.score_penalty, 0);

const thinWatch = evaluateShadowV2EngineGuard(pool({
  active_tvl: 9000,
  volume_window: 900,
  active_pct: 55,
}), cfg);
assert.equal(thinWatch.warning_level, "WATCH");
assert.equal(thinWatch.exit_route_status, "THIN");
assert.equal(thinWatch.action, "PENALIZE");
assert.equal(thinWatch.hard_block, false);
assert.ok(thinWatch.score_penalty > 0);

const highRisk = evaluateShadowV2EngineGuard(pool({
  active_tvl: 7500,
  volume_window: 700,
  active_pct: 31,
  fee_active_tvl_ratio: 0.91,
  risk_level: "high",
  bundle_pct: 38,
  price_change_1h_pct: 188,
}), cfg);
assert.equal(highRisk.hard_block, true);
assert.equal(highRisk.action, "BLOCK");

const incomplete = evaluateShadowV2EngineGuard(pool({
  active_tvl: null,
  liquidity: null,
  fee_active_tvl_ratio: null,
  volatility: null,
  active_bin: null,
}), cfg);
assert.equal(incomplete.data_complete, false);
assert.equal(incomplete.hard_block, false);
assert.equal(incomplete.score_penalty, 0);

console.log("shadow v2 guard test passed");
