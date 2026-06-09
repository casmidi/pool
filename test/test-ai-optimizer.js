import assert from "assert";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  assessAIEligibility,
  buildSignalFingerprint,
  getCachedAIResponse,
  normalizeAISignal,
  routeAIModels,
  storeAIResponse,
} from "../lib/ai_optimizer.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cacheFile = path.join(__dirname, "..", "data", "ai_signal_cache.json");
const originalCache = fs.existsSync(cacheFile) ? fs.readFileSync(cacheFile, "utf8") : null;

try {
  fs.writeFileSync(cacheFile, JSON.stringify({ version: 1, entries: [] }, null, 2));

  const low = assessAIEligibility({
    poolAddress: "POOL_LOW",
    confidence: 0.31,
    regime: "TRENDING_UP",
  });
  assert.equal(low.eligible, false);
  assert.equal(low.deterministicAction, "SKIP");

  const high = assessAIEligibility({
    poolAddress: "POOL_HIGH",
    confidence: 0.91,
    regime: "TRENDING_UP",
  });
  assert.equal(high.eligible, false);
  assert.equal(high.deterministicAction, "COPY");

  const ambiguous = assessAIEligibility({
    poolAddress: "POOL_MID",
    confidence: 0.61,
    regime: "SIDEWAYS",
  });
  assert.equal(ambiguous.eligible, true);
  assert.equal(ambiguous.ambiguous, true);

  const signalA = normalizeAISignal({
    poolAddress: "POOL_X",
    confidence: 0.6,
    organic: 82.123456,
    walletScore: 74,
    volatility: 2.51,
    regime: "trending_up",
  });
  const signalB = normalizeAISignal({
    poolAddress: "POOL_X",
    confidence: 0.6,
    organic: 82.123456,
    walletScore: 74,
    volatility: 2.51,
    regime: "TRENDING_UP",
  });
  assert.deepEqual(signalA, signalB);
  assert.equal(buildSignalFingerprint(signalA), buildSignalFingerprint(signalB));

  storeAIResponse(signalA, { content: "{\"decision\":\"APPROVE\"}", model: "openrouter/free" });
  const cached = getCachedAIResponse({
    ...signalA,
    organic: 83,
  });
  assert.equal(cached.cached, true);
  assert.match(cached.content, /APPROVE/);

  const routed = routeAIModels({
    preferredModel: "anthropic/claude-haiku-4.5",
    agentType: "SCREENER",
    context: { confidence: 0.62, amountSol: 0.5 },
  });
  assert.equal(routed[0], "openrouter/free");

  console.log("test-ai-optimizer ok");
} finally {
  if (originalCache == null) {
    try { fs.unlinkSync(cacheFile); } catch {}
  } else {
    fs.writeFileSync(cacheFile, originalCache);
  }
}
