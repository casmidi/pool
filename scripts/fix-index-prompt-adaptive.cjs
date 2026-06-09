const fs = require("fs");

// ===== STEP 2: Modify index.js =====
let idx = fs.readFileSync("index.js", "utf8");

// Step 2a: Add import for getAdaptiveCloseAdvice from shadow_v2_engine.js
if (idx.includes("getAdaptiveCloseAdvice")) {
  console.log("Step 2a: getAdaptiveCloseAdvice already imported - skipping");
} else {
  // Add new import after the shadow_summary import
  const shadowSummaryImport = 'import { buildShadowPayload, formatShadowTelegram } from "./shadow/shadow_summary.js";';
  const newImport = shadowSummaryImport + '\nimport { getAdaptiveCloseAdvice } from "./shadow/shadow_v2_engine.js";';
  
  if (idx.includes(shadowSummaryImport)) {
    idx = idx.replace(shadowSummaryImport, newImport);
    console.log("Step 2a DONE: Added getAdaptiveCloseAdvice import from shadow_v2_engine.js");
  } else {
    console.log("Step 2a WARNING: shadow_summary import not found");
  }
}

// Step 2b: Add adaptive delay logic before OOR timeout rules in getDeterministicCloseRule
if (idx.includes("ADAPTIVE_PNL_DELAY")) {
  console.log("Step 2b: Adaptive delay already exists - skipping");
} else {
  // Find the OOR timeout rule blocks - they check minutes_out_of_range >= outOfRangeWaitMinutes
  // and return { action: "CLOSE", rule: 4, reason: "OOR" }
  // We add adaptive delay BEFORE the first occurrence of rule 4
  
  const oorRule1 = 'if ((position.minutes_out_of_range ?? 0) >= managementConfig.outOfRangeWaitMinutes)';
  
  if (idx.includes(oorRule1)) {
    const adaptiveBlock = `
      // === ADAPTIVE PnL: Shadow V2 delay check before OOR close ===
      if (typeof getAdaptiveCloseAdvice === "function") {
        try {
          const adaptiveAdvice = getAdaptiveCloseAdvice(
            position.pool_address || position.poolAddress || "",
            position.pool_name || position.poolName || "",
            "oor_timeout"
          );
          if (adaptiveAdvice.shouldDelay) {
            const delayKey = "adaptive_delay_" + (position.position_address || position.positionAddress || position.pool_address || "");
            const lastDelay = globalThis[delayKey] || 0;
            const now = Date.now();
            const cooldownMs = adaptiveAdvice.delayMinutes * 60 * 1000;
            if (now - lastDelay < cooldownMs) {
              const remainingMin = Math.ceil((cooldownMs - (now - lastDelay)) / 60000);
              log("[adaptive-delay] HOLD " + (position.pool_name || position.poolName || "?") + ": adaptive wait " + remainingMin + "m remaining (route: " + adaptiveAdvice.adaptiveBestRoute + ")");
              return null;
            }
            globalThis[delayKey] = now;
            log("[adaptive-delay] EXPIRED " + (position.pool_name || position.poolName || "?") + ": adaptive wait over, allowing OOR close");
          }
        } catch (_e) { /* don't break management cycle */ }
      }
`;
    // Insert before the first OOR timeout check
    idx = idx.replace(oorRule1, adaptiveBlock + "\n      " + oorRule1);
    console.log("Step 2b DONE: Adaptive delay logic added before OOR timeout rule");
  } else {
    console.log("Step 2b WARNING: OOR timeout rule pattern not found");
  }
}

fs.writeFileSync("index.js", idx, "utf8");
console.log("index.js updated successfully");

// ===== STEP 3: Update prompt.js manager prompt =====
let prompt = fs.readFileSync("prompt.js", "utf8");

if (prompt.includes("ADAPTIVE_SHADOW_V2")) {
  console.log("Step 3: Manager prompt already has adaptive shadow context - skipping");
} else {
  // Find the manager prompt section and add shadow_v2 context
  // Look for "BIAS TO HOLD" or similar manager instructions
  const biasToHold = /BIAS TO HOLD/i;
  
  if (biasToHold.test(prompt)) {
    const shadowContext = `
ADAPTIVE SHADOW V2 CONTEXT:
- The Shadow V2 engine simulates alternative entry strategies (widen_shift_up, wait_5m_recheck, second_chance_queue) for every position.
- If the summary shows "adaptive_best_route: wait_5m_recheck" with positive "adaptive_best_impact_sol", it means WAITING before closing losing positions has historically been profitable.
- When adaptive impact is positive, be more PATIENT with OOR positions — the price often returns within 5 minutes.
- When adaptive impact is negative or zero, close normally per the deterministic rules.
- DO NOT close positions purely because of temporary OOR status if adaptive data suggests waiting.
- Always verify current PnL data via get_position_pnl before making any close decision.
`;
    prompt = prompt.replace(biasToHold, shadowContext + "\n$&");
    console.log("Step 3 DONE: Adaptive Shadow V2 context added to manager prompt");
  } else {
    console.log("Step 3 WARNING: Could not find BIAS TO HOLD in prompt.js");
  }
}

fs.writeFileSync("prompt.js", prompt, "utf8");
console.log("prompt.js updated successfully");

console.log("\n=== ALL STEPS COMPLETE ===");
