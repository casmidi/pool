const fs = require("fs");
let idx = fs.readFileSync("index.js", "utf8");

if (idx.includes("ADAPTIVE_PNL_DELAY")) {
  console.log("Adaptive delay already exists - skipping");
  process.exit(0);
}

const adaptiveBlock = `
  // === ADAPTIVE PnL: Shadow V2 delay check before OOR close ===
  if (typeof getAdaptiveCloseAdvice === "function") {
    try {
      const adaptiveAdvice = getAdaptiveCloseAdvice(
        position.pool_address || "",
        position.pool_name || "",
        "oor_timeout"
      );
      if (adaptiveAdvice.shouldDelay) {
        const delayKey = "adaptive_delay_" + (position.position_address || position.pool_address || "");
        const lastDelay = globalThis[delayKey] || 0;
        const now = Date.now();
        const cooldownMs = adaptiveAdvice.delayMinutes * 60 * 1000;
        if (now - lastDelay < cooldownMs) {
          const remainingMin = Math.ceil((cooldownMs - (now - lastDelay)) / 60000);
          log("[adaptive-delay] HOLD " + (position.pool_name || "?") + ": adaptive wait " + remainingMin + "m remaining (route: " + adaptiveAdvice.adaptiveBestRoute + ")");
          return null;
        }
        globalThis[delayKey] = now;
        log("[adaptive-delay] EXPIRED " + (position.pool_name || "?") + ": adaptive wait over, allowing OOR close");
      }
    } catch (_e) { /* don't break management cycle */ }
  }
  // === END ADAPTIVE PnL DELAY ===
`;

// Find the first OOR timeout rule (rule 4 above range) and insert adaptive delay before it
const target1 = `  if (\n    position.active_bin != null &&\n    position.upper_bin != null &&\n    position.active_bin > position.upper_bin &&\n    (position.minutes_out_of_range ?? 0) >= managementConfig.outOfRangeWaitMinutes\n  ) {\n    return { action: "CLOSE", rule: 4, reason: "OOR" };\n  }`;

if (idx.includes(target1)) {
  idx = idx.replace(target1, adaptiveBlock + target1);
  console.log("DONE: Adaptive delay added before OOR rule 4 (above range)");
} else {
  console.log("WARNING: Target pattern 1 not found");
}

fs.writeFileSync("index.js", idx, "utf8");
console.log("index.js updated");
