# TEMUAN 07 - ROI Priority Dashboard Improvement

## Overview

Implemented a profitability-focused ROI layer for the Meridian dashboard. The dashboard now explains why an opportunity deserves attention, should be held, or should be avoided instead of showing raw candidate metrics only.

## Features Implemented

- Wallet score classification: ELITE, STRONG, NEUTRAL, WEAK, DANGEROUS.
- Dynamic wallet insights with strengths, risks, adjusted score, and penalty details.
- Wallet penalty engine for suspicious clustering, repetitive reuse, concentration, copy-farm behavior, and abnormal patterns.
- FeeTVL classification: EXCELLENT, STRONG, HEALTHY, WEAK, DANGEROUS.
- FeeTVL insight with strengths, warnings, and trend state: Improving, Stable, Weakening.
- Blocker reason engine with blocked reasons, hold reasons, and positive signals.
- Alpha decision normalization to PASS, HOLD, or AVOID.
- Confidence breakdown by Wallet, Organic, FeeTVL, AntiCrowd, and Survival.
- Dashboard UI displays ROI classifications, tooltips, and expandable confidence details while preserving existing fields.

## Files Changed

- `lib/roi_priority.js`
- `dashboard.js`
- `public/index.html`
- `document/change_temuan_97.md`

## Technical Decisions

- Added a reusable backend helper module instead of embedding ROI logic directly in the frontend.
- Kept all existing API fields intact and added `roi` as an additive payload field for backward compatibility.
- Enriched both `/api/pools` and `/api/copy-signals` so screener candidates and copy-engine signals use the same explanation model.
- Used configurable threshold objects inside the helper module to make future ML-driven scoring easier.
- Kept dashboard rendering incremental: existing table structure remains, but cells now expose classification and explanation context.

## Logic Summary

- Wallet score starts from copy-engine wallet score when available, otherwise falls back to candidate score.
- Penalties reduce wallet confidence when suspicious reuse, clustering, concentration, copy-farm, or abnormal signals appear.
- FeeTVL is evaluated as a carry-quality proxy and classified independently from wallet quality.
- Blocker reasons combine wallet tier, FeeTVL risk, explicit risk flags, and alpha hold reasons.
- Alpha resolves to:
  - PASS when no hard blocker or hold reason exists.
  - HOLD when risks require waiting or confirmation.
  - AVOID when hard blockers are present.
- Confidence breakdown is an explainable weighted contribution model, not a replacement for the live decision engine.

## Backward Compatibility

- Existing dashboard endpoints still return their original fields.
- Existing UI pages and tables remain available.
- Existing copy-signal and candidate consumers can ignore the new `roi` field safely.
- No existing trading execution logic was changed.
- The change is dashboard and explainability focused.

## Future Improvements

- Persist historical FeeTVL snapshots to produce stronger trend detection.
- Feed wallet penalty outcomes back into Darwin or adaptive confidence calibration.
- Add pool-address based merge between screener candidates and copy-engine signals where pool names differ.
- Add hover cards with richer blocker details once the UI has a dedicated tooltip component.
- Calibrate confidence contribution weights from realized PnL data.

## Final Status

Completed. TEMUAN 07 ROI dashboard improvements are implemented with additive backend enrichment, visible UI classifications, expandable confidence explanation, and no breaking API changes.
