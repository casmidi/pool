function finite(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function analyzeCrowding(pool = {}, context = {}) {
  const poolCount = finite(pool.competing_pool_count ?? pool.same_pair_pool_count ?? context.samePairPoolCount, 0);
  const tvl = finite(pool.tvl ?? pool.active_tvl, 0);
  const activeTvl = finite(pool.active_tvl ?? pool.tvl_active ?? tvl, tvl);
  const feeTvl = finite(pool.fee_active_tvl_ratio ?? pool.fee_tvl_ratio, 0);
  const topLpShare = finite(pool.top_lp_share_pct ?? context.topLpSharePct, 0);
  const lpCount = finite(pool.lp_count ?? context.lpCount, 0);

  const fragmentation = clamp(poolCount * 10, 0, 35);
  const lpCompetition = clamp(lpCount / 4 + topLpShare * 0.4, 0, 35);
  const feeCompression = clamp((0.04 - feeTvl) * 500 + (activeTvl > 0 && tvl > 0 ? activeTvl / tvl * 10 : 0), 0, 30);
  const crowdingScore = Math.round(clamp(fragmentation + lpCompetition + feeCompression, 0, 100));

  return {
    crowding_score: crowdingScore,
    lp_competition: Math.round(lpCompetition),
    fee_compression_risk: Math.round(feeCompression),
    status: crowdingScore >= 70 ? "CROWDED" : crowdingScore >= 45 ? "WATCH" : "OPEN",
    recommendation:
      crowdingScore >= 70
        ? "avoid adding size unless edge is exceptional"
        : crowdingScore >= 45
          ? "monitor fee compression"
          : "crowding risk acceptable",
    reasons: [
      `same-pair pools ${poolCount}`,
      `LP competition ${Math.round(lpCompetition)}`,
      `fee compression ${Math.round(feeCompression)}`,
    ],
  };
}
