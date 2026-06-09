import assert from "assert/strict";
import fs from "fs";
import os from "os";
import path from "path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "meridian-shadow-"));
process.env.MERIDIAN_SHADOW_DATA_DIR = tmp;

const engine = await import("../shadow/shadow_engine.js");
const summaryMod = await import("../shadow/shadow_summary.js");

function signal(overrides = {}) {
  return {
    id: `sig_${Math.random().toString(16).slice(2)}`,
    poolName: "TEST-SOL",
    pool: "Pool111111111111111111111111111111111111",
    action: "SKIP",
    rejection_stage: "wallet_filter",
    risks: ["low_wallet_score"],
    verdict: "UNCLEAR",
    likely_logic_failure: "wallet_filter_too_strict",
    activeBin: 1000,
    lowerBin: 980,
    upperBin: 1020,
    binStep: 25,
    feeTvlRatio: 0.12,
    volatility: 1.5,
    walletScore: 48,
    confidence: 0.72,
    simulated_size_sol: 1,
    ts: "2026-06-04T00:00:00.000Z",
    ...overrides,
  };
}

const created = engine.recordShadowCandidate(signal());
assert.equal(created.recorded, true);
assert.equal(engine.getShadowPositions({ limit: 10 }).length, 1);

const blocked = engine.recordShadowCandidate(signal({
  id: "rug_case",
  risks: ["rug risk tinggi", "low_wallet_score"],
}));
assert.equal(blocked.recorded, false);
assert.match(blocked.reason, /major risk/i);

let update = engine.updateShadowFromMarket(signal({
  id: "market_update",
  activeBin: 1010,
  ts: "2026-06-04T00:30:00.000Z",
}));
assert.equal(update.updated, 1);
let open = engine.getShadowPositions({ status: "OPEN", limit: 1 })[0];
assert.ok(open.pnl_sol > 0);

update = engine.updateShadowFromMarket(signal({
  id: "market_oor",
  activeBin: 1030,
  ts: "2026-06-04T01:00:00.000Z",
}));
assert.equal(update.closed, 1);
const closed = engine.getShadowPositions({ status: "CLOSED", limit: 1 })[0];
assert.equal(closed.out_of_range, true);
assert.equal(closed.verdict, "GOOD_REJECTION");

assert.equal(summaryMod.classifyShadowStatus({
  sampleCount: 99,
  impactRatioPct: 99,
  falseNegativeCount: 99,
  shadowPnlSol: 10,
}), "LEARNING");
assert.equal(summaryMod.classifyShadowStatus({
  sampleCount: 100,
  impactRatioPct: 12,
  falseNegativeCount: 3,
  shadowPnlSol: 1,
}), "WATCH");
assert.equal(summaryMod.classifyShadowStatus({
  sampleCount: 100,
  impactRatioPct: 30,
  falseNegativeCount: 20,
  shadowPnlSol: 1,
}), "CANDIDATE");
assert.equal(summaryMod.classifyShadowStatus({
  sampleCount: 100,
  impactRatioPct: 40,
  falseNegativeCount: 30,
  shadowPnlSol: 0.1,
}), "READY");

const payload = summaryMod.buildShadowPayload({ date: "2026-06-04" });
assert.equal(payload.ok, true);
assert.equal(payload.rules.auto_deploy, false);
assert.equal(payload.rules.auto_learning_to_production, false);
assert.ok(payload.summary.shadow_cases >= 1);

const incomplete = engine.recordShadowCandidate(signal({
  id: "missing_geometry",
  activeBin: null,
  lowerBin: null,
  upperBin: null,
  binStep: null,
  entryPrice: null,
  price: null,
  ts: "2026-06-04T00:00:00.000Z",
}));
assert.equal(incomplete.recorded, true);
const incompleteUpdate = engine.updateShadowFromMarket(signal({
  id: "missing_geometry_update",
  pool: incomplete.position.pool_address,
  activeBin: null,
  price: null,
  ts: "2026-06-04T04:00:00.000Z",
}));
assert.equal(incompleteUpdate.closed, 1);
const incompletePos = engine.getShadowPositions({ limit: 5 }).find((p) => p.id === incomplete.id);
assert.equal(incompletePos.status, "DATA_INCOMPLETE");
assert.equal(incompletePos.verdict, "DATA_INCOMPLETE");

console.log("shadow intelligence smoke test passed");
