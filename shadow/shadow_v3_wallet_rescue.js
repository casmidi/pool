import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { evaluateShadowV2EngineGuard } from "../lib/shadow_v2_guard.js";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DATA_DIR = process.env.MERIDIAN_SHADOW_DATA_DIR || path.join(ROOT, "data");
const CASES_PATH = path.join(DATA_DIR, "shadow_v3_wallet_rescue_cases.json");
const SUMMARY_PATH = path.join(DATA_DIR, "shadow_v3_wallet_rescue_summary.json");
const DEFAULT_SIZE_SOL = 0.1;
const MAX_DURATION_MINUTES = 120;
const NEUTRAL_PNL_PCT = 0.15;

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readJson(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, data) {
  ensureDataDir();
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8");
  fs.renameSync(tmp, filePath);
}

function num(value, fallback = null) {
  if (value === null || value === undefined || value === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function round(value, digits = 4) {
  const n = num(value, 0);
  const m = 10 ** digits;
  return Math.round(n * m) / m;
}

function firstNum(...values) {
  for (const value of values) {
    const n = num(value, null);
    if (n !== null) return n;
  }
  return null;
}

function dateKey(value = new Date()) {
  const d = value instanceof Date ? value : new Date(value);
  return Number.isFinite(d.getTime()) ? d.toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);
}

function minutesBetween(start, end) {
  const a = new Date(start).getTime();
  const b = new Date(end).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return (b - a) / 60000;
}

function pctFromBins(entryBin, currentBin, binStep) {
  if (entryBin === null || currentBin === null) return null;
  const step = num(binStep, null);
  const delta = currentBin - entryBin;
  if (step !== null && step > 0) {
    return (Math.pow(1 + step / 10000, delta) - 1) * 100;
  }
  return delta * 0.05;
}

function loadTable() {
  const data = readJson(CASES_PATH, { table: "shadow_v3_wallet_rescue_cases", version: 1, cases: [] });
  return {
    table: "shadow_v3_wallet_rescue_cases",
    version: 1,
    cases: Array.isArray(data.cases) ? data.cases : [],
  };
}

function saveTable(table) {
  writeJson(CASES_PATH, {
    table: "shadow_v3_wallet_rescue_cases",
    version: 1,
    updated_at: new Date().toISOString(),
    cases: table.cases.slice(-3000),
  });
}

function poolKey(signal = {}) {
  return signal.pool_address || signal.poolAddress || signal.pool || signal.deployArgs?.pool_address || null;
}

function isWalletFilterReject(signal = {}) {
  const stage = String(signal.rejection_stage || signal.reject_stage || "").toLowerCase();
  const text = [
    stage,
    ...(Array.isArray(signal.risks) ? signal.risks : []),
    ...(Array.isArray(signal.reasons) ? signal.reasons : []),
  ].join(" ").toLowerCase();
  return stage.includes("wallet") || text.includes("low_wallet_score") || text.includes("wallet score");
}

function scoreCandidate(signal = {}) {
  return firstNum(
    signal.alphaScore,
    signal.poolScore,
    signal.pool_score,
    signal.score,
    signal.organicScore,
    signal.organic_score,
  );
}

function buildRescueEligibility(signal = {}, guard = {}) {
  const score = scoreCandidate(signal);
  const organic = firstNum(signal.organicScore, signal.organic_score, signal.deployArgs?.organic_score);
  const fee = firstNum(signal.feeTvlRatio, signal.fee_tvl_ratio, signal.deployArgs?.fee_tvl_ratio);
  const rangeKnown = firstNum(signal.active_bin, signal.activeBin) !== null;
  const scoreOk = score !== null && score >= 70;
  const organicFeeOk = organic !== null && organic >= 70 && fee !== null && fee >= 0.02;
  const blockedByTruth = guard.hard_block === true;
  const eligible = !blockedByTruth && (scoreOk || organicFeeOk);
  const reasons = [];
  if (scoreOk) reasons.push(`score ${score}`);
  if (organicFeeOk) reasons.push(`organic ${organic} fee ${round(fee, 4)}`);
  if (blockedByTruth) reasons.push(`shadow_v2_${guard.warning_level}_${guard.exit_route_status}`);
  if (!rangeKnown) reasons.push("range_geometry_missing");
  if (!eligible && !blockedByTruth) reasons.push("quality_below_rescue_threshold");
  return {
    eligible,
    blocked_by_truth: blockedByTruth,
    score,
    organic,
    fee_tvl_ratio: fee,
    range_known: rangeKnown,
    reasons,
  };
}

function idFor(signal = {}) {
  const key = poolKey(signal) || "unknown";
  const source = signal.id || signal.signal_id || signal.source_signal_id || new Date().toISOString();
  return `shadowv3_${String(key).replace(/[^a-zA-Z0-9]/g, "_")}_${String(source).replace(/[^a-zA-Z0-9]/g, "_")}`.slice(0, 160);
}

export function recordWalletRescueCandidate(signal = {}, options = {}) {
  if (!isWalletFilterReject(signal)) return { recorded: false, reason: "not_wallet_filter_reject" };
  const address = poolKey(signal);
  if (!address) return { recorded: false, reason: "missing_pool_address" };

  const guard = evaluateShadowV2EngineGuard({
    ...signal,
    active_tvl: signal.active_tvl ?? signal.tvl ?? signal.liquidity,
    volume_window: signal.volume_window ?? signal.volume,
    fee_active_tvl_ratio: signal.fee_active_tvl_ratio ?? signal.fee_tvl_ratio ?? signal.feeTvlRatio,
    active_pct: signal.active_pct ?? signal.active_positions_pct,
    active_bin: signal.active_bin ?? signal.activeBin ?? signal.current_bin,
    bin_step: signal.bin_step ?? signal.binStep,
    volatility: signal.volatility ?? signal.volatility_pct,
  }, { ...(options.shadowV2Guard || {}), enforce: true });
  const rescue = buildRescueEligibility(signal, guard);
  const activeBin = firstNum(signal.active_bin, signal.activeBin, signal.current_active_bin, signal.currentActiveBin);
  const entryPrice = firstNum(signal.entry_price, signal.entryPrice, signal.current_price, signal.currentPrice, signal.price);
  const now = signal.timestamp || signal.ts || new Date().toISOString();
  const table = loadTable();
  const id = idFor(signal);
  const existing = table.cases.find((item) => item.id === id);
  if (existing) return { recorded: false, reason: "duplicate", id };

  const record = {
    id,
    pool_name: signal.poolName || signal.pool_name || signal.pair || "unknown",
    pool_address: address,
    source_signal_id: signal.id || signal.signal_id || null,
    source: options.source || signal.source || "wallet_filter",
    created_at: now,
    updated_at: now,
    status: "OPEN",
    outcome: null,
    simulated_size_sol: num(signal.simulated_size_sol, DEFAULT_SIZE_SOL),
    entry_price: entryPrice,
    current_price: entryPrice,
    entry_bin: activeBin,
    current_bin: activeBin,
    lower_bin: firstNum(signal.lower_bin, signal.lowerBin),
    upper_bin: firstNum(signal.upper_bin, signal.upperBin),
    bin_step: firstNum(signal.bin_step, signal.binStep),
    wallet_score: firstNum(signal.walletScore, signal.wallet_score),
    decision_confidence: firstNum(signal.confidence, signal.decision_confidence),
    candidate_score: rescue.score,
    organic_score: rescue.organic,
    fee_tvl_ratio: rescue.fee_tvl_ratio,
    rescue_eligible: rescue.eligible,
    blocked_by_truth: rescue.blocked_by_truth,
    rescue_reasons: rescue.reasons,
    shadow_v2_guard: {
      action: guard.action,
      hard_block: guard.hard_block,
      warning_level: guard.warning_level,
      truth_score: guard.truth_score,
      exit_route_status: guard.exit_route_status,
      reasons: guard.reasons,
    },
    pnl_pct: 0,
    pnl_sol: 0,
    rescue_impact_sol: 0,
  };

  table.cases.push(record);
  saveTable(table);
  return { recorded: true, id, case: record };
}

export function updateShadowV3WalletRescueFromMarket(pool = {}) {
  const address = poolKey(pool);
  if (!address) return { updated: 0, closed: 0 };
  const now = pool.timestamp || pool.ts || new Date().toISOString();
  const currentPrice = firstNum(pool.current_price, pool.currentPrice, pool.price);
  const currentBin = firstNum(pool.active_bin, pool.activeBin, pool.current_active_bin, pool.currentActiveBin);
  const table = loadTable();
  let updated = 0;
  let closed = 0;

  for (const item of table.cases) {
    if (item.pool_address !== address || item.status !== "OPEN") continue;
    const pctFromPrice = currentPrice !== null && item.entry_price
      ? ((currentPrice - item.entry_price) / item.entry_price) * 100
      : null;
    const pct = pctFromPrice !== null
      ? pctFromPrice
      : pctFromBins(item.entry_bin, currentBin, item.bin_step);
    if (pct === null) continue;

    item.current_price = currentPrice ?? item.current_price;
    item.current_bin = currentBin ?? item.current_bin;
    item.pnl_pct = round(pct, 4);
    item.pnl_sol = round((num(item.simulated_size_sol, DEFAULT_SIZE_SOL) * pct) / 100, 6);
    item.updated_at = now;
    updated += 1;

    const age = minutesBetween(item.created_at, now);
    const shouldClose = Math.abs(pct) >= NEUTRAL_PNL_PCT || age >= MAX_DURATION_MINUTES;
    if (!shouldClose) continue;

    item.status = "CLOSED";
    item.closed_at = now;
    if (!item.rescue_eligible) item.outcome = item.blocked_by_truth ? "TRUTH_BLOCKED" : "NOT_ELIGIBLE";
    else if (pct > NEUTRAL_PNL_PCT) item.outcome = "RESCUE_WIN";
    else if (pct < -NEUTRAL_PNL_PCT) item.outcome = "RESCUE_LOSS";
    else item.outcome = "NEUTRAL";
    item.rescue_impact_sol = item.rescue_eligible ? item.pnl_sol : 0;
    closed += 1;
  }

  if (updated > 0) saveTable(table);
  return { updated, closed };
}

export function observeShadowV3WalletRescue(signal = {}, options = {}) {
  const recorded = recordWalletRescueCandidate(signal, options);
  const updated = updateShadowV3WalletRescueFromMarket(signal);
  return {
    ...recorded,
    market_updated: updated.updated,
    market_closed: updated.closed,
  };
}

function topCause(items = []) {
  const counts = {};
  for (const item of items) {
    const key = item.blocked_by_truth
      ? "shadow_v2_truth_block"
      : item.rescue_reasons?.[0] || item.outcome || "none";
    counts[key] = (counts[key] || 0) + 1;
  }
  return Object.entries(counts)
    .map(([cause, count]) => ({ cause, count }))
    .sort((a, b) => b.count - a.count || a.cause.localeCompare(b.cause))[0] || { cause: "none", count: 0 };
}

function classifyStatus({ closedEligible, rescuePnlSol, wins, losses }) {
  if (closedEligible < 30) return "LEARNING";
  if (closedEligible >= 50 && rescuePnlSol > 0.1 && wins > losses) return "CANDIDATE";
  if (closedEligible >= 30) return "WATCH";
  return "LEARNING";
}

export function buildShadowV3WalletRescueSummary({ date = dateKey(), persist = true } = {}) {
  const table = loadTable();
  const cases = table.cases.filter((item) => dateKey(item.created_at) === date || dateKey(item.updated_at) === date);
  const closed = cases.filter((item) => item.status === "CLOSED");
  const eligible = cases.filter((item) => item.rescue_eligible);
  const closedEligible = closed.filter((item) => item.rescue_eligible);
  const wins = closedEligible.filter((item) => item.outcome === "RESCUE_WIN").length;
  const losses = closedEligible.filter((item) => item.outcome === "RESCUE_LOSS").length;
  const rescuePnlSol = closedEligible.reduce((sum, item) => sum + num(item.rescue_impact_sol, item.pnl_sol), 0);
  const root = topCause(cases);
  const summary = {
    table: "shadow_v3_wallet_rescue_summary",
    date,
    generated_at: new Date().toISOString(),
    status: classifyStatus({ closedEligible: closedEligible.length, rescuePnlSol, wins, losses }),
    rescue_pnl_sol: round(rescuePnlSol, 6),
    cases: cases.length,
    open_cases: cases.filter((item) => item.status === "OPEN").length,
    closed_cases: closed.length,
    eligible_cases: eligible.length,
    closed_eligible_cases: closedEligible.length,
    rescue_wins: wins,
    rescue_losses: losses,
    neutral_count: closedEligible.filter((item) => item.outcome === "NEUTRAL").length,
    truth_blocked_count: cases.filter((item) => item.blocked_by_truth).length,
    not_eligible_count: cases.filter((item) => !item.rescue_eligible && !item.blocked_by_truth).length,
    false_rescue_count: losses,
    win_rate_pct: closedEligible.length ? round((wins / closedEligible.length) * 100, 2) : 0,
    top_cause: root.cause,
    top_cause_count: root.count,
  };

  if (persist) {
    const store = readJson(SUMMARY_PATH, { table: "shadow_v3_wallet_rescue_summary", version: 1, summaries: [] });
    const list = Array.isArray(store.summaries) ? store.summaries : [];
    const idx = list.findIndex((item) => item.date === date);
    if (idx >= 0) list[idx] = summary;
    else list.push(summary);
    writeJson(SUMMARY_PATH, {
      table: "shadow_v3_wallet_rescue_summary",
      version: 1,
      updated_at: new Date().toISOString(),
      summaries: list.slice(-400),
    });
  }
  return summary;
}

export function buildShadowV3WalletRescuePayload({ date = dateKey(), limit = 12 } = {}) {
  const table = loadTable();
  const summary = buildShadowV3WalletRescueSummary({ date, persist: true });
  const cases = table.cases
    .filter((item) => dateKey(item.created_at) === date || dateKey(item.updated_at) === date)
    .slice()
    .sort((a, b) => new Date(b.updated_at || b.created_at || 0) - new Date(a.updated_at || a.created_at || 0))
    .slice(0, limit);
  return {
    ok: true,
    summary,
    cases,
    tables: {
      shadow_v3_wallet_rescue_cases: "data/shadow_v3_wallet_rescue_cases.json",
      shadow_v3_wallet_rescue_summary: "data/shadow_v3_wallet_rescue_summary.json",
    },
    rules: {
      auto_deploy: false,
      hard_gate: false,
      production_learning: false,
      promotion_gate: ">=50 closed eligible, pnl > +0.10 SOL, wins > losses",
    },
    ts: new Date().toISOString(),
  };
}

export function resetShadowV3WalletRescueTablesForTest(baseDir) {
  const filePath = baseDir ? path.join(baseDir, "shadow_v3_wallet_rescue_cases.json") : CASES_PATH;
  writeJson(filePath, { table: "shadow_v3_wallet_rescue_cases", version: 1, updated_at: new Date().toISOString(), cases: [] });
}

export const SHADOW_V3_WALLET_RESCUE_CASES_PATH = CASES_PATH;
export const SHADOW_V3_WALLET_RESCUE_SUMMARY_PATH = SUMMARY_PATH;
