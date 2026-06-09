import assert from "assert/strict";
import fs from "fs";
import os from "os";
import path from "path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "meridian-shadow-v2-"));
process.env.MERIDIAN_SHADOW_DATA_DIR = tmp;

const engine = await import("../shadow/shadow_v2_engine.js");

function pool(overrides = {}) {
  return {
    name: "V2TEST-SOL",
    pool_address: "V2Pool11111111111111111111111111111111111",
    pool_score: 74,
    active_tvl: 42000,
    volume_window: 18000,
    active_pct: 72,
    fee_active_tvl_ratio: 0.22,
    volatility: 1.1,
    active_bin: 1000,
    price: 1,
    bin_step: 25,
    dlmm_plan: {
      bins_below: 20,
      bins_above: 8,
    },
    timestamp: "2026-06-05T00:00:00.000Z",
    ...overrides,
  };
}

const clean = engine.analyzePreTradeTruth(pool());
assert.equal(clean.warning_level, "CLEAR");
assert.equal(clean.would_warn, false);
assert.ok(clean.truth_score > 70);

const risky = pool({
  pool_address: "RiskyV2Pool111111111111111111111111111111",
  active_tvl: 7500,
  volume_window: 900,
  active_pct: 31,
  fee_active_tvl_ratio: 0.91,
  risk_level: "high",
  bundle_pct: 38,
  sniper_pct: 22,
  price_change_1h_pct: 188,
});

const truth = engine.analyzePreTradeTruth(risky);
assert.equal(truth.would_warn, true);
assert.match(truth.warnings.join(","), /(exit_route|cluster|timing)/);

const created = engine.recordShadowV2Candidate(risky, { source: "unit_test" });
assert.equal(created.recorded, true);
assert.equal(created.case.status, "OPEN");
assert.equal(created.case.warning_level, truth.warning_level);

const market = engine.updateShadowV2FromMarket(pool({
  ...risky,
  active_bin: 970,
  price: 0.92,
  timestamp: "2026-06-05T00:45:00.000Z",
}));
assert.ok(market.updated >= 1);
assert.equal(market.closed, 1);

const payload = engine.buildShadowV2Payload({ date: "2026-06-05", limit: 5 });
const closed = payload.cases.find((item) => item.pool_address === risky.pool_address);
assert.equal(payload.ok, true);
assert.equal(payload.rules.auto_deploy, false);
assert.equal(payload.rules.hard_gate, false);
assert.equal(closed.status, "CLOSED");
assert.equal(closed.outcome, "TRUE_WARNING");
assert.ok(payload.summary.truth_pnl_sol > 0);
assert.equal(payload.summary.true_warning_count, 1);

const adaptivePool = pool({
  pool_address: "AdaptiveV2Pool111111111111111111111111111",
  active_tvl: 8200,
  volume_window: 950,
  active_pct: 42,
  fee_active_tvl_ratio: 0.84,
  price_change_1h_pct: 92,
  active_bin: 2000,
  price: 1,
  dlmm_plan: {
    bins_below: 20,
    bins_above: 8,
  },
  timestamp: "2026-06-05T02:00:00.000Z",
});
const adaptiveCreated = engine.recordShadowV2Candidate(adaptivePool, { source: "unit_test" });
assert.equal(adaptiveCreated.recorded, true);
assert.ok(adaptiveCreated.case.adaptive_shadow);
assert.equal(adaptiveCreated.case.adaptive_shadow.rules.hard_gate, false);

const adaptiveBaselineClose = engine.updateShadowV2FromMarket(pool({
  ...adaptivePool,
  active_bin: 2030,
  price: 0.99,
  timestamp: "2026-06-05T02:10:00.000Z",
}));
assert.equal(adaptiveBaselineClose.closed, 1);
assert.ok(adaptiveBaselineClose.adaptive_updated >= 1);

const adaptiveFinal = engine.updateShadowV2FromMarket(pool({
  ...adaptivePool,
  active_bin: 2022,
  price: 1.08,
  timestamp: "2026-06-05T04:20:00.000Z",
}));
assert.ok(adaptiveFinal.adaptive_closed >= 1);

const adaptivePayload = engine.buildShadowV2Payload({ date: "2026-06-05", limit: 10 });
const adaptiveCase = adaptivePayload.cases.find((item) => item.pool_address === adaptivePool.pool_address);
assert.equal(adaptiveCase.status, "CLOSED");
assert.equal(adaptiveCase.adaptive_shadow.variants.widen_shift_up.status, "CLOSED");
assert.ok(adaptiveCase.adaptive_shadow.variants.widen_shift_up.impact_sol > 0);
assert.ok(adaptivePayload.summary.adaptive_impact_sol > 0);
assert.notEqual(adaptivePayload.summary.adaptive_best_route, "none");

const weakAdaptivePool = pool({
  pool_address: "WeakAdaptiveV2Pool111111111111111111111111",
  active_tvl: 8300,
  volume_window: 980,
  active_pct: 43,
  fee_active_tvl_ratio: 0.82,
  price_change_1h_pct: 88,
  active_bin: 3000,
  price: 1,
  dlmm_plan: {
    bins_below: 20,
    bins_above: 8,
  },
  timestamp: "2026-06-05T03:00:00.000Z",
});
const weakCreated = engine.recordShadowV2Candidate(weakAdaptivePool, { source: "unit_test" });
assert.equal(weakCreated.recorded, true);
const weakBaselineClose = engine.updateShadowV2FromMarket(pool({
  ...weakAdaptivePool,
  active_bin: 3030,
  price: 0.99,
  timestamp: "2026-06-05T03:10:00.000Z",
}));
assert.equal(weakBaselineClose.closed, 1);
const weakFinal = engine.updateShadowV2FromMarket(pool({
  ...weakAdaptivePool,
  active_bin: 3038,
  price: 0.94,
  timestamp: "2026-06-05T05:20:00.000Z",
}));
assert.ok(weakFinal.adaptive_closed >= 1);
const weakPayload = engine.buildShadowV2Payload({ date: "2026-06-05", limit: 10 });
const weakCase = weakPayload.cases.find((item) => item.pool_address === weakAdaptivePool.pool_address);
assert.equal(weakCase.adaptive_shadow.variants.widen_shift_up.status, "CLOSED");
assert.ok(weakCase.adaptive_shadow.variants.widen_shift_up.impact_sol <= 0);

const incomplete = engine.recordShadowV2Candidate(pool({
  pool_address: "IncompleteV2Pool111111111111111111111111",
  active_tvl: null,
  liquidity: null,
  fee_active_tvl_ratio: null,
  volatility: null,
  active_bin: null,
  price: null,
  timestamp: "2026-06-05T01:00:00.000Z",
}), { source: "unit_test" });
assert.equal(incomplete.recorded, true);
assert.equal(incomplete.case.data_complete, false);

console.log("shadow v2 engine smoke test passed");
