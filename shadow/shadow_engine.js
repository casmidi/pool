import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DATA_DIR = process.env.MERIDIAN_SHADOW_DATA_DIR || path.join(ROOT, "data");
const POSITIONS_PATH = path.join(DATA_DIR, "shadow_positions.json");
const DEFAULT_SIZE_SOL = 0.1;
const MAX_DURATION_MINUTES = 180;
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

function firstValue(...values) {
  for (const value of values) {
    if (value !== null && value !== undefined && value !== "") return value;
  }
  return null;
}

function textOf(value) {
  if (Array.isArray(value)) return value.join(" | ");
  if (value && typeof value === "object") {
    try { return JSON.stringify(value); } catch { return String(value); }
  }
  return String(value || "");
}

function normalizeStage(signal = {}) {
  const stage = String(signal.rejection_stage || signal.reject_stage || signal.stage || "").toLowerCase();
  if (stage === "wallet_filter" || stage === "decision_filter") return stage;
  const text = [
    stage,
    textOf(signal.risks),
    textOf(signal.reasons),
    textOf(signal.reject_reason),
  ].join(" ").toLowerCase();
  if (text.includes("wallet")) return "wallet_filter";
  if (text.includes("decision") || text.includes("confidence") || text.includes("score")) return "decision_filter";
  return stage || "decision_filter";
}

function normalizeReasons(signal = {}) {
  const risks = Array.isArray(signal.risks) ? signal.risks : [];
  const reasons = Array.isArray(signal.reasons) ? signal.reasons : [];
  const raw = signal.reject_reason ?? signal.reason ?? signal.likely_logic_failure ?? "";
  return [...risks, ...reasons, raw].filter(Boolean).map((x) => String(x));
}

function hasMajorRisk(signal = {}) {
  const reasons = normalizeReasons(signal).join(" ").toLowerCase();
  const tvl = num(signal.tvl ?? signal.activeTvl ?? signal.active_tvl ?? signal.deployArgs?.tvl, null);
  const liquidity = num(signal.liquidity ?? signal.deployArgs?.liquidity, null);
  const spread = num(signal.spreadPct ?? signal.spread_pct ?? signal.deployArgs?.spread_pct, null);
  const entryPrice = num(signal.entry_price ?? signal.price ?? signal.deployArgs?.entry_price, null);
  const activeBin = num(signal.activeBin ?? signal.active_bin ?? signal.deployArgs?.active_bin, null);

  const textBlocks = [
    "rug",
    "rug_risk_high",
    "high_rug",
    "mint authority",
    "freeze authority",
    "mint_authority",
    "freeze_authority",
    "invalid price",
    "invalid_price",
    "price feed",
    "abnormal spread",
    "spread_abnormal",
    "dangerous",
    "thin_liquidity",
    "low_liquidity",
  ];

  const textRisk = textBlocks.some((needle) => reasons.includes(needle));
  const tvlRisk = tvl !== null && tvl < 5000;
  const liqRisk = liquidity !== null && liquidity < 5000;
  const spreadRisk = spread !== null && spread > 5;
  const priceRisk = entryPrice !== null && entryPrice <= 0;
  const binRisk = activeBin !== null && activeBin <= 0;

  const blocked = textRisk || tvlRisk || liqRisk || spreadRisk || priceRisk || binRisk;
  return {
    blocked,
    reasons: [
      textRisk ? "major risk text marker" : null,
      tvlRisk ? `TVL too small (${tvl})` : null,
      liqRisk ? `liquidity too small (${liquidity})` : null,
      spreadRisk ? `spread abnormal (${spread}%)` : null,
      priceRisk ? "invalid price feed" : null,
      binRisk ? "invalid active bin" : null,
    ].filter(Boolean),
  };
}

function loadTable() {
  const table = readJson(POSITIONS_PATH, null);
  if (table && Array.isArray(table.positions)) {
    return {
      table: "shadow_positions",
      version: 1,
      updated_at: table.updated_at || null,
      positions: table.positions,
    };
  }
  return { table: "shadow_positions", version: 1, updated_at: null, positions: [] };
}

function saveTable(table) {
  table.updated_at = new Date().toISOString();
  writeJson(POSITIONS_PATH, table);
}

function pairFrom(signal = {}) {
  const name = signal.poolName || signal.pool_name || signal.pair || "";
  if (String(name).includes("-")) return String(name);
  return signal.pair || name || "UNKNOWN";
}

function idFor(signal = {}) {
  const source = signal.id || signal.signal_id || signal.trace_id || [
    signal.pool || signal.pool_address || signal.poolAddress,
    signal.wallet || signal.source_wallet || signal.timestamp || signal.ts,
    normalizeStage(signal),
  ].filter(Boolean).join(":");
  return `shadow_${String(source || Date.now()).replace(/[^a-z0-9_-]+/gi, "_").slice(0, 96)}`;
}

function initialVerdict(signal = {}) {
  const verdict = String(signal.verdict || "").toUpperCase();
  if (verdict === "FALSE_NEGATIVE" || verdict === "UNCLEAR") return verdict;
  return "UNCLEAR";
}

export function recordShadowCandidate(signal = {}) {
  const rejectStage = normalizeStage(signal);
  if (!["wallet_filter", "decision_filter"].includes(rejectStage)) {
    return { recorded: false, reason: `stage ${rejectStage} not tracked` };
  }

  const verdict = initialVerdict(signal);
  if (!["FALSE_NEGATIVE", "UNCLEAR"].includes(verdict)) {
    return { recorded: false, reason: `verdict ${verdict || "unknown"} not tracked` };
  }

  const risk = hasMajorRisk(signal);
  if (risk.blocked) {
    return { recorded: false, reason: `major risk: ${risk.reasons.join(", ")}` };
  }

  const poolAddress = firstValue(signal.pool_address, signal.poolAddress, signal.pool, signal.deployArgs?.pool_address);
  if (!poolAddress) return { recorded: false, reason: "missing pool address" };

  const activeBin = firstNum(
    signal.active_bin,
    signal.activeBin,
    signal.current_active_bin,
    signal.currentActiveBin,
    signal.deployArgs?.active_bin
  );
  const lowerBin = firstNum(signal.lower_bin, signal.lowerBin, signal.range_lower_bin, signal.deployArgs?.lower_bin);
  const upperBin = firstNum(signal.upper_bin, signal.upperBin, signal.range_upper_bin, signal.deployArgs?.upper_bin);
  const entryPrice = firstNum(
    signal.entry_price,
    signal.entryPrice,
    signal.price,
    signal.current_price,
    signal.currentPrice,
    signal.deployArgs?.entry_price,
    signal.deployArgs?.price,
    activeBin
  );
  const score = firstNum(signal.alphaScore, signal.poolScore, signal.score, signal.walletScore);
  const conf = firstNum(signal.confidence);
  const potentialFalseNegative = Boolean(signal.potential_logic_failure) ||
    (score !== null && score >= 75) ||
    (conf !== null && conf >= 0.75);

  const table = loadTable();
  const id = idFor(signal);
  const existing = table.positions.find((p) => p.id === id || (
    p.pool_address === poolAddress &&
    p.source_signal_id === (signal.id || signal.signal_id) &&
    p.reject_stage === rejectStage
  ));
  if (existing) return { recorded: false, reason: "duplicate", id: existing.id };

  const now = signal.timestamp || signal.ts || new Date().toISOString();
  const position = {
    id,
    source_signal_id: signal.id || signal.signal_id || null,
    pool_name: signal.poolName || signal.pool_name || signal.pair || "unknown",
    pool_address: poolAddress,
    pair: pairFrom(signal),
    created_at: now,
    updated_at: now,
    reject_stage: rejectStage,
    reject_reason: normalizeReasons(signal).join(" | ") || rejectStage,
    verdict,
    likely_cause: signal.likely_logic_failure || signal.likely_cause || `${rejectStage}_candidate`,
    potential_false_negative: potentialFalseNegative,
    potential_logic_failure: signal.potential_logic_failure || (potentialFalseNegative ? `${rejectStage}_too_strict` : null),
    entry_price: entryPrice,
    current_price: entryPrice,
    active_bin: activeBin,
    current_active_bin: activeBin,
    range_lower_bin: lowerBin,
    range_upper_bin: upperBin,
    simulated_size_sol: num(signal.simulated_size_sol ?? signal.deployArgs?.amount_sol, DEFAULT_SIZE_SOL),
    wallet_score: num(signal.walletScore ?? signal.wallet_score ?? signal.score, null),
    fee_tvl_ratio: num(signal.feeTvlRatio ?? signal.fee_tvl_ratio ?? signal.deployArgs?.fee_tvl_ratio, null),
    volatility_pct: num(signal.volatility ?? signal.volatility_pct ?? signal.deployArgs?.volatility, null),
    decision_score: num(signal.confidence ?? signal.decision_score, null),
    bin_step: num(signal.binStep ?? signal.bin_step ?? signal.deployArgs?.bin_step, null),
    pnl_pct: 0,
    pnl_sol: 0,
    out_of_range: false,
    close_reason: null,
    closed_at: null,
    status: "OPEN",
  };

  table.positions.push(position);
  if (table.positions.length > 2000) table.positions = table.positions.slice(-2000);
  saveTable(table);
  return { recorded: true, id: position.id, position };
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

function classifyClosed(position) {
  if (position.data_incomplete) return "DATA_INCOMPLETE";
  const pnl = num(position.pnl_pct, 0);
  if (position.out_of_range || pnl < -NEUTRAL_PNL_PCT) return "GOOD_REJECTION";
  if (pnl > NEUTRAL_PNL_PCT) return "FALSE_NEGATIVE";
  return "NEUTRAL";
}

function hasUsableMarketGeometry(position = {}, currentBin = null, currentPrice = null) {
  const entryPrice = num(position.entry_price, null);
  const entryBin = num(position.active_bin, null);
  const canUsePrice = entryPrice !== null && entryPrice > 0 && currentPrice !== null;
  const canUseBins = entryBin !== null && currentBin !== null;
  return canUsePrice || canUseBins;
}

export function updateShadowFromMarket(market = {}) {
  const poolAddress = market.pool_address || market.poolAddress || market.pool || market.deployArgs?.pool_address;
  if (!poolAddress) return { updated: 0, closed: 0 };
  const table = loadTable();
  const nowIso = market.timestamp || market.ts || new Date().toISOString();
  const nowMs = new Date(nowIso).getTime();
  const currentBin = firstNum(
    market.active_bin,
    market.activeBin,
    market.current_active_bin,
    market.currentActiveBin,
    market.deployArgs?.active_bin
  );
  const currentPrice = firstNum(
    market.price,
    market.entry_price,
    market.entryPrice,
    market.current_price,
    market.currentPrice,
    market.deployArgs?.entry_price,
    market.deployArgs?.price,
    currentBin
  );
  let updated = 0;
  let closed = 0;

  for (const pos of table.positions) {
    if (String(pos.status || "").toUpperCase() !== "OPEN" || pos.pool_address !== poolAddress) continue;
    const pnlPct = currentPrice !== null && num(pos.entry_price, null) !== null && num(pos.entry_price, 0) > 0
      ? ((currentPrice - Number(pos.entry_price)) / Number(pos.entry_price)) * 100
      : pctFromBins(num(pos.active_bin, null), currentBin, pos.bin_step);
    const hasGeometry = hasUsableMarketGeometry(pos, currentBin, currentPrice);
    if (pnlPct !== null && hasGeometry) {
      pos.pnl_pct = round(pnlPct, 4);
      pos.pnl_sol = round(num(pos.simulated_size_sol, DEFAULT_SIZE_SOL) * (pnlPct / 100), 6);
    }
    pos.current_price = currentPrice ?? pos.current_price;
    pos.current_active_bin = currentBin ?? pos.current_active_bin;
    pos.updated_at = nowIso;

    const below = currentBin !== null && num(pos.range_lower_bin, null) !== null && currentBin < Number(pos.range_lower_bin);
    const above = currentBin !== null && num(pos.range_upper_bin, null) !== null && currentBin > Number(pos.range_upper_bin);
    pos.out_of_range = below || above;
    const ageMinutes = Number.isFinite(nowMs)
      ? (nowMs - new Date(pos.created_at).getTime()) / 60000
      : 0;
    if (!hasGeometry && ageMinutes >= MAX_DURATION_MINUTES) {
      pos.status = "DATA_INCOMPLETE";
      pos.closed_at = nowIso;
      pos.close_reason = "shadow_missing_market_geometry";
      pos.data_incomplete = true;
      pos.verdict = "DATA_INCOMPLETE";
      closed += 1;
    } else if (pos.out_of_range || ageMinutes >= MAX_DURATION_MINUTES) {
      pos.status = "CLOSED";
      pos.closed_at = nowIso;
      pos.close_reason = pos.out_of_range ? (above ? "shadow_out_of_range_above" : "shadow_out_of_range_below") : "shadow_max_duration";
      pos.verdict = classifyClosed(pos);
      closed += 1;
    }
    updated += 1;
  }

  if (updated) saveTable(table);
  return { updated, closed };
}

export function updateShadowFromSignals(signals = []) {
  let recorded = 0;
  let updated = 0;
  let closed = 0;
  let skipped = 0;
  for (const signal of signals || []) {
    const r = recordShadowCandidate(signal);
    if (r.recorded) recorded += 1;
    else skipped += 1;
    const u = updateShadowFromMarket(signal);
    updated += u.updated;
    closed += u.closed;
  }
  return { recorded, updated, closed, skipped };
}

export function getShadowPositions({ limit = 50, status = null } = {}) {
  const table = loadTable();
  return table.positions
    .filter((p) => !status || p.status === status)
    .slice()
    .sort((a, b) => new Date(b.updated_at || b.created_at || 0) - new Date(a.updated_at || a.created_at || 0))
    .slice(0, limit);
}

export function getShadowTable() {
  return loadTable();
}

export function resetShadowTablesForTest(baseDir) {
  const filePath = baseDir ? path.join(baseDir, "shadow_positions.json") : POSITIONS_PATH;
  writeJson(filePath, { table: "shadow_positions", version: 1, updated_at: new Date().toISOString(), positions: [] });
}

export const SHADOW_POSITIONS_PATH = POSITIONS_PATH;
