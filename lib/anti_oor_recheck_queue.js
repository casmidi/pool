import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DATA_DIR = process.env.MERIDIAN_ANTI_OOR_QUEUE_DIR || process.env.MERIDIAN_SHADOW_DATA_DIR || path.join(ROOT, "data");
const QUEUE_PATH = path.join(DATA_DIR, "anti_oor_recheck_queue.json");

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readQueue() {
  try {
    if (!fs.existsSync(QUEUE_PATH)) return { table: "anti_oor_recheck_queue", version: 1, items: [] };
    const data = JSON.parse(fs.readFileSync(QUEUE_PATH, "utf8"));
    return {
      table: "anti_oor_recheck_queue",
      version: 1,
      updated_at: data.updated_at || null,
      items: Array.isArray(data.items) ? data.items : [],
    };
  } catch {
    return { table: "anti_oor_recheck_queue", version: 1, items: [] };
  }
}

function writeQueue(data) {
  ensureDataDir();
  data.updated_at = new Date().toISOString();
  data.items = (data.items || []).slice(-500);
  const tmp = `${QUEUE_PATH}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8");
  fs.renameSync(tmp, QUEUE_PATH);
}

function num(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function idFor(candidate = {}, createdAt = new Date().toISOString()) {
  const pool = String(candidate.pool_address || candidate.pool || "unknown").replace(/[^a-z0-9_-]+/gi, "_").slice(0, 48);
  return `anti_oor_recheck_${pool}_${createdAt.slice(0, 16).replace(/[^0-9T]+/g, "_")}`;
}

export function queueAntiOorRecheck(candidate = {}, antiOor = {}, options = {}) {
  const poolAddress = candidate.pool_address || candidate.pool;
  if (!poolAddress) return { queued: false, reason: "missing pool address" };
  const now = new Date(options.now || new Date()).toISOString();
  const waitMinutes = num(options.waitMinutes ?? antiOor.entryTimingDelay?.waitMinutes, 5) ?? 5;
  const availableAt = new Date(new Date(now).getTime() + waitMinutes * 60000).toISOString();
  const queue = readQueue();
  const id = idFor({ pool_address: poolAddress }, now);
  const existing = queue.items.find((item) => item.id === id);
  const item = existing || {
    id,
    status: "WAITING",
    created_at: now,
    available_at: availableAt,
    processed_at: null,
    pool_address: poolAddress,
    pool_name: candidate.pool_name || candidate.name || "unknown",
    source: options.source || "executor_anti_oor_block",
    score: num(candidate.pool_score ?? candidate.score, null),
    recommendation: candidate.trade_recommendation || candidate.recommendation || candidate.manual_recommendation?.action || null,
    anti_oor_risk: antiOor.oorPrediction?.oorRisk || null,
    anti_oor_score: num(antiOor.oorPrediction?.score, null),
    anti_oor_reasons: antiOor.oorPrediction?.reasons || [],
    momentum_state: antiOor.momentumEscape?.state || null,
    dynamic_range_recommendation: antiOor.dynamicRangeWidth?.recommendation || null,
    dynamic_range_width_multiplier: num(antiOor.dynamicRangeWidth?.widthMultiplier, null),
    active_bin_before_wait: num(candidate.active_bin ?? candidate.activeBin ?? candidate.current_bin, null),
    lower_bin_before_wait: num(candidate.lower_bin ?? candidate.lowerBin, null),
    upper_bin_before_wait: num(candidate.upper_bin ?? candidate.upperBin, null),
    bins_below_before_wait: num(candidate.bins_below ?? candidate.binsBelow, null),
    bins_above_before_wait: num(candidate.bins_above ?? candidate.binsAbove, 0),
    fee_tvl_ratio_before_wait: num(candidate.fee_tvl_ratio ?? candidate.fee_active_tvl_ratio, null),
    volume_before_wait: num(candidate.volume ?? candidate.volume_window, null),
    volatility_before_wait: num(candidate.volatility, null),
    final_range_action: options.finalRangeAction || null,
    shift_up_legal: options.shiftUpLegal ?? null,
    recheck_result: null,
  };
  if (existing) {
    existing.updated_at = now;
    existing.available_at = existing.available_at || availableAt;
  } else {
    queue.items.push(item);
  }
  writeQueue(queue);
  return { queued: !existing, updated: Boolean(existing), id, item };
}

export function getAntiOorRecheckQueue({ status = null, dueOnly = false, now = new Date() } = {}) {
  const queue = readQueue();
  const nowMs = new Date(now).getTime();
  return queue.items.filter((item) => {
    if (status && item.status !== status) return false;
    if (dueOnly && new Date(item.available_at || 0).getTime() > nowMs) return false;
    return true;
  });
}

export function updateAntiOorRecheck(id, patch = {}) {
  const queue = readQueue();
  const item = queue.items.find((entry) => entry.id === id);
  if (!item) return { updated: false, reason: "missing queue item" };
  Object.assign(item, patch, { updated_at: new Date().toISOString() });
  writeQueue(queue);
  return { updated: true, item };
}

export function summarizeAntiOorRecheckQueue() {
  const queue = readQueue();
  const counts = queue.items.reduce((acc, item) => {
    acc[item.status] = (acc[item.status] || 0) + 1;
    return acc;
  }, {});
  return {
    table: "anti_oor_recheck_queue",
    path: QUEUE_PATH,
    total: queue.items.length,
    waiting: counts.WAITING || 0,
    rechecked: counts.RECHECKED || 0,
    still_critical: queue.items.filter((item) => item.recheck_result === "STILL_CRITICAL").length,
    improved: queue.items.filter((item) => item.recheck_result === "IMPROVED_TO_SANDBOX_CANDIDATE").length,
    data_unavailable: queue.items.filter((item) => item.recheck_result === "DATA_UNAVAILABLE").length,
  };
}

export function resetAntiOorRecheckQueueForTest() {
  writeQueue({ table: "anti_oor_recheck_queue", version: 1, items: [] });
}

export const ANTI_OOR_RECHECK_QUEUE_PATH = QUEUE_PATH;
