import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const LEDGER_PATH = path.join(ROOT, "data", "decision_ledger.jsonl");
const MAX_BYTES = 50 * 1024 * 1024;

function getLedgerStream() {
  try {
    const dir = path.dirname(LEDGER_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (fs.existsSync(LEDGER_PATH)) {
      const stat = fs.statSync(LEDGER_PATH);
      if (stat.size > MAX_BYTES) rotateLedger();
    }
  } catch {}
}

function rotateLedger() {
  try {
    const rotated = LEDGER_PATH.replace(".jsonl", `_${Date.now()}.jsonl`);
    fs.renameSync(LEDGER_PATH, rotated);
  } catch {}
}

export function addLedgerEntry(entry) {
  getLedgerStream();
  const record = {
    ts: new Date().toISOString(),
    ...entry,
  };
  try {
    fs.appendFileSync(LEDGER_PATH, JSON.stringify(record) + "\n", "utf8");
  } catch {}
}

export function queryLedger({ pool, stage, limit = 50, since } = {}) {
  try {
    if (!fs.existsSync(LEDGER_PATH)) return [];
    const raw = fs.readFileSync(LEDGER_PATH, "utf8");
    const lines = raw.trim().split("\n").filter(Boolean);
    const entries = lines.map((l) => {
      try { return JSON.parse(l); } catch { return null; }
    }).filter(Boolean);
    entries.reverse();
    let filtered = entries;
    if (pool) filtered = filtered.filter((e) => e.pool === pool || e.poolName?.includes(pool));
    if (stage) filtered = filtered.filter((e) => e.stage === stage);
    if (since) filtered = filtered.filter((e) => new Date(e.ts) >= new Date(since));
    return filtered.slice(0, limit);
  } catch {
    return [];
  }
}

export function getLedgerSummary(hours = 24, limit = 20) {
  const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
  const entries = queryLedger({ since, limit: 500 });
  if (!entries.length) return "No ledger entries in last " + hours + "h";
  const blocked = entries.filter((e) => e.finalDecision === "BLOCKED");
  const deployed = entries.filter((e) => e.finalDecision === "DEPLOYED");
  const blockedByCount = {};
  for (const b of blocked) {
    for (const gate of (b.blockedBy || [])) {
      blockedByCount[gate] = (blockedByCount[gate] || 0) + 1;
    }
  }
  const wouldDeployCount = {};
  for (const b of blocked) {
    for (const fix of (b.wouldDeployIf || [])) {
      wouldDeployCount[fix] = (wouldDeployCount[fix] || 0) + 1;
    }
  }
  return {
    total: entries.length,
    deployed: deployed.length,
    blocked: blocked.length,
    blockedBySummary: Object.entries(blockedByCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([gate, count]) => `${gate}: ${count}`),
    wouldDeploySummary: Object.entries(wouldDeployCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([fix, count]) => `${fix}: ${count}`),
    topBlocked: blocked.slice(0, 5).map((e) => ({
      pool: e.poolName || e.pool,
      score: e.poolScore,
      blockedBy: e.blockedBy,
    })),
  };
}

export function getMissedOpportunities(hours = 24) {
  const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
  const entries = queryLedger({ since, limit: 500 });
  const blocked = entries.filter((e) => e.finalDecision === "BLOCKED");
  return blocked.map((e) => ({
    time: e.ts,
    pool: e.poolName || e.pool,
    score: e.poolScore,
    grade: e.grade,
    blockedBy: e.blockedBy || [],
    wouldDeployIf: e.wouldDeployIf || [],
    ev: e.ev,
    oorRisk: e.oorRisk,
    feeVelocity: e.feeVelocity,
    allocationSuggested: e.allocationSuggested,
  }));
}
