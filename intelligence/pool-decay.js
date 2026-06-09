function finite(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function avg(values) {
  const nums = values.map((v) => Number(v)).filter(Number.isFinite);
  if (nums.length === 0) return 0;
  return nums.reduce((sum, v) => sum + v, 0) / nums.length;
}

export function predictPoolDecay(pool = {}, history = [], options = {}) {
  const halfLifeDays = finite(options.halfLifeDays, 14);
  const feeChange = finite(pool.fee_change_pct, avg(history.map((h) => h.fee_change_pct)));
  const volumeChange = finite(pool.volume_change_pct, avg(history.map((h) => h.volume_change_pct)));
  const activePct = finite(pool.active_pct, 50);
  const feeTvl = finite(pool.fee_active_tvl_ratio ?? pool.fee_tvl_ratio, 0);
  const volatility = finite(pool.volatility, 0);
  const ageHours = finite(pool.token_age_hours, halfLifeDays * 24);

  const momentumPenalty = clamp((-feeChange * 0.7 - volumeChange * 0.3) / 100, -0.3, 0.7);
  const rangePenalty = activePct < 45 ? (45 - activePct) / 80 : 0;
  const volatilityPenalty = volatility > 5 ? clamp((volatility - 5) / 10, 0, 0.4) : 0;
  const agePenalty = ageHours > halfLifeDays * 24 ? 0.1 : 0;
  const feeSupport = clamp(feeTvl / 0.05, 0, 1) * 20;

  const decayRisk = clamp(Math.round((momentumPenalty + rangePenalty + volatilityPenalty + agePenalty) * 100), 0, 100);
  const sustainabilityScore = clamp(Math.round(100 - decayRisk + feeSupport), 0, 100);
  const expectedHalfLifeHours = Math.round(clamp(halfLifeDays * 24 * (sustainabilityScore / 70), 12, halfLifeDays * 48));
  const expectedFeeDecay = Math.round(clamp(-feeChange + decayRisk * 0.35, -30, 95));

  return {
    expected_half_life_hours: expectedHalfLifeHours,
    expected_fee_decay: expectedFeeDecay,
    sustainability_score: sustainabilityScore,
    decay_risk: decayRisk,
    status: decayRisk >= 70 ? "HIGH_DECAY" : decayRisk >= 45 ? "WATCH" : "STABLE",
    explanation: [
      feeChange < 0 ? "fees are decaying" : "fees are stable or improving",
      activePct < 45 ? "in-range activity is weak" : "in-range activity is acceptable",
      volatility > 5 ? "volatility raises IL decay pressure" : "volatility is manageable",
    ].join("; "),
  };
}
