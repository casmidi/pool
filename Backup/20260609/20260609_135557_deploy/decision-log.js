import fs from "fs";
import { log } from "./logger.js";

const DECISION_LOG_FILE = "./decision-log.json";
const MAX_DECISIONS = 1000;

function load() {
  if (!fs.existsSync(DECISION_LOG_FILE)) {
    return { decisions: [] };
  }
  try {
    return JSON.parse(fs.readFileSync(DECISION_LOG_FILE, "utf8"));
  } catch (error) {
    log("decision_log_warn", `Invalid ${DECISION_LOG_FILE}: ${error.message}`);
    return { decisions: [] };
  }
}

function save(data) {
  fs.writeFileSync(DECISION_LOG_FILE, JSON.stringify(data, null, 2));
}

function sanitize(value, maxLen = 280) {
  if (value == null) return null;
  return String(value).replace(/\s+/g, " ").trim().slice(0, maxLen) || null;
}

export function appendDecision(entry) {
  const data = load();
  const decision = {
    id: `dec_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    ts: new Date().toISOString(),
    type: entry.type || "note",
    actor: entry.actor || "GENERAL",
    pool: entry.pool || null,
    pool_name: sanitize(entry.pool_name || entry.pool, 120),
    position: entry.position || null,
    summary: sanitize(entry.summary),
    reason: sanitize(entry.reason, 500),
    recommendation: sanitize(entry.recommendation, 80),
    score: Number.isFinite(Number(entry.score)) ? Number(entry.score) : null,
    grade: sanitize(entry.grade, 20),
    action: sanitize(entry.action, 80),
    anti_oor_risk: sanitize(entry.anti_oor_risk ?? entry.metrics?.anti_oor_risk, 40),
    anti_oor_score: Number.isFinite(Number(entry.anti_oor_score ?? entry.metrics?.anti_oor_score)) ? Number(entry.anti_oor_score ?? entry.metrics?.anti_oor_score) : null,
    momentum_state: sanitize(entry.momentum_state ?? entry.metrics?.momentum_state, 80),
    dynamic_range_recommendation: sanitize(entry.dynamic_range_recommendation ?? entry.metrics?.dynamic_range_recommendation, 80),
    range_width_bins: Number.isFinite(Number(entry.range_width_bins ?? entry.metrics?.range_width_bins)) ? Number(entry.range_width_bins ?? entry.metrics?.range_width_bins) : null,
    bins_below: Number.isFinite(Number(entry.bins_below ?? entry.metrics?.bins_below)) ? Number(entry.bins_below ?? entry.metrics?.bins_below) : null,
    bins_above: Number.isFinite(Number(entry.bins_above ?? entry.metrics?.bins_above)) ? Number(entry.bins_above ?? entry.metrics?.bins_above) : null,
    active_bin: Number.isFinite(Number(entry.active_bin ?? entry.metrics?.active_bin_before_deploy ?? entry.metrics?.active_bin_before_plan)) ? Number(entry.active_bin ?? entry.metrics?.active_bin_before_deploy ?? entry.metrics?.active_bin_before_plan) : null,
    lower_bin: Number.isFinite(Number(entry.lower_bin ?? entry.metrics?.lower_bin)) ? Number(entry.lower_bin ?? entry.metrics?.lower_bin) : null,
    upper_bin: Number.isFinite(Number(entry.upper_bin ?? entry.metrics?.upper_bin)) ? Number(entry.upper_bin ?? entry.metrics?.upper_bin) : null,
    active_bin_position_pct: Number.isFinite(Number(entry.active_bin_position_pct ?? entry.metrics?.active_bin_position_pct)) ? Number(entry.active_bin_position_pct ?? entry.metrics?.active_bin_position_pct) : null,
    recheck_status: sanitize(entry.recheck_status ?? entry.metrics?.recheck_status, 80),
    recheck_result: sanitize(entry.recheck_result ?? entry.metrics?.recheck_result, 120),
    final_range_action: sanitize(entry.final_range_action ?? entry.metrics?.final_range_action, 120),
    deploy_block_reason: sanitize(entry.deploy_block_reason ?? entry.metrics?.deploy_block_reason, 200),
    risks: Array.isArray(entry.risks) ? entry.risks.map((r) => sanitize(r, 140)).filter(Boolean).slice(0, 6) : [],
    metrics: entry.metrics || {},
    rejected: Array.isArray(entry.rejected) ? entry.rejected.map((r) => sanitize(r, 180)).filter(Boolean).slice(0, 8) : [],
  };
  data.decisions.unshift(decision);
  data.decisions = data.decisions.slice(0, MAX_DECISIONS);
  save(data);
  return decision;
}

export function getRecentDecisions(limit = 10) {
  const data = load();
  return (data.decisions || []).slice(0, limit);
}

export function getDecisionSummary(limit = 6) {
  const decisions = getRecentDecisions(limit);
  if (!decisions.length) return "No recent structured decisions yet.";
  return decisions.map((d, i) => {
    const bits = [
      `${i + 1}. [${d.actor}] ${d.type.toUpperCase()} ${d.pool_name || d.pool || "unknown pool"}`,
      d.summary ? `summary: ${d.summary}` : null,
      d.reason ? `reason: ${d.reason}` : null,
      d.recommendation ? `recommendation: ${d.recommendation}` : null,
      d.score != null ? `score: ${d.score}` : null,
      d.risks?.length ? `risks: ${d.risks.join(", ")}` : null,
      d.rejected?.length ? `rejected: ${d.rejected.join(" | ")}` : null,
    ].filter(Boolean);
    return bits.join(" | ");
  }).join("\n");
}
