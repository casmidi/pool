const fs = require("fs");
const file = "/opt/bot/meridian/tools/dlmm.js";
let code = fs.readFileSync(file, "utf8");

// Find and replace the throw error block + activeBinsAbove = 0 block
// These are at lines 862-872 approximately
const lines = code.split("\n");
let startLine = -1;
let endLine = -1;

for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes("isSingleSidedSol") && lines[i].includes("bins_above") && lines[i].includes("upside_pct")) {
    startLine = i;
    // Find the closing of this if block and the next if(isSingleSidedSol) block
    let braceCount = 0;
    for (let j = i; j < lines.length && j < i + 20; j++) {
      for (const ch of lines[j]) {
        if (ch === "{") braceCount++;
        if (ch === "}") braceCount--;
      }
      endLine = j;
      // Check if we've closed both blocks
      if (j > i && braceCount <= 0) break;
    }
    break;
  }
}

if (startLine >= 0 && endLine >= 0) {
  // Also check if the next line is another isSingleSidedSol check
  let extraEnd = endLine;
  for (let j = endLine + 1; j < Math.min(endLine + 5, lines.length); j++) {
    if (lines[j].includes("isSingleSidedSol") && lines[j].includes("activeBinsAbove")) {
      // This is the "activeBinsAbove = 0" block - include it
      let bc = 0;
      for (let k = j; k < lines.length && k < j + 5; k++) {
        for (const ch of lines[k]) {
          if (ch === "{") bc++;
          if (ch === "}") bc--;
        }
        extraEnd = k;
        if (k > j && bc <= 0) break;
      }
      break;
    }
  }

  const before = lines.slice(0, startLine).join("\n");
  const after = lines.slice(extraEnd + 1).join("\n");
  const replacement = `  // [FIXED] Allow bins_above > 0 for single-sided SOL — SDK handles range placement
  // Removed: throw error that blocked bins_above > 0
  // Removed: activeBinsAbove = 0 override`;

  code = before + "\n" + replacement + "\n" + after;
  fs.writeFileSync(file, code);
  console.log("SUCCESS: Replaced lines " + startLine + "-" + extraEnd);
  console.log("Old:", lines.slice(startLine, extraEnd + 1).join("\n"));
} else {
  console.log("FAILED: Could not find the isSingleSidedSol + bins_above block");
}
