# Meridian Incident Report

Generated: 2026-06-05T04:37:25.411Z
Trace ID: Goblin-SOL_2026_06_04_13_15_32
Pool: Goblin-SOL
Pool Address: 453Z9ggMEdMnBiMLc5hHthxC3P4qhmhFUoTqkRnHDhqr
Position: dry_1780578932538_wyqy
Mode: DRY RUN
Strategy: bid_ask
Entry Time: 2026-06-04T13:15:32.540Z
Close Time: 2026-06-05T02:10:42.925Z
Minutes Held: 775
Amount: 0.118 SOL
Confidence: 76%
Organic: 74
PnL: -20.26%
PnL SOL: -0.023912
PnL USD: -1.66
Fees: unknown USD
OOR minutes: 0
Close reason: paper stop-loss

## Primary Finding

Anti-OOR warning should have prevented this deploy. Treat as pre-entry guard failure or legacy trade before hard-block.

## Entry / Exit Geometry

- Entry bin: -333
- Exit/active bin at close: -385
- Range: -402 -> -333
- Bins below/above: 69 / 0
- In range at close: yes
- Entry price: 0.0704113721124159

## Anti-OOR Snapshot

- Risk: CRITICAL
- Recommendation: NO_DEPLOY_OR_SANDBOX_ONLY
- Timing action: WAIT_5_MIN
- Wait minutes: 5
- Range recommendation: WIDEN_AND_SHIFT_UP
- Directional bias: UPWARD
- Reasons:
  - MOMENTUM_BREAKOUT_UP
  - recent fast OOR cluster
  - high recent OOR rate
  - OOR has produced repeated losses

## Risk Context

- Pool trust score: 66
- Pool trust samples: 1
- Pool trust win rate: 100%
- Pool trust OOR rate: 100%
- Capital protection: active (3 consecutive losing closes)
- Shadow v1 decision: COPY (threshold 0.742, differs=false)

## Red Flags

- Anti-OOR predicted CRITICAL (NO_DEPLOY_OR_SANDBOX_ONLY) before/at entry.
- Pool trust used sparse history (1 sample).
- Pool trust OOR rate was high (100%).
- Capital protection was active: 3 consecutive losing closes.
- Position was still inside configured range at close; loss came from PnL stop-loss, not OOR wait.

## Confidence Breakdown
```json
{
  "wallet": 0.1869,
  "range": 0.1053,
  "fee_tvl": 0.2105,
  "volatility": 0.1432,
  "organic": 0.1168,
  "age": 0,
  "total": 0.7628,
  "raw": {
    "walletScore": 74,
    "rangeQuality": 50,
    "feeTvl": 0.1551,
    "volatility": 1.498,
    "organicScore": 74,
    "organicWeight": 0.1579,
    "ageHours": null
  }
}
```

## Root Cause Hints
- No recorded OOR minutes; inspect price movement, momentum, and stop-loss mark.
- Organic score passed the configured floor.
- Fee/TVL was acceptable at entry.
- Anti-OOR risk was CRITICAL.

## Recommendations
- Keep Anti-OOR HIGH/CRITICAL as hard pre-entry block.
- Do not let sparse pool trust samples boost confidence above neutral.
- If stop-loss fires while in range, review momentum timing and PnL mark quality.
- Avoid immediate redeploy if pool trust score is deteriorating or OOR history is high.
- Compare this trade against future Shadow v2 exit-route and cluster-risk evidence.
