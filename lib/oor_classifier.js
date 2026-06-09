/**
 * OOR 3-Kategori Classifier
 *
 * Classifies out-of-range positions into three categories:
 *   OOR_BREAKOUT — healthy trend: fee still flowing, volume organic → shift + redeploy
 *   OOR_DUMP     — unhealthy dump: fee dropping, no volume → close faster
 *   OOR_NEUTRAL  — everything else → keep existing timer
 */

const FEE_HEALTHY_THRESHOLD = 7;
const FEE_CRITICAL_THRESHOLD = 3;
const MIN_OOR_MINUTES_BREAKOUT = 10;
const MIN_OOR_MINUTES_DUMP = 5;

/**
 * Classify an OOR position.
 * @param {Object} position - Position object from getMyPositions()
 * @param {Object} [opts]
 * @param {number} [opts.feeHealthyThreshold=FEE_HEALTHY_THRESHOLD]
 * @param {number} [opts.feeCriticalThreshold=FEE_CRITICAL_THRESHOLD]
 * @returns {{ classification: string, action: string, reason: string, waitMinutes: number }}
 */
export function classifyOor(position, opts = {}) {
  const {
    feeHealthyThreshold = FEE_HEALTHY_THRESHOLD,
    feeCriticalThreshold = FEE_CRITICAL_THRESHOLD,
  } = opts;

  const isAbove = position.active_bin > position.upper_bin;
  const isBelow = position.active_bin < position.lower_bin;
  if (!isAbove && !isBelow) {
    return {
      classification: "IN_RANGE",
      action: "STAY",
      reason: "position is in range",
      waitMinutes: 0,
    };
  }

  const fee24h = position.fee_per_tvl_24h ?? null;
  const minutesOor = position.minutes_out_of_range ?? 0;
  const pnlPct = position.pnl_pct ?? 0;
  const feeTvl = position.fee_tvl_ratio ?? position.fee_active_tvl_ratio ?? null;

  const feeHealthy = fee24h != null && fee24h >= feeHealthyThreshold;
  const feeCritical = fee24h != null && fee24h <= feeCriticalThreshold;
  const feeDropping = feeTvl != null && fee24h != null && feeTvl < fee24h * 0.5;

  if (feeHealthy && minutesOor >= MIN_OOR_MINUTES_BREAKOUT) {
    return {
      classification: "OOR_BREAKOUT",
      action: "SHIFT_AND_REDEPLOY",
      reason: `healthy breakout: fee24h=${fee24h} above threshold=${feeHealthyThreshold}, OOR for ${minutesOor}m`,
      waitMinutes: 0,
    };
  }

  if (feeHealthy && minutesOor < MIN_OOR_MINUTES_BREAKOUT) {
    return {
      classification: "OOR_BREAKOUT",
      action: "HOLD_AND_WATCH",
      reason: `recent breakout with healthy fee (${fee24h}), watching for ${MIN_OOR_MINUTES_BREAKOUT - minutesOor}m before deciding`,
      waitMinutes: MIN_OOR_MINUTES_BREAKOUT - minutesOor,
    };
  }

  if (feeCritical || feeDropping) {
    return {
      classification: "OOR_DUMP",
      action: "CLOSE_FAST",
      reason: feeCritical
        ? `critical fee: fee24h=${fee24h} below critical=${feeCriticalThreshold}`
        : `fee dropping: feeTvl=${feeTvl} vs fee24h=${fee24h} (50%+ drop detected)`,
      waitMinutes: Math.max(0, MIN_OOR_MINUTES_DUMP - Math.min(minutesOor, MIN_OOR_MINUTES_DUMP)),
    };
  }

  return {
    classification: "OOR_NEUTRAL",
    action: "USE_EXISTING_TIMER",
    reason: `neutral OOR: fee24h=${fee24h ?? "N/A"}, OOR for ${minutesOor}m, pnl=${pnlPct.toFixed(1)}%`,
    waitMinutes: 0,
  };
}
