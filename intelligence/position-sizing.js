function finite(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function recommendPositionSize(pool = {}, portfolio = {}, options = {}) {
  const baseAmountSol = finite(options.baseAmountSol ?? portfolio.baseAmountSol, 0.1);
  const minAmountSol = finite(options.minAmountSol, baseAmountSol * 0.5);
  const maxAmountSol = finite(options.maxAmountSol ?? portfolio.maxAmountSol, baseAmountSol * 2);
  const score = finite(pool.pool_score ?? pool.score, 50);
  const confidence = finite(pool.confidence ?? pool.ai_confidence, score / 100);
  const decayRisk = finite(pool.decay?.decay_risk ?? pool.decay_risk, 35);
  const crowding = finite(pool.crowding?.crowding_score ?? pool.crowding_score, 35);
  const winRate = finite(portfolio.winRate ?? portfolio.win_rate, 0.55);

  const conviction =
    score * 0.45 +
    clamp(confidence * 100, 0, 100) * 0.25 +
    (100 - decayRisk) * 0.15 +
    (100 - crowding) * 0.1 +
    clamp(winRate * 100, 0, 100) * 0.05;
  const multiplier = clamp(0.5 + (conviction - 50) / 80, 0.5, 1.5);
  const amountSol = clamp(baseAmountSol * multiplier, minAmountSol, maxAmountSol);

  return {
    amountSol: Math.round(amountSol * 10000) / 10000,
    multiplier: Math.round(multiplier * 100) / 100,
    conviction: Math.round(conviction),
    confidence: Math.round(clamp(confidence * 100, 0, 100)),
    reasons: [
      `score ${score}`,
      `decay risk ${decayRisk}`,
      `crowding ${crowding}`,
      `portfolio win rate ${(winRate * 100).toFixed(0)}%`,
    ],
  };
}
