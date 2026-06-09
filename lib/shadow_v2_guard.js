import { analyzePreTradeTruth } from "../shadow/shadow_v2_engine.js";

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeList(value, fallback = []) {
  if (Array.isArray(value)) return value.map((item) => String(item).toUpperCase());
  if (typeof value === "string") return value.split(",").map((item) => item.trim().toUpperCase()).filter(Boolean);
  return fallback;
}

function penaltyForLevel(level, cfg = {}) {
  const key = String(level || "CLEAR").toUpperCase();
  if (key === "CRITICAL") return num(cfg.criticalPenalty, 35);
  if (key === "HIGH") return num(cfg.highPenalty, 18);
  if (key === "WATCH") return num(cfg.watchPenalty, 8);
  return 0;
}

function penaltyForRoute(routeStatus, cfg = {}) {
  const key = String(routeStatus || "OK").toUpperCase();
  if (key === "NO_ROUTE") return num(cfg.noRoutePenalty, 35);
  if (key === "UNSTABLE") return num(cfg.unstableRoutePenalty, 18);
  if (key === "THIN") return num(cfg.thinRoutePenalty, 6);
  return 0;
}

export function evaluateShadowV2EngineGuard(pool = {}, options = {}) {
  const enabled = options.enabled !== false;
  if (!enabled) {
    return {
      enabled: false,
      action: "DISABLED",
      hard_block: false,
      score_penalty: 0,
      reasons: [],
    };
  }

  const truth = analyzePreTradeTruth(pool);
  const warningLevel = String(truth.warning_level || "CLEAR").toUpperCase();
  const exitStatus = String(truth.exit_route?.status || "OK").toUpperCase();
  const hardBlockLevels = normalizeList(options.hardBlockLevels, ["CRITICAL"]);
  const hardBlockExitRoutes = normalizeList(options.hardBlockExitRoutes, ["NO_ROUTE", "UNSTABLE"]);
  const dataUsable = truth.data_completeness?.usable !== false;

  const levelPenalty = penaltyForLevel(warningLevel, options);
  const routePenalty = penaltyForRoute(exitStatus, options);
  const rawPenalty = dataUsable ? levelPenalty + routePenalty : 0;
  const scorePenalty = Math.max(0, Math.min(num(options.maxPenalty, 40), rawPenalty));
  const hardBlock = dataUsable && options.enforce !== false && (
    hardBlockLevels.includes(warningLevel) ||
    hardBlockExitRoutes.includes(exitStatus)
  );
  const reasons = [
    ...truth.warnings,
    !dataUsable ? `data_incomplete:${(truth.data_completeness?.missing || []).join(",")}` : null,
  ].filter(Boolean);

  return {
    enabled: true,
    action: hardBlock ? "BLOCK" : scorePenalty > 0 ? "PENALIZE" : "PASS",
    hard_block: hardBlock,
    score_penalty: scorePenalty,
    warning_level: warningLevel,
    truth_score: truth.truth_score,
    exit_route_status: exitStatus,
    exit_route_score: truth.exit_route?.score ?? null,
    cluster_risk: truth.cluster_risk?.status ?? null,
    dev_risk: truth.dev_risk?.status ?? null,
    timing_status: truth.timing_truth?.status ?? null,
    data_complete: dataUsable,
    missing_data: truth.data_completeness?.missing || [],
    reasons,
    truth,
  };
}
