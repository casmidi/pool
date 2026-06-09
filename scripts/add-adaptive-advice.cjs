const fs = require("fs");

// Step 1: Add getAdaptiveCloseAdvice to shadow_v2_engine.js
let eng = fs.readFileSync("shadow/shadow_v2_engine.js", "utf8");

if (eng.includes("getAdaptiveCloseAdvice")) {
  console.log("Step 1: getAdaptiveCloseAdvice already exists - skipping");
} else {
  const newFunction = `
/**
 * Get adaptive close advice for a position based on Shadow V2 data.
 * Returns advice on whether to wait (adaptive says hold) or proceed with close.
 * @param {string} poolAddress - The pool address
 * @param {string} poolName - The pool name
 * @param {string} closeRule - The deterministic close rule that triggered (e.g. "oor_timeout")
 * @returns {{ shouldDelay: boolean, delayMinutes: number, reason: string, adaptiveBestRoute: string }}
 */
export function getAdaptiveCloseAdvice(poolAddress, poolName, closeRule) {
  try {
    const summaryData = readJson(SUMMARY_PATH, { summaries: [] });
    const today = new Date().toISOString().slice(0, 10);
    const todaySummary = (summaryData.summaries || []).find(s => s.date === today);
    
    if (!todaySummary || !todaySummary.adaptive_by_variant) {
      return { shouldDelay: false, delayMinutes: 0, reason: "no_adaptive_data", adaptiveBestRoute: "none" };
    }

    const bestRoute = todaySummary.adaptive_best_route || "none";
    const bestImpact = todaySummary.adaptive_best_impact_sol || 0;
    
    // Only delay if adaptive shows positive impact and the best route is wait_5m_recheck
    if (bestRoute === "wait_5m_recheck" && bestImpact > 0.1) {
      // For OOR timeout close rule, add adaptive delay of 5 minutes
      if (closeRule === "oor_timeout") {
        return {
          shouldDelay: true,
          delayMinutes: 5,
          reason: "adaptive_wait_5m_recheck_positive_impact",
          adaptiveBestRoute: bestRoute,
        };
      }
      // For low yield, add a shorter delay
      if (closeRule === "low_yield") {
        return {
          shouldDelay: true,
          delayMinutes: 3,
          reason: "adaptive_wait_low_yield_recheck",
          adaptiveBestRoute: bestRoute,
        };
      }
    }

    // Check if this specific pool has shadow cases with positive adaptive data
    const casesData = readJson(CASES_PATH, { cases: [] });
    const poolCase = (casesData.cases || []).find(
      c => c.pool_address === poolAddress && c.adaptive_shadow
    );
    
    if (poolCase && poolCase.adaptive_shadow) {
      const variants = poolCase.adaptive_shadow;
      // Check if wait_5m_recheck variant shows positive impact for this specific pool
      const waitVariant = variants.find(v => v.name === "wait_5m_recheck");
      if (waitVariant && waitVariant.impact_sol > 0.05 && closeRule === "oor_timeout") {
        return {
          shouldDelay: true,
          delayMinutes: 5,
          reason: "pool_specific_adaptive_wait_positive",
          adaptiveBestRoute: "wait_5m_recheck",
        };
      }
    }

    return { shouldDelay: false, delayMinutes: 0, reason: "adaptive_no_delay", adaptiveBestRoute: bestRoute };
  } catch (err) {
    console.error("[shadow_v2] getAdaptiveCloseAdvice error:", err.message);
    return { shouldDelay: false, delayMinutes: 0, reason: "error", adaptiveBestRoute: "none" };
  }
}
`;

  // Insert before the resetShadowV2TablesForTest function
  eng = eng.replace(
    "export function resetShadowV2TablesForTest",
    newFunction + "\nexport function resetShadowV2TablesForTest"
  );
  
  fs.writeFileSync("shadow/shadow_v2_engine.js", eng, "utf8");
  console.log("Step 1 DONE: getAdaptiveCloseAdvice added to shadow_v2_engine.js");
}

// Step 2: Modify index.js - add import and adaptive delay in getDeterministicCloseRule
let idx = fs.readFileSync("index.js", "utf8");

// Step 2a: Add import for getAdaptiveCloseAdvice
if (idx.includes("getAdaptiveCloseAdvice")) {
  console.log("Step 2a: getAdaptiveCloseAdvice import already exists - skipping");
} else {
  // Find the shadow_v2 import or add near other imports
  const shadowImport = 'import { buildShadowV2Summary, recordShadowV2Candidate, observeShadowV2Candidate, SHADOW_V2_CASES_PATH, SHADOW_V2_SUMMARY_PATH } from "./shadow/shadow_v2_engine.js";';
  const newImport = shadowImport.replace(
    'SHADOW_V2_SUMMARY_PATH } from "./shadow/shadow_v2_engine.js";',
    'SHADOW_V2_SUMMARY_PATH, getAdaptiveCloseAdvice } from "./shadow/shadow_v2_engine.js";'
  );
  
  if (idx.includes(shadowImport)) {
    idx = idx.replace(shadowImport, newImport);
    console.log("Step 2a DONE: Added getAdaptiveCloseAdvice to shadow_v2 import");
  } else {
    console.log("Step 2a: shadow_v2 import not found as expected, searching...");
    // Try alternative import patterns
    const altPatterns = [
      /from\s+["']\.\/shadow\/shadow_v2_engine\.js["'];/,
    ];
    let found = false;
    for (const pat of altPatterns) {
      if (pat.test(idx)) {
        idx = idx.replace(pat, (match) => match.replace(";", ", getAdaptiveCloseAdvice };").replace("{,", "{"));
        console.log("Step 2a DONE: Added getAdaptiveCloseAdvice via alt pattern");
        found = true;
        break;
      }
    }
    if (!found) {
      console.log("Step 2a WARNING: Could not find shadow_v2 import to add getAdaptiveCloseAdvice");
    }
  }
}

// Step 2b: Add adaptive delay logic in getDeterministicCloseRule
// Find the OOR timeout rule (rule 4) and add adaptive check before it
if (idx.includes("adaptiveDelayMinutes")) {
  console.log("Step 2b: Adaptive delay already exists - skipping");
} else {
  // Find the OOR timeout rule - it checks outOfRangeWaitMinutes
  const oorTimeoutPattern = /\/\/ Rule 4.*?oor_timeout.*?outOfRangeWaitMinutes/s;
  
  // Find the rule 4 section and add adaptive delay before it
  // We look for the specific pattern where rule 4 returns oor_timeout
  const rule4Search = 'action: "CLOSE", rule: "oor_timeout"';
  
  if (idx.includes(rule4Search)) {
    // Find the full rule 4 block and wrap it with adaptive delay check
    const adaptiveBlock = `
      // === ADAPTIVE PnL: Check if Shadow V2 says to delay this close ===
      if (typeof getAdaptiveCloseAdvice === "function") {
        try {
          const adaptiveAdvice = getAdaptiveCloseAdvice(
            p.pool_address || p.poolAddress || "",
            p.pool_name || p.poolName || "",
            "oor_timeout"
          );
          if (adaptiveAdvice.shouldDelay) {
            // Check if we already delayed for this position recently
            const delayKey = \`adaptive_delay_\${p.position_address || p.positionAddress}\`;
            const lastDelay = globalThis[delayKey] || 0;
            const now = Date.now();
            const cooldownMs = adaptiveAdvice.delayMinutes * 60 * 1000;
            
            if (now - lastDelay < cooldownMs) {
              // Still in adaptive delay period - don't close yet
              const remainingMin = Math.ceil((cooldownMs - (now - lastDelay)) / 60000);
              log(\`[adaptive-delay] HOLD \${p.pool_name || p.poolName}: adaptive wait \${remainingMin}m remaining (route: \${adaptiveAdvice.adaptiveBestRoute})\`);
              return null; // Skip this close rule
            } else {
              // Delay period expired, allow close but log it
              globalThis[delayKey] = now;
              log(\`[adaptive-delay] EXPIRED \${p.pool_name || p.poolName}: adaptive wait period over, allowing OOR close\`);
            }
          }
        } catch (e) {
          // Don't break the management cycle if adaptive check fails
        }
      }
      // === END ADAPTIVE PnL CHECK ===
`;
    
    // Insert the adaptive block right before the rule 4 OOR timeout check
    // Find the exact line with rule 4
    const rule4Idx = idx.indexOf(rule4Search);
    if (rule4Idx > -1) {
      // Find the start of this rule block (go back to find the if statement)
      let blockStart = idx.lastIndexOf("if (", rule4Idx);
      if (blockStart > -1) {
        // Also go back past any comments
        let commentStart = idx.lastIndexOf("\n", blockStart);
        if (commentStart > -1 && idx.substring(commentStart, blockStart).trim().startsWith("//")) {
          blockStart = commentStart;
        }
        idx = idx.substring(0, blockStart) + adaptiveBlock + "\n      " + idx.substring(blockStart);
        console.log("Step 2b DONE: Adaptive delay logic added before OOR timeout rule");
      } else {
        console.log("Step 2b WARNING: Could not find block start for rule 4");
      }
    } else {
      console.log("Step 2b WARNING: Could not find rule 4 pattern");
    }
  } else {
    console.log("Step 2b WARNING: Could not find oor_timeout rule pattern in index.js");
  }
}

fs.writeFileSync("index.js", idx, "utf8");
console.log("\nAll steps complete!");
