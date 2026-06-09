import "dotenv/config";
/**
 * Pool Dashboard — Backend Server (PATCHED v2)
 * =============================================
 * Fix: extractBotInfo sekarang baca format log non-TTY PM2
 * Fix: SOL price fetch langsung dari CoinGecko API (bukan dari log)
 * Fix: SOL balance baca dari log CRON
 * Fix: screeningCount baca dari semua log files
 * Fix: running status deteksi dari aktivitas log terbaru
 */

import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { exec } from "child_process";
import https from "https";
import { buildOperatorIntelligenceSnapshot, generateIncidentReport } from "./lib/operator_intelligence.js";
import { getMissedOpportunities, updateMissedOpportunitiesFromTrades } from "./lib/alpha_edge.js";
import { getAIOptimizationStatus } from "./lib/ai_optimizer.js";
import { buildFeatureImpactPayload } from "./lib/feature_impact.js";
import { enrichRoiPriority } from "./lib/roi_priority.js";
import { buildMarketRegime, buildTopOpportunities, enrichOffensiveEdge } from "./lib/offensive_edge.js";
import { applyPortfolioAllocation, buildCapitalAllocation, buildPortfolioRiskBudget, enrichExecutionIntelligence } from "./lib/execution_intelligence.js";
import { runBacktest } from "./lib/backtest_engine.js";
import { applyMemoryAwareConviction } from "./lib/experience_intelligence.js";
import { buildForensicsReport } from "./lib/source_truth.js";
import { buildLiveValidationPayload } from "./lib/live_validation.js";
import { buildSelfPreservationPayload } from "./lib/self_preservation.js";
import { buildSandboxEvidencePayload } from "./lib/sandbox_evidence.js";
import { buildAntiOorPayload } from "./lib/anti_oor_intelligence.js";
import { buildForensicDaily } from "./lib/forensic_scanner.js";
import { buildMomentumRiderPayload } from "./lib/momentum_rider.js";
import { buildShadowPayload } from "./shadow/shadow_summary.js";
import { buildShadowV2Payload } from "./shadow/shadow_v2_engine.js";
import { buildShadowV3WalletRescuePayload } from "./shadow/shadow_v3_wallet_rescue.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3001;

// Berada di root meridian-bot — BOT_DIR = direktori ini sendiri
const BOT_DIR = __dirname;

const PATHS = {
  state: path.join(BOT_DIR, "state.json"),
  decisions: path.join(BOT_DIR, "decision-log.json"),
  userConfig: path.join(BOT_DIR, "user-config.json"),
  signals: path.join(BOT_DIR, "signal-weights.json"),
  logsDir: path.join(BOT_DIR, "logs"),
  dotenv: path.join(BOT_DIR, ".env"),
  pnlLog: path.join(BOT_DIR, "data", "pnl_log.json"),
  aiUsage: path.join(BOT_DIR, "data", "ai_usage.json"),
  aiProviderAlert: path.join(BOT_DIR, "data", "ai_provider_alert.json"),
  smartWalletObserver: path.join(BOT_DIR, "data", "smart_wallet_observer.json"),
  memeAlphaFinder: path.join(BOT_DIR, "data", "meme_alpha_finder.json"),
  tradeReplay: path.join(BOT_DIR, "data", "trade_replay.json"),
  missedOpportunities: path.join(BOT_DIR, "data", "missed_opportunities.json"),
  featureImpact: path.join(BOT_DIR, "data", "feature_impact.json"),
  shadowPositions: path.join(BOT_DIR, "data", "shadow_positions.json"),
  shadowDailySummary: path.join(BOT_DIR, "data", "shadow_daily_summary.json"),
  incidentReport: path.join(BOT_DIR, "data", "incident_report.md"),
  rankingDb: path.join(BOT_DIR, "ranking-db.json"),
  copySignals: path.join(BOT_DIR, "copy-signals.json"),
};

// ── CORS ──────────────────────────────────────────────────────────────────────
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  next();
});
app.use(express.json());

// ── Helper: fetch SOL price dari CoinGecko ────────────────────────────────────
let _solPriceCache = 0;
let _solPriceCacheTime = 0;
let _usdIdrCache = 0;
let _usdIdrCacheTime = 0;

async function fetchSolPrice() {
  const now = Date.now();
  if (_solPriceCache > 0 && now - _solPriceCacheTime < 60_000) {
    return _solPriceCache;
  }
  return new Promise((resolve) => {
    exec(
      'curl -s "https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd"',
      (err, stdout) => {
        if (err) { resolve(_solPriceCache || 0); return; }
        try {
          const json = JSON.parse(stdout);
          _solPriceCache = json?.solana?.usd || 0;
          _solPriceCacheTime = Date.now();
          resolve(_solPriceCache);
        } catch {
          resolve(_solPriceCache || 0);
        }
      }
    );
  });
}

async function fetchUsdIdr() {
  const now = Date.now();
  if (_usdIdrCache > 0 && now - _usdIdrCacheTime < 10 * 60_000) {
    return _usdIdrCache;
  }
  return new Promise((resolve) => {
    const sources = [
      {
        cmd: 'curl -s "https://open.er-api.com/v6/latest/USD"',
        parse: (json) => Number(json?.rates?.IDR),
      },
      {
        cmd: 'curl -s "https://api.coingecko.com/api/v3/simple/price?ids=tether&vs_currencies=idr"',
        parse: (json) => Number(json?.tether?.idr),
      },
      {
        cmd: 'curl -Ls "https://api.frankfurter.app/latest?from=USD&to=IDR"',
        parse: (json) => Number(json?.rates?.IDR),
      },
    ];
    const trySource = (idx = 0) => {
      if (idx >= sources.length) {
        resolve(_usdIdrCache || 0);
        return;
      }
      exec(sources[idx].cmd, (err, stdout) => {
        if (!err) {
          try {
            const rate = sources[idx].parse(JSON.parse(stdout));
            if (Number.isFinite(rate) && rate > 0) {
              _usdIdrCache = rate;
              _usdIdrCacheTime = Date.now();
              resolve(rate);
              return;
            }
          } catch {}
        }
        trySource(idx + 1);
      }
      );
    };
    trySource();
  });
}

// ── Helper: baca JSON file ────────────────────────────────────────────────────
function readJSON(filePath, fallback = {}) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (e) {
    console.error(`Failed to read ${filePath}:`, e.message);
    return fallback;
  }
}

function formatWibRevision(date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date).reduce((acc, part) => {
    acc[part.type] = part.value;
    return acc;
  }, {});
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute} WIB`;
}

function dateKeyInTimeZone(value, timeZone = "Asia/Jakarta") {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date).reduce((acc, part) => {
    acc[part.type] = part.value;
    return acc;
  }, {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function getDashboardRevision() {
  const revisionRoots = [
    "dashboard.js",
    "public/index.html",
    "tools",
    "strategy",
    "lib",
    "shadow",
    "copy-engine",
    "decision-log.js",
    "config.js",
    "document",
  ];
  const skipDirs = new Set(["node_modules", ".git", "data", "logs", "scanning_log", "Backup", "garbage"]);
  const latestMtimeInPath = (targetPath) => {
    try {
      const stat = fs.statSync(targetPath);
      if (stat.isFile()) return stat.mtimeMs;
      if (!stat.isDirectory()) return 0;
      return fs.readdirSync(targetPath, { withFileTypes: true }).reduce((latest, entry) => {
        if (entry.name.startsWith(".")) return latest;
        if (entry.isDirectory() && skipDirs.has(entry.name)) return latest;
        if (!entry.isDirectory() && !/\.(js|html|css|json|md)$/i.test(entry.name)) return latest;
        return Math.max(latest, latestMtimeInPath(path.join(targetPath, entry.name)));
      }, stat.mtimeMs);
    } catch {
      return 0;
    }
  };
  const latestMtime = revisionRoots.reduce((latest, relPath) => {
    return Math.max(latest, latestMtimeInPath(path.join(BOT_DIR, relPath)));
  }, 0);
  const date = latestMtime > 0 ? new Date(latestMtime) : new Date();
  return {
    label: `Rev. ${formatWibRevision(date)}`,
    ts: date.toISOString(),
  };
}

// ── Helper: baca .env file sebagai key=value map ──────────────────────────────
function readDotenv(filePath) {
  const result = {};
  try {
    if (!fs.existsSync(filePath)) return result;
    const lines = fs.readFileSync(filePath, "utf8").split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const idx = trimmed.indexOf("=");
      if (idx < 0) continue;
      result[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim();
    }
  } catch (_) { }
  return result;
}

// ── Helper: ambil log lines dari 2 file terbaru (max 500 baris per file) ───
function getAllLogLines() {
  try {
    if (!fs.existsSync(PATHS.logsDir)) return [];
    const files = fs.readdirSync(PATHS.logsDir)
      .filter((f) => f.endsWith(".log"))
      .sort()
      .slice(-2);
    const lines = [];
    const MAX_LINES_PER_FILE = 500;
    for (const f of files) {
      const filePath = path.join(PATHS.logsDir, f);
      const stat = fs.statSync(filePath);
      // Untuk file besar, baca dari akhir file untuk efisiensi
      if (stat.size > 100 * 1024) {
        const fd = fs.openSync(filePath, "r");
        const buffer = Buffer.alloc(1024 * 64); // 64KB buffer
        let content = '';
        let bytesToRead = Math.min(buffer.length, stat.size);
        fs.readSync(fd, buffer, 0, bytesToRead, Math.max(0, stat.size - bytesToRead));
        fs.closeSync(fd);
        content = buffer.toString('utf8');
        // Ambil baris terakhir dari chunk yang dibaca
        const chunkLines = content.split("\n").filter(Boolean);
        lines.push(...chunkLines.slice(-MAX_LINES_PER_FILE));
      } else {
        const content = fs.readFileSync(filePath, "utf8");
        const fileLines = content.split("\n").filter(Boolean);
        lines.push(...fileLines.slice(-MAX_LINES_PER_FILE));
      }
    }
    return lines;
  } catch {
    return [];
  }
}

// ── Helper: ambil log file terbaru saja ──────────────────────────────────────
function getLatestLog() {
  try {
    if (!fs.existsSync(PATHS.logsDir)) return [];
    const files = fs.readdirSync(PATHS.logsDir)
      .filter((f) => f.endsWith(".log"))
      .sort()
      .reverse();
    if (!files.length) return [];
    const content = fs.readFileSync(path.join(PATHS.logsDir, files[0]), "utf8");
    return content.split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

// ── Helper: parse log line ────────────────────────────────────────────────────
function parseLogLine(line) {
  const match = line.match(/^\[(.+?)\] \[(.+?)\] (.+)$/);
  if (!match) return null;
  return { ts: match[1], tag: match[2], msg: match[3] };
}

function parseCompactUsd(value) {
  const raw = String(value || "").replace(/[$,\s]/g, "").trim().toLowerCase();
  const match = raw.match(/^([\d.]+)([kmb])?$/);
  if (!match) return null;
  const n = Number(match[1]);
  if (!Number.isFinite(n)) return null;
  const mult = match[2] === "b" ? 1_000_000_000 : match[2] === "m" ? 1_000_000 : match[2] === "k" ? 1_000 : 1;
  return n * mult;
}

function parsePercentRatio(value) {
  const match = String(value || "").match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  return Number(match[0]) / 100;
}

function normalizePoolKey(value) {
  return String(value || "").trim().toUpperCase();
}

function buildCopySignalPoolMap(limit = 200) {
  const data = readJSON(PATHS.copySignals, { signals: [], ignored: [] });
  const all = [...(data.signals || []), ...(data.ignored || [])].slice(-limit);
  const byPool = new Map();
  for (const signal of all) {
    const key = normalizePoolKey(signal.poolName || signal.deployArgs?.pool_name || signal.pool);
    if (!key) continue;
    const prev = byPool.get(key);
    const prevScore = Number(prev?.walletScore ?? prev?.deployArgs?.wallet_score);
    const nextScore = Number(signal.walletScore ?? signal.deployArgs?.wallet_score);
    const nextIsDefensive = String(signal.alphaEdge?.action || signal.deployArgs?.alpha_edge?.action || signal.action || "").toUpperCase() === "AVOID";
    const prevIsDefensive = String(prev?.alphaEdge?.action || prev?.deployArgs?.alpha_edge?.action || prev?.action || "").toUpperCase() === "AVOID";
    if (!prev || (nextIsDefensive && !prevIsDefensive) || (Number.isFinite(nextScore) && (!Number.isFinite(prevScore) || nextScore < prevScore))) {
      byPool.set(key, signal);
    }
  }
  return byPool;
}

function mergeDefensiveSignal(pool = {}, signal = null) {
  if (!signal) return pool;
  return {
    ...pool,
    defensiveSignal: {
      poolName: signal.poolName || signal.deployArgs?.pool_name || null,
      action: signal.alphaEdge?.action || signal.deployArgs?.alpha_edge?.action || signal.action || null,
      walletScore: signal.walletScore ?? signal.deployArgs?.wallet_score ?? null,
      ts: signal.ts || null,
    },
    walletScore: signal.walletScore ?? signal.deployArgs?.wallet_score ?? pool.walletScore ?? pool.wallet_score ?? null,
    feeTvlRatio: signal.feeTvlRatio ?? signal.deployArgs?.fee_tvl_ratio ?? pool.feeTvlRatio ?? pool.fee_tvl_ratio ?? null,
    organicScore: signal.organicScore ?? signal.deployArgs?.organic_score ?? pool.organicScore ?? pool.organic_score ?? pool.organic ?? null,
    alphaEdge: signal.alphaEdge ?? signal.deployArgs?.alpha_edge ?? pool.alphaEdge ?? pool.alpha_edge ?? null,
    action: signal.alphaEdge?.action ?? signal.deployArgs?.alpha_edge?.action ?? signal.action ?? pool.action ?? null,
    risks: [...(Array.isArray(pool.risks) ? pool.risks : []), ...(Array.isArray(signal.risks) ? signal.risks : [])],
    reasons: [...(Array.isArray(pool.reasons) ? pool.reasons : []), ...(Array.isArray(signal.reasons) ? signal.reasons : [])],
  };
}

// ── Helper: ekstrak info bot dari log ────────────────────────────────────────
function extractBotInfo(lines) {
  let wallet = null;
  let mode = "DRY RUN";
  let model = "unknown";
  let solBalance = 0;
  let screeningCount = 0;
  let lastActivity = null;
  let lastScreening = null;

  const dotenv = readDotenv(PATHS.dotenv);
  const cfg = readJSON(PATHS.userConfig, {});
  // user-config.json dryRun wins over .env (mirrors config.js fix)
  if (cfg.dryRun !== undefined) {
    mode = cfg.dryRun === false ? "LIVE" : "DRY RUN";
  } else {
    mode = dotenv.DRY_RUN === "true" ? "DRY RUN" : "LIVE";
  }
  if (cfg.screeningModel) model = cfg.screeningModel;

  for (const line of lines) {
    const parsed = parseLogLine(line);
    if (!parsed) continue;

    lastActivity = parsed.ts;

    if (parsed.tag === "INIT" && parsed.msg.includes("Wallet:")) {
      wallet = parsed.msg.replace("Wallet:", "").trim();
    }

    if (parsed.msg.includes("wallet:") && parsed.msg.includes("SOL")) {
      const m = parsed.msg.match(/wallet:\s*([\d.]+)\s*SOL/);
      if (m) solBalance = parseFloat(m[1]);
    }

    if (parsed.tag === "CRON" && parsed.msg.includes("Starting screening cycle")) {
      screeningCount++;
      lastScreening = parsed.ts;
    }
  }

  // Fallback: wallet might not be in recent logs; check state.json
  if (!wallet) {
    try {
      const state = readJSON(PATHS.state, {});
      if (state.walletAddress) wallet = state.walletAddress;
    } catch {}
  }

  let isRunning = false;
  if (lastActivity) {
    isRunning = Date.now() - new Date(lastActivity).getTime() < 40 * 60 * 1000;
  }
  if (!isRunning && lastScreening) {
    isRunning = Date.now() - new Date(lastScreening).getTime() < 35 * 60 * 1000;
  }

  return { wallet, mode, model, solBalance, screeningCount, lastActivity, isRunning };
}

// ── Helper: ekstrak pool dari log ────────────────────────────────────────────
function extractPoolsFromLog(lines) {
  const candidates = new Map();
  const dropped = [];

  for (const line of lines) {
    const parsed = parseLogLine(line);
    if (!parsed) continue;

    const poolMatch = parsed.msg.match(/^POOL:\s+(\S+)\s+\((\S+)\)/);
    if (poolMatch) {
      candidates.set(poolMatch[1], {
        name: poolMatch[1],
        pool: poolMatch[2],
        status: "candidate",
        ts: parsed.ts,
      });
    }

    if (parsed.msg.includes("metrics:") && parsed.msg.includes("organic=")) {
      const lastPool = [...candidates.values()].pop();
      if (lastPool) {
        const organicMatch = parsed.msg.match(/organic=([\d.]+)/);
        const volMatch = parsed.msg.match(/vol=\$([\d.]+)/);
        const tvlMatch = parsed.msg.match(/tvl=\$([\d.]+)/);
        const feeTvlMatch = parsed.msg.match(/fee_tvl=([\d.]+)/);
        if (organicMatch) lastPool.organic = parseFloat(organicMatch[1]);
        if (volMatch) lastPool.vol_usd = parseFloat(volMatch[1]);
        if (tvlMatch) lastPool.tvl_usd = parseFloat(tvlMatch[1]);
        if (feeTvlMatch) lastPool.feeAtvl = `${(parseFloat(feeTvlMatch[1]) * 100).toFixed(2)}%`;
      }
    }

    const rankedMatch = parsed.msg.match(/^\[(\d+)\]\s+(.+?)\s+fee\/aTVL:\s*([\d.]+)%\s+vol:\s*\$?([\d.,]+[kmb]?)\s+in-range:\s*([\d.]+)%\s+organic:\s*([\d.]+)\s+score:\s*([\d.]+)\s+grade:\s*(\w+)/i);
    if (rankedMatch) {
      const existing = candidates.get(rankedMatch[2]) || { name: rankedMatch[2], status: "candidate" };
      candidates.set(rankedMatch[2], {
        ...existing,
        rank: Number(rankedMatch[1]),
        feeAtvl: `${Number(rankedMatch[3]).toFixed(3)}%`,
        vol_usd: parseCompactUsd(rankedMatch[4]) ?? existing.vol_usd ?? null,
        inRangePct: Number(rankedMatch[5]),
        organic: Number(rankedMatch[6]),
        confidence: Number(rankedMatch[7]) / 100,
        poolScore: Number(rankedMatch[7]),
        grade: rankedMatch[8],
        ts: parsed.ts,
      });
    }

    if (parsed.tag === "SAFETY_BLOCK") {
      const m = parsed.msg.match(/([A-Z]+-[A-Z0-9]+)/);
      if (m) dropped.push({ name: m[1], reason: parsed.msg, status: "blocked", ts: parsed.ts });
    }

    const pvpMatch = parsed.msg.match(/PVP guard: (\S+) has active rival/);
    if (pvpMatch) {
      dropped.push({ name: pvpMatch[1], reason: "PVP guard blocked", status: "dropped", ts: parsed.ts });
    }

    const botMatch = parsed.msg.match(/Bot-holder filter: dropped (\S+).*bots ([\d.]+)% > (\d+)%/);
    if (botMatch) {
      dropped.push({
        name: botMatch[1],
        reason: `bots ${botMatch[2]}% > ${botMatch[3]}%`,
        status: "dropped",
        ts: parsed.ts
      });
    }

    const scoreMatch = parsed.msg.match(/Pool-score gate: dropped (\S+) — score (\d+) < (\d+)/);
    if (scoreMatch) {
      dropped.push({
        name: scoreMatch[1],
        reason: `score ${scoreMatch[2]} < ${scoreMatch[3]}`,
        status: "dropped",
        ts: parsed.ts
      });
    }
  }

  return { candidates: Array.from(candidates.values()), dropped: dropped.slice(-10) };
}

// ── Helper: hitung PnL per hari ──────────────────────────────────────────────
function calcDailyPnl(decisions) {
  const pnlByDay = {};
  for (const d of decisions) {
    if (!d.ts || !d.metrics) continue;
    const day = dateKeyInTimeZone(d.ts);
    if (!day) continue;
    const pnl = parseFloat(d.metrics.pnl_usd || d.metrics.pnl || 0);
    if (!pnlByDay[day]) pnlByDay[day] = 0;
    pnlByDay[day] += pnl;
  }
  return pnlByDay;
}

function calcConfidenceAnalytics(trades = []) {
  const closed = trades.filter((t) => (
    t.status === "closed" &&
    Number.isFinite(Number(t.decision_confidence))
  ));
  const buckets = [
    { key: "0.55-0.70", min: 0.55, max: 0.70 },
    { key: "0.70-0.85", min: 0.70, max: 0.85 },
    { key: "0.85-1.00", min: 0.85, max: 1.01 },
  ];
  const summarize = (items) => {
    const count = items.length;
    const avg = (field) => count
      ? items.reduce((sum, t) => sum + (Number(t[field]) || 0), 0) / count
      : 0;
    const wins = items.filter((t) => Number(t.pnl_pct ?? 0) > 0).length;
    const oor = items.filter((t) => Number(t.minutes_out_of_range ?? 0) > 0).length;
    return {
      count,
      avgConfidence: Math.round(avg("decision_confidence") * 1000) / 1000,
      avgPnlPct: Math.round(avg("pnl_pct") * 100) / 100,
      avgFeeYield: Math.round(avg("fee_tvl_ratio") * 10000) / 10000,
      winRate: count ? Math.round((wins / count) * 1000) / 10 : 0,
      oorRate: count ? Math.round((oor / count) * 1000) / 10 : 0,
    };
  };
  return {
    totalClosedWithConfidence: closed.length,
    overall: summarize(closed),
    buckets: buckets.map((bucket) => ({
      ...bucket,
      ...summarize(closed.filter((t) => {
        const confidence = Number(t.decision_confidence);
        return confidence >= bucket.min && confidence < bucket.max;
      })),
    })),
  };
}

function getCurrentMonthAICostUsd() {
  const usage = readJSON(PATHS.aiUsage, { months: {} });
  const monthKey = new Date().toISOString().slice(0, 7);
  return Number(usage?.months?.[monthKey]?.cost_usd ?? 0) || 0;
}

function getAIBudgetStatus(config = {}) {
  const usage = readJSON(PATHS.aiUsage, { days: {}, months: {} });
  const providerAlert = readJSON(PATHS.aiProviderAlert, null);
  const optimization = getAIOptimizationStatus();
  const modelNames = [
    config.screeningModel,
    config.managementModel,
    config.generalModel,
    config.aiReviewModel,
  ].map((model) => String(model || ""));
  const hasFreeFallback = modelNames.some((model) => /(^openrouter\/free$|:free$)/i.test(model));
  const now = new Date();
  const dayKey = now.toISOString().slice(0, 10);
  const monthKey = now.toISOString().slice(0, 7);
  const day = usage?.days?.[dayKey] || {};
  const month = usage?.months?.[monthKey] || {};
  const dayCalls = Number(day.calls || 0);
  const dayCostUsd = Number(day.cost_usd || 0);
  const monthCalls = Number(month.calls || 0);
  const monthCostUsd = Number(month.cost_usd || 0);
  const dailyBudgetUsd = Number(config.aiDailyBudgetUsd || 0);
  const monthlyBudgetUsd = Number(config.aiMonthlyBudgetUsd || 0);
  const maxCallsPerDay = Number(config.aiMaxCallsPerDay || 0);
  const dailyCostPct = dailyBudgetUsd > 0 ? (dayCostUsd / dailyBudgetUsd) * 100 : null;
  const monthlyCostPct = monthlyBudgetUsd > 0 ? (monthCostUsd / monthlyBudgetUsd) * 100 : null;
  const dailyCallPct = maxCallsPerDay > 0 ? (dayCalls / maxCallsPerDay) * 100 : null;

  const blockedReasons = [];
  const warnReasons = [];
  if (dailyBudgetUsd > 0 && dayCostUsd >= dailyBudgetUsd) {
    const msg = `AI daily paid budget reached: $${dayCostUsd.toFixed(4)} >= $${dailyBudgetUsd}`;
    if (hasFreeFallback) warnReasons.push(`${msg}; using free fallback`);
    else blockedReasons.push(msg);
  } else if (dailyCostPct != null && dailyCostPct >= 80) {
    warnReasons.push(`AI daily budget ${dailyCostPct.toFixed(0)}% used`);
  }
  if (monthlyBudgetUsd > 0 && monthCostUsd >= monthlyBudgetUsd) {
    const msg = `AI monthly paid budget reached: $${monthCostUsd.toFixed(4)} >= $${monthlyBudgetUsd}`;
    if (hasFreeFallback) warnReasons.push(`${msg}; using free fallback`);
    else blockedReasons.push(msg);
  } else if (monthlyCostPct != null && monthlyCostPct >= 80) {
    warnReasons.push(`AI monthly budget ${monthlyCostPct.toFixed(0)}% used`);
  }
  if (maxCallsPerDay > 0 && dayCalls >= maxCallsPerDay) {
    const msg = `AI daily paid call cap reached: ${dayCalls} >= ${maxCallsPerDay}`;
    if (hasFreeFallback) warnReasons.push(`${msg}; using free fallback`);
    else blockedReasons.push(msg);
  } else if (dailyCallPct != null && dailyCallPct >= 80) {
    warnReasons.push(`AI daily call cap ${dailyCallPct.toFixed(0)}% used`);
  }

  const providerAlertAgeMs = providerAlert?.ts ? now.getTime() - new Date(providerAlert.ts).getTime() : Infinity;
  if (providerAlert?.active && providerAlertAgeMs >= 0 && providerAlertAgeMs < 24 * 60 * 60 * 1000) {
    const msg = providerAlert.reason || "OpenRouter budget/credits blocked";
    if (hasFreeFallback) warnReasons.push(`${msg}; trying free fallback`);
    else blockedReasons.push(msg);
  }

  const blocked = blockedReasons.length > 0;
  const warn = blocked || warnReasons.length > 0;
  return {
    blocked,
    warn,
    reason: blocked ? blockedReasons.join("; ") : warnReasons.join("; "),
    dayKey,
    monthKey,
    dayCalls,
    dayCostUsd: Math.round(dayCostUsd * 1000000) / 1000000,
    monthCalls,
    monthCostUsd: Math.round(monthCostUsd * 1000000) / 1000000,
    dailyBudgetUsd,
    monthlyBudgetUsd,
    maxCallsPerDay,
    dailyCostPct: dailyCostPct == null ? null : Math.round(dailyCostPct * 10) / 10,
    monthlyCostPct: monthlyCostPct == null ? null : Math.round(monthlyCostPct * 10) / 10,
    dailyCallPct: dailyCallPct == null ? null : Math.round(dailyCallPct * 10) / 10,
    mode: optimization.mode,
    remainingPct: optimization.remainingPct,
    effectiveDailyCallCap: optimization.effectiveDailyCallCap,
    optimization,
    providerAlert: providerAlert?.active && providerAlertAgeMs >= 0 && providerAlertAgeMs < 24 * 60 * 60 * 1000
      ? { type: providerAlert.type || "provider", ts: providerAlert.ts || null }
      : null,
  };
}

function calcPnlSummary(config = {}, solPrice = 0) {
  const pnl = readJSON(PATHS.pnlLog, { trades: [] });
  const allTrades = pnl.trades || [];
  // In LIVE mode only count real trades; in dry-run only count simulated trades
  // Check user-config first, then fallback to .env (mirrors config.js logic)
  const dotenvForMode = readDotenv(PATHS.dotenv);
  const isLiveMode = config.dryRun !== undefined
    ? (config.dryRun === false || config.dryRun === "false")
    : dotenvForMode.DRY_RUN !== "true";
  const trades = isLiveMode
    ? allTrades.filter(t => !t.is_dry_run)
    : allTrades.filter(t => t.is_dry_run !== false);
  const closed = trades.filter(t => t.status === "closed");
  const open = trades.filter(t => t.status === "open");
  const configuredInitial = Number(config.dry_run_wallet ?? config.dryRunWallet);
  const storedInitial = Number(pnl.initial_sol);
  const fallbackInitial = Number(config.deployAmountSol || 0.5) * Math.max(1, Number(config.maxPositions || 1));
  const initial = Number.isFinite(configuredInitial) && configuredInitial > 0
    ? configuredInitial
    : Number.isFinite(storedInitial) && storedInitial > 0
      ? storedInitial
      : fallbackInitial;
  const pnlSolRaw = closed.reduce((sum, t) => {
    const explicit = Number(t.pnl_sol);
    if (Number.isFinite(explicit)) return sum + explicit;
    return sum + (Number(t.pnl_pct || 0) / 100) * Number(t.amount_sol || 0);
  }, 0);
  const pnlUsd = closed.reduce((sum, t) => sum + Number(t.pnl_usd || 0), 0);
  const estimatedRoundTripCostUsd = Number(config.estimatedRoundTripTxCostUsd ?? 0.04);
  const implicitTxCostUsd = closed.reduce((sum, t) => (
    sum + (t.costs_included_in_pnl ? 0 : (Number.isFinite(estimatedRoundTripCostUsd) ? estimatedRoundTripCostUsd : 0))
  ), 0);
  const explicitTxCostUsd = closed.reduce((sum, t) => sum + Number(t.costs_usd || 0), 0);
  const aiCostUsd = config.includeAICostInNetPnl === false ? 0 : getCurrentMonthAICostUsd();
  const netCostUsd = implicitTxCostUsd + aiCostUsd;
  const netCostSol = solPrice > 0 ? netCostUsd / solPrice : 0;
  const pnlSol = pnlSolRaw - netCostSol;
  const netPnlUsd = pnlUsd - netCostUsd;
  const locked = open.reduce((sum, t) => sum + Number(t.amount_sol || 0), 0);
  const current = initial + pnlSol;
  const wins = closed.filter(t => Number(t.pnl_pct || 0) > 0);
  const losses = closed.filter(t => Number(t.pnl_pct || 0) <= 0);    const daily = {};
    for (const t of closed) {
    const day = dateKeyInTimeZone(t.close_time || t.deploy_time);      if (!day) continue;
      const implicitCost = t.costs_included_in_pnl ? 0 : (Number.isFinite(estimatedRoundTripCostUsd) ? estimatedRoundTripCostUsd : 0);
    daily[day] = (daily[day] || 0) + Number(t.pnl_usd || 0) - implicitCost;
  }    // NOTE: AI cost tidak dipotong dari daily PnL — daily hanya menampilkan hasil murni trading
  return {
    initial: Math.round(initial * 10000) / 10000,
    current: Math.round(current * 10000) / 10000,
    pnl: Math.round(pnlSol * 10000) / 10000,
    pnlUsd: Math.round(netPnlUsd * 100) / 100,
    grossPnlUsd: Math.round(pnlUsd * 100) / 100,
    costsUsd: Math.round((netCostUsd + explicitTxCostUsd) * 10000) / 10000,
    aiCostUsd: Math.round(aiCostUsd * 10000) / 10000,
    txCostUsd: Math.round((implicitTxCostUsd + explicitTxCostUsd) * 10000) / 10000,
    locked: Math.round(locked * 10000) / 10000,
    total: closed.length,
    open: open.length,
    wins: wins.length,
    losses: losses.length,
    winRate: closed.length ? Math.round((wins.length / closed.length) * 100) : 0,
    daily,
    lastUpdated: pnl.last_updated || null,
  };
}

function getModeFilteredTrades(config = {}) {
  const pnl = readJSON(PATHS.pnlLog, { trades: [] });
  const allTrades = Array.isArray(pnl.trades) ? pnl.trades : [];
  const dotenvForMode = readDotenv(PATHS.dotenv);
  const isLiveMode = config.dryRun !== undefined
    ? (config.dryRun === false || config.dryRun === "false")
    : dotenvForMode.DRY_RUN !== "true";
  return (isLiveMode
    ? allTrades.filter(t => !t.is_dry_run)
    : allTrades.filter(t => t.is_dry_run !== false)
  ).sort((a, b) => {
    const at = new Date(a.close_time || a.deploy_time || 0).getTime();
    const bt = new Date(b.close_time || b.deploy_time || 0).getTime();
    return bt - at;
  });
}

function normalizeTradeHistory(trades = [], solPrice = 0, limit = 50) {
  return trades.slice(0, limit).map((t) => {
    const amountSol = Number(t.amount_sol || 0);
    const pnlSol = Number.isFinite(Number(t.pnl_sol))
      ? Number(t.pnl_sol)
      : Number.isFinite(Number(t.paper_unrealized_pnl_sol))
        ? Number(t.paper_unrealized_pnl_sol)
        : null;
    const pnlPct = Number.isFinite(Number(t.pnl_pct))
      ? Number(t.pnl_pct)
      : Number.isFinite(Number(t.paper_unrealized_pnl_pct))
        ? Number(t.paper_unrealized_pnl_pct)
        : null;
    const pnlUsd = Number.isFinite(Number(t.pnl_usd))
      ? Number(t.pnl_usd)
      : (pnlSol != null && solPrice > 0 ? pnlSol * solPrice : null);
    const deployMs = new Date(t.deploy_time || 0).getTime();
    const endMs = new Date(t.close_time || Date.now()).getTime();
    const minutesHeld = Number.isFinite(Number(t.minutes_held))
      ? Number(t.minutes_held)
      : (Number.isFinite(deployMs) && Number.isFinite(endMs) ? Math.max(0, Math.floor((endMs - deployMs) / 60000)) : null);
    return {
      id: t.id || t.position_address || t.pool_address || null,
      pool: t.pool_name || t.pair || "Unknown pool",
      poolAddress: t.pool_address || null,
      positionAddress: t.position_address || null,
      status: t.status || "unknown",
      mode: t.is_dry_run ? "DRY RUN" : "LIVE",
      amountSol,
      strategy: t.strategy || null,
      binsBelow: t.bins_below ?? null,
      lowerBin: t.lower_bin ?? null,
      upperBin: t.upper_bin ?? null,
      entryBin: t.entry_bin ?? null,
      activeBin: t.active_bin ?? null,
      exitBin: t.exit_bin ?? (t.status === "closed" ? t.active_bin : null),
      exitPrice: t.exit_price ?? (t.status === "closed" ? t.current_price : null),
      exitSide: t.exit_side ?? (t.status === "closed" ? t.out_of_range_side : null),
      feeTvlRatio: t.fee_tvl_ratio ?? null,
      organicScore: t.organic_score ?? null,
      pnlSol,
      pnlPct,
      pnlUsd: pnlUsd != null ? Math.round(pnlUsd * 100) / 100 : null,
      reason: t.close_reason || (t.status === "open" ? "open" : null),
      deployTime: t.deploy_time || null,
      closeTime: t.close_time || null,
      minutesHeld,
    };
  });
}

// ── Cache ─────────────────────────────────────────────────────────────────────
let _cache = {};
let _cacheTime = {};
const CACHE_TTL = 15000;

function cached(key, fn) {
  const now = Date.now();
  if (_cache[key] && now - _cacheTime[key] < CACHE_TTL) return _cache[key];
  const result = fn();
  _cache[key] = result;
  _cacheTime[key] = now;
  return result;
}

function getExperienceMemory(days = 30) {
  return cached(`experience-memory:${days}`, () => {
    try {
      return runBacktest({ days, mode: "all" }).experienceMemory || {};
    } catch (e) {
      return { error: e.message };
    }
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// API ROUTES
// ══════════════════════════════════════════════════════════════════════════════

app.get("/api/status", async (req, res) => {
  try {
    const solPrice = await fetchSolPrice();
    const lines = getAllLogLines();
    const botInfo = extractBotInfo(lines);
    const state = readJSON(PATHS.state, {});
    const config = readJSON(PATHS.userConfig, {});
    const signals = readJSON(PATHS.signals, {});
    const positions = state.positions || {};
    const pnlSummary = calcPnlSummary(config, solPrice);
    const isDryRun = botInfo.mode !== "LIVE";

    res.json({
      ok: true,
      bot: {
        running: botInfo.isRunning,
        mode: botInfo.mode,
        model: botInfo.model,
        lastStartup: botInfo.lastActivity,
        agentId: config.agentId || null,
        screeningCount: botInfo.screeningCount,
        executionIntelligenceMode: config.executionIntelligenceMode || "strict",
      },
      dashboard: getDashboardRevision(),
      wallet: {
        address: botInfo.wallet,
        solBalance: isDryRun ? pnlSummary.current : botInfo.solBalance,
        solPrice: solPrice,
        usdValue: Math.round((isDryRun ? pnlSummary.current : botInfo.solBalance) * solPrice * 100) / 100,
        simulated: isDryRun,
      },
      positions: {
        count: isDryRun ? pnlSummary.open : Object.keys(positions).length,
        active: positions,
      },
      signals: {
        weights: signals.weights || {},
        lastRecalc: signals.last_recalc || null,
        recalcCount: signals.recalc_count || 0,
      },
      tradeStats: (function() {
        return {
          total:    pnlSummary.total,
          open:     pnlSummary.open,
          wins:     pnlSummary.wins,
          losses:   pnlSummary.losses,
          winRate:  pnlSummary.winRate,
        };
      })(),
      simCapital: (function() {
        const dec = readJSON(PATHS.decisions, { decisions: [] });
        const daily = calcDailyPnl(dec.decisions || []);
        const totalPnlUsd = Object.values(daily).reduce((s, v) => s + v, 0);
        const initial = (config.maxDeployAmount || 40) * (config.maxPositions || 3);
        const totalPnlSol = solPrice > 0 ? totalPnlUsd / solPrice : 0;
        return {
          initial: pnlSummary.initial,
          current: pnlSummary.current,
          pnl:     pnlSummary.pnl,
          locked:  pnlSummary.locked,
          pnlUsd:  pnlSummary.pnlUsd,
          grossPnlUsd: pnlSummary.grossPnlUsd,
          costsUsd: pnlSummary.costsUsd,
          aiCostUsd: pnlSummary.aiCostUsd,
          txCostUsd: pnlSummary.txCostUsd,
          solPrice,
          mode:    botInfo.mode,
          lastUpdated: pnlSummary.lastUpdated,
        };
      })(),
      aiBudget: getAIBudgetStatus(config),
      operatorIntelligence: buildOperatorIntelligenceSnapshot({
        capitalProtection: {
          lossTrigger: config.capitalProtectionLossTrigger ?? 3,
          winRecovery: config.capitalProtectionWinRecovery ?? 3,
          deployMultiplier: config.capitalProtectionDeployMultiplier ?? 0.5,
          confidenceBoost: config.capitalProtectionConfidenceBoost ?? 0.10,
        },
        adaptiveConfidence: {
          minSamples: config.decisionAdaptiveCalibrationMinSamples ?? 10,
        },
      }),
      lastUpdated: state.lastUpdated || null,
      ts: new Date().toISOString(),
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get("/api/pools", async (req, res) => {
  const solPrice = await fetchSolPrice();
  const config = readJSON(PATHS.userConfig, {});
  const lines  = getAllLogLines();
  const result = extractPoolsFromLog(lines);
  const defensiveByPool = buildCopySignalPoolMap();
  const experienceMemory = getExperienceMemory(30);
  const toSol = (usd) => {
    if (usd == null || !Number.isFinite(usd)) return null;
    if (solPrice <= 0) return null;
    const sol = usd / solPrice;
    return sol < 1 ? sol.toFixed(3) + ' SOL' : sol.toFixed(2) + ' SOL';
  };
  const enrich = (p) => {
    const defensiveSignal = defensiveByPool.get(normalizePoolKey(p.name));
    const base = mergeDefensiveSignal(p, defensiveSignal);
    const enriched = {
      ...base,
      walletScore: base.walletScore ?? base.wallet_score ?? base.poolScore ?? base.score ?? null,
      feeTvlRatio: base.feeTvlRatio ?? base.fee_tvl_ratio ?? parsePercentRatio(base.feeAtvl),
      vol: base.vol_usd != null ? toSol(base.vol_usd) : base.vol ?? null,
      tvl: base.tvl_usd != null ? toSol(base.tvl_usd) : base.tvl ?? null,
    };
    const roi = enrichRoiPriority(enriched);
    const offensive = enrichOffensiveEdge(enriched, roi);
    const execCfg = { executionIntelligenceMode: config.executionIntelligenceMode || "strict" };
    const execution = enrichExecutionIntelligence(enriched, roi, offensive, undefined, execCfg);
    return {
      ...enriched,
      roi,
      offensive,
      execution: applyMemoryAwareConviction(enriched, roi, offensive, execution, experienceMemory),
    };
  };
  const candidates = result.candidates.map(enrich);
  const dropped = result.dropped.map(enrich);
  const allPools = [...candidates, ...dropped];
  const riskBudget = buildPortfolioRiskBudget(allPools);
  const capitalAllocation = buildCapitalAllocation(allPools, 6, riskBudget);
  applyPortfolioAllocation(allPools, capitalAllocation);
  res.json({
    ok: true,
    candidates,
    dropped,
    offensive: {
      topOpportunities: buildTopOpportunities(allPools, 5),
      marketRegime: buildMarketRegime(allPools),
    },
    execution: {
      capitalAllocation,
      riskBudget,
    },
    experience: {
      memory: experienceMemory,
    },
    total:      result.candidates.length,
    solPrice,
    ts:         new Date().toISOString(),
  });
});

app.get("/api/decisions", (req, res) => {
  const data = cached("decisions", () => {
    const dec = readJSON(PATHS.decisions, { decisions: [] });
    return {
      ok: true,
      decisions: (dec.decisions || []).slice(-20).reverse(),
      total: (dec.decisions || []).length,
      ts: new Date().toISOString(),
    };
  });
  res.json(data);
});

app.get("/api/ranking", (req, res) => {
  const db = readJSON(PATHS.rankingDb, { snapshots: [], rankingHistory: [], wallets: {}, meta: {} });
  const snapshots = db.snapshots || [];
  const latest = snapshots.length ? snapshots[snapshots.length - 1] : null;
  const entries = latest?.entries || [];
  res.json({
    ok: true,
    meta: db.meta || {},
    latest: latest ? {
      ts: latest.ts,
      mode: latest.mode,
      count: latest.count,
      entries,
    } : null,
    walletsTracked: Object.keys(db.wallets || {}).length,
    history: (db.rankingHistory || []).slice(-20).reverse(),
    ts: new Date().toISOString(),
  });
});

app.get("/api/copy-signals", (req, res) => {
  const config = readJSON(PATHS.userConfig, {});
  const data = readJSON(PATHS.copySignals, { signals: [], ignored: [], meta: {} });
  const limit = Math.max(1, Math.min(100, parseInt(req.query.limit || "30", 10) || 30));
  const experienceMemory = getExperienceMemory(30);
  const enrichSignal = (signal) => {
    const normalized = {
      ...signal,
      walletScore: signal.walletScore ?? signal.deployArgs?.wallet_score,
      feeTvlRatio: signal.feeTvlRatio ?? signal.deployArgs?.fee_tvl_ratio,
      organicScore: signal.organicScore ?? signal.deployArgs?.organic_score,
      alphaEdge: signal.alphaEdge ?? signal.deployArgs?.alpha_edge,
    };
    const roi = enrichRoiPriority(normalized);
    const offensive = enrichOffensiveEdge(normalized, roi);
    const execCfg = { executionIntelligenceMode: config.executionIntelligenceMode || "strict" };
    const execution = enrichExecutionIntelligence(normalized, roi, offensive, undefined, execCfg);
    return {
      ...signal,
      roi,
      offensive,
      execution: applyMemoryAwareConviction(normalized, roi, offensive, execution, experienceMemory),
    };
  };
  res.json({
    ok: true,
    meta: data.meta || {},
    signals: (data.signals || []).slice().reverse().slice(0, limit).map(enrichSignal),
    ignored: (data.ignored || []).slice().reverse().slice(0, limit).map(enrichSignal),
    totalSignals: (data.signals || []).length,
    totalIgnored: (data.ignored || []).length,
    ts: new Date().toISOString(),
  });
});

app.get("/api/logs", (req, res) => {
  const limit = parseInt(req.query.limit || "100");
  const lines = getLatestLog();
  const parsed = lines.map(parseLogLine).filter(Boolean).slice(-limit).reverse();
  res.json({ ok: true, logs: parsed, total: lines.length, ts: new Date().toISOString() });
});

app.get("/api/smart-wallet-observer", (req, res) => {
  const fallback = {
    ok: true,
    observer: "smart-wallet-observer",
    mode: "REPORT_ONLY",
    status: "HOLD",
    confidence: 0,
    reason: "observer has not produced a snapshot yet",
    engineUseAllowed: false,
    engineImpact: "NONE",
    generatedAt: null,
    summary: {
      totalWallets: 0,
      activeWallets: 0,
      sampleCount: 0,
      promisingWallets: 0,
      bestScore: 0,
    },
    topWallets: [],
  };
  res.json(readJSON(PATHS.smartWalletObserver, fallback));
});

app.get("/api/meme-alpha-finder", (req, res) => {
  const fallback = {
    ok: true,
    finder: "meme-alpha-finder",
    mode: "REPORT_ONLY",
    status: "HOLD",
    engineUseAllowed: false,
    engineImpact: "NONE",
    buySell: "MANUAL_ONLY",
    reason: "finder has not produced a snapshot yet",
    generatedAt: null,
    summary: {
      scannedProfiles: 0,
      detailedCandidates: 0,
      hot: 0,
      watch: 0,
      hold: 0,
      danger: 0,
      topScore: 0,
    },
    candidates: [],
  };
  res.json(readJSON(PATHS.memeAlphaFinder, fallback));
});

app.get("/api/pnl", async (req, res) => {
  const solPrice = await fetchSolPrice();
  const usdIdr = await fetchUsdIdr();
  const config = readJSON(PATHS.userConfig, {});
  const pnlSummary = calcPnlSummary(config, solPrice);
  const trades = getModeFilteredTrades(config);
  const limit = Math.max(1, Math.min(200, parseInt(req.query.limit || "50", 10) || 50));
  const dec = readJSON(PATHS.decisions, { decisions: [] });
  const decisionDaily = calcDailyPnl(dec.decisions || []);
  const daily = Object.keys(pnlSummary.daily).length ? pnlSummary.daily : decisionDaily;
  const toSol = (usd) => solPrice > 0 ? usd / solPrice : 0;
  const todayKey = dateKeyInTimeZone(new Date());
  const monthPrefix = todayKey ? todayKey.slice(0, 7) : "";
  const monthDaily = Object.fromEntries(
    Object.entries(daily).filter(([day]) => monthPrefix && String(day).startsWith(monthPrefix))
  );
  const values = Object.values(monthDaily);
  const total = values.reduce((s, v) => s + Number(v || 0), 0);
  const best = values.length ? Math.max(...values) : 0;
  const worst = values.length ? Math.min(...values) : 0;
  const todayUsd = todayKey ? Number(daily[todayKey] || 0) : 0;
  const todaySol = toSol(todayUsd);
  const dailySol = Object.fromEntries(Object.entries(daily).map(([d, v]) => [d, Math.round(toSol(v) * 10000) / 10000]));
  const estimatedRoundTripCostUsd = Number(config.estimatedRoundTripTxCostUsd ?? 0.04);
  const monthlyClosedTrades = trades.filter((t) => {
    if (t.status !== "closed") return false;
    const day = dateKeyInTimeZone(t.close_time || t.deploy_time);
    return monthPrefix && day && day.startsWith(monthPrefix);
  });
  const monthlyImplicitTxCostUsd = monthlyClosedTrades.reduce((sum, t) => (
    sum + (t.costs_included_in_pnl ? 0 : (Number.isFinite(estimatedRoundTripCostUsd) ? estimatedRoundTripCostUsd : 0))
  ), 0);
  const monthlyExplicitTxCostUsd = monthlyClosedTrades.reduce((sum, t) => sum + Number(t.costs_usd || 0), 0);
  const monthlyAiCostUsd = config.includeAICostInNetPnl === false ? 0 : getCurrentMonthAICostUsd();
  const monthlyCostsUsd = monthlyImplicitTxCostUsd + monthlyExplicitTxCostUsd + monthlyAiCostUsd;
  res.json({
    ok: true,
    daily: dailySol,
    dailyUsd: daily,
    trades: normalizeTradeHistory(trades, solPrice, limit),
    tradeTotal: trades.length,
    solPrice,
    usdIdr,
    summary: {
      total:       Math.round(toSol(total) * 10000) / 10000,
      today:       Math.round(todaySol * 10000) / 10000,
      best:        Math.round(toSol(best)  * 10000) / 10000,
      worst:       Math.round(toSol(worst) * 10000) / 10000,
      totalUsd:    Math.round(total * 100) / 100,
      todayUsd:    Math.round(todayUsd * 100) / 100,
      todayKey,
      monthKey:    monthPrefix,
      costsUsd:    Math.round(monthlyCostsUsd * 10000) / 10000,
      aiCostUsd:   Math.round(monthlyAiCostUsd * 10000) / 10000,
      txCostUsd:   Math.round((monthlyImplicitTxCostUsd + monthlyExplicitTxCostUsd) * 10000) / 10000,
      tradingDays: values.filter((v) => v !== 0).length,
      open:        pnlSummary.open,
      lockedSol:   pnlSummary.locked,
      currentSol:  pnlSummary.current,
    },
    ts: new Date().toISOString(),
  });
});

app.get("/api/shadow-intelligence", (req, res) => {
  const date = String(req.query.date || new Date().toISOString().slice(0, 10));
  const limit = Math.max(1, Math.min(100, parseInt(req.query.limit || "12", 10) || 12));
  res.json(buildShadowPayload({ date, limit }));
});

app.get("/api/shadow-v2", (req, res) => {
  const date = String(req.query.date || new Date().toISOString().slice(0, 10));
  const limit = Math.max(1, Math.min(100, parseInt(req.query.limit || "12", 10) || 12));
  res.json(buildShadowV2Payload({ date, limit }));
});

app.get("/api/shadow-v3-wallet-rescue", (req, res) => {
  const date = String(req.query.date || new Date().toISOString().slice(0, 10));
  const limit = Math.max(1, Math.min(100, parseInt(req.query.limit || "12", 10) || 12));
  res.json(buildShadowV3WalletRescuePayload({ date, limit }));
});

app.get("/api/confidence-analytics", (req, res) => {
  const config = readJSON(PATHS.userConfig, {});
  const trades = getModeFilteredTrades(config);
  res.json({
    ok: true,
    analytics: calcConfidenceAnalytics(trades),
    ts: new Date().toISOString(),
  });
});

app.get("/api/operator-intelligence", (req, res) => {
  const config = readJSON(PATHS.userConfig, {});
  res.json({
    ok: true,
    ...buildOperatorIntelligenceSnapshot({
      capitalProtection: {
        lossTrigger: config.capitalProtectionLossTrigger ?? 3,
        winRecovery: config.capitalProtectionWinRecovery ?? 3,
        deployMultiplier: config.capitalProtectionDeployMultiplier ?? 0.5,
        confidenceBoost: config.capitalProtectionConfidenceBoost ?? 0.10,
      },
      adaptiveConfidence: {
        minSamples: config.decisionAdaptiveCalibrationMinSamples ?? 10,
      },
    }),
    ts: new Date().toISOString(),
  });
});

app.get("/api/trade-replay", (req, res) => {
  const data = readJSON(PATHS.tradeReplay, { version: 1, trades: [] });
  const limit = Math.max(1, Math.min(100, parseInt(req.query.limit || "30", 10) || 30));
  res.json({
    ok: true,
    trades: (data.trades || []).slice().reverse().slice(0, limit),
    total: (data.trades || []).length,
    ts: new Date().toISOString(),
  });
});

app.get("/api/missed-opportunities", (req, res) => {
  updateMissedOpportunitiesFromTrades();
  const limit = Math.max(1, Math.min(100, parseInt(req.query.limit || "30", 10) || 30));
  res.json({
    ok: true,
    opportunities: getMissedOpportunities(limit),
    ts: new Date().toISOString(),
  });
});

app.get("/api/feature-impact", (req, res) => {
  res.json({
    ok: true,
    ...buildFeatureImpactPayload(),
    ts: new Date().toISOString(),
  });
});

app.get("/api/backtest", (req, res) => {
  const days = Math.max(1, Math.min(365, parseInt(req.query.days || "30", 10) || 30));
  const mode = String(req.query.mode || "all").toLowerCase();
  const key = `backtest:${days}:${mode}`;
  const data = cached(key, () => runBacktest({ days, mode }));
  res.json(data);
});

app.get("/api/experience-memory", (req, res) => {
  const days = Math.max(1, Math.min(365, parseInt(req.query.days || "30", 10) || 30));
  res.json({
    ok: true,
    config: { days, mode: "all" },
    experienceMemory: getExperienceMemory(days),
    ts: new Date().toISOString(),
  });
});

app.get("/api/defensive-truth", (req, res) => {
  const days = Math.max(1, Math.min(365, parseInt(req.query.days || "30", 10) || 30));
  const memory = getExperienceMemory(days);
  res.json({
    ok: true,
    config: { days, mode: "all" },
    defensiveTruthAudit: memory.defensiveTruthAudit || null,
    contextualDanger: memory.contextualDanger || null,
    blockerAttribution: memory.blockerAttribution || null,
    blockerConfidence: memory.blockerConfidence || null,
    regressionDetection: memory.regressionDetection || null,
    ts: new Date().toISOString(),
  });
});

app.get("/api/shadow-execution", (req, res) => {
  const days = Math.max(1, Math.min(365, parseInt(req.query.days || "30", 10) || 30));
  const mode = String(req.query.mode || "all").toLowerCase();
  const data = cached(`shadow-execution:${days}:${mode}`, () => runBacktest({ days, mode }));
  res.json({
    ok: true,
    config: { days, mode },
    shadowExperiment: data.shadowExperiment || data.experienceMemory?.shadowExperiment || null,
    ts: new Date().toISOString(),
  });
});

app.get("/api/wallet-truth", (req, res) => {
  const days = Math.max(1, Math.min(365, parseInt(req.query.days || "30", 10) || 30));
  const mode = String(req.query.mode || "all").toLowerCase();
  const data = cached(`wallet-truth:${days}:${mode}`, () => runBacktest({ days, mode }));
  res.json({
    ok: true,
    config: { days, mode },
    walletTruth: data.walletTruth || data.experienceMemory?.walletTruth || null,
    ts: new Date().toISOString(),
  });
});

app.get("/api/signal-forensics", (req, res) => {
  const pnl = readJSON(PATHS.pnlLog, { trades: [] });
  const limit = Math.max(1, Math.min(200, parseInt(req.query.limit || "100", 10) || 100));
  const trades = (pnl.trades || []).slice(-limit);
  res.json({
    ok: true,
    ...buildForensicsReport(trades),
    ts: new Date().toISOString(),
  });
});

app.get("/api/live-validation", (req, res) => {
  const pnl = readJSON(PATHS.pnlLog, { trades: [] });
  res.json({
    ok: true,
    ...buildLiveValidationPayload(pnl.trades || []),
    ts: new Date().toISOString(),
  });
});

app.get("/api/self-preservation", (req, res) => {
  const pnl = readJSON(PATHS.pnlLog, { trades: [] });
  res.json({
    ok: true,
    ...buildSelfPreservationPayload(pnl.trades || []),
    ts: new Date().toISOString(),
  });
});

app.get("/api/sandbox-evidence", (req, res) => {
  const days = Math.max(1, Math.min(365, parseInt(req.query.days || "30", 10) || 30));
  const mode = String(req.query.mode || "all").toLowerCase();
  const pnl = readJSON(PATHS.pnlLog, { trades: [] });
  const backtest = cached(`sandbox-evidence:${days}:${mode}`, () => runBacktest({ days, mode }));
  const liveValidation = buildLiveValidationPayload(pnl.trades || []);
  const selfPreservation = buildSelfPreservationPayload(pnl.trades || []);
  res.json({
    config: { days, mode },
    ...buildSandboxEvidencePayload({
      trades: pnl.trades || [],
      liveValidation,
      selfPreservation,
      shadowExperiment: backtest.shadowExperiment || backtest.experienceMemory?.shadowExperiment || {},
      walletTruth: backtest.walletTruth || backtest.experienceMemory?.walletTruth || {},
    }),
    ts: new Date().toISOString(),
  });
});

app.get("/api/anti-oor", (req, res) => {
  const days = Math.max(1, Math.min(365, parseInt(req.query.days || "30", 10) || 30));
  const mode = String(req.query.mode || "all").toLowerCase();
  const pnl = readJSON(PATHS.pnlLog, { trades: [] });
  const backtest = cached(`anti-oor:${days}:${mode}`, () => runBacktest({ days, mode }));
  const liveValidation = buildLiveValidationPayload(pnl.trades || []);
  const selfPreservation = buildSelfPreservationPayload(pnl.trades || []);
  const sandboxEvidence = buildSandboxEvidencePayload({
    trades: pnl.trades || [],
    liveValidation,
    selfPreservation,
    shadowExperiment: backtest.shadowExperiment || backtest.experienceMemory?.shadowExperiment || {},
    walletTruth: backtest.walletTruth || backtest.experienceMemory?.walletTruth || {},
  });
  res.json({
    config: { days, mode },
    ...buildAntiOorPayload({
      trades: pnl.trades || [],
      sandboxEvidence,
    }),
    ts: new Date().toISOString(),
  });
});

app.get("/api/momentum-rider", (req, res) => {
  const pnl = readJSON(PATHS.pnlLog, { trades: [] });
  res.json({
    ...buildMomentumRiderPayload({ trades: pnl.trades || [] }),
    ts: new Date().toISOString(),
  });
});

app.get("/api/ai-usage", (req, res) => {
  const usage = readJSON(PATHS.aiUsage, { days: {}, months: {}, calls: [] });
  const todayKey = new Date().toISOString().slice(0, 10);
  const monthKey = new Date().toISOString().slice(0, 7);
  const today = usage.days?.[todayKey] || {};
  const month = usage.months?.[monthKey] || {};
  const dayCalls = Number(today.calls || 0);
  const dayCostUsd = Number(today.cost_usd || 0);
  const dayInput = Number(today.input_tokens || 0);
  const dayOutput = Number(today.output_tokens || 0);
  const dayTotal = Number(today.total_tokens || 0);
  const monthCalls = Number(month.calls || 0);
  const monthCostUsd = Number(month.cost_usd || 0);
  const monthInput = Number(month.input_tokens || 0);
  const monthOutput = Number(month.output_tokens || 0);
  const monthTotal = Number(month.total_tokens || 0);
  const avgCostPerCall = dayCalls > 0 ? dayCostUsd / dayCalls : 0;
  res.json({
    ok: true,
    today: {
      date: todayKey,
      calls: dayCalls,
      costUsd: Math.round(dayCostUsd * 10000) / 10000,
      inputTokens: dayInput,
      outputTokens: dayOutput,
      totalTokens: dayTotal,
      avgCostPerCall: Math.round(avgCostPerCall * 1000000) / 1000000,
    },
    month: {
      month: monthKey,
      calls: monthCalls,
      costUsd: Math.round(monthCostUsd * 10000) / 10000,
      inputTokens: monthInput,
      outputTokens: monthOutput,
      totalTokens: monthTotal,
    },
    ts: new Date().toISOString(),
  });
});

app.get("/api/forensic-scan/daily", async (req, res) => {
  const date = String(req.query.date || dateKeyInTimeZone(new Date()) || "").slice(0, 10);
  try {
    const daily = await buildForensicDaily(date);
    res.json({
      ok: true,
      source: `scanning_log/daily/${date}.json`,
      ...daily,
      ts: new Date().toISOString(),
    });
  } catch (e) {
    res.json({
      ok: false,
      date,
      source: `scanning_log/daily/${date}.json`,
      error: e.message,
      summary: { total_trades: 0, profit_count: 0, loss_count: 0, pf: 0, oor_above: 0, oor_below: 0 },
      loss_analysis: [],
      ts: new Date().toISOString(),
    });
  }
});

app.get("/api/incident-report", (req, res) => {
  const report = fs.existsSync(PATHS.incidentReport)
    ? fs.readFileSync(PATHS.incidentReport, "utf8")
    : "";
  res.json({
    ok: true,
    report,
    exists: !!report,
    ts: new Date().toISOString(),
  });
});

app.get("/api/incident-report/download", (req, res) => {
  if (!fs.existsSync(PATHS.incidentReport)) {
    return res.status(404).json({ ok: false, reason: "incident report not found" });
  }
  const stamp = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, "");
  res.setHeader("Content-Type", "text/markdown; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename=\"incident_report_${stamp}.md\"`);
  res.send(fs.readFileSync(PATHS.incidentReport, "utf8"));
});

app.post("/api/incident-report/generate", (req, res) => {
  const pnl = readJSON(PATHS.pnlLog, { trades: [] });
  const latestLoss = (pnl.trades || [])
    .filter((t) => (t.status === "closed" || t.close_time) && Number(t.pnl_pct ?? 0) < 0)
    .sort((a, b) => new Date(b.close_time || 0) - new Date(a.close_time || 0))[0];
  const reportPath = latestLoss ? generateIncidentReport(latestLoss) : null;
  res.json({
    ok: !!reportPath,
    reportPath,
    downloadUrl: reportPath ? "/api/incident-report/download" : null,
    reason: reportPath ? null : "no closed losing trade found",
    ts: new Date().toISOString(),
  });
});

app.get("/api/health", (req, res) => {
  res.json({ ok: true, service: "pool-dashboard-backend", ts: new Date().toISOString() });
});

app.use(express.static(path.join(__dirname, "public"), {
  setHeaders(res, filePath) {
    if (path.basename(filePath) === "index.html") {
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    }
  },
}));
app.get("*", (req, res) => {
  const indexPath = path.join(__dirname, "public", "index.html");
  if (fs.existsSync(indexPath)) {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.sendFile(indexPath);
  } else {
    res.json({
      ok: true,
      message: "Pool Dashboard API running",
      endpoints: ["/api/status", "/api/pools", "/api/decisions", "/api/logs", "/api/pnl", "/api/shadow-intelligence", "/api/shadow-v2", "/api/shadow-v3-wallet-rescue", "/api/smart-wallet-observer", "/api/meme-alpha-finder", "/api/feature-impact", "/api/backtest", "/api/experience-memory", "/api/defensive-truth", "/api/shadow-execution", "/api/wallet-truth", "/api/signal-forensics", "/api/live-validation", "/api/self-preservation", "/api/sandbox-evidence", "/api/anti-oor", "/api/momentum-rider", "/api/forensic-scan/daily"],
    });
  }
});

app.listen(PORT, () => {
  console.log(`\n╔══════════════════════════════════════╗`);
  console.log(`║   Pool Dashboard Backend — Ready     ║`);
  console.log(`╚══════════════════════════════════════╝`);
  console.log(`\n  API   : http://localhost:${PORT}/api/status`);
  console.log(`  UI    : http://localhost:${PORT}`);
  console.log(`  BOT   : ${BOT_DIR}`);
  console.log(`\nPress Ctrl+C to stop\n`);
});
