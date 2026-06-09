import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { config } from "../config.js";
import { getAIUsageSummary } from "../ai-budget.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "data");
const CACHE_FILE = path.join(DATA_DIR, "ai_signal_cache.json");
const QUALITY_FILE = path.join(DATA_DIR, "ai_quality.json");

const DEFAULT_CHEAP_MODELS = [
  "openrouter/free",
  "google/gemini-2.0-flash-lite:free",
  "deepseek/deepseek-chat:free",
];

const HIGH_SIGNAL_REGIMES = new Set(["HIGH_VOLATILITY", "TRENDING_UP", "TRENDING_DOWN"]);
const QUIET_REGIMES = new Set(["SIDEWAYS", "LOW_ACTIVITY"]);

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readJSON(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJSON(file, value) {
  ensureDataDir();
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
}

function numeric(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function round(value, decimals = 4) {
  const n = numeric(value);
  if (n == null) return null;
  const factor = 10 ** decimals;
  return Math.round(n * factor) / factor;
}

function normString(value, fallback = "UNKNOWN") {
  const s = String(value ?? "").trim();
  return s ? s.toUpperCase() : fallback;
}

function poolIdFrom(input = {}) {
  if (typeof input.pool === "string" && input.pool.trim()) return input.pool.trim();
  return String(
    input.poolAddress ||
    input.pool_address ||
    input.pool?.pool ||
    input.pool?.pool_address ||
    input.pool?.address ||
    input.pool?.name ||
    input.name ||
    "unknown"
  );
}

export function normalizeAISignal(input = {}) {
  const pool = input.pool || {};
  return {
    pool: poolIdFrom(input),
    confidence: round(input.confidence ?? input.decision_confidence ?? pool.decision_confidence ?? pool.confidence),
    organic: round(input.organic ?? input.organicScore ?? input.organic_score ?? pool.organic_score),
    walletScore: round(input.walletScore ?? input.wallet_score ?? pool.wallet_score ?? pool.smart_wallet_score),
    volatility: round(input.volatility ?? pool.volatility),
    regime: normString(input.regime ?? pool.regime ?? pool.market_regime),
  };
}

export function buildSignalFingerprint(input = {}) {
  const signal = normalizeAISignal(input);
  const canonical = JSON.stringify(signal);
  return crypto.createHash("sha256").update(canonical).digest("hex");
}

function maxSignalDiffPct(a = {}, b = {}) {
  const keys = ["confidence", "organic", "walletScore", "volatility"];
  let maxDiff = 0;
  for (const key of keys) {
    const av = numeric(a[key]);
    const bv = numeric(b[key]);
    if (av == null || bv == null) continue;
    const denom = Math.max(Math.abs(av), Math.abs(bv), 1);
    maxDiff = Math.max(maxDiff, Math.abs(av - bv) / denom);
  }
  return maxDiff;
}

function loadCache() {
  const store = readJSON(CACHE_FILE, { version: 1, entries: [] });
  if (!Array.isArray(store.entries)) store.entries = [];
  return store;
}

function saveCache(store) {
  const now = Date.now();
  const ttlMs = Math.max(60_000, Number(config.aiOptimization?.signalCacheTtlMinutes ?? 15) * 60_000);
  store.entries = (store.entries || [])
    .filter((entry) => entry?.ts && now - new Date(entry.ts).getTime() <= ttlMs * 4)
    .slice(-500);
  writeJSON(CACHE_FILE, store);
}

export function getCachedAIResponse(input = {}) {
  if (config.aiOptimization?.enabled === false || config.aiOptimization?.signalCacheEnabled === false) return null;
  const signal = normalizeAISignal(input);
  if (!signal.pool || signal.pool === "unknown") return null;
  const fingerprint = buildSignalFingerprint(input);
  const ttlMs = Math.max(60_000, Number(config.aiOptimization?.signalCacheTtlMinutes ?? 15) * 60_000);
  const now = Date.now();
  const store = loadCache();
  const hit = [...store.entries].reverse().find((entry) => {
    if (!entry?.response || entry.pool !== signal.pool) return false;
    const age = now - new Date(entry.ts || 0).getTime();
    if (age < 0 || age > ttlMs) return false;
    if (entry.fingerprint === fingerprint) return true;
    if (entry.signal?.regime !== signal.regime) return false;
    return maxSignalDiffPct(entry.signal, signal) <= Number(config.aiOptimization?.signalCacheMaxDiffPct ?? 0.05);
  });
  return hit ? { ...hit.response, cached: true, cache_ts: hit.ts, cache_reason: "signal_fingerprint_ttl" } : null;
}

export function storeAIResponse(input = {}, response = {}) {
  if (config.aiOptimization?.enabled === false || config.aiOptimization?.signalCacheEnabled === false) return false;
  const signal = normalizeAISignal(input);
  if (!signal.pool || signal.pool === "unknown") return false;
  const store = loadCache();
  store.entries.push({
    ts: new Date().toISOString(),
    pool: signal.pool,
    signal,
    fingerprint: buildSignalFingerprint(input),
    response: {
      content: response.content || "",
      model: response.model || null,
      usage: response.usage || {},
    },
  });
  saveCache(store);
  return true;
}

export function getAIBudgetMode({ usage = null, llm = config.llm, optimization = config.aiOptimization } = {}) {
  const summary = usage || getAIUsageSummary();
  const day = summary?.today || {};
  const dailyBudget = Number(llm?.dailyBudgetUsd || 0);
  const configuredMaxCalls = Number(llm?.maxCallsPerDay || 0);
  const targetCalls = Number(optimization?.targetCallsPerDay || 60);
  const maxCalls = configuredMaxCalls > 0
    ? Math.min(configuredMaxCalls, targetCalls)
    : targetCalls;
  const costRemainingPct = dailyBudget > 0
    ? Math.max(0, ((dailyBudget - Number(day.cost_usd || 0)) / dailyBudget) * 100)
    : 100;
  const callRemainingPct = maxCalls > 0
    ? Math.max(0, ((maxCalls - Number(day.calls || 0)) / maxCalls) * 100)
    : 100;
  const remainingPct = Math.min(costRemainingPct, callRemainingPct);
  const criticalPct = Number(optimization?.criticalRemainingPct ?? 30);
  const conservativePct = Number(optimization?.conservativeRemainingPct ?? 70);

  if (optimization?.zeroAiEmergencyMode) {
    return { mode: "ZERO_AI", remainingPct, reason: "zero AI emergency mode enabled", day, maxCalls };
  }
  if (remainingPct < criticalPct) {
    return { mode: "CRITICAL", remainingPct, reason: `AI budget remaining ${remainingPct.toFixed(1)}%`, day, maxCalls };
  }
  if (remainingPct < conservativePct) {
    return { mode: "CONSERVATIVE", remainingPct, reason: `AI budget remaining ${remainingPct.toFixed(1)}%`, day, maxCalls };
  }
  return { mode: "NORMAL", remainingPct, reason: `AI budget remaining ${remainingPct.toFixed(1)}%`, day, maxCalls };
}

export function assessAIEligibility(context = {}) {
  const opt = config.aiOptimization || {};
  if (opt.enabled === false) return { eligible: true, reason: "ai optimization disabled" };
  const hasSignal = context.confidence != null || context.pool || context.poolAddress || context.pool_address;
  const mode = getAIBudgetMode();
  const confidence = numeric(context.confidence ?? context.decision_confidence);
  const low = Number(opt.lowConfidenceSkip ?? 0.45);
  const high = Number(opt.highConfidenceBypass ?? 0.75);
  const regime = normString(context.regime ?? context.pool?.regime ?? context.pool?.market_regime, "");
  const ambiguous = confidence == null ? false : confidence >= low && confidence <= high;

  if (mode.mode === "ZERO_AI") {
    return { eligible: false, deterministicAction: "SKIP", reason: mode.reason, mode };
  }
  if (!hasSignal) {
    return { eligible: true, reason: "no signal context", mode };
  }
  if (confidence != null && confidence < low) {
    return { eligible: false, deterministicAction: "SKIP", reason: `confidence ${confidence.toFixed(3)} < ${low}`, mode };
  }
  if (confidence != null && confidence > high) {
    return { eligible: false, deterministicAction: "COPY", reason: `confidence ${confidence.toFixed(3)} > ${high}`, mode };
  }
  if (QUIET_REGIMES.has(regime) && !ambiguous) {
    return { eligible: false, deterministicAction: "SKIP", reason: `quiet regime ${regime}; no ambiguous signal`, mode };
  }
  if (mode.mode === "CRITICAL" && !ambiguous) {
    return { eligible: false, deterministicAction: "SKIP", reason: `${mode.reason}; non-ambiguous signal bypassed`, mode };
  }
  if (regime && !HIGH_SIGNAL_REGIMES.has(regime) && !ambiguous) {
    return { eligible: false, deterministicAction: "SKIP", reason: `regime ${regime} not AI-worthy without ambiguity`, mode };
  }
  return {
    eligible: true,
    ambiguous,
    reason: ambiguous ? "ambiguous confidence band requires AI" : "AI-worthy market regime",
    mode,
  };
}

export function routeAIModels({ preferredModel = null, agentType = "GENERAL", context = {} } = {}) {
  const opt = config.aiOptimization || {};
  const mode = getAIBudgetMode();
  const cheap = Array.isArray(opt.cheapModels) && opt.cheapModels.length ? opt.cheapModels : DEFAULT_CHEAP_MODELS;
  const premium = Array.isArray(opt.premiumModels) && opt.premiumModels.length ? opt.premiumModels : [preferredModel].filter(Boolean);
  const confidence = numeric(context.confidence ?? context.decision_confidence);
  const low = Number(opt.lowConfidenceSkip ?? 0.45);
  const high = Number(opt.highConfidenceBypass ?? 0.75);
  const ambiguity = confidence == null ? 0 : Math.min(Math.abs(confidence - low), Math.abs(high - confidence));
  const amountSol = numeric(context.amountSol ?? context.deployAmount ?? context.deploy_amount_sol, 0);
  const largeDeploy = amountSol >= Number(opt.premiumDeployAmountSol ?? 1.5);
  const conflictingSignals = Boolean(context.conflictingSignals || context.conflicting_signals);
  const highAmbiguity = confidence != null && confidence >= low && confidence <= high && ambiguity <= 0.08;
  const reviewAgent = ["REVIEWER", "RISK", "MANAGER"].includes(String(agentType).toUpperCase());
  const allowPremium = mode.mode === "NORMAL" && (reviewAgent || highAmbiguity || largeDeploy || conflictingSignals);

  if (allowPremium) return [...new Set([preferredModel, ...premium, ...cheap].filter(Boolean))];
  return [...new Set([...cheap, preferredModel].filter(Boolean))];
}

export function recordAIQualityEvent(event = {}) {
  const store = readJSON(QUALITY_FILE, { version: 1, decisions: [], models: {} });
  const model = String(event.model || "unknown");
  store.models[model] ||= { calls: 0, cached: 0, skipped: 0 };
  store.models[model].calls += event.type === "call" ? 1 : 0;
  store.models[model].cached += event.type === "cache_hit" ? 1 : 0;
  store.models[model].skipped += event.type === "skip" ? 1 : 0;
  store.decisions.push({ ts: new Date().toISOString(), ...event });
  if (store.decisions.length > 500) store.decisions = store.decisions.slice(-500);
  writeJSON(QUALITY_FILE, store);
}

export function getAIOptimizationStatus() {
  const mode = getAIBudgetMode();
  const cache = loadCache();
  const quality = readJSON(QUALITY_FILE, { decisions: [], models: {} });
  return {
    enabled: config.aiOptimization?.enabled !== false,
    mode: mode.mode,
    remainingPct: Math.round(mode.remainingPct * 10) / 10,
    reason: mode.reason,
    effectiveDailyCallCap: mode.maxCalls,
    cacheEntries: cache.entries.length,
    quality: quality.models || {},
    thresholds: {
      lowConfidenceSkip: Number(config.aiOptimization?.lowConfidenceSkip ?? 0.45),
      highConfidenceBypass: Number(config.aiOptimization?.highConfidenceBypass ?? 0.75),
      signalCacheTtlMinutes: Number(config.aiOptimization?.signalCacheTtlMinutes ?? 15),
      targetCallsPerDay: Number(config.aiOptimization?.targetCallsPerDay ?? 60),
    },
  };
}
