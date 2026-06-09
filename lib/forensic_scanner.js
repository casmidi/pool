import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { recordShadowCandidate } from "../shadow/shadow_engine.js";
import { getPoolDetail } from "../tools/screening.js";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const BASE_DIR = path.join(ROOT, "scanning_log");
const RAW_DIR = path.join(BASE_DIR, "raw");
const DAILY_DIR = path.join(BASE_DIR, "daily");
const REJECTION_DIR = path.join(BASE_DIR, "rejections");
const ARCHIVE_DIR = path.join(BASE_DIR, "archive");
const ANTI_OOR_RECHECK_QUEUE_PATH = path.join(ROOT, "data", "anti_oor_recheck_queue.json");

let writeQueue = Promise.resolve();

function warn(error) {
  console.warn(`[FORENSIC_SCANNER] ${error?.message || error}`);
}

function enqueue(task) {
  writeQueue = writeQueue.then(task).catch(warn);
  return writeQueue;
}

function ensureDirsSync() {
  for (const dir of [RAW_DIR, DAILY_DIR, REJECTION_DIR, ARCHIVE_DIR]) {
    try {
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    } catch (error) {
      warn(error);
    }
  }
}

async function ensureDirs() {
  await fs.promises.mkdir(RAW_DIR, { recursive: true });
  await fs.promises.mkdir(DAILY_DIR, { recursive: true });
  await fs.promises.mkdir(REJECTION_DIR, { recursive: true });
  await fs.promises.mkdir(ARCHIVE_DIR, { recursive: true });
}

function sanitize(value) {
  return String(value || "UNKNOWN")
    .replace(/[^a-z0-9_-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || "UNKNOWN";
}

function tsParts(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  const iso = Number.isFinite(d.getTime()) ? d.toISOString() : new Date().toISOString();
  return {
    date: iso.slice(0, 10),
    stamp: iso.slice(0, 19).replace(/[-:T]/g, "_"),
    iso,
  };
}

function rawPath(traceId) {
  return path.join(RAW_DIR, `${traceId}.json`);
}

function num(value, fallback = null) {
  if (value === null || value === undefined || value === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function round(value, digits = 2) {
  const n = num(value, 0);
  const m = 10 ** digits;
  return Math.round(n * m) / m;
}

function clone(value) {
  if (value == null) return null;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return null;
  }
}

function readJsonSync(filePath, fallback = null) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

async function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(await fs.promises.readFile(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

async function writeJson(filePath, data) {
  const tmp = `${filePath}.tmp`;
  await fs.promises.writeFile(tmp, JSON.stringify(data, null, 2));
  await fs.promises.rename(tmp, filePath);
}

function stageSummary(stage = {}) {
  if (stage.stage === "screening") return stage.decision ? `screening_${String(stage.decision).toLowerCase()}` : "screening";
  if (stage.stage === "candidate") return stage.status ? `candidate_${String(stage.status).toLowerCase()}` : "candidate";
  if (stage.stage === "anti_oor") return stage.timing_action ? `anti_oor_${String(stage.timing_action).toLowerCase()}` : "anti_oor";
  if (stage.stage === "deploy") return stage.strategy ? `deploy_${String(stage.strategy).toLowerCase()}` : "deploy";
  if (stage.stage === "runtime") return String(stage.event || "runtime").toLowerCase();
  if (stage.stage === "exit") return String(stage.exit_reason || "exit").toLowerCase().replace(/\s+/g, "_");
  return stage.stage || "unknown";
}

function exitSide(exit = {}) {
  const reason = String(exit.exit_reason || "").toLowerCase();
  if (reason.includes("above")) return "above";
  if (reason.includes("below")) return "below";
  return String(exit.exit_side || "").toLowerCase() || null;
}

function classifyLoss(trace = {}) {
  const stages = trace.stages || [];
  const screening = stages.find((s) => s.stage === "screening") || {};
  const candidate = stages.find((s) => s.stage === "candidate") || {};
  const antiOor = stages.find((s) => s.stage === "anti_oor") || {};
  const deploy = stages.find((s) => s.stage === "deploy") || {};
  const runtime = stages.filter((s) => s.stage === "runtime");
  const exit = stages.find((s) => s.stage === "exit") || {};
  const side = exitSide(exit);
  const risk = String(antiOor.risk_level || antiOor.oor_prediction || "").toUpperCase();
  const momentum = String(antiOor.momentum_state || "").toUpperCase();
  const rangeAction = String(antiOor.range_action || "").toUpperCase();
  const timingAction = String(antiOor.timing_action || "").toUpperCase();
  const binsAbove = num(deploy.bins_above, null);
  const binsBelow = num(deploy.bins_below, null);
  const volatility = num(screening.metrics?.volatility ?? deploy.volatility_used, null);
  const confidence = num(screening.metrics?.confidence ?? candidate.confidence, null);
  const wallet = num(screening.metrics?.wallet_score, null);
  const runtimeBreakout = runtime.some((s) => /BREAKOUT|ACCELERATION/.test(String(s.event || "").toUpperCase()));

  const p = {
    late_entry: 0.05,
    range_too_low: 0.05,
    range_too_high: 0.05,
    momentum_breakout: 0.05,
    wallet_issue: 0.03,
    screening_error: 0.05,
    candidate_error: 0.05,
    variance: 0.25,
  };

  if (side === "above") {
    p.range_too_low += 0.45;
    if (binsAbove === 0) p.range_too_low += 0.25;
    if (momentum === "MOMENTUM_BREAKOUT_UP") p.momentum_breakout += 0.35;
  }
  if (side === "below") {
    p.range_too_high += 0.45;
    if (momentum === "MOMENTUM_BREAKOUT_DOWN") p.momentum_breakout += 0.35;
  }
  if (runtimeBreakout) p.momentum_breakout += 0.25;
  if (["HIGH", "CRITICAL"].includes(risk)) {
    p.momentum_breakout += 0.25;
    p.late_entry += timingAction.includes("WAIT") ? 0.2 : 0.1;
  }
  if (timingAction.includes("WAIT") && num(exit.duration_minutes, 999) <= 30) p.late_entry += 0.25;
  if (rangeAction.includes("SHIFT_UP") && side === "above") p.range_too_low += 0.15;
  if (rangeAction.includes("SHIFT_DOWN") && side === "below") p.range_too_high += 0.15;
  if (volatility !== null && volatility >= 5) p.screening_error += 0.25;
  if (confidence !== null && confidence < 0.55) p.candidate_error += 0.25;
  if (wallet !== null && wallet < 45) p.wallet_issue += 0.25;

  for (const key of Object.keys(p)) p[key] = round(Math.max(0, Math.min(0.95, p[key])), 2);
  const ranked = Object.entries(p).sort((a, b) => b[1] - a[1]);
  const top = ranked[0]?.[0] || "variance";
  let stage = "unavoidable variance";
  if (top === "screening_error" || top === "wallet_issue") stage = "screening";
  else if (top === "candidate_error") stage = "candidate";
  else if (top === "late_entry" || top === "momentum_breakout") stage = "anti_oor";
  else if (top === "range_too_low" || top === "range_too_high") stage = "deploy";
  else if (runtimeBreakout) stage = "runtime";

  const verdicts = {
    screening: "Screening allowed a pool with weak preconditions before the loss.",
    candidate: "Candidate selection/ranking likely overestimated entry quality.",
    anti_oor: "Anti-OOR timing or momentum detection is the likely first failure point.",
    deploy: side === "above"
      ? "Likely upward breakout while deployment range sat too low."
      : side === "below"
        ? "Likely downward breakout while deployment range sat too high."
        : "Deploy range likely mismatched the market movement.",
    runtime: "Runtime market movement changed after entry; classify as breakout monitoring failure.",
    "unavoidable variance": "Loss appears closer to variance with current available evidence.",
  };

  return {
    pool: trace.pool,
    result: "LOSS",
    loss_reason: exit.exit_reason || "unknown",
    timeline: stages.map(stageSummary),
    logic_failure_stage: stage,
    root_cause_probability: {
      late_entry: p.late_entry,
      range_too_low: p.range_too_low,
      range_too_high: p.range_too_high,
      momentum_breakout: p.momentum_breakout,
      wallet_issue: p.wallet_issue,
      screening_error: p.screening_error,
      candidate_error: p.candidate_error,
      variance: p.variance,
    },
    verdict: verdicts[stage],
  };
}

function summarizeDaily(traces = []) {
  const exits = traces.map((trace) => (trace.stages || []).find((s) => s.stage === "exit")).filter(Boolean);
  const profits = exits.filter((s) => s.result === "PROFIT");
  const losses = exits.filter((s) => s.result === "LOSS");
  const grossWin = profits.reduce((sum, s) => sum + Math.max(0, num(s.pnl_pct, 0)), 0);
  const grossLoss = Math.abs(losses.reduce((sum, s) => sum + Math.min(0, num(s.pnl_pct, 0)), 0));
  const total = exits.length;
  const pf = grossLoss > 0 ? round(grossWin / grossLoss) : (grossWin > 0 ? 99 : 0);
  return {
    total_trades: total,
    profit_count: profits.length,
    loss_count: losses.length,
    pf,
    pf_confidence: total < 10 ? "VERY_LOW_SAMPLE_DO_NOT_TRUST" : total < 30 ? "LOW_SAMPLE_UNCERTAIN" : total < 100 ? "MEDIUM_SAMPLE_USABLE" : "HIGH_SAMPLE_RELIABLE",
    pf_warning: total < 30 ? `sample size too small (${total} trades) — PF ${pf} should not be treated as reliable performance metric` : null,
    oor_above: exits.filter((s) => String(s.exit_reason || "").toLowerCase().includes("above")).length,
    oor_below: exits.filter((s) => String(s.exit_reason || "").toLowerCase().includes("below")).length,
  };
}

async function summarizeRangeFailure(traces = []) {
  const exits = traces.map((trace) => (trace.stages || []).find((s) => s.stage === "exit")).filter(Boolean);
  const antiStages = traces.map((trace) => (trace.stages || []).find((s) => s.stage === "anti_oor")).filter(Boolean);
  const deployStages = traces.map((trace) => (trace.stages || []).find((s) => s.stage === "deploy")).filter(Boolean);
  const queue = await readJson(ANTI_OOR_RECHECK_QUEUE_PATH, { items: [] });
  const items = Array.isArray(queue.items) ? queue.items : [];
  const oor = exits.filter((s) => String(s.exit_reason || "").toLowerCase().includes("oor") || String(s.exit_reason || "").toLowerCase().includes("out-of-range"));
  const above = exits.filter((s) => String(s.exit_reason || "").toLowerCase().includes("above"));
  const fast = exits.filter((s) => num(s.duration_minutes, 999) <= 30 && String(s.exit_reason || "").toLowerCase().includes("oor"));
  return {
    active_bin_escape_count: above.length,
    fast_oor_under_30m: fast.length,
    oor_above_rate: oor.length ? round((above.length / oor.length) * 100, 1) : 0,
    avg_time_to_oor: fast.length
      ? round(fast.reduce((sum, s) => sum + num(s.duration_minutes, 0), 0) / fast.length)
      : null,
    widen_recommendation_used_count: antiStages.filter((s) => String(s.range_action || "").includes("WIDEN")).length,
    wait_recheck_count: items.length,
    recheck_success_count: items.filter((item) => item.recheck_result === "IMPROVED_TO_SANDBOX_CANDIDATE").length,
    recheck_still_critical_count: items.filter((item) => item.recheck_result === "STILL_CRITICAL").length,
    shift_up_not_supported_count: items.filter((item) => String(item.final_range_action || item.final_range_action_after_wait || "").includes("SHIFT_UP_NOT_SUPPORTED")).length,
    widen_range_safety_count: items.filter((item) => String(item.final_range_action || item.final_range_action_after_wait || "").includes("WIDEN_RANGE_UPWARD_SAFETY")).length,
    single_side_bins_above_violation_count: deployStages.filter((s) => Number(s.bins_above ?? 0) !== 0).length,
  };
}

function rejectionDatePath(date) {
  return path.join(REJECTION_DIR, `${date}.json`);
}

function rejectionStatus(signal = {}) {
  const action = String(signal.action || "").toUpperCase();
  if (action === "HOLD" || action === "WATCH") return "WATCH";
  return "BLOCKED";
}

function rejectionStage(signal = {}) {
  const risks = signal.risks || [];
  const text = [...risks, ...(signal.reasons || [])].join(" ").toLowerCase();
  if (text.includes("wallet")) return "wallet_filter";
  if (text.includes("out_of_range") || text.includes("oor") || text.includes("range")) return "range_filter";
  if (text.includes("fee")) return "fee_filter";
  if (text.includes("organic")) return "organic_filter";
  if (text.includes("confidence")) return "confidence_filter";
  if (text.includes("alpha")) return "alpha_filter";
  if (text.includes("duplicate")) return "dedupe_filter";
  return "decision_filter";
}

function rejectionReasonObjects(signal = {}) {
  const risks = Array.isArray(signal.risks) ? signal.risks : [];
  const reasons = risks.length ? risks : (Array.isArray(signal.reasons) ? signal.reasons : []);
  return reasons.map((reason) => ({
    logic: rejectionStage({ ...signal, risks: [reason], reasons: [] }),
    value: reason,
    threshold: null,
    verdict: "OBSERVED",
  }));
}

function classifyRejection(record = {}) {
  const text = [
    record.rejection_stage,
    ...(record.reasons || []).map((r) => r.value),
  ].join(" ").toLowerCase();
  const score = num(record.score, null);
  const confidence = num(record.confidence, null);
  const positiveObservation = [record.after_30m, record.after_1h, record.after_2h].some((obs) => {
    if (!obs || String(obs.status || "").toUpperCase() === "PENDING_OBSERVATION") return false;
    const priceChange = num(obs.price_change_pct, null);
    const profitability = num(obs.estimated_profitability, null);
    const survived = obs.survival === true || String(obs.survival || "").toUpperCase() === "SURVIVED";
    return (priceChange !== null && priceChange > 0.5) || (profitability !== null && profitability > 0) || survived;
  });
  let verdict = "UNCLEAR";
  let likely = record.rejection_stage || "unknown";
  let potential = null;

  if (text.includes("dangerous") || text.includes("out_of_range") || text.includes("oor") || text.includes("duplicate")) {
    verdict = "GOOD_REJECTION";
  }
  if ((score !== null && score >= 75) || (confidence !== null && confidence >= 0.75)) {
    potential = `${record.rejection_stage || "decision_filter"}_too_strict`;
  }
  if (positiveObservation && potential) {
    verdict = "FALSE_NEGATIVE";
    likely = potential;
  }
  if (text.includes("low_fee") || text.includes("low fee") || text.includes("poor_range")) {
    verdict = verdict === "FALSE_NEGATIVE" ? "UNCLEAR" : "GOOD_REJECTION";
  }

  return {
    verdict,
    likely_logic_failure: verdict === "FALSE_NEGATIVE" ? likely : null,
    potential_logic_failure: verdict !== "FALSE_NEGATIVE" ? potential : null,
  };
}

async function loadRejections(date) {
  const data = await readJson(rejectionDatePath(date), { date, rejections: [] });
  return Array.isArray(data.rejections) ? data.rejections : [];
}

function summarizeRejections(rejections = []) {
  const verdicts = rejections.map((r) => r.verdict || "UNCLEAR");
  const falseNegatives = rejections.filter((r) => r.verdict === "FALSE_NEGATIVE");
  const potentialFalseNegatives = rejections.filter((r) => r.potential_logic_failure && r.verdict !== "FALSE_NEGATIVE");
  const counts = falseNegatives.reduce((acc, item) => {
    const key = item.likely_logic_failure || item.rejection_stage || "unknown";
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  const potentialCounts = potentialFalseNegatives.reduce((acc, item) => {
    const key = item.potential_logic_failure || item.rejection_stage || "unknown";
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  return {
    total_blocked: rejections.filter((r) => r.status === "BLOCKED").length,
    total_watch: rejections.filter((r) => r.status === "WATCH").length,
    good_rejections: verdicts.filter((v) => v === "GOOD_REJECTION").length,
    false_negatives: verdicts.filter((v) => v === "FALSE_NEGATIVE").length,
    potential_false_negatives: potentialFalseNegatives.length,
    unclear: verdicts.filter((v) => v === "UNCLEAR").length,
    top_false_negative_causes: Object.entries(counts)
      .map(([logic, count]) => ({ logic, count }))
      .sort((a, b) => b.count - a.count || a.logic.localeCompare(b.logic))
      .slice(0, 8),
    top_potential_false_negative_causes: Object.entries(potentialCounts)
      .map(([logic, count]) => ({ logic, count }))
      .sort((a, b) => b.count - a.count || a.logic.localeCompare(b.logic))
      .slice(0, 8),
    items: rejections.slice(-50).reverse(),
  };
}

async function generateDaily(date) {
  await ensureDirs();
  await updateAllPendingObservations(date);
  const files = await fs.promises.readdir(RAW_DIR).catch(() => []);
  const traces = [];
  for (const file of files.filter((f) => f.endsWith(".json"))) {
    const trace = await readJson(path.join(RAW_DIR, file), null);
    if (!trace) continue;
    const exit = (trace.stages || []).find((s) => s.stage === "exit");
    if (!exit || String(exit.timestamp || "").slice(0, 10) !== date) continue;
    traces.push(trace);
  }
  const daily = {
    date,
    generated_at: new Date().toISOString(),
    summary: summarizeDaily(traces),
    range_failure_analysis: await summarizeRangeFailure(traces),
    loss_analysis: traces
      .filter((trace) => ((trace.stages || []).find((s) => s.stage === "exit") || {}).result === "LOSS")
      .map(classifyLoss),
    rejection_analysis: summarizeRejections(await loadRejections(date)),
  };
  await writeJson(path.join(DAILY_DIR, `${date}.json`), daily);
  return daily;
}

function appendStage(traceId, stage) {
  return enqueue(async () => {
    await ensureDirs();
    const filePath = rawPath(traceId);
    const existing = await readJson(filePath, null);
    const trace = existing || {
      trace_id: traceId,
      pool: stage.pool || "unknown",
      created_at: stage.timestamp || new Date().toISOString(),
      stages: [],
    };
    trace.pool = trace.pool || stage.pool || "unknown";
    trace.updated_at = new Date().toISOString();
    trace.stages.push(stage);
    await writeJson(filePath, trace);
    if (stage.stage === "exit") {
      const date = String(stage.timestamp || new Date().toISOString()).slice(0, 10);
      await generateDaily(date);
    }
  });
}

export function createForensicTraceId(pool, date = new Date()) {
  ensureDirsSync();
  const parts = tsParts(date);
  return `${sanitize(pool)}_${parts.stamp}`;
}

export function recordForensicDeploy(trade = {}) {
  try {
    const traceId = trade.forensic_trace_id || createForensicTraceId(trade.pool_name || trade.pool_address);
    const ts = trade.deploy_time || new Date().toISOString();
    const args = trade.entry_truth?.deployArgs || {};
    const decision = args.decision_result || {};
    const anti = args.anti_oor_intelligence || {};
    appendStage(traceId, {
      stage: "screening",
      pool: trade.pool_name,
      timestamp: ts,
      metrics: {
        fee_tvl: trade.fee_tvl_ratio,
        organic: trade.organic_score,
        wallet_score: trade.source_wallet_score,
        confidence: trade.decision_confidence,
        volatility: trade.volatility,
        alpha: trade.alpha_edge?.action || trade.alpha_edge?.state || null,
      },
      decision: decision.action || args.action || "DEPLOY_RECORDED",
      why_pass: clone(args.reasons || decision.reasons || []),
      why_blocked: clone(args.risks || decision.risks || []),
    });
    appendStage(traceId, {
      stage: "candidate",
      pool: trade.pool_name,
      timestamp: ts,
      score: args.pool_score ?? args.ranking_score ?? args.organic_score ?? null,
      grade: args.pool_grade ?? args.ranking_grade ?? null,
      status: args.status ?? "DEPLOYED",
      confidence: trade.decision_confidence,
    });
    appendStage(traceId, {
      stage: "anti_oor",
      pool: trade.pool_name,
      timestamp: ts,
      momentum_state: anti.momentumEscape?.state || null,
      predicted_direction: anti.dynamicRangeWidth?.directionalBias || null,
      wait_minutes: anti.entryTimingDelay?.waitMinutes ?? null,
      timing_action: anti.entryTimingDelay?.action || null,
      range_action: anti.dynamicRangeWidth?.recommendation || null,
      risk_level: anti.oorPrediction?.oorRisk || null,
      oor_prediction: anti.finalRecommendation || anti.oorPrediction?.action || null,
    });
    appendStage(traceId, {
      stage: "deploy",
      pool: trade.pool_name,
      timestamp: ts,
      strategy: trade.strategy,
      entry_price: trade.entry_price,
      bins_above: args.bins_above ?? null,
      bins_below: trade.bins_below,
      volatility_used: trade.volatility,
      timing: anti.entryTimingDelay?.action || null,
      range_width: trade.lower_bin != null && trade.upper_bin != null ? Math.max(1, trade.upper_bin - trade.lower_bin + 1) : null,
      probe_candidate: Boolean(trade.probe_candidate ?? args.probe_candidate ?? false),
      overridden: Boolean(trade.overridden ?? args._overridden ?? false),
      fee_velocity_boost: trade.fee_velocity_boost ?? args.fee_velocity_boost ?? null,
      exact: {
        active_bin: trade.entry_bin ?? trade.active_bin,
        lower_bin: trade.lower_bin,
        upper_bin: trade.upper_bin,
        bin_step: trade.bin_step,
        amount_sol: trade.amount_sol,
      },
    });
    return traceId;
  } catch (error) {
    warn(error);
    return trade.forensic_trace_id || null;
  }
}

export function recordForensicRuntime(traceId, trade = {}, event = {}) {
  if (!traceId) return;
  try {
    appendStage(traceId, {
      stage: "runtime",
      pool: trade.pool_name,
      timestamp: new Date().toISOString(),
      event: event.event,
      pct_move: event.pct_move ?? null,
      minutes_since_entry: event.minutes_since_entry ?? null,
      active_bin: trade.active_bin ?? null,
      entry_bin: trade.entry_bin ?? null,
      lower_bin: trade.lower_bin ?? null,
      upper_bin: trade.upper_bin ?? null,
      oor_classification: event.oor_classification ?? null,
      oor_action: event.oor_action ?? null,
      oor_reason: event.oor_reason ?? null,
    });
  } catch (error) {
    warn(error);
  }
}

export function recordForensicExit(trade = {}) {
  const traceId = trade.forensic_trace_id;
  if (!traceId) return;
  try {
    appendStage(traceId, {
      stage: "exit",
      pool: trade.pool_name,
      timestamp: trade.close_time || new Date().toISOString(),
      result: num(trade.pnl_pct, 0) > 0 ? "PROFIT" : "LOSS",
      exit_reason: String(trade.close_reason || "").replace(/\s+/g, "_").toLowerCase(),
      pnl_pct: trade.pnl_pct,
      duration_minutes: trade.minutes_held,
      fees_earned: trade.fees_usd ?? trade.paper_fee_sol ?? null,
      exit_side: trade.exit_side || trade.out_of_range_side || null,
      oor_classification: trade.oor_classification ?? null,
      oor_action: trade.oor_action ?? null,
      oor_reason: trade.oor_reason ?? null,
    });
  } catch (error) {
    warn(error);
  }
}

const OBSERVATION_INTERVALS = [
  { key: "after_30m", label: "30m", delayMs: 30 * 60 * 1000 },
  { key: "after_1h",  label: "1h",  delayMs: 60 * 60 * 1000 },
  { key: "after_2h",  label: "2h",  delayMs: 120 * 60 * 1000 },
];

const scheduledTimers = new Map();

async function updateObservation(traceId, date, observationKey) {
  try {
    const filePath = rejectionDatePath(date);
    const data = await readJson(filePath, { date, rejections: [] });
    const list = Array.isArray(data.rejections) ? data.rejections : [];
    const idx = list.findIndex((r) => r.trace_id === traceId);
    if (idx === -1) return;
    const record = list[idx];
    const current = record[observationKey];
    if (!current || String(current.status || "").toUpperCase() !== "PENDING_OBSERVATION") return;

    const poolAddress = record.pool_address;
    if (!poolAddress) {
      current.status = "OBSERVED";
      current.survival = false;
      list[idx] = record;
      const classified = classifyRejection(record);
      record.verdict = classified.verdict;
      record.likely_logic_failure = classified.likely_logic_failure;
      await writeJson(filePath, { date, updated_at: new Date().toISOString(), rejections: list });
      await generateDaily(date).catch(() => {});
      return;
    }

    const detail = await getPoolDetail({ pool_address: poolAddress }).catch(() => null);
    if (!detail) {
      current.status = "OBSERVED";
      current.survival = false;
    } else {
      const feeQuality = detail.fee_active_tvl_ratio ?? detail.fee_atvl ?? null;
      const isActive = detail.active_tvl != null && detail.active_tvl > 0;
      const activeRatio = detail.tvl > 0 ? (detail.active_tvl / detail.tvl) : 0;
      current.status = "OBSERVED";
      current.price_change_pct = detail.price_change_pct ?? detail.pool_price_change_pct ?? null;
      current.fee_quality = feeQuality != null ? Math.round(feeQuality * 10000) / 10000 : null;
      current.estimated_profitability = (feeQuality != null && feeQuality > 0.05) ? Math.round(feeQuality * 10000) / 10000 : null;
      current.survival = true;
      current.oor_probability = (!isActive || activeRatio < 0.05) ? "HIGH" : activeRatio < 0.2 ? "MEDIUM" : "LOW";
    }

    const classified = classifyRejection(record);
    record.verdict = classified.verdict;
    record.likely_logic_failure = classified.likely_logic_failure;

    list[idx] = record;
    await writeJson(filePath, { date, updated_at: new Date().toISOString(), rejections: list });
    await generateDaily(date).catch(() => {});
  } catch (e) {
    warn(e);
  }
}

function scheduleObservationTimers(record, date) {
  const rejectionTime = new Date(record.timestamp).getTime();
  if (!Number.isFinite(rejectionTime)) return;
  const traceId = record.trace_id;
  for (const { key, delayMs } of OBSERVATION_INTERVALS) {
    const elapsed = Date.now() - rejectionTime;
    const remaining = delayMs - elapsed;
    if (remaining > 0) {
      const timer = setTimeout(() => {
        scheduledTimers.delete(traceId + ":" + key);
        updateObservation(traceId, date, key);
      }, remaining);
      scheduledTimers.set(traceId + ":" + key, timer);
    } else if (elapsed >= delayMs && elapsed < delayMs + 24 * 60 * 60 * 1000) {
      updateObservation(traceId, date, key);
    }
  }
}

async function updateAllPendingObservations(date) {
  try {
    const filePath = rejectionDatePath(date);
    const data = await readJson(filePath, { date, rejections: [] });
    const list = Array.isArray(data.rejections) ? data.rejections : [];
    let changed = false;
    for (let i = 0; i < list.length; i++) {
      const record = list[i];
      const rejectionTime = new Date(record.timestamp).getTime();
      if (!Number.isFinite(rejectionTime)) continue;
      for (const { key, delayMs } of OBSERVATION_INTERVALS) {
        const current = record[key];
        if (!current || String(current.status || "").toUpperCase() !== "PENDING_OBSERVATION") continue;
        if (Date.now() - rejectionTime >= delayMs) {
          await updateObservation(record.trace_id, date, key);
          changed = true;
        }
      }
    }
    return changed;
  } catch {
    return false;
  }
}

export function recordForensicRejection(signal = {}) {
  try {
    const timestamp = signal.ts || signal.timestamp || new Date().toISOString();
    const date = String(timestamp).slice(0, 10);
    const poolAddress = signal.pool_address || signal.poolAddress || signal.pool || signal.deployArgs?.pool_address || null;
    const classified = classifyRejection({
      rejection_stage: rejectionStage(signal),
      reasons: rejectionReasonObjects(signal),
      score: signal.alphaScore ?? signal.poolScore ?? signal.walletScore ?? null,
      confidence: signal.confidence ?? null,
    });
    const record = {
      trace_id: createForensicTraceId(signal.poolName || signal.pool || "rejection", timestamp),
      pool: signal.poolName || signal.pool || "unknown",
      pool_address: poolAddress,
      timestamp,
      status: rejectionStatus(signal),
      score: signal.alphaScore ?? signal.poolScore ?? signal.walletScore ?? null,
      confidence: signal.confidence ?? null,
      rejection_stage: rejectionStage(signal),
      reasons: rejectionReasonObjects(signal),
      after_30m: { status: "PENDING_OBSERVATION", price_change_pct: null, fee_quality: null, estimated_profitability: null, survival: null, oor_probability: null },
      after_1h: { status: "PENDING_OBSERVATION", price_change_pct: null, fee_quality: null, estimated_profitability: null, survival: null, oor_probability: null },
      after_2h: { status: "PENDING_OBSERVATION", price_change_pct: null, fee_quality: null, estimated_profitability: null, survival: null, oor_probability: null },
      verdict: classified.verdict,
      likely_logic_failure: classified.likely_logic_failure,
      probe_candidate: Boolean(signal.probe_candidate ?? false),
      overridden: Boolean(signal.overridden ?? false),
      fee_velocity_boost: signal.fee_velocity_boost ?? null,
    };
    recordShadowCandidate({
      ...signal,
      ...record,
      poolName: record.pool,
      pool: record.pool_address,
      pool_address: record.pool_address,
      rejection_stage: record.rejection_stage,
      reject_reason: (record.reasons || []).map((r) => r.value).join(" | "),
    });
    enqueue(async () => {
      await ensureDirs();
      const filePath = rejectionDatePath(date);
      const data = await readJson(filePath, { date, rejections: [] });
      const list = Array.isArray(data.rejections) ? data.rejections : [];
      if (!list.some((item) => item.trace_id === record.trace_id || (signal.id && item.signal_id === signal.id))) {
        list.push({ ...record, signal_id: signal.id || null });
      }
      await writeJson(filePath, { date, updated_at: new Date().toISOString(), rejections: list });
      await generateDaily(date);
    });
    scheduleObservationTimers(record, date);
    return record.trace_id;
  } catch (error) {
    warn(error);
    return null;
  }
}

export function rebuildForensicDailySync(date = new Date().toISOString().slice(0, 10)) {
  enqueue(() => generateDaily(date)).catch(warn);
}

export async function buildForensicDaily(date = new Date().toISOString().slice(0, 10)) {
  return generateDaily(date);
}

export async function buildDailyValidationMetrics(date = new Date().toISOString().slice(0, 10)) {
  const daily = await generateDaily(date).catch(() => null);
  const summary = daily?.summary || summarizeDaily([]);
  const range = daily?.range_failure_analysis || await summarizeRangeFailure([]);
  const rejections = daily?.rejection_analysis || summarizeRejections([]);

  // Read recheck queue for additional metrics
  let recheckData = { waiting: 0, rechecked: 0, still_critical: 0, improved: 0 };
  try {
    const queue = await readJson(ANTI_OOR_RECHECK_QUEUE_PATH, { items: [] });
    const items = Array.isArray(queue.items) ? queue.items : [];
    recheckData = {
      waiting: items.filter((i) => i.status === "WAITING").length,
      rechecked: items.filter((i) => i.status === "RECHECKED").length,
      still_critical: items.filter((i) => i.recheck_result === "STILL_CRITICAL").length,
      improved: items.filter((i) => i.recheck_result === "IMPROVED_TO_SANDBOX_CANDIDATE" || i.recheck_result === "IMPROVED_TO_DEPLOY_CANDIDATE").length,
      shift_up: items.filter((i) => String(i.final_range_action || i.final_range_action_after_wait || "").startsWith("SHIFT")).length,
      widen: items.filter((i) => String(i.final_range_action || i.final_range_action_after_wait || "").startsWith("WIDEN")).length,
    };
  } catch {}

  // Count dedupe events from rejection data
  const dedupeBlocked = rejections.items?.filter((r) => r.rejection_stage === "dedupe_filter").length || 0;

  return {
    date,
    generated_at: new Date().toISOString(),
    total_candidates: summary.total_trades || 0,
    total_deployed: summary.total_trades ? summary.total_trades - (rejections.total_blocked || 0) : 0,
    total_blocked: rejections.total_blocked || 0,
    false_negative_count: rejections.false_negatives || 0,
    false_positive_count: 0,
    oor_count: (summary.oor_above || 0) + (summary.oor_below || 0),
    oor_above_count: summary.oor_above || 0,
    oor_below_count: summary.oor_below || 0,
    avg_time_to_oor_minutes: range.avg_time_to_oor,
    wallet_filter_false_negative: (rejections.top_false_negative_causes || [])
      .filter((c) => c.logic?.includes("wallet"))
      .reduce((sum, c) => sum + c.count, 0),
    dedupe_false_negative: (rejections.top_false_negative_causes || [])
      .filter((c) => c.logic?.includes("dedupe"))
      .reduce((sum, c) => sum + c.count, 0),
    wait_recheck_count: range.wait_recheck_count || recheckData.waiting + recheckData.rechecked,
    recheck_success_count: range.recheck_success_count || recheckData.improved,
    recheck_still_critical_count: range.recheck_still_critical_count || recheckData.still_critical,
    recheck_deployed_count: 0,
    recheck_blocked_count: recheckData.still_critical || 0,
    shift_up_used_count: recheckData.shift_up,
    widen_used_count: recheckData.widen,
    pf: summary.pf || 0,
    pf_confidence: summary.pf_confidence || "NO_DATA",
    pf_warning: summary.pf_warning || null,
    dedupe_blocked,
    source: daily ? "daily_forensic" : "live_aggregation",
  };
}

export async function recoverPendingObservations(dates = []) {
  const today = new Date().toISOString().slice(0, 10);
  const candidates = dates.length ? dates : [today];
  for (const d of candidates) {
    await updateAllPendingObservations(d);
  }
}
