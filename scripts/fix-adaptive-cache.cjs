const fs = require("fs");
let eng = fs.readFileSync("shadow/shadow_v2_engine.js", "utf8");

// Cache for summary and cases data - reset every 60 seconds
const CACHE_TTL_MS = 60000;
let cachedSummary = null;
let cachedSummaryTime = 0;
let cachedCases = null;
let cachedCasesTime = 0;

function readJsonCached(path, fallback) {
  const now = Date.now();
  if (path.includes("summary") && cachedSummary && (now - cachedSummaryTime) < CACHE_TTL_MS) {
    return cachedSummary;
  }
  if (path.includes("cases") && cachedCases && (now - cachedCasesTime) < CACHE_TTL_MS) {
    return cachedCases;
  }
  try {
    const data = JSON.parse(fs.readFileSync(path, "utf8"));
    if (path.includes("summary")) {
      cachedSummary = data;
      cachedSummaryTime = now;
    } else if (path.includes("cases")) {
      cachedCases = data;
      cachedCasesTime = now;
    }
    return data;
  } catch {
    return fallback;
  }
}

// Replace the readJson calls inside getAdaptiveCloseAdvice with cached version
const oldCode = `    const summaryData = readJson(SUMMARY_PATH, { summaries: [] });`;
const newCode = `    const summaryData = readJsonCached(SUMMARY_PATH, { summaries: [] });`;

if (eng.includes(oldCode)) {
  eng = eng.replace(oldCode, newCode);
  console.log("Replaced summary readJson with cached version");
} else {
  console.log("Summary readJson pattern not found");
}

const oldCasesCode = `    const casesData = readJson(CASES_PATH, { cases: [] });`;
const newCasesCode = `    const casesData = readJsonCached(CASES_PATH, { cases: [] });`;

if (eng.includes(oldCasesCode)) {
  eng = eng.replace(oldCasesCode, newCasesCode);
  console.log("Replaced cases readJson with cached version");
} else {
  console.log("Cases readJson pattern not found");
}

fs.writeFileSync("shadow/shadow_v2_engine.js", eng, "utf8");
console.log("shadow_v2_engine.js updated with cached reads");
