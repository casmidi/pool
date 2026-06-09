import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { log } from "../logger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATE_PATH = path.join(__dirname, "..", "copy-signals.json");

const DEFAULT_STATE = {
  signals: [],
  ignored: [],
  meta: {
    lastRun: null,
    totalRuns: 0,
  },
};

let _cache = null;

function load() {
  if (_cache) return _cache;
  try {
    _cache = JSON.parse(fs.readFileSync(STATE_PATH, "utf8"));
  } catch {
    _cache = structuredClone(DEFAULT_STATE);
  }
  if (!Array.isArray(_cache.signals)) _cache.signals = [];
  if (!Array.isArray(_cache.ignored)) _cache.ignored = [];
  if (!_cache.meta) _cache.meta = {};
  return _cache;
}

function save() {
  try {
    gcStaleEntries();
    fs.writeFileSync(STATE_PATH, JSON.stringify(_cache, null, 2), "utf8");
  } catch (err) {
    log("copy_state", `Save failed: ${err.message}`);
  }
}

const MAX_TTL_MS = 60 * 60_000;  // 60 min absolute max for any entry

function gcStaleEntries() {
  const now = Date.now();
  for (const listKey of ["signals", "ignored"]) {
    const list = _cache[listKey];
    if (!Array.isArray(list)) continue;
    const before = list.length;
    _cache[listKey] = list.filter((entry) => {
      const ts = new Date(entry.ts || 0).getTime();
      return Number.isFinite(ts) && now - ts <= MAX_TTL_MS;
    });
    if (_cache[listKey].length < before) {
      log("copy_state", `GC removed ${before - _cache[listKey].length} stale ${listKey} entries (max ${MAX_TTL_MS / 60000}min TTL)`);
    }
  }
}

export function getCopyState() {
  return load();
}

export function getRecentCopySignals({ limit = 20, action = null } = {}) {
  const state = load();
  return state.signals
    .filter((s) => !action || s.action === action)
    .slice()
    .sort((a, b) => new Date(b.ts || 0) - new Date(a.ts || 0))
    .slice(0, limit);
}

export function volatilityBasedTtl(baseTtlMs, volatility) {
  if (volatility == null || volatility <= 0) return baseTtlMs;
  // High volatility pools change state fast → shorter TTL
  // Low volatility pools are stable → longer TTL
  if (volatility >= 5) return Math.round(baseTtlMs * 0.4);    // 12-15min for 30min base
  if (volatility >= 3.5) return Math.round(baseTtlMs * 0.6);  // ~18min
  if (volatility >= 2) return Math.round(baseTtlMs * 0.8);    // ~24min
  return baseTtlMs;  // stable: full TTL
}

function findRecentMatch(list, { wallet, position, pool, ttlMs }) {
  const now = Date.now();
  return list.find((entry) => {
    const ts = new Date(entry.ts || 0).getTime();
    if (!Number.isFinite(ts) || now - ts > ttlMs) return false;
    return (
      (position && entry.position === position) ||
      (wallet && pool && entry.wallet === wallet && entry.pool === pool)
    );
  }) || null;
}

export function findDedupeEntriesByPool(list, { pool, sinceMs }) {
  const since = Date.now() - sinceMs;
  return list.filter((entry) => {
    const ts = new Date(entry.ts || 0).getTime();
    return Number.isFinite(ts) && ts >= since && entry.pool === pool;
  });
}

export function hasRecentCopySignal({ wallet, position, pool, ttlMs }) {
  const state = load();
  return findRecentMatch(state.signals, { wallet, position, pool, ttlMs }) ||
    findRecentMatch(state.ignored, { wallet, position, pool, ttlMs }) || false;
}

export function findRecentCopySignal({ wallet, position, pool, ttlMs }) {
  const state = load();
  return findRecentMatch(state.signals, { wallet, position, pool, ttlMs })
    || findRecentMatch(state.ignored, { wallet, position, pool, ttlMs });
}

export function recordCopySignal(signal) {
  const state = load();
  const entry = {
    ...signal,
    ts: signal.ts || new Date().toISOString(),
  };
  state.signals.push(entry);
  if (state.signals.length > 500) {
    state.signals = state.signals.slice(-500);
  }
  save();
  return entry;
}

export function recordIgnoredCopySignal(signal) {
  const state = load();
  const entry = {
    ...signal,
    ts: signal.ts || new Date().toISOString(),
  };
  state.ignored.push(entry);
  if (state.ignored.length > 500) {
    state.ignored = state.ignored.slice(-500);
  }
  save();
  return entry;
}


export function updateCopySignalDeployResult(signal, deployResult) {
  if (!signal || !deployResult) return false;
  const state = load();
  const key = String(signal.poolName || signal.pool || '') + '|' +
              String(signal.wallet || '') + '|' +
              String(signal.ts || '');
  for (let i = state.signals.length - 1; i >= 0; i--) {
    const s = state.signals[i];
    const sk = String(s.poolName || s.pool || '') + '|' +
               String(s.wallet || '') + '|' +
               String(s.ts || '');
    if (sk === key) {
      s.deployResult = deployResult;
      save();
      return true;
    }
  }
  return false;
}


export function touchCopyRun(summary = {}) {
  const state = load();
  state.meta.lastRun = new Date().toISOString();
  state.meta.totalRuns = Number(state.meta.totalRuns || 0) + 1;
  state.meta.lastSummary = summary;
  save();
  return state.meta;
}
