/**
 * Master Strategy Database
 *
 * Captures copyable range/timing patterns from high-ranked wallets so the bot
 * can prefer proven DLMM structures instead of blindly mirroring every position.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { config } from "../config.js";
import { log } from "../logger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, "..", "data", "master-strategies.json");
const DEFAULT_MAX_OBSERVATIONS = 1500;

function ensureDir() {
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function readDb() {
  try {
    if (!fs.existsSync(DB_PATH)) {
      return { version: 1, updatedAt: null, observations: [], strategies: [] };
    }
    return JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
  } catch (err) {
    log("strategy_db", `Read error: ${err.message}`);
    return { version: 1, updatedAt: null, observations: [], strategies: [] };
  }
}

function writeDb(db) {
  ensureDir();
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), "utf8");
}

function num(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function median(values) {
  const sorted = values.filter(Number.isFinite).slice().sort((a, b) => a - b);
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function percentile(values, pct) {
  const sorted = values.filter(Number.isFinite).slice().sort((a, b) => a - b);
  if (!sorted.length) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor((pct / 100) * (sorted.length - 1))));
  return sorted[idx];
}

function bucketForObservation(obs) {
  const binStep = num(obs.binStep, 0);
  const feeTvl = num(obs.feeTvlRatio, 0);
  const volatility = num(obs.volatility, 0);
  const pair = String(obs.poolName || obs.poolAddress || "unknown")
    .split(/[-/]/)
    .slice(-1)[0]
    .toUpperCase();
  const binBucket = binStep >= 125 ? "wide" : binStep >= 80 ? "medium" : "tight";
  const feeBucket = feeTvl >= 0.08 ? "high_fee" : feeTvl >= 0.03 ? "mid_fee" : "low_fee";
  const volBucket = volatility >= 6 ? "high_vol" : volatility >= 3 ? "mid_vol" : "low_vol";
  return `${pair}:${binBucket}:${feeBucket}:${volBucket}`;
}

function rebuildStrategies(observations) {
  const minSamples = Number(config.masterStrategy?.minSamples ?? 3);
  const byBucket = new Map();
  for (const obs of observations) {
    const bucket = bucketForObservation(obs);
    if (!byBucket.has(bucket)) byBucket.set(bucket, []);
    byBucket.get(bucket).push(obs);
  }

  return Array.from(byBucket.entries())
    .map(([bucket, items]) => {
      const copied = items.filter((x) => x.action === "COPY");
      const confidence = items.map((x) => num(x.confidence, 0)).filter(Number.isFinite);
      const walletRanks = items.map((x) => num(x.walletRank, 999)).filter(Number.isFinite);
      const binsBelow = items.map((x) => num(x.binsBelow)).filter(Number.isFinite);
      const binsAbove = items.map((x) => num(x.binsAbove)).filter(Number.isFinite);
      const feeTvl = items.map((x) => num(x.feeTvlRatio, 0)).filter(Number.isFinite);
      const volatility = items.map((x) => num(x.volatility, 0)).filter(Number.isFinite);
      const copyRate = items.length ? copied.length / items.length : 0;
      const rankQuality = walletRanks.length ? Math.max(0, 1 - (median(walletRanks) - 1) / 20) : 0;
      const confidenceQuality = confidence.length ? median(confidence) : 0;
      const feeQuality = Math.min(1, (median(feeTvl) || 0) / 0.08);
      const volPenalty = Math.min(0.35, (median(volatility) || 0) * 0.035);
      const qualityScore = Math.round((copyRate * 35 + rankQuality * 25 + confidenceQuality * 25 + feeQuality * 15 - volPenalty * 100) * 100) / 100;

      return {
        id: bucket,
        bucket,
        samples: items.length,
        copyRate: Math.round(copyRate * 1000) / 1000,
        qualityScore: Math.max(0, Math.min(100, qualityScore)),
        recommendedBinsBelow: Math.round(median(binsBelow) ?? config.strategy?.defaultBinsBelow ?? 50),
        recommendedBinsAbove: Math.round(median(binsAbove) ?? 0),
        aggressiveBinsBelow: Math.round(percentile(binsBelow, 35) ?? median(binsBelow) ?? config.strategy?.minBinsBelow ?? 35),
        conservativeBinsBelow: Math.round(percentile(binsBelow, 75) ?? median(binsBelow) ?? config.strategy?.maxBinsBelow ?? 69),
        medianFeeTvlRatio: median(feeTvl),
        medianVolatility: median(volatility),
        updatedAt: new Date().toISOString(),
      };
    })
    .filter((strategy) => strategy.samples >= minSamples)
    .sort((a, b) => b.qualityScore - a.qualityScore);
}

export function buildMasterObservation({ position, walletEntry, decision, signal }) {
  const inferredUpper = num(position.upper_bin ?? position.upperBin ?? position.upper_bin_id);
  const activeBin = num(position.active_bin ?? position.activeBin, inferredUpper);
  const lowerBin = num(position.lower_bin ?? position.lowerBin ?? position.lower_bin_id);
  const upperBin = inferredUpper;
  return {
    ts: new Date().toISOString(),
    wallet: walletEntry?.address || signal?.wallet || null,
    walletRank: num(walletEntry?.rank ?? signal?.walletRank),
    walletScore: num(walletEntry?.score ?? signal?.walletScore),
    poolAddress: position.poolAddress || position.pool || position.pool_address || signal?.pool || null,
    poolName: position.poolName || position.pool_name || signal?.poolName || null,
    position: position.position || signal?.position || null,
    action: signal?.action || decision?.action || "UNKNOWN",
    confidence: num(decision?.confidence ?? signal?.confidence, 0),
    binStep: num(position.binStep ?? position.bin_step),
    activeBin,
    lowerBin,
    upperBin,
    binsBelow: activeBin != null && lowerBin != null ? Math.max(0, activeBin - lowerBin) : null,
    binsAbove: activeBin != null && upperBin != null ? Math.max(0, upperBin - activeBin) : null,
    feeTvlRatio: num(position.feeTvlRatio ?? position.fee_tvl_ratio, 0),
    volatility: num(position.volatility, 0),
    organicScore: num(position.organicScore ?? position.organic_score),
    reasons: decision?.reasons || signal?.reasons || [],
    risks: decision?.risks || signal?.risks || [],
  };
}

export function recordMasterObservation(observation) {
  if (config.masterStrategy?.enabled === false) return null;
  const db = readDb();
  const max = Number(config.masterStrategy?.maxObservations ?? DEFAULT_MAX_OBSERVATIONS);
  const obs = { ...observation, id: `${Date.now()}-${Math.random().toString(16).slice(2)}` };
  db.observations = [obs, ...(db.observations || [])].slice(0, max);
  db.strategies = rebuildStrategies(db.observations);
  db.updatedAt = new Date().toISOString();
  writeDb(db);
  return obs;
}

export function getMasterStrategies(options = {}) {
  const minScore = Number(options.minScore ?? config.masterStrategy?.minQualityScore ?? 55);
  return (readDb().strategies || []).filter((s) => Number(s.qualityScore || 0) >= minScore);
}

export function recommendMasterStrategy(position, options = {}) {
  const observation = buildMasterObservation({ position, walletEntry: {}, decision: {}, signal: {} });
  const bucket = bucketForObservation(observation);
  const strategies = getMasterStrategies(options);
  return strategies.find((s) => s.bucket === bucket) || strategies[0] || null;
}

export function getMasterStrategyDbSummary() {
  const db = readDb();
  return {
    updatedAt: db.updatedAt,
    observations: (db.observations || []).length,
    strategies: (db.strategies || []).length,
    topStrategies: (db.strategies || []).slice(0, 10),
  };
}
