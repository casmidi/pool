# Change Rekomendasi 01 - Intelligence Layer Upgrade

## 1. Executive Summary

Implemented an advisory intelligence layer for Meridian DLMM LP. The layer adds market-regime detection, adaptive Darwin learning, pool-decay prediction, capital reallocation analysis, conviction sizing, crowding analysis, and explainability.

## 2. Scope

This change adds measurement and recommendation modules only. It does not rewrite the strategy, deploy flow, confidence formula, or default thresholds.

## 3. Files Added

- `intelligence/market-regime.js`
- `intelligence/darwin-intelligence.js`
- `intelligence/pool-decay.js`
- `intelligence/capital-allocator.js`
- `intelligence/position-sizing.js`
- `intelligence/crowding-engine.js`
- `intelligence/explainable-intelligence.js`
- `test/test-intelligence-layer.js`

## 4. Files Modified

- `config.js`
- `tools/screening.js`
- `strategy/position-manager.js`

## 5. Feature 1 - Market Regime

Added `detectMarketRegime(pools, history)` with regimes:

- `EUPHORIC`
- `TRENDING`
- `DEFENSIVE`
- `DEAD_MARKET`

The module returns recommended scoring/penalty/threshold/exit adjustments, but these are not applied by default.

## 6. Feature 2 - Darwin Intelligence

Added `learnFromOutcomes(trades)` and `applyAdaptiveWeights(baseWeights, learned)`. Adjustments are capped and decay-weighted so recent outcomes matter more without allowing runaway weights.

## 7. Feature 3 - Pool Decay

Added `predictPoolDecay(pool, history)` with:

- expected half-life
- expected fee decay
- sustainability score
- decay risk
- status and explanation

`position-manager.js` now includes decay metadata in `position_summary`. It does not change actions unless `applyIntelligenceDecayRules` is enabled per call.

## 8. Feature 4 - Capital Allocator

Added `evaluateOpportunityCost(currentPositions, availablePools)`, returning best alternative pools and redeploy candidates. This is analytics-only.

## 9. Feature 5 - Position Sizing

Added `recommendPositionSize(pool, portfolio)`, returning advisory size, multiplier, conviction, confidence, and reasons. It does not alter deploy amount by default.

## 10. Feature 6 - Crowding Engine

Added `analyzeCrowding(pool, context)` with crowding score, LP competition, fee compression risk, status, recommendation, and reasons.

## 11. Explainability

Added `explainPoolIntelligence(pool, context)`, which combines regime, decay, crowding, and sizing into a compact operator explanation. `tools/screening.js` attaches this under `pool.intelligence` when `config.intelligenceLayer.enabled` is true.

## 12. Safety Controls

New config block:

```js
intelligenceLayer: {
  enabled: true,
  enforce: false,
  applyScoringAdjustments: false,
  applyPositionRules: false,
  applySizingRecommendation: false
}
```

Default behavior is advisory/read-only. Scoring adjustments are only applied if `intelligenceLayer.enforce` or `intelligenceLayer.applyScoringAdjustments` is enabled. Position-manager decay rules only affect actions when explicitly enabled per call.

## Validation

Run:

```bash
node test/test-intelligence-layer.js
```

The test validates all new modules and confirms default advisory mode does not change the base scorer output or default position action.

## Rollback

Remove the added `intelligence/*.js` modules, remove `test/test-intelligence-layer.js`, revert the `intelligenceLayer` config block, and remove intelligence metadata wiring from `tools/screening.js` and `strategy/position-manager.js`.
