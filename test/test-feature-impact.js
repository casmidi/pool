import assert from "assert";
import fs from "fs";
import os from "os";
import path from "path";
import {
  buildFeatureImpactPayload,
  estimateCounterfactual,
  recordFeatureImpactEvent,
  updateFeatureImpactAnalytics,
} from "../lib/feature_impact.js";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "meridian-feature-impact-"));
const paths = {
  featureImpact: path.join(tmp, "feature_impact.json"),
  copySignals: path.join(tmp, "copy-signals.json"),
  missed: path.join(tmp, "missed_opportunities.json"),
  pnl: path.join(tmp, "pnl_log.json"),
  replay: path.join(tmp, "trade_replay.json"),
  decisions: path.join(tmp, "decision-log.json"),
};

function write(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2), "utf8");
}

write(paths.copySignals, {
  signals: [{
    ts: "2026-06-01T00:00:00.000Z",
    pool: "POOL_PASS",
    poolName: "PASS-SOL",
    confidence: 0.74,
    organicScore: 82,
    alphaEdge: {
      action: "PASS",
      alphaRank: "A",
      euphoria: { score: 20, reason: "calm" },
      survival: { score: 72, reason: "stable" },
      crowd: { score: 32, reason: "not crowded" },
      walletTiming: { score: 80, reason: "early" },
    },
  }],
  ignored: [{
    ts: "2026-06-01T00:10:00.000Z",
    pool: "POOL_BLOCK",
    poolName: "BLOCK-SOL",
    confidence: 0.62,
    organicScore: 88,
    reason: "Alpha edge hold: euphoria_trap, copy_saturation",
    alphaEdge: {
      action: "HOLD",
      alphaRank: "D",
      holdReasons: ["euphoria_trap", "copy_saturation"],
      euphoria: { score: 95, reason: "priceAccel=40" },
      survival: { score: 61, reason: "ok" },
      crowd: { score: 94, reason: "too many wallets" },
      walletTiming: { score: 45, reason: "late" },
    },
  }],
});
write(paths.missed, { version: 1, opportunities: [] });
write(paths.pnl, {
  trades: [{
    pool_address: "POOL_BLOCK",
    status: "closed",
    pnl_pct: -8.2,
    close_time: "2026-06-01T01:00:00.000Z",
  }],
});
write(paths.replay, { version: 1, trades: [] });
write(paths.decisions, {
  decisions: [{
    ts: "2026-06-01T00:20:00.000Z",
    pool: "POOL_AI",
    summary: "Hybrid review",
    reason: "Claude rejected: volatile pool",
  }],
});

updateFeatureImpactAnalytics(paths);
assert.ok(fs.existsSync(paths.featureImpact), "analytics file should be created");

let store = JSON.parse(fs.readFileSync(paths.featureImpact, "utf8"));
assert.ok(store.entries.some((e) => e.feature === "anti_euphoria" && e.decision === "BLOCKED"));
assert.ok(store.entries.some((e) => e.feature === "crowding" && e.decision === "BLOCKED"));
assert.ok(store.entries.some((e) => e.feature === "ai_reviewer" && e.decision === "BLOCKED"));
assert.ok(store.entries.every((e) => e.decision !== "BLOCKED" || e.estimatedCounterfactual), "blocked entries get counterfactuals");

const counterfactual = estimateCounterfactual(
  { pool: "POOL_BLOCK", confidence: 0.62, alphaRank: "D", decision: "BLOCKED" },
  { trades: JSON.parse(fs.readFileSync(paths.pnl, "utf8")).trades, replay: [] },
);
assert.equal(counterfactual.estimatedPnl, -8.2, "pool historical pnl should drive saved estimate");

const payload = buildFeatureImpactPayload(paths);
const euphoria = payload.features.find((f) => f.id === "anti_euphoria");
assert.ok(euphoria.blockedCount >= 1);
assert.ok(euphoria.estimatedSavedPct > 0, "lossy counterfactual should count as saved");
assert.ok(payload.summary);

const oversized = [];
for (let i = 0; i < 10050; i++) {
  oversized.push({
    pool: `POOL_${i}`,
    feature: "organic_gate",
    decision: i % 2 ? "PASSED" : "BLOCKED",
    timestamp: `2026-06-02T00:${String(i % 60).padStart(2, "0")}:00.000Z`,
  });
}
write(paths.featureImpact, { version: 1, entries: oversized, updatedAt: null });
recordFeatureImpactEvent({
  pool: "POOL_ROLLING",
  feature: "organic_gate",
  decision: "PASSED",
  timestamp: "2026-06-02T01:00:00.000Z",
}, paths);
store = JSON.parse(fs.readFileSync(paths.featureImpact, "utf8"));
assert.ok(store.entries.length <= 10000, "rolling store should cap at 10000 entries");

const pnlAfter = JSON.parse(fs.readFileSync(paths.pnl, "utf8"));
assert.deepEqual(pnlAfter.trades[0].pnl_pct, -8.2, "analytics must not mutate trading logs");

console.log("test-feature-impact ok");
