import assert from "assert/strict";
import fs from "fs";
import os from "os";
import path from "path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "meridian-anti-oor-"));
process.env.MERIDIAN_ANTI_OOR_QUEUE_DIR = tmp;

const anti = await import("../lib/anti_oor_intelligence.js");
const queue = await import("../lib/anti_oor_recheck_queue.js");
const edge = await import("../strategy/dlmm-edge.js");

function closedOor(overrides = {}) {
  return {
    status: "closed",
    close_time: "2026-06-05T00:00:00.000Z",
    deploy_time: "2026-06-04T23:50:00.000Z",
    close_reason: "paper out-of-range above",
    exit_side: "above",
    exit_bin: 110,
    upper_bin: 100,
    lower_bin: 60,
    bins_below: 40,
    bins_above: 0,
    minutes_out_of_range: 5,
    pnl_pct: -0.4,
    fee_tvl_ratio: 1.1,
    ...overrides,
  };
}

const trades = [
  closedOor(),
  closedOor({ exit_bin: 112 }),
  closedOor({ exit_bin: 114 }),
];
const payload = anti.buildAntiOorPayload({
  trades,
  candidate: {
    active_bin: 100,
    lower_bin: 60,
    upper_bin: 100,
    bins_below: 40,
    bins_above: 0,
    volatility: 2,
  },
});

assert.equal(payload.momentumEscape.state, "MOMENTUM_BREAKOUT_UP");
assert.equal(payload.dynamicRangeWidth.recommendation, "WIDEN_AND_SHIFT_UP");
assert.equal(payload.oorPrediction.oorRisk, "CRITICAL");

const rangeAction = edge.evaluateAntiOorRangeAdaptation({
  bins_below: 40,
  bins_above: 0,
}, payload, {
  isSingleSidedSol: true,
  minBinsBelow: 35,
  maxBinsBelow: 69,
});

assert.equal(rangeAction.legal, false);
assert.equal(rangeAction.final_range_action, "SHIFT_UP_NOT_SUPPORTED_FOR_SINGLE_SIDE_SOL");
assert.equal(rangeAction.bins_above, 0);

const queued = queue.queueAntiOorRecheck({
  pool_address: "PoolRange111111111111111111111111111111111",
  pool_name: "RANGE-SOL",
  active_bin: 100,
  lower_bin: 60,
  upper_bin: 100,
  bins_below: 40,
  bins_above: 0,
}, payload, {
  now: "2026-06-05T00:00:00.000Z",
  waitMinutes: 5,
  finalRangeAction: rangeAction.final_range_action,
  shiftUpLegal: rangeAction.legal,
});

assert.equal(queued.queued, true);
assert.equal(queue.getAntiOorRecheckQueue({ status: "WAITING" }).length, 1);
assert.equal(queue.getAntiOorRecheckQueue({ status: "WAITING", dueOnly: true, now: "2026-06-05T00:04:59.000Z" }).length, 0);
assert.equal(queue.getAntiOorRecheckQueue({ status: "WAITING", dueOnly: true, now: "2026-06-05T00:05:01.000Z" }).length, 1);

queue.updateAntiOorRecheck(queued.id, {
  status: "RECHECKED",
  recheck_result: "STILL_CRITICAL",
});
const summary = queue.summarizeAntiOorRecheckQueue();
assert.equal(summary.rechecked, 1);
assert.equal(summary.still_critical, 1);

console.log("anti-oor range smoke test passed");
