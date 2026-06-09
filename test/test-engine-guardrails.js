import assert from "node:assert/strict";
import { validateTrainingRecord } from "../lib/training_record.js";
import { buildTradeRecommendation } from "../lib/recommendation_engine.js";

const dummy = validateTrainingRecord({
  pool: "pool_a",
  pool_name: "pool_a",
  pnl_pct: 4.8,
  recorded_at: new Date().toISOString(),
  volatility: 1.2,
});
assert.equal(dummy.ok, false);
assert.equal(dummy.reason, "dummy_record");

const valid = validateTrainingRecord({
  pool: "real_pool_1",
  pool_name: "REAL-SOL",
  pnl_pct: 3.1,
  recorded_at: new Date().toISOString(),
  volatility: 1.8,
  fee_tvl_ratio: 0.04,
});
assert.equal(valid.ok, true);

const buy = buildTradeRecommendation(
  {
    fee_active_tvl_ratio: 0.05,
    organic_score: 88,
    active_pct: 72,
    volatility: 2.1,
    smart_money_buy: true,
  },
  { score: 76, grade: "A" },
);
assert.equal(buy.action, "BUY");
assert.equal(buy.manual_only, true);
assert.equal(buy.auto_buy_allowed, false);

const danger = buildTradeRecommendation({ is_wash: true }, { score: 95 });
assert.equal(danger.action, "DANGER");
assert.equal(danger.auto_buy_allowed, false);

console.log("engine guardrail tests passed");
