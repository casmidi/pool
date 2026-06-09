# Change Log TEMUAN 16

Tanggal: 2026-06-02

## 1. Overview

TEMUAN 16 mengimplementasikan Wallet Truth Repair & Data Normalization Layer.

Tujuan:

- Mengukur kualitas sumber `source_wallet_score`.
- Mendeteksi wallet score kosong, fallback, malformed, drift, dan mismatch.
- Memecah label `DANGEROUS` menjadi taxonomy yang lebih presisi.
- Membuat wallet reputation shadow.
- Membuat missing source repair.
- Membandingkan wallet logic lama vs repaired wallet truth secara shadow-only.
- Mendeteksi regression khusus wallet truth.

Core rule tetap:

- Defensive engine always wins.
- No auto-pass dangerous wallet.
- Hard rug protection preserved.
- Shadow first.

## 2. Root Problem

Hasil TEMUAN 14 dan 15 menunjukkan:

- Wallet blocker confidence LOW.
- False block rate 83.3%.
- Huge winners seperti `SQUIRE-SOL` +49.71% dan `SPCX-SOL` +49.66% terbaca `wallet:DANGEROUS`.

TEMUAN 16 menguji hipotesis:

Missing/corrupt wallet source -> score fallback/zero -> DANGEROUS -> false block.

Hasil VPS mengonfirmasi hipotesis itu.

## 3. Wallet Normalization Audit

Ditambahkan `WalletNormalizationAuditEngine` di `lib/wallet_truth.js`.

Tracked fields:

- `source_wallet_score`
- `walletScore`
- `deployArgs.wallet_score`
- raw decision breakdown wallet score
- pool score fallback
- ROI raw wallet score
- ROI adjusted wallet score

Issues detected:

- `missing_wallet_score`
- `fallback_usage`
- `malformed_score_range`
- `normalization_mismatch`
- `score_drift_after_penalty`
- `missing_source_wallet_identity`
- `zero_score_without_wallet_identity`

VPS result 30 hari:

- Total rows: 26
- Normalized: 0
- Corrupted: 26
- Corrupted rate: 100%
- Missing source wallet identity: 26
- Zero score without wallet identity: 26
- Normalization mismatch: 14

Interpretasi:

Wallet truth layer tidak bisa dipercaya pada dataset ini. Semua closed trade memakai wallet source yang rusak/kosong. Ini menjelaskan kenapa winner besar terbaca `DANGEROUS`.

## 4. Dangerous Taxonomy

Ditambahkan `DangerousWalletTaxonomy`.

Taxonomy:

- `TOXIC_DANGEROUS`
- `AGGRESSIVE_DANGEROUS`
- `ELITE_DANGEROUS`

Rule:

- Rug/honeypot/blacklist/exploit/malicious/dump tetap `TOXIC_DANGEROUS` dan `HARD_BLOCK`.
- Dangerous dengan positive fee/range/context bisa masuk `AGGRESSIVE_DANGEROUS`.
- Dangerous dengan historical profitable outcome/context bisa masuk `ELITE_DANGEROUS`.
- Semua ini shadow/context review, bukan live auto-pass.

VPS result:

| Taxonomy | Trades | Wins | Losses | Win Rate | Avg PnL | Total PnL |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| ELITE_DANGEROUS | 10 | 8 | 2 | 80.0% | 10.87% | 108.70% |
| AGGRESSIVE_DANGEROUS | 2 | 2 | 0 | 100.0% | 0.12% | 0.24% |

Interpretasi:

Mayoritas dangerous false blocks bukan toxic pada sample ini. Mereka terlihat seperti corrupted/unknown wallet source dengan profitable outcome.

## 5. Wallet Reputation

Ditambahkan `WalletReputationEngine`.

Metrics:

- win rate
- pnl
- rug association
- volatility
- repeat success
- trade count

Output:

- `TRUSTED`
- `AGGRESSIVE`
- `UNSTABLE`
- `TOXIC`
- `ELITE`

VPS result:

Semua trade saat ini jatuh ke `UNKNOWN_WALLET` karena source wallet identity hilang.

`UNKNOWN_WALLET`:

- Reputation: `ELITE`
- Trades: 26
- Win rate: 80.8%
- Avg PnL: 5.42%
- Total PnL: 140.92%
- Rug association: 0

Interpretasi:

Reputation belum bisa dipakai sebagai real wallet intelligence karena identity wallet hilang. Ini hanya bukti bahwa data identity source harus diperbaiki sebelum reputasi wallet dianggap valid.

## 6. Missing Source Repair

Ditambahkan `MissingSourceRepair`.

Rule:

Jika wallet score missing/fallback/corrupt:

- Jangan otomatis treat sebagai clean PASS.
- Jangan auto-pass.
- Gunakan context fallback untuk shadow recommendation:
  - FeeTVL strong/excellent
  - positive memory context
  - repaired score shadow

VPS result:

- Repaired shadow samples: 20
- Recommendation hanya shadow: `SOFT_BLOCK` / `CONTEXT_REVIEW`

Interpretasi:

Missing wallet source tidak lagi menjadi catastrophic hard truth di audit layer. Namun live defensive engine tetap tidak dilemahkan.

## 7. Shadow Reclassification

Ditambahkan `ShadowWalletReclassification`.

Mode:

- `SHADOW_ONLY`
- `realMoney: false`

VPS result:

- Current dangerous: 12
- Shadow reviewed: 12
- Shadow reviewed win rate: 83.3%
- Shadow reviewed avg PnL: 9.08%
- Shadow reviewed total PnL: 108.94%

Interpretasi:

Jika repaired wallet truth dipakai hanya sebagai review layer, semua false-block candidates menjadi terlihat. Tetapi karena sample kecil dan source identity corrupt, tidak ada live promotion.

## 8. Regression Detection

Ditambahkan `WalletTruthRegression`.

Triggers:

- dangerous wallet false winner rate tinggi
- wallet source corruption tinggi
- repaired shadow cohort collapse

VPS result:

State:

`WALLET_REGRESSION_DETECTED`

Metrics:

- False danger rate: 83.3%
- Corrupted rate: 100%

Warnings:

- dangerous wallet false winner rate 83.3%
- wallet source corruption 100%

Rollback:

Keep current defensive live logic; use repaired wallet truth only in shadow.

## 9. Files Changed

Created:

- `lib/wallet_truth.js`
- `document/change_temuan_16.md`

Modified:

- `lib/backtest_engine.js`
- `dashboard.js`

Endpoint baru:

- `/api/wallet-truth?days=30`

Backtest output baru:

- `walletTruth`
- `experienceMemory.walletTruth`

## 10. Verification

Local:

- `node --check lib/wallet_truth.js`
- `node --check lib/backtest_engine.js`
- `node --check dashboard.js`
- local `runBacktest({ days: 30, mode: "all" })`

VPS:

- Deployed `lib/wallet_truth.js`
- Deployed updated `lib/backtest_engine.js`
- Deployed updated `dashboard.js`
- Restarted `pool-dashboard`
- Verified `/api/health`
- Verified `/api/wallet-truth?days=30`

## 11. Known Limitations

- Dataset masih kecil.
- Wallet identity hilang untuk semua closed trades.
- `UNKNOWN_WALLET` reputation tidak boleh dianggap wallet real.
- Shadow repaired wallet truth belum boleh dipakai untuk live execution.
- Hard rug/safety protection tetap harus diprioritaskan.
- Root fix berikutnya harus masuk ke logging/source capture agar `source_wallet` dan `source_wallet_score` tidak hilang.

## 12. Final Status

TEMUAN 16 selesai dan live di VPS.

Final state:

`WALLET_REGRESSION_DETECTED`

Objective verdict:

Wallet truth layer rusak pada data historis saat ini. Masalah utamanya bukan wallet benar-benar toxic, tetapi source wallet identity dan score tidak tersimpan/terbaca dengan benar. Repaired wallet truth berhasil mengekspos false-danger cohort secara shadow-only, tetapi tidak melakukan auto-pass dan tidak melemahkan defensive engine.

Next highest-ROI step:

Perbaiki capture/persistence `source_wallet`, `source_wallet_score`, dan raw wallet breakdown di PnL log atau copy signal merge path. Tanpa itu, wallet reputation tidak bisa menjadi real intelligence.
