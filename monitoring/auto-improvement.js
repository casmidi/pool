/**
 * Daily auto-improvement loop.
 *
 * Uses realized closes from pnl_log.json to:
 * - produce a compact daily profitability report,
 * - blacklist/downrank copied wallets that underperform,
 * - suggest conservative config tuning from actual outcomes.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { config } from "../config.js";
import { log } from "../logger.js";
import { tagWallet } from "../ranking/ranking-db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BOT_DIR = path.join(__dirname, "..");
const PNL_PATH = path.join(BOT_DIR, "data", "pnl_log.json");
const REPORT_PATH = path.join(BOT_DIR, "data", "daily-improvement.json");
const USER_CONFIG_PATH = path.join(BOT_DIR, "user-config.json");

const TUNABLES = {
  minPoolScore: { section: "screening", field: "minPoolScore", min: 60, max: 82, step: 1 },
  minActivePct: { section: "screening", field: "minActivePct", min: 45, max: 80, step: 1 },
  maxDeployVolatility: { section: "screening", field: "maxDeployVolatility", min: 2.0, max: 8.0, step: 0.1 },
  minNetEVPct: { section: "screening", field: "minNetEVPct", min: 0, max: 1.5, step: 0.05 },
  outOfRangeWaitMinutes: { section: "management", field: "outOfRangeWaitMinutes", min: 5, max: 45, step: 1 },
  deployAmountSol: { section: "management", field: "deployAmountSol", min: 0.03, max: 2, step: 0.001 },
};

function readJSON(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJSON(filePath, value) {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(value, null, 2), "utf8");
  } catch { /* report persistence is best-effort */ }
}

function clampToTunable(key, value) {
  const rule = TUNABLES[key];
  if (!rule) return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const clipped = Math.max(rule.min, Math.min(rule.max, n));
  const stepped = Math.round(clipped / rule.step) * rule.step;
  return Number(stepped.toFixed(6));
}

function applyRuntimeConfig(key, value) {
  const rule = TUNABLES[key];
  if (!rule) return;
  if (!config[rule.section]) return;
  config[rule.section][rule.field] = value;
}

function safeLog(message) {
  try {
    log("auto_improve", message);
  } catch { /* ignore logging failures in read-only test contexts */ }
}

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function avg(values) {
  return values.length ? values.reduce((s, v) => s + v, 0) / values.length : 0;
}

function std(values) {
  if (values.length < 2) return 0;
  const mean = avg(values);
  return Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / (values.length - 1));
}

function downsideStd(values) {
  const negative = values.filter((v) => v < 0);
  return std(negative);
}

function sharpe(values) {
  const s = std(values);
  return s > 0 ? avg(values) / s : 0;
}

function sortino(values) {
  const s = downsideStd(values);
  return s > 0 ? avg(values) / s : (avg(values) > 0 ? 99 : 0);
}

function dayKey(ts = Date.now()) {
  return new Date(ts).toISOString().slice(0, 10);
}

function closedTrades(days = 1) {
  const pnl = readJSON(PNL_PATH, { trades: [] });
  const cutoff = Date.now() - days * 86400_000;
  return (pnl.trades || [])
    .filter((t) => t.status === "closed" && new Date(t.close_time || 0).getTime() >= cutoff);
}

function allClosedTrades() {
  const pnl = readJSON(PNL_PATH, { trades: [] });
  return (pnl.trades || []).filter((t) => t.status === "closed");
}

function groupBySourceWallet(trades) {
  const map = new Map();
  for (const t of trades) {
    if (!t.source_wallet) continue;
    if (!map.has(t.source_wallet)) map.set(t.source_wallet, []);
    map.get(t.source_wallet).push(t);
  }
  return map;
}

function buildWalletActions(trades) {
  const minSamples = Number(config.copyTrading?.autoBlacklistMinSamples ?? 3);
  const minWinRate = Number(config.copyTrading?.autoBlacklistWinRateBelow ?? 35);
  const minPnlSol = Number(config.copyTrading?.autoBlacklistPnlSolBelow ?? -0.03);
  const actions = [];

  for (const [wallet, samples] of groupBySourceWallet(trades)) {
    const pnls = samples.map((t) => num(t.pnl_sol, (num(t.pnl_pct) / 100) * num(t.amount_sol))).filter(Number.isFinite);
    const wins = pnls.filter((p) => p > 0).length;
    const total = pnls.reduce((s, p) => s + p, 0);
    const winRate = pnls.length ? (wins / pnls.length) * 100 : 0;
    if (pnls.length >= minSamples && (winRate < minWinRate || total < minPnlSol)) {
      tagWallet(wallet, "auto_blacklist_realized_underperform");
      actions.push({
        wallet,
        samples: pnls.length,
        winRate: Math.round(winRate * 10) / 10,
        pnlSol: Math.round(total * 1e6) / 1e6,
        action: "tagged_auto_blacklist_realized_underperform",
      });
    }
  }

  return actions;
}

function buildSuggestions(recent, all) {
  const suggestions = [];
  const recentPnls = recent.map((t) => num(t.pnl_sol, (num(t.pnl_pct) / 100) * num(t.amount_sol)));
  const recentWinRate = recentPnls.length ? (recentPnls.filter((p) => p > 0).length / recentPnls.length) * 100 : null;
  const oorRate = recent.length
    ? recent.filter((t) => String(t.close_reason || "").toLowerCase().includes("out-of-range") || String(t.close_reason || "").toLowerCase().includes("oor")).length / recent.length
    : 0;
  const avgRangeEfficiency = avg(recent.map((t) => num(t.range_efficiency_pct, NaN)).filter(Number.isFinite));
  const avgFeeVsIl = avg(recent.map((t) => num(t.fee_vs_il_ratio, NaN)).filter(Number.isFinite));

  if (recent.length >= 3 && recentWinRate != null && recentWinRate < 45) {
    suggestions.push({
      key: "minPoolScore",
      current: config.screening?.minPoolScore ?? null,
      suggested: Math.min(78, Math.max(65, num(config.screening?.minPoolScore, 65) + 3)),
      reason: `Recent win rate ${recentWinRate.toFixed(1)}% is below 45%`,
    });
  }
  if (recent.length >= 3 && oorRate >= 0.5) {
    suggestions.push({
      key: "outOfRangeWaitMinutes",
      current: config.management?.outOfRangeWaitMinutes ?? null,
      suggested: Math.max(10, num(config.management?.outOfRangeWaitMinutes, 20) - 5),
      reason: `OOR close rate ${(oorRate * 100).toFixed(0)}% suggests exits are too slow`,
    });
    suggestions.push({
      key: "maxDeployVolatility",
      current: config.screening?.maxDeployVolatility ?? null,
      suggested: Math.max(2.5, num(config.screening?.maxDeployVolatility, 4) - 0.5),
      reason: "OOR-heavy regime needs lower volatility acceptance",
    });
  }
  if (avgRangeEfficiency && avgRangeEfficiency < 45) {
    suggestions.push({
      key: "minActivePct",
      current: config.screening?.minActivePct ?? null,
      suggested: Math.min(75, Math.max(55, num(config.screening?.minActivePct, 55) + 5)),
      reason: `Average range efficiency ${avgRangeEfficiency.toFixed(1)}% is weak`,
    });
  }
  if (avgFeeVsIl && avgFeeVsIl < 1.2) {
    suggestions.push({
      key: "minNetEVPct",
      current: config.screening?.minNetEVPct ?? null,
      suggested: Math.min(1, Math.max(0.2, num(config.screening?.minNetEVPct, 0.2) + 0.1)),
      reason: `Fee-vs-IL ratio ${avgFeeVsIl.toFixed(2)} is too thin`,
    });
  }
  if (all.length >= 20 && sharpe(all.map((t) => num(t.pnl_sol))) < 0) {
    suggestions.push({
      key: "deployAmountSol",
      current: config.management?.deployAmountSol ?? null,
      suggested: Math.max(0.05, Math.round(num(config.management?.deployAmountSol, 0.1) * 0.8 * 1000) / 1000),
      reason: "Longer sample Sharpe is negative; reduce base size until edge recovers",
    });
  }

  return suggestions;
}

export function generateDailyImprovementReport({ days = 1 } = {}) {
  const recent = closedTrades(days);
  const all = allClosedTrades();
  const pnlSol = recent.reduce((s, t) => s + num(t.pnl_sol, (num(t.pnl_pct) / 100) * num(t.amount_sol)), 0);
  const pnlUsd = recent.reduce((s, t) => s + num(t.pnl_usd), 0);
  const pnls = recent.map((t) => num(t.pnl_sol, (num(t.pnl_pct) / 100) * num(t.amount_sol)));
  const wins = pnls.filter((p) => p > 0).length;
  const walletActions = config.copyTrading?.autoBlacklistRealized === false ? [] : buildWalletActions(all);
  const suggestions = buildSuggestions(recent, all);

  const report = {
    ts: new Date().toISOString(),
    day: dayKey(),
    windowDays: days,
    summary: {
      closes: recent.length,
      pnlSol: Math.round(pnlSol * 1e6) / 1e6,
      pnlUsd: Math.round(pnlUsd * 100) / 100,
      winRate: recent.length ? Math.round((wins / recent.length) * 1000) / 10 : 0,
      sharpe: Math.round(sharpe(pnls) * 100) / 100,
      sortino: Math.round(sortino(pnls) * 100) / 100,
      avgRangeEfficiency: Math.round(avg(recent.map((t) => num(t.range_efficiency_pct, NaN)).filter(Number.isFinite)) * 10) / 10 || null,
      avgFeeVsIl: Math.round(avg(recent.map((t) => num(t.fee_vs_il_ratio, NaN)).filter(Number.isFinite)) * 100) / 100 || null,
    },
    suggestions,
    walletActions,
  };

  const store = readJSON(REPORT_PATH, { reports: [] });
  store.reports = [report, ...(store.reports || [])].slice(0, 90);
  writeJSON(REPORT_PATH, store);
  safeLog(`Daily report: closes=${report.summary.closes}, pnl=${report.summary.pnlSol} SOL, suggestions=${suggestions.length}, walletActions=${walletActions.length}`);
  return report;
}

export function applyDailyImprovementSuggestions({ days = 1, dryRun = false, force = false } = {}) {
  const report = generateDailyImprovementReport({ days });
  const changes = {};
  const skipped = [];
  const userConfig = readJSON(USER_CONFIG_PATH, {});

  if (report.summary.closes < Number(config.autoImprovement?.minClosesToTune ?? 3)) {
    return {
      applied: false,
      dryRun,
      reason: `Need at least ${config.autoImprovement?.minClosesToTune ?? 3} closes in window`,
      report,
      changes,
      skipped,
    };
  }

  const lastTuneDay = userConfig._lastAutoImprovementTune
    ? dayKey(new Date(userConfig._lastAutoImprovementTune).getTime())
    : null;
  if (!dryRun && !force && lastTuneDay === report.day) {
    return {
      applied: false,
      dryRun,
      reason: `Auto-tune already applied for ${report.day}`,
      report,
      changes,
      skipped,
    };
  }

  for (const suggestion of report.suggestions || []) {
    const key = suggestion.key;
    const next = clampToTunable(key, suggestion.suggested);
    if (next == null) {
      skipped.push({ key, reason: "not tunable or invalid value" });
      continue;
    }
    const current = suggestion.current;
    if (String(current) === String(next)) continue;
    changes[key] = {
      from: current,
      to: next,
      reason: suggestion.reason,
    };
  }

  if (!Object.keys(changes).length) {
    return { applied: false, dryRun, reason: "No actionable tuning suggestions", report, changes, skipped };
  }

  if (dryRun) {
    return { applied: false, dryRun: true, report, changes, skipped };
  }

  for (const [key, change] of Object.entries(changes)) {
    userConfig[key] = change.to;
    applyRuntimeConfig(key, change.to);
  }
  userConfig._lastAutoImprovementTune = new Date().toISOString();
  userConfig._lastAutoImprovementChanges = changes;
  writeJSON(USER_CONFIG_PATH, userConfig);
  safeLog(`Applied auto tuning: ${Object.entries(changes).map(([k, v]) => `${k}=${v.to}`).join(", ")}`);

  return { applied: true, dryRun: false, report, changes, skipped };
}

export function formatDailyImprovementReport(report) {
  const s = report.summary;
  const lines = [
    "DAILY AUTO-IMPROVEMENT",
    `Closes: ${s.closes} | PnL: ${s.pnlSol >= 0 ? "+" : ""}${s.pnlSol} SOL ($${s.pnlUsd}) | Win: ${s.winRate}%`,
    `Sharpe: ${s.sharpe} | Sortino: ${s.sortino} | RangeEff: ${s.avgRangeEfficiency ?? "?"}% | Fee/IL: ${s.avgFeeVsIl ?? "?"}`,
  ];
  if (report.suggestions.length) {
    lines.push("", "Suggested tuning:");
    for (const x of report.suggestions.slice(0, 6)) lines.push(`- ${x.key}: ${x.current} -> ${x.suggested} (${x.reason})`);
  }
  if (report.walletActions.length) {
    lines.push("", "Wallet actions:");
    for (const x of report.walletActions.slice(0, 6)) lines.push(`- ${x.wallet.slice(0, 8)}... tagged (${x.samples} samples, win ${x.winRate}%, pnl ${x.pnlSol} SOL)`);
  }
  return lines.join("\n").slice(0, 3900);
}

export function formatAutoTuneResult(result) {
  const lines = [
    result.dryRun ? "AUTO-TUNE PREVIEW" : "AUTO-TUNE RESULT",
    `Applied: ${result.applied ? "yes" : "no"}${result.reason ? ` | ${result.reason}` : ""}`,
  ];
  const entries = Object.entries(result.changes || {});
  if (entries.length) {
    lines.push("", "Changes:");
    for (const [key, change] of entries.slice(0, 8)) {
      lines.push(`- ${key}: ${change.from} -> ${change.to} (${change.reason})`);
    }
  }
  if (result.skipped?.length) {
    lines.push("", "Skipped:");
    for (const item of result.skipped.slice(0, 5)) lines.push(`- ${item.key}: ${item.reason}`);
  }
  return lines.join("\n").slice(0, 3900);
}
