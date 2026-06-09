import { runCopyEngineCycle } from "../copy-engine/position-monitor.js";

const result = await runCopyEngineCycle({
  dryRun: true,
  forceRanking: false,
});

console.log(JSON.stringify(result, null, 2));
