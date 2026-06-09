import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const DATA_DIR = path.join(ROOT, "data");
const DEFAULT_PATHS = {
  featureImpact: path.join(DATA_DIR, "feature_impact.json"),
  copySignals: path.join(ROOT, "copy-signals.json"),
  missed: path.join(DATA_DIR, "missed_opportunities.json"),
  pnl: path.join(DATA_DIR, "pnl_log.json"),
  replay: path.join(DATA_DIR, "trade_replay.json"),
  decisions: path.join(ROOT, "decision-log.json"),
};

export const FEATURE_DEFS = [
  { id: "anti_euphoria", label: "Anti-Euphoria", aliases: ["euphoria", "euphoria_trap"] },
  { id: "survival", label: "Survival Filter", aliases: ["survival", "low_survival"] },
  { id: "crowding", label: "Crowding Filter", aliases: ["crowd", "copy_saturation", "saturation"] },
  { id: "timing_boost", label: "Timing Boost", aliases: ["timing", "walletTiming"] },
  { id: "trust_score", label: "Trust Score", aliases: ["trust", "poolTrust"] },
  { id: "organic_gate", label: "Organic Gate", aliases: ["organic", "low_organic"] },
  { id: "ai_reviewer", label: "AI Reviewer", aliases: ["claude", "hybrid_review", "reviewer"] },
  { id: "alpha_rank", label: "Alpha Rank Filter", aliases: ["alpha_rank", "alpha edge", "alpha_edge_hold"] },
];

const MAX_ENTRIES = 10000;

function ensureDir(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function readJSON(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJSON(filePath, value) {
  ensureDir(filePath);
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), "utf8");
}

function num(value, fallback = null) {
  if (value === null || value === undefined || value === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function round(value, places = 2) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  const m = 10 ** places;
  return Math.round(n * m) / m;
}

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value));
}

function emptyStore() {
  return { version: 1, entries: [], updatedAt: null };
}

export function loadFeatureImpactStore(paths = DEFAULT_PATHS) {
  const store = readJSON(paths.featureImpact, emptyStore());
  if (!Array.isArray(store.entries)) store.entries = [];
  return store;
}

export function saveFeatureImpactStore(store, paths = DEFAULT_PATHS) {
  const next = {
    version: 1,
    entries: (store.entries || []).slice(-MAX_ENTRIES),
    updatedAt: new Date().toISOString(),
  };
  writeJSON(paths.featureImpact, next);
  return next;
}

function eventKey(event) {
  return [
    event.pool || "unknown",
    event.feature || "unknown",
    event.decision || "unknown",
    event.timestamp || event.ts || "",
    event.reason || "",
  ].join("|");
}

export function recordFeatureImpactEvent(event = {}, paths = DEFAULT_PATHS) {
  const store = loadFeatureImpactStore(paths);
  const entry = normalizeEntry(event);
  const key = eventKey(entry);
  const idx = store.entries.findIndex((x) => eventKey(x) === key);
  if (idx >= 0) store.entries[idx] = { ...store.entries[idx], ...entry };
  else store.entries.push(entry);
  return saveFeatureImpactStore(store, paths);
}

function normalizeEntry(event = {}) {
  const feature = normalizeFeature(event.feature || "unknown");
  const decision = String(event.decision || event.action || "PASSED").toUpperCase() === "BLOCKED" ? "BLOCKED" : "PASSED";
  return {
    pool: event.pool || event.poolAddress || event.pool_address || event.deployArgs?.pool_address || null,
    poolName: event.poolName || event.pool_name || event.deployArgs?.pool_name || null,
    feature,
    featureLabel: FEATURE_DEFS.find((f) => f.id === feature)?.label || feature,
    confidence: num(event.confidence ?? event.decision_confidence),
    alphaRank: event.alphaRank ?? event.alpha_rank ?? event.alpha?.alphaRank ?? event.alphaEdge?.alphaRank ?? null,
    decision,
    reason: event.reason || event.reasonSkipped || event.reasons?.join("; ") || null,
    timestamp: event.timestamp || event.ts || new Date().toISOString(),
    estimatedCounterfactual: event.estimatedCounterfactual ?? null,
    observedPnl: num(event.observedPnl ?? event.actualPnl ?? event.pnl_pct),
    meta: event.meta || {},
  };
}

function normalizeFeature(value = "") {
  const raw = String(value).trim().toLowerCase();
  const direct = FEATURE_DEFS.find((f) => f.id === raw);
  if (direct) return direct.id;
  const found = FEATURE_DEFS.find((f) => f.aliases.some((alias) => raw.includes(alias.toLowerCase())));
  return found?.id || raw.replace(/[^a-z0-9]+/g, "_") || "unknown";
}

function textOf(value) {
  if (value == null) return "";
  if (Array.isArray(value)) return value.map(textOf).join(" ");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function poolOf(signal = {}) {
  return signal.pool || signal.poolAddress || signal.pool_address || signal.deployArgs?.pool_address || signal.poolName || signal.deployArgs?.pool_name || null;
}

function confidenceOf(signal = {}) {
  return num(signal.confidence ?? signal.decision_confidence ?? signal.deployArgs?.decision_confidence);
}

function alphaOf(signal = {}) {
  return signal.alphaEdge || signal.alpha || signal.deployArgs?.alpha_edge || null;
}

function addFeature(events, signal, feature, decision, reason, extra = {}) {
  events.push(normalizeEntry({
    pool: poolOf(signal),
    poolName: signal.poolName || signal.pool_name || signal.deployArgs?.pool_name || null,
    feature,
    confidence: confidenceOf(signal),
    alphaRank: signal.alphaRank || signal.alpha_rank || alphaOf(signal)?.alphaRank || null,
    decision,
    reason,
    timestamp: signal.ts || signal.timestamp || new Date().toISOString(),
    meta: {
      source: extra.source || "derived",
      wallet: signal.wallet || signal.source_wallet || null,
      ...extra.meta,
    },
  }));
}

function deriveAlphaEvents(signal, decision, events, source) {
  const alpha = alphaOf(signal);
  const holdReasons = new Set((alpha?.holdReasons || signal.holdReasons || signal.risks || []).map((r) => String(r).toLowerCase()));
  const reasonText = textOf([signal.reason, signal.reasonSkipped, signal.reasons, signal.risks, alpha?.holdReasons]).toLowerCase();
  if (alpha?.euphoria) {
    addFeature(events, signal, "anti_euphoria", holdReasons.has("euphoria_trap") || reasonText.includes("euphoria") ? "BLOCKED" : decision, alpha.euphoria.reason, { source });
  }
  if (alpha?.survival) {
    addFeature(events, signal, "survival", holdReasons.has("low_survival") || reasonText.includes("survival") ? "BLOCKED" : decision, alpha.survival.reason, { source });
  }
  if (alpha?.crowd) {
    addFeature(events, signal, "crowding", holdReasons.has("copy_saturation") || reasonText.includes("saturation") || reasonText.includes("crowd") ? "BLOCKED" : decision, alpha.crowd.reason, { source });
  }
  if (alpha?.walletTiming) {
    const score = num(alpha.walletTiming.score, 50);
    addFeature(events, signal, "timing_boost", score < 35 ? "BLOCKED" : "PASSED", alpha.walletTiming.reason, { source });
  }
  if (alpha?.alphaRank || signal.alphaRank || signal.alpha_rank) {
    const rank = String(alpha?.alphaRank || signal.alphaRank || signal.alpha_rank || "").toUpperCase();
    addFeature(events, signal, "alpha_rank", alpha?.action === "HOLD" || ["D", "F"].includes(rank) ? "BLOCKED" : "PASSED", `rank ${rank || "unknown"}`, { source });
  }
}

function deriveOrganicEvent(signal, events, source) {
  const organic = num(signal.organicScore ?? signal.organic_score ?? signal.deployArgs?.organic_score ?? signal.organic);
  const reasonText = textOf([signal.reason, signal.reasonSkipped, signal.reasons, signal.risks]).toLowerCase();
  if (organic == null && !reasonText.includes("organic")) return;
  const blocked = reasonText.includes("low_organic") || reasonText.includes("organic") && reasonText.includes("below");
  addFeature(events, signal, "organic_gate", blocked ? "BLOCKED" : "PASSED", organic == null ? "organic gate mentioned" : `organic ${organic}`, { source });
}

function deriveTrustEvent(signal, events, source) {
  const trust = signal.poolTrust || signal.trustScore || signal.deployArgs?.pool_trust || null;
  const score = num(trust?.score ?? trust);
  const reasonText = textOf([signal.reason, signal.reasons, signal.risks]).toLowerCase();
  if (score == null && !reasonText.includes("trust")) return;
  addFeature(events, signal, "trust_score", score != null && score < 40 || reasonText.includes("trust") && reasonText.includes("below") ? "BLOCKED" : "PASSED", score == null ? "trust score mentioned" : `trust ${score}`, { source });
}

function deriveReviewerEvents(decisions = []) {
  const events = [];
  for (const d of decisions) {
    const reason = textOf([d.reason, d.summary]).toLowerCase();
    if (!reason.includes("claude") && !reason.includes("hybrid review") && !reason.includes("reviewer")) continue;
    addFeature(events, d, "ai_reviewer", reason.includes("reject") || reason.includes("blocked") ? "BLOCKED" : "PASSED", d.reason || d.summary || "AI reviewer", { source: "decision-log" });
  }
  return events;
}

export function deriveFeatureImpactEvents(sources = {}) {
  const copy = sources.copySignals || { signals: [], ignored: [] };
  const missed = sources.missed || { opportunities: [] };
  const decisions = sources.decisions || { decisions: [] };
  const events = [];

  for (const signal of copy.signals || []) {
    deriveAlphaEvents(signal, "PASSED", events, "copy-signals");
    deriveOrganicEvent(signal, events, "copy-signals");
    deriveTrustEvent(signal, events, "copy-signals");
  }
  for (const signal of copy.ignored || []) {
    deriveAlphaEvents(signal, "BLOCKED", events, "copy-ignored");
    deriveOrganicEvent(signal, events, "copy-ignored");
    deriveTrustEvent(signal, events, "copy-ignored");
  }
  for (const opp of missed.opportunities || []) {
    const blockedSignal = { ...opp, ts: opp.ts, reason: opp.reasonSkipped, alphaEdge: opp.alpha };
    deriveAlphaEvents(blockedSignal, "BLOCKED", events, "missed-opportunities");
    deriveOrganicEvent(blockedSignal, events, "missed-opportunities");
  }
  events.push(...deriveReviewerEvents(decisions.decisions || []));
  return events;
}

function avgPoolPnl(pool, trades = []) {
  const matches = trades.filter((t) => pool && (t.pool_address === pool || t.pool_name === pool) && (t.status === "closed" || t.close_time));
  if (!matches.length) return null;
  return matches.reduce((sum, t) => sum + num(t.pnl_pct ?? t.pnl_sol ?? t.pnl_usd, 0), 0) / matches.length;
}

function replayPnl(pool, replay = []) {
  const hit = replay.find((r) => pool && (r.poolAddress === pool || r.poolName === pool) && r.result);
  return hit ? num(hit.result.pnlPct ?? hit.result.pnl_pct ?? hit.result.pnlSol ?? hit.result.pnl_sol) : null;
}

export function estimateCounterfactual(entry = {}, context = {}) {
  const trades = context.trades || [];
  const replay = context.replay || [];
  const pool = entry.pool || entry.poolName;
  const explicit = num(entry.observedPnl);
  const replayEstimate = replayPnl(pool, replay);
  const poolAvg = avgPoolPnl(pool, trades);
  const confidence = num(entry.confidence, 0.5);
  const rank = String(entry.alphaRank || "C").toUpperCase();
  const rankAdj = rank.startsWith("A") ? 1.2 : rank === "B" ? 0.6 : rank === "D" ? -1.1 : -0.2;
  const survival = clamp(50 + confidence * 35 + rankAdj * 5);
  const oorRisk = clamp(70 - survival + (entry.feature === "survival" ? 12 : 0) + (entry.feature === "anti_euphoria" ? 8 : 0));
  const proxy = confidence * 5 + rankAdj - oorRisk / 18;
  const estimatedPnl = explicit ?? replayEstimate ?? poolAvg ?? proxy;
  return {
    estimatedPnl: round(estimatedPnl, 2),
    oorRisk: Math.round(oorRisk),
    survival: Math.round(survival),
  };
}

export function updateFeatureImpactAnalytics(paths = DEFAULT_PATHS) {
  const store = loadFeatureImpactStore(paths);
  const sources = {
    copySignals: readJSON(paths.copySignals, { signals: [], ignored: [] }),
    missed: readJSON(paths.missed, { opportunities: [] }),
    pnl: readJSON(paths.pnl, { trades: [] }),
    replay: readJSON(paths.replay, { trades: [] }),
    decisions: readJSON(paths.decisions, { decisions: [] }),
  };
  const entriesByKey = new Map((store.entries || []).map((entry) => [eventKey(entry), entry]));
  for (const event of deriveFeatureImpactEvents(sources)) {
    entriesByKey.set(eventKey(event), { ...entriesByKey.get(eventKey(event)), ...event });
  }
  const trades = sources.pnl.trades || [];
  const replay = sources.replay.trades || [];
  const entries = [...entriesByKey.values()].map((entry) => {
    if (entry.decision === "BLOCKED" && !entry.estimatedCounterfactual) {
      return { ...entry, estimatedCounterfactual: estimateCounterfactual(entry, { trades, replay }) };
    }
    return entry;
  }).sort((a, b) => new Date(a.timestamp || 0) - new Date(b.timestamp || 0)).slice(-MAX_ENTRIES);
  return saveFeatureImpactStore({ entries }, paths);
}

function statusFor(effectiveness) {
  if (effectiveness > 70) return "HIGH VALUE";
  if (effectiveness >= 50) return "WORKING";
  if (effectiveness >= 30) return "WATCH";
  return "TOO AGGRESSIVE?";
}

export function buildFeatureImpactPayload(paths = DEFAULT_PATHS) {
  const store = updateFeatureImpactAnalytics(paths);
  const features = FEATURE_DEFS.map((def) => {
    const entries = store.entries.filter((entry) => entry.feature === def.id);
    const blockedEntries = entries.filter((entry) => entry.decision === "BLOCKED");
    const passedEntries = entries.filter((entry) => entry.decision === "PASSED");
    const estimatedPnls = blockedEntries
      .map((entry) => num(entry.estimatedCounterfactual?.estimatedPnl))
      .filter((v) => v != null);
    const savedEst = estimatedPnls.length
      ? -estimatedPnls.reduce((sum, v) => sum + v, 0) / estimatedPnls.length
      : 0;
    const falseBlock = blockedEntries.length
      ? blockedEntries.filter((entry) => num(entry.estimatedCounterfactual?.estimatedPnl, -1) > 0).length / blockedEntries.length * 100
      : 0;
    const passScore = passedEntries.length ? Math.min(10, passedEntries.length / 4) : 0;
    const effectiveness = Math.round(clamp(50 + savedEst * 2.5 - falseBlock * 0.65 + passScore));
    return {
      id: def.id,
      label: def.label,
      blockedCount: blockedEntries.length,
      passedCount: passedEntries.length,
      estimatedSavedPct: round(savedEst, 1),
      falseBlockEstimatePct: round(falseBlock, 1),
      effectivenessScore: effectiveness,
      status: statusFor(effectiveness),
    };
  });
  const withSignals = features.filter((f) => f.blockedCount > 0 || f.passedCount > 0);
  const topHelper = withSignals.slice().sort((a, b) => b.estimatedSavedPct - a.estimatedSavedPct)[0] || null;
  const mostAggressive = withSignals.slice().sort((a, b) => a.estimatedSavedPct - b.estimatedSavedPct || b.blockedCount - a.blockedCount)[0] || null;
  return {
    summary: {
      totalEntries: store.entries.length,
      topHelper: topHelper ? { label: topHelper.label, estimatedSavedPct: topHelper.estimatedSavedPct } : null,
      mostAggressive: mostAggressive ? { label: mostAggressive.label, estimatedSavedPct: mostAggressive.estimatedSavedPct } : null,
      updatedAt: store.updatedAt,
    },
    features,
  };
}

export { DEFAULT_PATHS };
