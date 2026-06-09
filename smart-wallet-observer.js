import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "data");

const PATHS = {
  output: path.join(DATA_DIR, "smart_wallet_observer.json"),
  pnlLog: path.join(DATA_DIR, "pnl_log.json"),
  copySignals: path.join(__dirname, "copy-signals.json"),
  rankingDb: path.join(__dirname, "ranking-db.json"),
  smartWallets: path.join(__dirname, "smart-wallets.json"),
};

const INTERVAL_MS = Number(process.env.SMART_WALLET_OBSERVER_INTERVAL_MS || 15 * 60 * 1000);

function readJSON(filePath, fallback = {}) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJSON(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function shortAddress(address = "") {
  const s = String(address || "");
  if (s.length <= 12) return s || "UNKNOWN";
  return `${s.slice(0, 6)}...${s.slice(-4)}`;
}

function blankWallet(address, source = "unknown") {
  return {
    address,
    short: shortAddress(address),
    source,
    samples: 0,
    wins: 0,
    losses: 0,
    open: 0,
    pnlSol: 0,
    pnlUsd: 0,
    avgPnlPct: 0,
    winRate: 0,
    profitFactor: 0,
    pools: {},
    lastSeen: null,
    score: null,
    grade: null,
    tags: [],
  };
}

function upsert(map, address, source = "unknown") {
  const key = String(address || "").trim();
  if (!key) return null;
  if (!map.has(key)) map.set(key, blankWallet(key, source));
  const item = map.get(key);
  if (item.source === "unknown" && source !== "unknown") item.source = source;
  return item;
}

function observeTradeWallets(map, trades = []) {
  for (const trade of trades) {
    const address = trade.source_wallet || trade.sourceWallet || trade.deployArgs?.source_wallet;
    const item = upsert(map, address, "pnl_log");
    if (!item) continue;

    const status = String(trade.status || "").toLowerCase();
    const pnlSol = num(trade.pnl_sol ?? trade.pnlSol, 0);
    const pnlUsd = num(trade.pnl_usd ?? trade.pnlUsd, 0);
    const pnlPct = num(trade.pnl_pct ?? trade.pnlPct, 0);
    const closed = status === "closed" || trade.close_time || trade.closeTime;
    const pool = trade.pool_name || trade.pool || trade.poolName || trade.deployArgs?.pool_name;
    const seen = trade.close_time || trade.closeTime || trade.deploy_time || trade.deployTime || null;

    item.samples += closed ? 1 : 0;
    item.open += closed ? 0 : 1;
    if (closed && pnlSol > 0) item.wins += 1;
    if (closed && pnlSol < 0) item.losses += 1;
    item.pnlSol += closed ? pnlSol : 0;
    item.pnlUsd += closed ? pnlUsd : 0;
    item.avgPnlPct += closed ? pnlPct : 0;
    item.score = trade.source_wallet_score ?? trade.sourceWalletScore ?? trade.deployArgs?.wallet_score ?? item.score;
    item.grade = trade.source_wallet_grade ?? trade.sourceWalletGrade ?? item.grade;
    if (pool) item.pools[pool] = (item.pools[pool] || 0) + 1;
    if (seen && (!item.lastSeen || new Date(seen) > new Date(item.lastSeen))) item.lastSeen = seen;
  }
}

function observeCopySignals(map, copy = {}) {
  const all = [...(copy.signals || []), ...(copy.ignored || [])];
  for (const signal of all) {
    const address = signal.source_wallet || signal.wallet || signal.deployArgs?.source_wallet;
    const item = upsert(map, address, "copy_signals");
    if (!item) continue;
    item.score = signal.walletScore ?? signal.wallet_score ?? signal.deployArgs?.wallet_score ?? item.score;
    item.grade = signal.walletGrade ?? signal.wallet_grade ?? signal.deployArgs?.wallet_grade ?? item.grade;
    const pool = signal.poolName || signal.pool_name || signal.deployArgs?.pool_name;
    if (pool) item.pools[pool] = (item.pools[pool] || 0) + 1;
    const seen = signal.ts || signal.createdAt || signal.deployArgs?.ts || copy.meta?.lastRun || null;
    if (seen && (!item.lastSeen || new Date(seen) > new Date(item.lastSeen))) item.lastSeen = seen;
  }
}

function observeRankingDb(map, ranking = {}) {
  for (const wallet of Object.values(ranking.wallets || {})) {
    const item = upsert(map, wallet.address, "ranking_db");
    if (!item) continue;
    const metrics = wallet.lastMetrics || {};
    item.score = metrics.score ?? item.score;
    item.winRate = num(metrics.winRate, item.winRate);
    item.pnlUsd += num(metrics.pnl7d ?? metrics.pnl30d, 0);
    item.profitFactor = num(metrics.profitFactor, item.profitFactor);
    item.tags = [...new Set([...(item.tags || []), ...(wallet.tags || [])])];
    if (wallet.lastSeen && (!item.lastSeen || new Date(wallet.lastSeen) > new Date(item.lastSeen))) {
      item.lastSeen = wallet.lastSeen;
    }
  }
  for (const snapshot of ranking.snapshots || []) {
    for (const entry of snapshot.entries || []) {
      const item = upsert(map, entry.address, "ranking_snapshot");
      if (!item) continue;
      item.score = entry.score ?? item.score;
      item.grade = entry.grade ?? item.grade;
      item.winRate = num(entry.winRate, item.winRate);
      item.pnlUsd += num(entry.pnl7d ?? entry.pnl30d, 0);
      if (snapshot.ts && (!item.lastSeen || new Date(snapshot.ts) > new Date(item.lastSeen))) item.lastSeen = snapshot.ts;
    }
  }
}

function observeManualSmartWallets(map, manual = {}) {
  for (const wallet of manual.wallets || []) {
    const item = upsert(map, wallet.address, "manual_smart_wallets");
    if (!item) continue;
    item.name = wallet.name || item.name;
    item.category = wallet.category || item.category;
    item.type = wallet.type || item.type;
    item.tags = [...new Set([...(item.tags || []), wallet.category, wallet.type].filter(Boolean))];
    if (wallet.addedAt && (!item.lastSeen || new Date(wallet.addedAt) > new Date(item.lastSeen))) item.lastSeen = wallet.addedAt;
  }
}

function finalizeWallet(item) {
  const closed = item.samples;
  item.pnlSol = Math.round(item.pnlSol * 10000) / 10000;
  item.pnlUsd = Math.round(item.pnlUsd * 100) / 100;
  item.winRate = closed > 0 ? Math.round((item.wins / closed) * 1000) / 10 : Math.round(num(item.winRate, 0) * 10) / 10;
  item.avgPnlPct = closed > 0 ? Math.round((item.avgPnlPct / closed) * 100) / 100 : 0;
  const grossWin = Math.max(0, item.pnlSol);
  const grossLoss = Math.abs(Math.min(0, item.pnlSol));
  item.profitFactor = grossLoss > 0 ? Math.round((grossWin / grossLoss) * 100) / 100 : (grossWin > 0 ? 99 : num(item.profitFactor, 0));
  item.score = item.score == null ? null : Math.round(num(item.score));
  item.topPools = Object.entries(item.pools)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([pool, count]) => ({ pool, count }));
  delete item.pools;

  const sampleScore = Math.min(35, closed * 7);
  const winScore = Math.max(0, item.winRate - 45) * 0.45;
  const pnlScore = Math.max(-15, Math.min(25, item.avgPnlPct * 2));
  const qualityScore = item.score == null ? 0 : Math.max(0, item.score - 50) * 0.35;
  item.observerScore = Math.round(Math.max(0, Math.min(100, sampleScore + winScore + pnlScore + qualityScore)));
  item.riskLabel = item.samples < 5 ? "LOW_SAMPLE" : item.winRate >= 65 && item.pnlSol > 0 ? "PROMISING" : item.pnlSol < 0 ? "WEAK" : "NEUTRAL";
  return item;
}

function deriveStatus(wallets) {
  const sampleCount = wallets.reduce((sum, w) => sum + w.samples, 0);
  const activeWallets = wallets.filter((w) => w.lastSeen).length;
  const promising = wallets.filter((w) => w.riskLabel === "PROMISING");
  const bestScore = wallets.reduce((max, w) => Math.max(max, w.observerScore || 0), 0);
  const avgPromisingWr = promising.length
    ? promising.reduce((sum, w) => sum + num(w.winRate, 0), 0) / promising.length
    : 0;

  let status = "HOLD";
  let confidence = Math.min(40, Math.round(sampleCount * 2 + activeWallets * 3));
  const reasons = [];

  if (sampleCount < 30) reasons.push(`sample ${sampleCount}/30 minimum`);
  if (activeWallets < 5) reasons.push(`active wallet ${activeWallets}/5 minimum`);
  if (!promising.length) reasons.push("no stable promising wallet cohort yet");

  if (sampleCount >= 30 && activeWallets >= 5 && bestScore >= 55) {
    status = "WATCH";
    confidence = Math.max(confidence, Math.min(75, Math.round(45 + bestScore * 0.35 + promising.length * 3)));
    reasons.push("observer signal is interesting but still validation-only");
  }
  if (sampleCount >= 100 && activeWallets >= 10 && promising.length >= 5 && avgPromisingWr >= 65 && bestScore >= 75) {
    status = "READY";
    confidence = Math.max(80, Math.min(95, Math.round(70 + bestScore * 0.2 + promising.length)));
    reasons.length = 0;
    reasons.push("100+ samples with stable smart-wallet edge detected");
  }

  return {
    status,
    confidence,
    engineUseAllowed: false,
    reason: reasons.join(" | ") || "learning only",
    sampleCount,
    activeWallets,
    promisingWallets: promising.length,
    bestScore,
  };
}

export function buildSmartWalletObserverSnapshot() {
  const map = new Map();
  const pnl = readJSON(PATHS.pnlLog, { trades: [] });
  const copy = readJSON(PATHS.copySignals, { signals: [], ignored: [], meta: {} });
  const ranking = readJSON(PATHS.rankingDb, { wallets: {}, snapshots: [] });
  const manual = readJSON(PATHS.smartWallets, { wallets: [] });

  observeTradeWallets(map, pnl.trades || []);
  observeCopySignals(map, copy);
  observeRankingDb(map, ranking);
  observeManualSmartWallets(map, manual);

  const wallets = [...map.values()]
    .map(finalizeWallet)
    .sort((a, b) => (b.observerScore || 0) - (a.observerScore || 0))
    .slice(0, 50);
  const maturity = deriveStatus(wallets);

  return {
    ok: true,
    observer: "smart-wallet-observer",
    mode: "REPORT_ONLY",
    status: maturity.status,
    confidence: maturity.confidence,
    reason: maturity.reason,
    engineUseAllowed: false,
    engineImpact: "NONE",
    generatedAt: new Date().toISOString(),
    nextReview: "after 3-7 days of observer samples",
    summary: {
      totalWallets: wallets.length,
      activeWallets: maturity.activeWallets,
      sampleCount: maturity.sampleCount,
      promisingWallets: maturity.promisingWallets,
      bestScore: maturity.bestScore,
      trackedManualWallets: (manual.wallets || []).length,
      copySignals: (copy.signals || []).length,
      ignoredSignals: (copy.ignored || []).length,
    },
    thresholds: {
      HOLD: "sample < 30 or active wallets < 5 or no promising cohort",
      WATCH: "sample >= 30, active wallets >= 5, best score >= 55",
      READY: "sample >= 100, active wallets >= 10, 5 promising wallets, WR >= 65, best score >= 75",
    },
    topWallets: wallets.slice(0, 12),
  };
}

export function runOnce() {
  const snapshot = buildSmartWalletObserverSnapshot();
  writeJSON(PATHS.output, snapshot);
  return snapshot;
}

const _singleRun = process.argv.includes("--once") || process.argv.includes("--single-run");
const _runOnce = () => {
  try {
    const snapshot = runOnce();
    console.log(`[smart-wallet-observer] ${snapshot.status} confidence=${snapshot.confidence}% wallets=${snapshot.summary.totalWallets} samples=${snapshot.summary.sampleCount}`);
    return snapshot;
  } catch (err) {
    console.error(`[smart-wallet-observer] Error: ${err.message}`);
    return null;
  }
};
_runOnce();
if (!_singleRun) {
  setInterval(_runOnce, INTERVAL_MS);
}
