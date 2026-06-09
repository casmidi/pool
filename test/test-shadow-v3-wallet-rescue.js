import assert from "assert/strict";
import fs from "fs";
import os from "os";
import path from "path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "meridian-shadow-v3-"));
process.env.MERIDIAN_SHADOW_DATA_DIR = tmp;

const engine = await import("../shadow/shadow_v3_wallet_rescue.js");

function rejected(overrides = {}) {
  return {
    id: "sig-1",
    poolName: "RESCUE-SOL",
    pool_address: "RescuePool11111111111111111111111111111111",
    rejection_stage: "wallet_filter",
    risks: ["low_wallet_score"],
    score: 82,
    walletScore: 12,
    confidence: 0.12,
    organicScore: 88,
    feeTvlRatio: 0.08,
    active_tvl: 40000,
    volume_window: 25000,
    active_pct: 72,
    volatility: 1.2,
    active_bin: 1000,
    lower_bin: 965,
    upper_bin: 1000,
    binStep: 25,
    price: 1,
    timestamp: "2026-06-05T00:00:00.000Z",
    ...overrides,
  };
}

const created = engine.recordWalletRescueCandidate(rejected(), { source: "unit_test" });
assert.equal(created.recorded, true);
assert.equal(created.case.rescue_eligible, true);

const updated = engine.updateShadowV3WalletRescueFromMarket(rejected({
  id: "sig-1-update",
  price: 1.02,
  active_bin: 1008,
  timestamp: "2026-06-05T00:30:00.000Z",
}));
assert.equal(updated.closed, 1);

const risky = engine.recordWalletRescueCandidate(rejected({
  id: "sig-2",
  poolName: "RISKY-SOL",
  pool_address: "RiskyRescuePool111111111111111111111111111",
  active_tvl: 7000,
  volume_window: 500,
  active_pct: 25,
  feeTvlRatio: 0.9,
  fee_active_tvl_ratio: 0.9,
  risk_level: "high",
  bundle_pct: 40,
  price_change_1h_pct: 180,
}), { source: "unit_test" });
assert.equal(risky.recorded, true);
assert.equal(risky.case.rescue_eligible, false);
assert.equal(risky.case.blocked_by_truth, true);

const summary = engine.buildShadowV3WalletRescuePayload({ date: "2026-06-05", limit: 10 }).summary;
assert.equal(summary.cases, 2);
assert.equal(summary.eligible_cases, 1);
assert.equal(summary.rescue_wins, 1);
assert.ok(summary.rescue_pnl_sol > 0);
assert.equal(summary.truth_blocked_count, 1);

console.log("shadow v3 wallet rescue test passed");
