function num(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function bool(value) {
  return value === true || String(value).toLowerCase() === "true";
}

export function buildTradeRecommendation(pool = {}, scored = {}) {
  const score = num(scored.score ?? pool.pool_score, 0);
  const grade = scored.grade ?? pool.pool_grade ?? null;
  const reasons = [];
  const warnings = [];

  const hardRisk =
    bool(pool.is_wash) ||
    bool(pool.dev_sold_all) ||
    bool(pool.is_rugpull) ||
    String(pool.risk_level || "").toLowerCase() === "high";

  if (hardRisk) {
    return {
      action: "DANGER",
      confidence: "high",
      reasons: ["hard risk flag present"],
      warnings,
      manual_only: true,
      auto_buy_allowed: false,
    };
  }

  const volatility = num(pool.volatility);
  const feeRatio = num(pool.fee_active_tvl_ratio ?? pool.fee_tvl_ratio, 0);
  const organic = num(pool.organic_score ?? pool.base?.organic_score ?? pool.base?.organic, 0);
  const activePct = num(pool.active_pct, 0);
  const smartWalletSignal =
    bool(pool.smart_money_buy) ||
    bool(pool.kol_in_clusters) ||
    String(pool.top_cluster_trend || "").toLowerCase() === "buy";

  if (volatility == null || volatility <= 0) warnings.push("volatility_missing");
  if (volatility != null && volatility > 5) warnings.push("extreme_volatility");
  if (feeRatio < 0.02) warnings.push("weak_fee_active_tvl");
  if (organic < 70) warnings.push("weak_organic_score");
  if (activePct > 0 && activePct < 45) warnings.push("low_active_liquidity");

  if (score >= 72 && warnings.length === 0) {
    reasons.push("high score with clean risk context");
    return {
      action: "BUY",
      confidence: smartWalletSignal ? "high" : "medium",
      reasons,
      warnings,
      manual_only: true,
      auto_buy_allowed: false,
    };
  }

  if (score >= 60 && warnings.length <= 1) {
    reasons.push("good score but needs manual confirmation");
    return {
      action: smartWalletSignal ? "WATCH" : "WATCH_SHADOW",
      confidence: smartWalletSignal ? "medium" : "low",
      reasons,
      warnings,
      manual_only: true,
      auto_buy_allowed: false,
    };
  }

  if (score >= 45) {
    reasons.push("borderline score");
    return {
      action: "WATCH_SHADOW",
      confidence: "low",
      reasons,
      warnings,
      manual_only: true,
      auto_buy_allowed: false,
    };
  }

  return {
    action: "SKIP",
    confidence: "low",
    reasons: ["score below deployable range"],
    warnings,
    manual_only: true,
    auto_buy_allowed: false,
  };
}
