import { getTopCandidates } from "./tools/screening.js";

const result = await getTopCandidates({ limit: 10 });
const candidates = result?.candidates || result?.pools || [];
console.log(JSON.stringify({
  keys: Object.keys(result || {}),
  count: candidates.length,
  filtered: (result?.filtered_examples || []).slice(0, 15),
  first: candidates[0] || null,
}, null, 2));
