import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const INTELLIGENCE_DIR = process.env.MERIDIAN_INTELLIGENCE_DIR || path.join(ROOT, "data", "intelligence");

function appendJsonl(fileName, payload = {}) {
  const record = {
    timestamp: payload.timestamp || new Date().toISOString(),
    ...payload,
  };
  try {
    fs.mkdirSync(INTELLIGENCE_DIR, { recursive: true });
    fs.appendFileSync(path.join(INTELLIGENCE_DIR, fileName), `${JSON.stringify(record)}\n`, "utf8");
  } catch (error) {
    record.ledger_error = error.message;
  }
  return record;
}

export function appendAIScreeningLog(payload) {
  return appendJsonl("ai_screening_log.jsonl", payload);
}

export function appendCycleLog(payload) {
  return appendJsonl("cycle_log.jsonl", payload);
}

export function appendIntelligenceDecision(payload) {
  return appendJsonl("decision_log.jsonl", payload);
}

export function appendDeployLog(payload) {
  return appendJsonl("deploy_log.jsonl", payload);
}

export function appendExitLog(payload) {
  return appendJsonl("exit_log.jsonl", payload);
}

export function appendStrategyConflict(payload) {
  return appendJsonl("strategy_conflict_report.jsonl", payload);
}

export function appendStrategyAttribution(payload) {
  return appendJsonl("strategy_attribution.jsonl", payload);
}

export const INTELLIGENCE_LEDGER_DIR = INTELLIGENCE_DIR;
