import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { getShadowTable } from "./shadow_engine.js";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DATA_DIR = process.env.MERIDIAN_SHADOW_DATA_DIR || path.join(ROOT, "data");
const SUMMARY_PATH = path.join(DATA_DIR, "shadow_daily_summary.json");
const PNL_PATH = path.join(DATA_DIR, "pnl_log.json");

function readJson(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, data) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8");
  fs.renameSync(tmp, filePath);
}

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function round(value, digits = 4) {
  const m = 10 ** digits;
  return Math.round(num(value) * m) / m;
}

function dateKey(value = new Date()) {
  const d = value instanceof Date ? value : new Date(value);
  return Number.isFinite(d.getTime()) ? d.toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);
}

function realPnlSol(date) {
  const data = readJson(PNL_PATH, { trades: [] });
  return (data.trades || [])
    .filter((t) => String(t.status || "").toLowerCase() === "closed")
    .filter((t) => dateKey(t.close_time || t.closeTime || t.updated_at || t.ts) === date)
    .reduce((sum, t) => sum + num(t.pnl_sol ?? t.pnlSol, 0), 0);
}

function topCause(positions = []) {
  const counts = {};
  for (const p of positions) {
    const key = p.likely_cause || p.reject_stage || "unknown";
    counts[key] = (counts[key] || 0) + 1;
  }
  return Object.entries(counts)
    .map(([cause, count]) => ({ cause, count }))
    .sort((a, b) => b.count - a.count || a.cause.localeCompare(b.cause))[0] || { cause: "none", count: 0 };
}

export function classifyShadowStatus({ sampleCount, impactRatioPct, falseNegativeCount, shadowPnlSol }) {
  if (sampleCount >= 100 && impactRatioPct >= 40 && falseNegativeCount >= 30 && shadowPnlSol > 0) return "READY";
  if (sampleCount >= 100 && impactRatioPct >= 25 && falseNegativeCount >= 20) return "CANDIDATE";
  if (sampleCount >= 100 && impactRatioPct >= 10) return "WATCH";
  return "LEARNING";
}

export function buildShadowSummary({ date = dateKey(), persist = true } = {}) {
  const table = getShadowTable();
  const positions = (table.positions || []).filter((p) => dateKey(p.created_at) === date || dateKey(p.updated_at) === date);
  const closed = positions.filter((p) => String(p.status || "").toUpperCase() === "CLOSED");
  const incomplete = positions.filter((p) => String(p.status || "").toUpperCase() === "DATA_INCOMPLETE" || p.verdict === "DATA_INCOMPLETE");
  const shadowPnlSol = closed.reduce((sum, p) => sum + num(p.pnl_sol, 0), 0);
  const realPnl = realPnlSol(date);
  const simulatedTotal = realPnl + shadowPnlSol;
  const impactRatioPct = realPnl !== 0
    ? (shadowPnlSol / Math.abs(realPnl)) * 100
    : (shadowPnlSol !== 0 ? 100 : 0);
  const falseNegativeCount = closed.filter((p) => p.verdict === "FALSE_NEGATIVE").length;
  const goodRejectionCount = closed.filter((p) => p.verdict === "GOOD_REJECTION").length;
  const neutralCount = closed.filter((p) => p.verdict === "NEUTRAL").length;
  const root = topCause(positions);
  const status = classifyShadowStatus({
    sampleCount: positions.length,
    impactRatioPct,
    falseNegativeCount,
    shadowPnlSol,
  });
  const summary = {
    table: "shadow_daily_summary",
    date,
    generated_at: new Date().toISOString(),
    status,
    real_pnl_sol: round(realPnl, 6),
    shadow_pnl_sol: round(shadowPnlSol, 6),
    simulated_total_pnl_sol: round(simulatedTotal, 6),
    impact_ratio_pct: round(impactRatioPct, 2),
    shadow_cases: positions.length,
    open_cases: positions.filter((p) => String(p.status || "").toUpperCase() === "OPEN").length,
    closed_cases: closed.length,
    data_incomplete_count: incomplete.length,
    false_negative_count: falseNegativeCount,
    good_rejection_count: goodRejectionCount,
    neutral_count: neutralCount,
    top_root_cause: root.cause,
    top_root_cause_count: root.count,
  };

  if (persist) {
    const store = readJson(SUMMARY_PATH, { table: "shadow_daily_summary", version: 1, summaries: [] });
    const list = Array.isArray(store.summaries) ? store.summaries : [];
    const idx = list.findIndex((item) => item.date === date);
    if (idx >= 0) list[idx] = summary;
    else list.push(summary);
    writeJson(SUMMARY_PATH, {
      table: "shadow_daily_summary",
      version: 1,
      updated_at: new Date().toISOString(),
      summaries: list.slice(-400),
    });
  }

  return summary;
}

export function buildShadowPayload({ date = dateKey(), limit = 12 } = {}) {
  const table = getShadowTable();
  const summary = buildShadowSummary({ date, persist: true });
  const positions = (table.positions || [])
    .slice()
    .sort((a, b) => new Date(b.updated_at || b.created_at || 0) - new Date(a.updated_at || a.created_at || 0))
    .slice(0, limit);
  return {
    ok: true,
    summary,
    positions,
    tables: {
      shadow_positions: "data/shadow_positions.json",
      shadow_daily_summary: "data/shadow_daily_summary.json",
    },
    rules: {
      production_engine_modified: false,
      auto_deploy: false,
      auto_learning_to_production: false,
    },
    ts: new Date().toISOString(),
  };
}

export function formatShadowTelegram(payload = buildShadowPayload()) {
  const s = payload.summary || {};
  return [
    "SHADOW INTELLIGENCE",
    "",
    `Status: ${s.status || "LEARNING"}`,
    `Shadow PnL: ${s.shadow_pnl_sol ?? 0} SOL`,
    `Real PnL: ${s.real_pnl_sol ?? 0} SOL`,
    `Impact: ${s.impact_ratio_pct ?? 0}%`,
    `Cases: ${s.shadow_cases ?? 0} | Open: ${s.open_cases ?? 0} | Closed: ${s.closed_cases ?? 0}`,
    `False Negative: ${s.false_negative_count ?? 0}`,
    `Good Rejection: ${s.good_rejection_count ?? 0}`,
    `Top Cause: ${s.top_root_cause || "none"}`,
    "",
    "Report only. No auto-deploy, no production learning.",
  ].join("\n");
}

export const SHADOW_SUMMARY_PATH = SUMMARY_PATH;
