import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "meridian-intelligence-"));
process.env.MERIDIAN_INTELLIGENCE_DIR = tempDir;

const { evaluateAntiOorRangeAdaptation } = await import("../strategy/dlmm-edge.js");
const { appendStrategyConflict } = await import("../lib/intelligence_ledger.js");

const rangeAction = evaluateAntiOorRangeAdaptation(
  { bins_below: 45, bins_above: 0 },
  { dynamicRangeWidth: { recommendation: "WIDEN_AND_SHIFT_UP", widthMultiplier: 1.4 } },
  { isSingleSidedSol: true, minBinsBelow: 35, maxBinsBelow: 69 },
);

assert.equal(rangeAction.legal, false);
assert.equal(rangeAction.final_range_action, "SHIFT_UP_NOT_SUPPORTED_FOR_SINGLE_SIDE_SOL");
assert.equal(rangeAction.bins_above, 0);

appendStrategyConflict({
  pool: "test-SOL",
  executor_action: "BLOCK",
  final_decision: "REJECT",
  conflict: true,
  prevented_oor_above: true,
});

const conflictPath = path.join(tempDir, "strategy_conflict_report.jsonl");
assert.equal(fs.existsSync(conflictPath), true);
const conflict = JSON.parse(fs.readFileSync(conflictPath, "utf8").trim());
assert.equal(conflict.executor_action, "BLOCK");
assert.equal(conflict.prevented_oor_above, true);

console.log("phase1 hard-block tests passed");
