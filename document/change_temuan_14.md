# Change Log TEMUAN 14

Tanggal: 2026-06-02

## 1. Overview

TEMUAN 14 mengimplementasikan Defensive Truth Audit & Context Intelligence Layer.

Tujuan:

- Mengukur kualitas blocker defensive.
- Membedakan blocker kuat vs blocker inkonsisten.
- Memberi contextual danger scoring tanpa melemahkan proteksi.
- Menambahkan blocker attribution dan confidence.
- Menambahkan regression detection untuk mendeteksi defensive engine yang mulai merusak profit.

Core rule tetap:

Defensive engine always wins.

Tidak ada auto-pass untuk dangerous wallet.

## 2. Root Problem

Hasil `document/hasil_backtest.md` dan `document/change_temuan_13.md` menunjukkan:

- Huge winners masih diblokir.
- Blocked trades menyimpan total PnL besar.
- Wallet `DANGEROUS` terlalu binary.
- Sebelum TEMUAN 14, `dangerous wallet` langsung diperlakukan sebagai hard block.

Kasus utama:

- `SQUIRE-SOL` +49.71% BLOCKED
- `SPCX-SOL` +49.66% BLOCKED

Masalahnya bukan defensive engine harus dilemahkan. Masalahnya defensive truth harus bisa membedakan:

- truly dangerous wallet
- smart aggressive wallet
- high-risk but profitable wallet
- contextual winner

## 3. Features Implemented

File baru:

- `lib/defensive_truth.js`

File yang diubah:

- `lib/experience_intelligence.js`
- `lib/backtest_engine.js`
- `dashboard.js`
- `document/change_temuan_14.md`

Endpoint baru:

- `/api/defensive-truth?days=30`

Output baru juga tersedia lewat:

- `/api/backtest?days=30&mode=all`
- `/api/experience-memory?days=30`

## 4. Defensive Truth Audit

Ditambahkan `buildDefensiveTruthAudit()`.

Metrics per blocker:

- block count
- avoided losses
- missed winners
- avoided loss rate
- false block rate
- blocker accuracy
- missed winner PnL
- avoided loss PnL
- blocker confidence
- verdict

Blockers yang dilacak:

- wallet
- FeeTVL
- alpha
- OOR
- crowding
- timing
- rug
- safety

Hasil validasi VPS 30 hari:

| Blocker | Block Count | Avoided Loss Rate | False Block Rate | Missed Winner PnL | Confidence | Verdict |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| wallet | 12 | 16.7% | 83.3% | 109.42% | 0 | BLOCKER_INCONSISTENT |
| alpha | 12 | 16.7% | 83.3% | 109.42% | 0 | BLOCKER_INCONSISTENT |
| timing | 12 | 16.7% | 83.3% | 109.42% | 0 | BLOCKER_INCONSISTENT |

Interpretasi:

Pada sample saat ini, blocker wallet/alpha/timing terlalu agresif dan tidak reliable. Ini bukan izin auto-pass. Ini bukti bahwa defensive classifier perlu data normalization dan context weighting yang lebih presisi.

## 5. Contextual Danger Scoring

Ditambahkan `scoreContextualDanger()`.

Input:

- wallet classification
- FeeTVL classification
- entry timing
- OOR bucket
- memory confidence
- market memory
- failure memory
- execution memory
- blocker confidence

Output:

- `HARD_BLOCK`
- `SOFT_BLOCK`
- `WATCHLIST`
- `TEST_POSITION`

Rule penting:

- Context hanya memberi recommended strictness.
- Context tidak membuat blocked pool otomatis executable.
- Safety/rug/honeypot/fee dangerous tetap hard protection.
- Dangerous wallet tidak lagi otomatis dianggap hard safety truth; ia diaudit dengan confidence dan context.

Hasil validasi VPS:

- Soft block replay sekarang mendeteksi 12 release candidates untuk review.
- Hypothetical recovered PnL: 108.94%.
- Verdict: `SOFT_BLOCK_REVIEW_NEEDED`.

Ini berarti layer baru berhasil memindahkan kasus dangerous-wallet-only dari hard binary ke auditable soft/context category, tanpa membuka live execution.

## 6. Blocker Attribution

Ditambahkan `buildBlockerAttribution()`.

Metrics:

- false block contribution
- avoided loss contribution
- blocker precision
- blocker recall
- blocker reliability
- verdict

Hasil validasi VPS:

| Blocker | False Block Contribution | Avoided Loss Contribution | Precision | Reliability |
| --- | ---: | ---: | ---: | --- |
| wallet | 33.3% | 33.3% | 16.7% | LOW |
| alpha | 33.3% | 33.3% | 16.7% | LOW |
| timing | 33.3% | 33.3% | 16.7% | LOW |

Interpretasi:

Kerusakan false-block bukan dari satu label saja. Wallet, alpha AVOID, dan timing WAIT saling mengunci keputusan BLOCKED. Ini penting supaya tuning tidak dilakukan membabi buta hanya pada satu threshold.

## 7. Blocker Confidence

Ditambahkan `buildBlockerConfidence()`.

Tier:

- `<40` = LOW
- `40-70` = MEDIUM
- `70+` = HIGH

Rule:

- Rug/safety blocker diberi minimum high confidence.
- FeeTVL dangerous tetap lebih protektif.
- Wallet blocker diberi penalty jika false block tinggi.
- Sample kecil memberi confidence haircut.
- Missed winner PnL besar menurunkan confidence.

Hasil VPS:

- Wallet blocker confidence: 0, LOW.
- Alpha blocker confidence: 0, LOW.
- Timing blocker confidence: 0, LOW.

Interpretasi:

Dalam data saat ini, ketiga blocker tidak layak diperlakukan sebagai high-confidence hard truth jika berdiri sendiri. Mereka harus masuk context review.

## 8. Regression Detection

Ditambahkan `detectDefensiveRegression()`.

Trigger:

- false block rate >= 55%
- missed winner PnL jauh lebih besar dari avoided loss
- avoided loss rate < 30%
- blocker inconsistent

Hasil VPS:

State:

`DEFENSIVE_REGRESSION_DETECTED`

Warnings:

- false block rate 83.3% >= 55%
- missed winner PnL 109.42% dominates avoided loss -0.48%
- avoided loss rate 16.7% < 30%
- 3 blockers inconsistent

Interpretasi:

Defensive layer sedang terlalu banyak membuang upside dibanding loss yang diselamatkan. Ini regression kualitas judgement, bukan sinyal untuk langsung melepas risiko.

## 9. Files Changed

Created:

- `lib/defensive_truth.js`
- `document/change_temuan_14.md`

Modified:

- `lib/experience_intelligence.js`
- `lib/backtest_engine.js`
- `dashboard.js`

## 10. Verification

Local checks:

- `node --check lib/defensive_truth.js`
- `node --check lib/experience_intelligence.js`
- `node --check lib/backtest_engine.js`
- `node --check dashboard.js`
- sample `runBacktest({ days: 30, mode: "all" })`

VPS checks:

- Deployed to `/opt/bot/meridian`.
- Restarted `pool-dashboard`.
- Verified `/api/health`.
- Verified `/api/backtest?days=30&mode=all`.
- Verified `/api/defensive-truth?days=30`.

VPS summary:

- Total closed trades: 26
- Executable trades: 14
- Blocked trades: 12
- Soft block replay candidates: 12
- Soft block replay PnL: 108.94%
- Defensive regression: detected

## 11. Known Limitations

- Sample masih kecil: 26 closed trades.
- 7/14/30 hari sebelumnya identik, jadi belum ada multi-regime proof.
- Confidence 0 untuk blocker bukan berarti blocker pasti buruk selamanya; itu berarti blocker buruk pada sample saat ini.
- Contextual danger belum melakukan live override.
- `TEST_POSITION` masih recommendation, bukan execution action.
- Data normalization wallet score masih perlu audit lebih dalam.
- Jika historical `source_wallet_score` kosong/salah, dangerous wallet classification bisa bias.

## 12. Final Status

TEMUAN 14 selesai dan live di VPS.

Final status:

`DEFENSIVE_REGRESSION_DETECTED`

Practical conclusion:

Bot sekarang bisa melihat bahwa false-block problem bukan opini visual dashboard, tetapi measurable blocker failure. Defensive engine tetap menang, tetapi dangerous wallet judgement sekarang punya audit trail, confidence, attribution, context, dan regression warning.

Next highest-ROI step:

Audit data normalization untuk wallet score dan alpha AVOID source. Fokus pada kenapa SQUIRE-SOL/SPCX-SOL terbaca dangerous/avoid padahal historisnya huge winners.
