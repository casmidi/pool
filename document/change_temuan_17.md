# Change Log TEMUAN 17

Tanggal: 2026-06-02

## 1. Overview

TEMUAN 17 mengimplementasikan Source Truth Persistence & Signal Forensics Layer.

Tujuan:

- Membekukan truth saat entry.
- Menghentikan recompute historis dari state yang sudah berubah.
- Menyimpan decision snapshot immutable di PnL log.
- Membuat signal forensics yang objektif.
- Mendeteksi missing truth sebagai error eksplisit.

Core rule:

NO RECOMPUTE AFTER TRADE.

## 2. Root Problem

TEMUAN 16 membuktikan wallet truth rusak:

- Wallet source corruption 100%.
- Missing source wallet identity 100%.
- Huge winners terbaca `wallet:DANGEROUS`.

Root cause:

Trade log lama tidak punya frozen entry truth. Saat close/backtest, sistem mencoba membaca ulang atau menyusun ulang truth dari field yang sudah tidak lengkap.

Akibat:

- Forensics menjadi tebak-tebakan.
- Wallet score terlihat zero.
- Defensive truth terlihat lebih buruk/aneh.
- Backtest jadi kurang reliable.

## 3. Source Truth Persistence

Ditambahkan `lib/source_truth.js`.

Fungsi:

- `createSourceTruth()`
- `validateEntryTruth()`
- `detectSignalLoss()`

Source truth menyimpan:

- source wallet
- source wallet score
- source wallet type
- source wallet confidence
- copy engine source
- source signal id
- raw FeeTVL
- raw alpha
- raw timing
- raw OOR
- raw crowding
- raw confidence
- raw edge
- deploy args asli

Hook:

- `lib/pnl_tracker.js::recordDeploy()`

Setiap deploy baru sekarang menyimpan:

- `entry_truth`
- `truth_snapshot_hash`
- `signal_loss`

## 4. Immutable Snapshot

Ditambahkan `createDecisionSnapshot()`.

Snapshot berisi:

- wallet truth
- FeeTVL
- alpha
- timing
- OOR
- crowding
- blocker reasons
- conviction placeholder
- confidence
- execution mode
- copy engine state
- memory state
- defensive state

Snapshot disimpan sebagai:

- `decision_snapshot`

Rule:

- Snapshot dibuat hanya saat deploy.
- Close/dry-run close tidak menimpa snapshot.
- Snapshot punya hash agar mismatch bisa dideteksi.

## 5. Signal Forensics

Ditambahkan:

- `buildSignalForensics()`
- `buildForensicsReport()`

Endpoint baru:

- `/api/signal-forensics?limit=100`

Forensics menjawab:

- entry truth
- decision
- reasons
- blockers
- pnl outcome
- duration
- OOR outcome
- shadow comparison
- signal loss state
- forensic verdict

Verdict:

- `PASS_WIN`
- `PASS_LOSS`
- `MISCLASSIFIED_BLOCKED_WINNER`
- `CORRECT_BLOCK_OR_AVOIDED_LOSS`
- `FORENSICS_INCOMPLETE`

## 6. Immutable PnL Log

`recordDeploy()` sekarang membangun PnL record dari immutable truth snapshot.

Field baru:

- `source_wallet_type`
- `source_wallet_confidence`
- `copy_engine_source`
- `source_signal_id`
- `entry_truth`
- `decision_snapshot`
- `truth_snapshot_hash`
- `signal_loss`

`recordClose()` dan `simulateDryRunCloses()` tetap boleh update outcome fields seperti PnL/close reason, tetapi tidak membuat ulang entry truth.

## 7. Signal Loss Detection

`detectSignalLoss()` mendeteksi:

- missing entry truth
- missing decision snapshot
- snapshot hash mismatch
- missing source wallet
- missing wallet score
- missing source signal id
- missing raw FeeTVL/confidence/action
- malformed score range

Output:

- `SIGNAL_OK`
- `SIGNAL_LOSS_DETECTED`
- `CRITICAL_SIGNAL_LOSS`

Severity:

- LOW
- MEDIUM
- HIGH
- CRITICAL

Rule:

CRITICAL/HIGH means promotion is not allowed.

## 8. Entry-Time Validation

`validateEntryTruth()` runs before persistence.

If critical source is missing:

- snapshot still persists
- validation marks `SOURCE_CORRUPTED`
- signal loss marks severity

This prevents silent corruption.

## 9. Files Changed

Created:

- `lib/source_truth.js`
- `document/change_temuan_17.md`

Modified:

- `lib/pnl_tracker.js`
- `tools/executor.js`
- `copy-engine/position-monitor.js`
- `lib/backtest_engine.js`
- `dashboard.js`

## 10. Verification

Local checks:

- `node --check lib/source_truth.js`
- `node --check lib/pnl_tracker.js`
- `node --check lib/backtest_engine.js`
- `node --check dashboard.js`
- `node --check tools/executor.js`
- `node --check copy-engine/position-monitor.js`

Local sample:

- synthetic valid snapshot returns `SIGNAL_OK`
- legacy local trades return `CRITICAL_SIGNAL_LOSS`

VPS checks:

- Deployed updated files.
- `node --check` passed on VPS.
- Restarted `pool-dashboard`.
- Restarted `meridian`.
- Verified `/api/health`.
- Verified `/api/signal-forensics?limit=50`.
- Verified `/api/backtest?days=30&mode=all`.

VPS forensic result:

- Total checked: 27
- `CRITICAL_SIGNAL_LOSS`: 27
- `FORENSICS_INCOMPLETE`: 27

Interpretation:

All old trades lack immutable entry truth. This is expected and now visible. Future deploys will carry frozen truth.

## 11. Known Limitations

- Old trades cannot be repaired without original entry snapshots.
- We intentionally do not fabricate missing truth.
- Existing historical backtest remains useful for outcome analysis, but not exact signal forensics.
- New truth persistence only affects future deploys.
- Source signal quality still depends on copy engine producing valid wallet/source fields.

## 12. Final Status

TEMUAN 17 selesai dan live di VPS.

Final status:

`SOURCE TRUTH PERSISTENCE ACTIVE`

Current forensic state for old data:

`CRITICAL_SIGNAL_LOSS`

Objective verdict:

The system now stops guessing. Old trades are marked incomplete instead of being recomputed. Future trades will preserve entry-time truth, decision snapshot, source wallet identity, source score, raw signals, and immutable hash.
