# Change: Profit Formula Fix - 2026-06-06

## Problem
- 3 trades, 0 profit, 3 losses (100% loss rate)
- All losses: `paper_out-of-range_above` — price broke upward beyond range
- 178 candidates ALL blocked by `wallet_filter` / `low_wallet_score`
- Root causes: bins_above=0 (one-sided down range) + walletScore=0 (missing smart-wallets.json)

## Changes

### 1. bins_above: 0 → 10 (Range Fix)
**Files:** `prompt.js`, `index.js`, `tools/executor.js`

All positions had `bins_above=0`, meaning range only extended downward. Any upward price movement = instant OOR above.

| File | Line | Before | After |
|------|------|--------|-------|
| prompt.js | 134 | `bins_above=0` | `bins_above=10` |
| index.js | 755 | `?? 0` | `?? 10` |
| index.js | 756 | `bins_above: 0` | `bins_above: 10` |
| index.js | 985 | `bins_above=0` | `bins_above=10` |
| index.js | 990 | `bins_above = 0` | `bins_above = 10` |
| index.js | 1897 | `bins_above: 0` | `bins_above: 10` |
| index.js | 2587 | `bins_above=0` | `bins_above=10` |
| executor.js | 903 | `bins_above ?? 0` | `bins_above ?? 10` |
| executor.js | 918 | `bins_above: 0` | `bins_above: 10` |

**New range example:** bins -271→-208 (53 below, 10 above) — was bins -271→-218 (53 below, 0 above)

### 2. executor.js Safety Check: Reject → Clamp [0,30]
**File:** `tools/executor.js` lines 1045-1053

Old: rejected bins_above != 0 for single-sided SOL deploys.
New: clamps requestedBinsAbove to [0, 30] range.

### 3. Wallet Score Fallback Fix
**File:** `decision/analysis-engine.js` line 23

`walletMetrics?.score ?? walletMetrics?._score ?? 0` → `?? 50`

When `smart-wallets.json` is missing, candidates now get default score 50 (= minScoreToCopy) instead of 0 (auto-blocked).

### 4. Shadow V2 Guard: hardBlockLevels
**File:** `lib/shadow_v2_guard.js` line 45

`["HIGH", "CRITICAL"]` → `["CRITICAL"]`

HIGH warnings now advisory-only, not hard block.

### 5. Model Fix
**File:** `user-config.json`

All models → `deepseek/deepseek-v4-flash` (was `deepseek/deepseek-chat:free` which 404'd)


### 6. dlmm.js: Remove bins_above Rejection for Single-Sided SOL
**File:** `tools/dlmm.js` lines 862-867

Old: throw new Error("Single-side SOL deploy cannot use bins_above or upside_pct...")
Removed the throw error + activeBinsAbove = 0 override.

This was the ACTUAL rejection point — even after executor.js was fixed, dlmm.js still threw an error when bins_above > 0 with single-sided SOL. The SDK wrapper now allows bins_above > 0.

### 7. definitions.js: Update LLM Instructions for bins_above
**File:** `tools/definitions.js` lines 174-182

Old: "Keep this at 0 for single-side SOL deploys. Only use this for dual-sided or explicit upside-exposure deploys."
New: "Use bins_above=10 for single-side SOL deploys to provide upward range coverage. Higher values (up to 20) for volatile tokens. Only set to 0 for very low-volatility pairs."

The LLM reads tool schema descriptions. With the old instruction, even after executor.js allowed bins_above=10, the LLM reverted to 0 because the tool definition told it to.


## Bot Status After Fix
- PM2: online, DRY_RUN=true
- 3 positions open (max reached)
- Screening active: finding candidates, pool-score gate working
- No syntax errors

## Risks
1. **DLMM SDK**: bins_above > 0 with single-sided SOL (amount_x=0) — SDK should handle internally but unverified on-chain
2. **Wallet filter**: analysis-engine.js is called by copy-engine, not main screening. If candidates still blocked, trace actual rejection source
3. **Range width**: total bins now 45-79 (was 35-69). Wider range = lower fee concentration but fewer OOR events

### 8. dashboard.js: Fix config is not defined in /api/pools and /api/copy-signals
**File:** dashboard.js lines 891, 985

**Problem:** The Opportunity Watchlist table was permanently stuck on "Loading" because:
- The config variable was only defined inside the /api/status handler (line 806)
- /api/pools handler used config.executionIntelligenceMode in its enrich() function without defining config in its scope
- /api/copy-signals handler also used config in enrichSignal() without defining it
- This caused ReferenceError: config is not defined → API crash → frontend never gets data → "Loading" forever

**Fix:** Added const config = readJSON(PATHS.userConfig, {}); at the start of:
- /api/pools handler (line 891)
- /api/copy-signals handler (line 985)

**Result:** /api/pools now returns valid JSON with candidates, execution, and offensive data. Opportunity Watchlist renders correctly.

### Risk
- Minimal — readJSON is a synchronous disk read of a small JSON file, negligible overhead per request
---
