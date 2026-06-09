import assert from "assert";
import {
  calculateConviction,
  calculatePositionSize,
  calculateExecutionState,
  calculateRiskReward,
  enrichExecutionIntelligence,
} from "../lib/execution_intelligence.js";

// ── Test fixtures ──────────────────────────────────────────────────────────────
const BLOCKED_ROI = {
  status: { label: "BLOCKED" },
  blockers: { blockedReasons: ["rug detected"] },
  wallet: { adjustedScore: 30 },
  confidence: { total: 0.2 },
  feeTvl: { value: 0.01 },
  organicTrend: { state: "FLAT" },
  alpha: { state: "" },
};

const AVOID_ROI = {
  status: { label: "ACTIVE" },
  blockers: { blockedReasons: [] },
  wallet: { adjustedScore: 40 },
  confidence: { total: 0.3 },
  feeTvl: { value: 0.02 },
  organicTrend: { state: "FLAT" },
  alpha: { state: "AVOID" },
};

const NORMAL_ROI = {
  status: { label: "ACTIVE" },
  blockers: { blockedReasons: [] },
  wallet: { adjustedScore: 70 },
  confidence: { total: 0.75 },
  feeTvl: { value: 0.08 },
  organicTrend: { state: "ACCELERATING" },
  alpha: { state: "PASS" },
};

const NORMAL_POOL = { walletScore: 70, organic: 75, volatility: 3 };
const OFFENSIVE = { edgeScore: { score: 80 } };

// ── Test 1: STRICT mode — blocked ROI returns NO TRADE ─────────────────────────
{
  const conviction = calculateConviction(NORMAL_POOL, BLOCKED_ROI, OFFENSIVE);
  assert.strictEqual(conviction.state, "NO TRADE");
  assert.strictEqual(conviction.tone, "blocked");
  assert.strictEqual(conviction.score, 0);
  console.log("✅ Test 1 PASSED: STRICT mode returns NO TRADE for blocked ROI");
}

// ── Test 2: ADVISORY mode — blocked ROI returns LOW with advisory flag ─────────
{
  const conviction = calculateConviction(NORMAL_POOL, BLOCKED_ROI, OFFENSIVE, undefined, { advisoryMode: true });
  assert.strictEqual(conviction.state, "LOW");
  assert.strictEqual(conviction.advisory, true);
  assert.ok(conviction.warnings.length > 0);
  assert.ok(conviction.score > 0);
  console.log("✅ Test 2 PASSED: ADVISORY mode returns LOW with advisory flag for blocked ROI");
}

// ── Test 3: STRICT mode — blocked position size returns 0% ─────────────────────
{
  const conviction = calculateConviction(NORMAL_POOL, BLOCKED_ROI, OFFENSIVE);
  const size = calculatePositionSize(conviction, BLOCKED_ROI);
  assert.strictEqual(size.suggestedPct, 0);
  assert.strictEqual(size.label, "0%");
  console.log("✅ Test 3 PASSED: STRICT mode returns 0% for blocked pool");
}

// ── Test 4: ADVISORY mode — blocked position size returns small test ───────────
{
  const conviction = calculateConviction(NORMAL_POOL, BLOCKED_ROI, OFFENSIVE, undefined, { advisoryMode: true });
  const size = calculatePositionSize(conviction, BLOCKED_ROI, undefined, { advisoryMode: true });
  assert.ok(size.suggestedPct > 0, "advisory mode should suggest > 0%");
  assert.strictEqual(size.advisory, true);
  assert.ok(size.reason.includes("advisory"));
  console.log("✅ Test 4 PASSED: ADVISORY mode returns small test position for blocked pool");
}

// ── Test 5: STRICT mode — blocked execution state returns NO ENTRY ─────────────
{
  const conviction = calculateConviction(NORMAL_POOL, BLOCKED_ROI, OFFENSIVE);
  const size = calculatePositionSize(conviction, BLOCKED_ROI);
  const state = calculateExecutionState(conviction, size, BLOCKED_ROI, OFFENSIVE);
  assert.strictEqual(state.state, "NO ENTRY");
  assert.strictEqual(state.tone, "blocked");
  console.log("✅ Test 5 PASSED: STRICT mode returns NO ENTRY for blocked pool");
}

// ── Test 6: ADVISORY mode — blocked execution state returns ADVISORY_ONLY ──────
{
  const conviction = calculateConviction(NORMAL_POOL, BLOCKED_ROI, OFFENSIVE, undefined, { advisoryMode: true });
  const size = calculatePositionSize(conviction, BLOCKED_ROI, undefined, { advisoryMode: true });
  const state = calculateExecutionState(conviction, size, BLOCKED_ROI, OFFENSIVE, { advisoryMode: true });
  assert.strictEqual(state.state, "ADVISORY_ONLY");
  assert.strictEqual(state.advisory, true);
  assert.strictEqual(state.recommendedAction, "SMALL_TEST_POSITION");
  console.log("✅ Test 6 PASSED: ADVISORY mode returns ADVISORY_ONLY with recommendedAction");
}

// ── Test 7: STRICT mode — blocked risk/reward returns NO TRADE ─────────────────
{
  const conviction = calculateConviction(NORMAL_POOL, BLOCKED_ROI, OFFENSIVE);
  const rr = calculateRiskReward(NORMAL_POOL, BLOCKED_ROI, OFFENSIVE, conviction);
  assert.strictEqual(rr.label, "NO TRADE");
  assert.strictEqual(rr.rr, 0);
  console.log("✅ Test 7 PASSED: STRICT mode returns NO TRADE risk/reward for blocked pool");
}

// ── Test 8: ADVISORY mode — blocked risk/reward still projects ─────────────────
{
  const conviction = calculateConviction(NORMAL_POOL, BLOCKED_ROI, OFFENSIVE, undefined, { advisoryMode: true });
  const rr = calculateRiskReward(NORMAL_POOL, BLOCKED_ROI, OFFENSIVE, conviction, { advisoryMode: true });
  assert.ok(rr.label !== "NO TRADE", "advisory mode should project risk/reward");
  assert.strictEqual(rr.advisory, true);
  assert.ok(rr.expectedRiskPct < 0, "risk should be negative");
  assert.ok(rr.expectedRewardPct > 0, "reward should be positive");
  console.log("✅ Test 8 PASSED: ADVISORY mode projects risk/reward for blocked pool");
}

// ── Test 9: NORMAL pool — both modes return same results ───────────────────────
{
  const strict = calculateConviction(NORMAL_POOL, NORMAL_ROI, OFFENSIVE);
  const advisory = calculateConviction(NORMAL_POOL, NORMAL_ROI, OFFENSIVE, undefined, { advisoryMode: true });
  assert.strictEqual(strict.state, advisory.state, "normal pools should have same conviction in both modes");
  assert.strictEqual(strict.score, advisory.score, "normal pools should have same score in both modes");
  console.log("✅ Test 9 PASSED: Normal pool identical in STRICT and ADVISORY modes");
}

// ── Test 10: enrichExecutionIntelligence with advisory mode ────────────────────
{
  const result = enrichExecutionIntelligence(NORMAL_POOL, BLOCKED_ROI, OFFENSIVE, undefined, { advisoryMode: true });
  assert.ok(result.executionState.state === "ADVISORY_ONLY", "execution state should be ADVISORY_ONLY");
  assert.ok(result.advisoryLog !== null, "advisoryLog should be present");
  assert.strictEqual(result.advisoryLog.event, "execution_intelligence_advisory_override");
  assert.strictEqual(result.advisoryLog.mode, "advisory");
  console.log("✅ Test 10 PASSED: enrichExecutionIntelligence returns advisoryLog in advisory mode");
}

// ── Test 11: enrichExecutionIntelligence without advisory mode — no advisoryLog ─
{
  const result = enrichExecutionIntelligence(NORMAL_POOL, BLOCKED_ROI, OFFENSIVE);
  assert.strictEqual(result.advisoryLog, null, "advisoryLog should be null in strict mode");
  console.log("✅ Test 11 PASSED: No advisoryLog in strict mode");
}

// ── Test 12: DEFAULT mode (missing config) falls back to strict ────────────────
{
  const conviction = calculateConviction(NORMAL_POOL, BLOCKED_ROI, OFFENSIVE);
  assert.strictEqual(conviction.state, "NO TRADE");
  console.log("✅ Test 12 PASSED: Default (no advisoryMode) behaves as strict");
}

console.log("\n🎉 All 12 regression tests passed!");
