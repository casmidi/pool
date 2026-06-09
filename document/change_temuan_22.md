# Change Log TEMUAN 22

Tanggal: 2026-06-02

## 1. Overview

TEMUAN 22 mengimplementasikan Active Learning & Anti-OOR Momentum Intelligence Layer.

Tujuan:

- Mengurangi loss OOR yang predictable.
- Mendeteksi momentum escape.
- Memberi rekomendasi delay/range sebelum deploy.
- Memisahkan smart loss dari stupid loss.
- Tetap sandbox-first dan defensive-first.

Core rule:

Smart loss allowed. Stupid loss not allowed. Defensive engine always wins.

## 2. Root Problem

Recent losses menunjukkan pattern:

- paper out-of-range above
- fast OOR
- range terlalu rendah saat market bergerak naik
- bot masih terlalu mean-reversion saat market momentum breakout

Masalah ini tidak boleh diselesaikan dengan aggressive risk. Yang dibutuhkan adalah deteksi momentum, delay, range adjustment, dan learning priority.

## 3. Momentum Escape Detector

Ditambahkan `MomentumEscapeDetector` di `lib/anti_oor_intelligence.js`.

Outputs:

- `MOMENTUM_BREAKOUT_UP`
- `MOMENTUM_BREAKOUT_DOWN`
- `MOMENTUM_STABLE`

Signals:

- rapid upward OOR cluster
- rapid downward OOR cluster
- narrow range repeatedly failed
- high fee activity during OOR

Rule:

Breakout active means avoid narrow mean-reversion deployment.

## 4. Anti-OOR Intelligence

Ditambahkan `AntiOorIntelligence`.

Tracks:

- OOR above
- OOR below
- time-to-OOR
- OOR rate
- losing OOR
- narrow range OOR

Outputs:

- `UPWARD_ESCAPE`
- `DOWNWARD_ESCAPE`
- `LATE_ENTRY`
- `BAD_RANGE`
- `NO_OOR_PATTERN`

Important:

OOR history diberi label `OBSERVATIONAL_UNTIL_TRUTH_VALID_SAMPLE`. Ini bukan fake confidence.

## 5. Entry Timing Delay

Ditambahkan `EntryTimingDelayEngine`.

Actions:

- `WAIT_2_MIN`
- `WAIT_5_MIN`
- `ENTER_ALLOWED_BY_TIMING`

Recheck:

- spread quality
- FeeTVL
- momentum persistence
- OOR probability

Rule:

Delay adalah timing optimization, bukan permanent rejection.

## 6. Dynamic Range Width

Ditambahkan `DynamicRangeWidth`.

Recommendations:

- `KEEP_STANDARD_RANGE`
- `WIDEN_RANGE`
- `WIDEN_AND_SHIFT_UP`
- `WIDEN_AND_SHIFT_DOWN`

Rule:

Range adapts to regime, but does not override defensive gates.

## 7. OOR Prediction

Ditambahkan `OorPredictionEngine`.

Output:

- `OOR_RISK LOW`
- `OOR_RISK MEDIUM`
- `OOR_RISK HIGH`
- `OOR_RISK CRITICAL`

Actions:

- LOW: normal defensive gates
- MEDIUM: delay and recheck
- HIGH: sandbox only or delay
- CRITICAL: no deploy or sandbox only

Executor integration:

- Dry-run/sandbox: allowed for evidence with anti-OOR annotation.
- Live/non-dry: `CRITICAL` OOR risk blocks deploy.

## 8. Active Learning

Ditambahkan `ActiveLearningPriorityEngine`.

Prioritizes:

- repeated OOR above
- repeated OOR below
- fast OOR
- OOR losses
- shadow/candidate disagreement

Outputs:

- LOW
- MEDIUM
- HIGH
- CRITICAL

Purpose:

Learn from the highest-value mistakes first.

## 9. Loss Quality

Ditambahkan `LossQualityEngine`.

Classifications:

- `SMART`
- `WARNING`
- `STUPID`

SMART loss:

- sandbox/tiny size
- new evidence
- expected uncertainty

STUPID loss:

- repeated avoidable OOR
- warning ignored
- known range/timing mistake repeated

Repeated stupid loss triggers:

- `REPEATED_STUPID_LOSS_WARNING`

## 10. Files Changed

Created:

- `lib/anti_oor_intelligence.js`
- `document/change_temuan_22.md`

Modified:

- `dashboard.js`
- `tools/executor.js`

New endpoint:

- `/api/anti-oor`

Executor behavior:

- Adds `anti_oor_intelligence` to deploy args.
- Blocks live deploy only when OOR risk is `CRITICAL`.
- Does not block dry-run/sandbox evidence collection.

## 11. Verification

Local verification:

- `node --input-type=module` import test for `buildAntiOorPayload`
- Payload returns:
  - momentum escape state
  - OOR pattern
  - entry timing action
  - dynamic range recommendation
  - OOR risk
  - learning priority
  - loss quality state

VPS verification:

- Deploy `dashboard.js`
- Deploy `tools/executor.js`
- Deploy `lib/anti_oor_intelligence.js`
- Restart `pool-dashboard`
- Restart `meridian`
- Query `/api/anti-oor?days=30&mode=all`

## 12. Known Limitations

- Historical OOR data is observational until enough truth-valid trades exist.
- Fee spike acceleration and spread compression are only used when fields are present.
- Dynamic range output is recommendation/gating metadata, not a forced range rewrite.
- No dashboard redesign was performed.

## 13. Final Status

TEMUAN 22 implemented.

The system now identifies repeated OOR mistakes, predicts OOR risk before deploy, delays entry during momentum escape, recommends adaptive range behavior, and classifies loss quality without increasing risk.

End state:

The bot can make better mistakes while avoiding repeated stupid OOR losses.
