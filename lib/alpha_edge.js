import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const DATA_DIR = path.join(ROOT, "data");
const MISSED_PATH = path.join(DATA_DIR, "missed_opportunities.json");
const COPY_STATE_PATH = path.join(ROOT, "copy-signals.json");
const PNL_LOG_PATH = path.join(DATA_DIR, "pnl_log.json");
const POOL_MEMORY_PATH = path.join(ROOT, "pool-memory.json");

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readJSON(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJSON(filePath, data) {
  ensureDir();
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
}

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value));
}

function round(value, places = 2) {
  const m = 10 ** places;
  return Math.round(Number(value || 0) * m) / m;
}

function getPoolMemory(poolAddress) {
  const db = readJSON(POOL_MEMORY_PATH, {});
  return poolAddress ? db[poolAddress] || null : null;
}

function getRecentCopySignals(poolAddress, lookbackMs = 30 * 60_000) {
  const state = readJSON(COPY_STATE_PATH, { signals: [] });
  const now = Date.now();
  return (state.signals || []).filter((s) => {
    const ts = new Date(s.ts || 0).getTime();
    if (!Number.isFinite(ts) || now - ts > lookbackMs) return false;
    return !poolAddress || s.pool === poolAddress || s.deployArgs?.pool_address === poolAddress;
  });
}

export function calculateWalletTimingScore(walletEntry = {}, context = {}) {
  const rank = num(walletEntry.rank, 10);
  const score = num(walletEntry.score, 50);
  const ageHours = num(context.ageHours ?? context.age_hours, null);
  const pnlPct = num(context.pnlPct ?? context.pnl_pct, 0);
  const firstSeenMinutes = num(context.firstSeenMinutes ?? context.minutesSinceFirstCopy, null);
  let timing = 50;
  timing += Math.max(0, 20 - rank * 2);
  timing += Math.max(-15, Math.min(15, (score - 50) * 0.25));
  if (ageHours != null) timing += ageHours <= 2 ? 18 : ageHours <= 8 ? 8 : ageHours > 48 ? -12 : 0;
  if (firstSeenMinutes != null) timing += firstSeenMinutes <= 15 ? 15 : firstSeenMinutes > 90 ? -15 : 0;
  if (pnlPct > 20) timing -= 12;
  if (pnlPct < 5 && pnlPct >= -5) timing += 6;
  return {
    score: Math.round(clamp(timing)),
    boost: round((clamp(timing) - 50) / 500, 4),
    reason: `rank=${rank}, walletScore=${score}, age=${ageHours ?? "?"}h, pnl=${pnlPct}%`,
  };
}

export function calculateCopyCrowdScore(poolAddress, context = {}) {
  const signals = getRecentCopySignals(poolAddress, 30 * 60_000);
  const walletCount = new Set(signals.map((s) => s.wallet).filter(Boolean)).size;
  const firstTs = signals.reduce((min, s) => Math.min(min, new Date(s.ts || Date.now()).getTime()), Date.now());
  const minutesSinceFirst = Math.max(0, (Date.now() - firstTs) / 60000);
  const velocity = minutesSinceFirst > 0 ? walletCount / Math.max(1, minutesSinceFirst / 15) : walletCount;
  const explicitSmartWallets = num(context.smartWalletCount ?? context.smart_wallet_count, 0);
  const count = Math.max(walletCount, explicitSmartWallets);
  const score = clamp(count * 9 + velocity * 10);
  return {
    score: Math.round(score),
    walletCount: count,
    minutesSinceFirst: round(minutesSinceFirst, 1),
    velocity: round(velocity, 2),
    penalty: score >= 90 ? -0.18 : score >= 70 ? -0.10 : score >= 50 ? -0.04 : 0,
    hold: score >= 90 || (count > 7 && minutesSinceFirst <= 15),
    reason: `${count} smart/copy wallet(s), ${round(minutesSinceFirst, 1)}m since first copy`,
  };
}

export function predictLpSurvival(input = {}) {
  const volatility = num(input.volatility, 0);
  const priceAccel = Math.abs(num(input.priceAcceleration ?? input.price_change_pct ?? input.priceChangePct, 0));
  const binStep = Math.max(1, num(input.binStep ?? input.bin_step, 80));
  const lower = num(input.lowerBin ?? input.lower_bin, null);
  const upper = num(input.upperBin ?? input.upper_bin, null);
  const active = num(input.activeBin ?? input.active_bin, null);
  const width = lower != null && upper != null ? Math.max(1, Math.abs(upper - lower)) : Math.max(35, num(input.rangeWidth ?? input.range_width, 60));
  const mem = getPoolMemory(input.poolAddress ?? input.pool_address);
  const history = mem?.deploys || mem?.history || [];
  const oorRate = history.length
    ? history.filter((d) => /out.of.range|oor/i.test(String(d.close_reason || ""))).length / history.length
    : num(input.oorRate, 0);
  const regime = String(input.regime ?? input.marketRegime?.regime ?? "").toUpperCase();
  const regimePenalty = regime.includes("HIGH_VOL") ? 25 : regime.includes("TRENDING") ? 15 : 0;
  const distance = active != null && lower != null && upper != null ? Math.min(Math.abs(active - lower), Math.abs(upper - active)) : width / 2;
  const widthCredit = Math.min(25, width / 4) + Math.min(15, distance / 3);
  const risk = volatility * 8 + priceAccel * 0.6 + (binStep / 100) * 4 + oorRate * 30 + regimePenalty;
  const score = Math.round(clamp(70 + widthCredit - risk));
  const expectedMinutes = Math.max(10, Math.round((score / 100) * 360 * Math.max(0.5, width / 80)));
  return {
    score,
    expectedMinutes,
    expectedHours: round(expectedMinutes / 60, 2),
    penalty: score < 20 ? -0.25 : score < 40 ? -0.15 : score < 55 ? -0.06 : 0,
    hold: score < 20,
    reason: `vol=${volatility}, accel=${priceAccel}, width=${width}, oor=${round(oorRate * 100, 1)}%`,
  };
}

export function calculateEuphoriaScore(input = {}) {
  const priceAccel = Math.max(0, num(input.priceAcceleration ?? input.price_change_pct ?? input.priceChangePct, 0));
  const volumeChange = Math.max(0, num(input.volumeChangePct ?? input.volume_change_pct, 0));
  const organic = num(input.organicScore ?? input.organic_score, 0);
  const organicSpike = Math.max(0, organic - 85);
  const athPct = Math.max(0, num(input.athPct ?? input.price_vs_ath_pct, 0));
  const crowdScore = num(input.crowdScore, 0);
  const score = clamp(priceAccel * 0.7 + volumeChange * 0.25 + organicSpike * 1.2 + Math.max(0, athPct - 70) * 0.7 + crowdScore * 0.35);
  return {
    score: Math.round(score),
    penalty: score >= 90 ? -0.25 : score >= 80 ? -0.15 : score >= 65 ? -0.07 : 0,
    hold: score >= 90,
    reason: `priceAccel=${priceAccel}, volumeChange=${volumeChange}, organic=${organic}, ath=${athPct}, crowd=${crowdScore}`,
  };
}

export function calculateProfitExpectancy(input = {}) {
  const feeTvl = num(input.feeTvlRatio ?? input.fee_tvl_ratio, 0);
  const survivalHours = num(input.survival?.expectedHours, 1);
  const volatility = num(input.volatility, 0);
  const binStep = num(input.binStep ?? input.bin_step, 80);
  const expectedFeePct = feeTvl * Math.max(1, survivalHours * 12) * 100;
  const ilRiskPct = volatility * 0.8 + (binStep / 100) * 0.4 + Math.max(0, 3 - survivalHours) * 0.8;
  const expectancyPct = expectedFeePct - ilRiskPct;
  const score = Math.round(clamp(50 + expectancyPct * 8));
  return {
    score,
    expectancyPct: round(expectancyPct, 2),
    positive: expectancyPct > 0,
    reason: `fee=${round(expectedFeePct, 2)}%, ilRisk=${round(ilRiskPct, 2)}%`,
  };
}

export function calculateWalletClusterScore(poolAddress, wallet) {
  const signals = getRecentCopySignals(poolAddress, 60 * 60_000);
  const wallets = new Set(signals.map((s) => s.wallet).filter(Boolean));
  if (wallet) wallets.add(wallet);
  const count = wallets.size;
  const score = Math.round(clamp(count * 12));
  return {
    score,
    walletCount: count,
    boost: count >= 3 && count <= 7 ? 0.10 : count >= 2 ? 0.04 : 0,
    reason: `${count} wallet(s) in recent cluster`,
  };
}

export function evaluateAlphaEdge(input = {}) {
  const poolAddress = input.poolAddress ?? input.pool_address;
  const walletTiming = calculateWalletTimingScore(input.walletEntry || {}, input);
  const crowd = calculateCopyCrowdScore(poolAddress, input);
  const survival = predictLpSurvival(input);
  const euphoria = calculateEuphoriaScore({ ...input, crowdScore: crowd.score });
  const cluster = calculateWalletClusterScore(poolAddress, input.walletEntry?.address ?? input.source_wallet);
  const expectancy = calculateProfitExpectancy({ ...input, survival });
  let confidenceAdjustment = walletTiming.boost + crowd.penalty + survival.penalty + euphoria.penalty + cluster.boost;
  if (!expectancy.positive) confidenceAdjustment -= 0.08;
  const alphaScore = clamp(
    walletTiming.score * 0.18 +
    (100 - crowd.score) * 0.14 +
    survival.score * 0.24 +
    (100 - euphoria.score) * 0.18 +
    expectancy.score * 0.18 +
    cluster.score * 0.08
  );
  const holdReasons = [];
  if (crowd.hold) holdReasons.push("copy_saturation");
  if (survival.hold) holdReasons.push("low_survival");
  if (euphoria.hold) holdReasons.push("euphoria_trap");
  if (!expectancy.positive && expectancy.score < 40) holdReasons.push("negative_expectancy");
  return {
    action: holdReasons.length ? "HOLD" : "PASS",
    confidenceAdjustment: round(confidenceAdjustment, 4),
    alphaScore: Math.round(alphaScore),
    alphaRank: alphaScore >= 85 ? "A+" : alphaScore >= 75 ? "A" : alphaScore >= 65 ? "B" : alphaScore >= 50 ? "C" : "D",
    walletTiming,
    crowd,
    survival,
    euphoria,
    cluster,
    expectancy,
    holdReasons,
  };
}

export function recordMissedOpportunity(signal = {}) {
  const store = readJSON(MISSED_PATH, { version: 1, opportunities: [] });
  store.opportunities.push({
    ts: new Date().toISOString(),
    pool: signal.pool ?? signal.poolAddress ?? signal.deployArgs?.pool_address ?? null,
    poolName: signal.poolName ?? signal.deployArgs?.pool_name ?? null,
    wallet: signal.wallet ?? null,
    confidence: signal.confidence ?? null,
    alpha: signal.alpha ?? signal.alphaEdge ?? null,
    reasonSkipped: signal.reason ?? signal.reasons?.join("; ") ?? signal.action ?? "skipped",
    actualPnl: null,
    status: "pending",
  });
  store.opportunities = store.opportunities.slice(-500);
  writeJSON(MISSED_PATH, store);
  return store.opportunities.at(-1);
}

export function getMissedOpportunities(limit = 50) {
  const store = readJSON(MISSED_PATH, { version: 1, opportunities: [] });
  return (store.opportunities || []).slice().reverse().slice(0, limit);
}

export function updateMissedOpportunitiesFromTrades() {
  const store = readJSON(MISSED_PATH, { version: 1, opportunities: [] });
  const trades = readJSON(PNL_LOG_PATH, { trades: [] }).trades || [];
  for (const opp of store.opportunities || []) {
    if (opp.status !== "pending" || !opp.pool) continue;
    const match = trades.find((t) => t.pool_address === opp.pool && (t.status === "closed" || t.close_time));
    if (match) {
      opp.actualPnl = match.pnl_pct ?? match.pnl_sol ?? match.pnl_usd ?? null;
      opp.status = "observed";
      opp.observedAt = new Date().toISOString();
    }
  }
  writeJSON(MISSED_PATH, store);
  return store;
}

