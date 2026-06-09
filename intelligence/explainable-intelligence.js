import { detectMarketRegime } from "./market-regime.js";
import { predictPoolDecay } from "./pool-decay.js";
import { analyzeCrowding } from "./crowding-engine.js";
import { recommendPositionSize } from "./position-sizing.js";

export function explainPoolIntelligence(pool = {}, context = {}) {
  const marketRegime = context.marketRegime ?? detectMarketRegime(context.pools ?? [pool], context.history ?? []);
  const decay = predictPoolDecay(pool, context.poolHistory ?? [], context.decayOptions ?? {});
  const crowding = analyzeCrowding(pool, context.crowding ?? {});
  const sizing = recommendPositionSize(
    { ...pool, decay, crowding },
    context.portfolio ?? {},
    context.sizingOptions ?? {},
  );

  return {
    marketRegime,
    decay,
    crowding,
    sizing,
    explainability: [
      `regime ${marketRegime.regime}: ${marketRegime.explanation}`,
      `decay ${decay.status}: ${decay.explanation}`,
      `crowding ${crowding.status}: ${crowding.recommendation}`,
      `sizing conviction ${sizing.conviction}`,
    ],
  };
}
