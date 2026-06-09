function finite(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function poolScore(pool) {
  return finite(pool.pool_score ?? pool.score ?? pool.alpha_score, 0);
}

function currentScore(position) {
  return finite(position.pool_score ?? position.score ?? position.alpha_score, 0);
}

export function evaluateOpportunityCost(currentPositions = [], availablePools = [], options = {}) {
  const minScoreGap = finite(options.minScoreGap, 12);
  const minNetGain = finite(options.minNetGain, 8);
  const bestPool = [...(availablePools ?? [])].sort((a, b) => poolScore(b) - poolScore(a))[0] ?? null;
  const evaluations = (currentPositions ?? []).map((position) => {
    const scoreGap = bestPool ? poolScore(bestPool) - currentScore(position) : 0;
    const currentNet = finite(position.pnl_usd) + finite(position.fees_earned_usd);
    const switchCost = finite(options.switchCostUsd, 0);
    const estimatedGain = scoreGap + currentNet - switchCost;
    return {
      pool: position.pool,
      name: position.name ?? position.pool,
      currentScore: currentScore(position),
      bestAlternative: bestPool
        ? { pool: bestPool.pool, name: bestPool.name, score: poolScore(bestPool) }
        : null,
      scoreGap,
      estimatedGain: Math.round(estimatedGain * 100) / 100,
      shouldRedeploy: Boolean(bestPool && scoreGap >= minScoreGap && estimatedGain >= minNetGain),
      reason: bestPool
        ? `best alternative score gap ${scoreGap.toFixed(1)}`
        : "no alternative pool available",
    };
  });

  return {
    generatedAt: new Date().toISOString(),
    bestPool,
    evaluations,
    redeployCandidates: evaluations.filter((item) => item.shouldRedeploy),
  };
}

export const shouldRedeploy = evaluateOpportunityCost;
