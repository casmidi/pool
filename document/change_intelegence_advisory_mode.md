# MERIDIAN PHASE 3 — EXECUTION INTELLIGENCE ADVISORY MODE

## Change Report

**Date:** 2026-06-06  
**Status:** Implemented  
**Author:** Buffy (Codebuff AI)

---

## 1. Files Modified

| File | Change Type | Description |
|------|-------------|-------------|
| `config.js` | Modified | Added `executionIntelligenceMode` config field |
| `lib/execution_intelligence.js` | Modified | Added advisory mode logic to all calculation functions |
| `dashboard.js` | Modified | Passes `advisoryMode` to enrichment, exposes mode in bot status |
| `test/test-execution-intelligence-advisory.js` | New | 12 regression tests for advisory mode |
| `user-config.json` | Modified | Added `executionIntelligenceMode: "advisory"` |

---

## 2. Exact Logic Changed

### config.js (line ~474)
Added new config field:
```javascript
executionIntelligenceMode: u.executionIntelligenceMode ?? "strict",
```
- `strict` — current behavior (backward-compatible)
- `advisory` — execution intelligence calculates but NEVER blocks deploy
- `disabled` — skip execution intelligence entirely

### lib/execution_intelligence.js
**Core change:** All 5 exported functions now accept `{ advisoryMode }` options parameter.

#### calculateConviction()
- **BEFORE:** `status === "BLOCKED" || alpha === "AVOID"` → `{ state: "NO TRADE", score: 0 }`
- **AFTER (advisory):** Same conditions → `{ state: "LOW", score: 25, advisory: true, warnings: [...] }`

#### calculatePositionSize()
- **BEFORE:** `conviction.state === "NO TRADE"` → `{ suggestedPct: 0 }`
- **AFTER (advisory):** Same condition → `{ suggestedPct: 1-3%, advisory: true }` (small test position)

#### calculateExecutionState()
- **BEFORE:** blocked conditions → `{ state: "NO ENTRY", tone: "blocked" }`
- **AFTER (advisory):** Same conditions → `{ state: "ADVISORY_ONLY", recommendedAction: "SMALL_TEST_POSITION" }`

#### calculateRiskReward()
- **BEFORE:** blocked conditions → `{ label: "NO TRADE", rr: 0 }`
- **AFTER (advisory):** Same conditions → still projects risk/reward with advisory flag

#### enrichExecutionIntelligence()
- Returns `advisoryLog` object when `advisoryMode: true`:
```javascript
{
  event: "execution_intelligence_advisory_override",
  mode: "advisory",
  originalState: "NO TRADE",
  effectiveState: "ADVISORY_ONLY",
  recommendedAction: "SMALL_TEST_POSITION",
  conviction: 25,
  warnings: ["defensive engine blocks execution", ...]
}
```

### dashboard.js
- `/api/status` response now includes `bot.executionIntelligenceMode`
- `/api/pools` enrichment passes `advisoryMode` from config
- `/api/copy-signals` enrichment passes `advisoryMode` from config

---

## 3. Rollback Steps

1. Remove `executionIntelligenceMode` from `user-config.json`
2. Revert `config.js` — remove the `executionIntelligenceMode` field
3. Revert `lib/execution_intelligence.js` — remove `{ advisoryMode }` parameters
4. Revert `dashboard.js` — remove `execCfg` variable and `executionIntelligenceMode` from status
5. Delete `test/test-execution-intelligence-advisory.js`

**OR simply set config to:**
```json
{ "executionIntelligenceMode": "strict" }
```
This restores all original behavior without code changes.

---

## 4. Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Advisory mode allows risky deploys | Medium | Anti-OOR, allocation engine, shadow v2, legality checks still enforce |
| Dashboard shows stale mode | Low | Mode read from user-config.json on each request |
| experience_intelligence.js not updated | Low | Uses execution data but doesn't check advisory flag — safe since it only adjusts scores |
| backtest_engine.js not updated | Low | Backtest still uses original logic — correct for historical analysis |

---

## 5. Expected Impact

### Before (strict mode)
```
Candidate passes screening
↓
Execution Intelligence says: NO ENTRY
↓
No deploy (dashboard shows BLOCKED)
```

### After (advisory mode)
```
Candidate passes screening
↓
Execution Intelligence warns: ADVISORY_ONLY
↓
Deploy continues if other gates pass
↓
Dashboard shows ADVISORY MODE badge
```

### Trade Volume
- Advisory mode removes ONE veto layer (execution intelligence)
- Other veto layers remain: anti-OOR, allocation, shadow v2, decision layer, alpha edge
- Expected: moderate increase in deploy frequency for borderline candidates

---

## 6. Sample Logs

### Advisory Override Log
```json
{
  "event": "execution_intelligence_advisory_override",
  "mode": "advisory",
  "pool": "ABC-XYZ...",
  "original_state": "NO TRADE",
  "effective_state": "CONTINUE_DEPLOY",
  "recommended_action": "SMALL_TEST_POSITION",
  "conviction": 25
}
```

### Dashboard Status Response
```json
{
  "bot": {
    "executionIntelligenceMode": "advisory"
  }
}
```

### API Pools Response (per pool)
```json
{
  "execution": {
    "executionState": {
      "state": "ADVISORY_ONLY",
      "advisory": true,
      "recommendedAction": "SMALL_TEST_POSITION"
    },
    "advisoryLog": {
      "event": "execution_intelligence_advisory_override",
      "mode": "advisory",
      "conviction": 25,
      "warnings": ["defensive engine blocks execution"]
    }
  }
}
```

---

## 7. Regression Test Results

```
✅ Test 1 PASSED: STRICT mode returns NO TRADE for blocked ROI
✅ Test 2 PASSED: ADVISORY mode returns LOW with advisory flag for blocked ROI
✅ Test 3 PASSED: STRICT mode returns 0% for blocked pool
✅ Test 4 PASSED: ADVISORY mode returns small test position for blocked pool
✅ Test 5 PASSED: STRICT mode returns NO ENTRY for blocked pool
✅ Test 6 PASSED: ADVISORY mode returns ADVISORY_ONLY with recommendedAction
✅ Test 7 PASSED: STRICT mode returns NO TRADE risk/reward for blocked pool
✅ Test 8 PASSED: ADVISORY mode projects risk/reward for blocked pool
✅ Test 9 PASSED: Normal pool identical in STRICT and ADVISORY modes
✅ Test 10 PASSED: enrichExecutionIntelligence returns advisoryLog in advisory mode
✅ Test 11 PASSED: No advisoryLog in strict mode
✅ Test 12 PASSED: Default (no advisoryMode) behaves as strict

🎉 All 12 regression tests passed!
```

---

## 8. Remaining Risks

1. **execution_intelligence.js is NOT imported in executor.js** — The module is only used by dashboard.js (display) and backtest_engine.js (analysis). The actual deploy blocking happens in executor.js's own safety checks (anti-OOR, allocation, shadow v2, decision layer, alpha edge). Therefore, advisory mode in execution_intelligence.js primarily affects **dashboard display and backtest analysis**, not the actual deploy flow.

2. **experience_intelligence.js calls execution functions but doesn't pass advisoryMode** — This means `applyMemoryAwareConviction()` will use strict mode internally. This is acceptable because experience_intelligence adjusts scores but doesn't block deploys.

3. **User must manually add `executionIntelligenceMode` to user-config.json** if not already present.

---

## 9. Recommendation After Deployment

1. **Monitor dashboard** — Verify ADVISORY MODE badge appears in bot status
2. **Check deploy frequency** — Advisory mode should increase candidate pool visibility
3. **Review advisoryLog** — Confirm advisory overrides are logged correctly
4. **If trade frequency doesn't increase** — The real blockers are anti-OOR, allocation engine, and shadow v2 — not execution intelligence
5. **Consider adjusting other gates** — See `document/rekomendasi_perubahan_20260606.md` for complementary config changes

---

## Key Finding

**Execution Intelligence is NOT a hard blocker in the deploy flow.** The module (`lib/execution_intelligence.js`) is only imported by:
- `dashboard.js` — for display/API responses
- `lib/backtest_engine.js` — for historical analysis

The actual deploy flow in `tools/executor.js` has its OWN blocking conditions (anti-OOR, allocation engine, shadow v2, decision layer, alpha edge) that do NOT reference execution_intelligence.js.

Therefore, advisory mode primarily changes **how the dashboard displays execution state** and **how backtests analyze historical trades**, rather than directly unblocking deploys.
