const DUMMY_POOL_NAMES = new Set(["pool_a", "pool_b", "dummy_pool", "test_pool"]);

function finiteNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function readTrainingPnlPct(record = {}) {
  const direct = finiteNumber(record.pnl_pct);
  if (direct != null) return direct;

  const pnlUsd = finiteNumber(record.pnl_usd);
  const initialUsd = finiteNumber(record.initial_value_usd);
  if (pnlUsd != null && initialUsd != null && initialUsd > 0) {
    return (pnlUsd / initialUsd) * 100;
  }

  const finalUsd = finiteNumber(record.final_value_usd);
  const feesUsd = finiteNumber(record.fees_earned_usd) ?? 0;
  if (finalUsd != null && initialUsd != null && initialUsd > 0) {
    return ((finalUsd + feesUsd - initialUsd) / initialUsd) * 100;
  }

  return null;
}

export function isDummyTrainingRecord(record = {}) {
  const names = [
    record.pool,
    record.pool_name,
    record.name,
    record.position,
  ].map((v) => String(v || "").trim().toLowerCase()).filter(Boolean);

  return names.some((name) => DUMMY_POOL_NAMES.has(name) || name.startsWith("dummy_"));
}

export function validateTrainingRecord(record = {}, options = {}) {
  const requireSignals = options.requireSignals === true;

  if (!record || typeof record !== "object") {
    return { ok: false, reason: "not_an_object" };
  }
  if (record.exclude_from_training === true) {
    return { ok: false, reason: record.training_exclusion_reason || "explicitly_excluded" };
  }
  if (isDummyTrainingRecord(record)) {
    return { ok: false, reason: "dummy_record" };
  }

  const pnlPct = readTrainingPnlPct(record);
  if (pnlPct == null) {
    return { ok: false, reason: "missing_outcome" };
  }
  if (Math.abs(pnlPct) > 95) {
    return { ok: false, reason: "implausible_outcome" };
  }

  const ts = record.recorded_at || record.closed_at || record.deployed_at || record.ts;
  if (!ts || Number.isNaN(Date.parse(ts))) {
    return { ok: false, reason: "missing_timestamp" };
  }

  const hasAnyMarketContext = [
    record.volatility,
    record.fee_tvl_ratio,
    record.fee_active_tvl_ratio,
    record.organic_score,
    record.bin_step,
    record.bin_range,
    record.signal_snapshot,
  ].some((value) => value != null);
  if (!hasAnyMarketContext) {
    return { ok: false, reason: "missing_market_context" };
  }

  if (requireSignals) {
    const snap = record.signal_snapshot;
    if (!snap || typeof snap !== "object") {
      return { ok: false, reason: "missing_signal_snapshot" };
    }
    const usableSignals = Object.values(snap).filter((value) => {
      if (typeof value === "boolean") return true;
      return finiteNumber(value) != null || String(value || "").trim() !== "";
    });
    if (usableSignals.length < 3) {
      return { ok: false, reason: "sparse_signal_snapshot" };
    }
  }

  return { ok: true, reason: null };
}

export function filterValidTrainingRecords(records = [], options = {}) {
  return (Array.isArray(records) ? records : []).filter((record) => validateTrainingRecord(record, options).ok);
}
