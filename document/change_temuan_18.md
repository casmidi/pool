# Change Log TEMUAN 18

Tanggal: 2026-06-02

## 1. Overview

TEMUAN 18 mengimplementasikan Live Evidence Accumulation & Quant Validation Layer.

Tujuan:

- Membuat golden dataset dari trade truth-valid saja.
- Mengukur confidence secara statistik.
- Memvalidasi real edge tanpa mencampur legacy corrupted trades.
- Menolak klaim alpha jika sample belum cukup.
- Menyiapkan live learning foundation yang aman.

Core rule:

No fake confidence. No edge claim without evidence.

## 2. Root Problem

TEMUAN 17 mengaktifkan source truth persistence untuk trade masa depan.

Masalah saat ini:

- Historical trades lama tidak punya immutable entry truth.
- Semua legacy trades terdeteksi `CRITICAL_SIGNAL_LOSS`.
- Backtest historis masih berguna untuk outcome review, tetapi tidak valid untuk exact signal learning.

Karena itu TEMUAN 18 harus memisahkan:

- corrupted legacy history
- truth-valid golden evidence

## 3. Golden Dataset

Ditambahkan `GoldenDatasetEngine` di `lib/live_validation.js`.

Rule inclusion:

- trade closed
- punya immutable `entry_truth`
- punya `decision_snapshot`
- signal loss state `SIGNAL_OK`
- no critical/high truth loss

Dataset tiers:

- PRE_TIER: <30 trades
- TIER_1: 30 trades
- TIER_2: 50 trades
- TIER_3: 100 trades
- TIER_4: 250+ trades

VPS result:

- Total closed: 26
- Truth-valid trades: 0
- Rejected corrupted trades: 26
- Rejection reason: `CRITICAL_SIGNAL_LOSS`
- Dataset quality: `INSUFFICIENT`
- Tier: `PRE_TIER`
- Next tier needs: 30 truth-valid trades

Interpretasi:

Belum ada golden dataset. Semua legacy trades dikeluarkan dari quant validation.

## 4. Quant Confidence

Ditambahkan `QuantConfidenceEngine`.

Metrics:

- sample size
- PF stability
- drawdown stability
- signal integrity
- regime consistency

VPS result:

- Edge confidence: 0
- Label: `LOW_CONFIDENCE`
- Sample size: 0

Components:

- sampleScore: 0
- pfScore: 0
- drawdownScore: 0
- signalIntegrityScore: 0
- regimeScore: 0

Interpretasi:

Tidak ada confidence yang boleh diklaim. Ini sengaja konservatif.

## 5. Live Edge Validation

Ditambahkan `LiveEdgeValidation`.

Metrics:

- win rate
- profit factor
- expectancy
- max drawdown
- survival
- OOR stability
- blocker precision
- wallet truth accuracy

VPS result:

- Edge state: `UNPROVEN`
- Trades: 0
- Win rate: 0
- Profit factor: 0
- Expectancy: 0
- Enough sample: false
- Wallet truth accuracy: `NO_VALID_SAMPLE`

Interpretasi:

Bot belum boleh mengklaim real edge berdasarkan corrupted historical data.

## 6. Regime Detection

Ditambahkan `MarketRegimeDetection`.

States:

- BULLISH
- RISK_ON
- CHOPPY
- CHAOTIC
- DEAD
- UNKNOWN

Inputs:

- volatility
- FeeTVL activity
- OOR behavior
- activity rate

VPS result:

- State: `UNKNOWN`
- Confidence: 0
- Reason: no truth-valid trades

Interpretasi:

Regime tidak boleh diinterpretasi dari corrupted trades.

## 7. Statistical Honesty

Ditambahkan `StatisticalHonestyEngine`.

VPS result:

- Statistical warning: `NOT_ENOUGH_EVIDENCE`
- Can claim edge: false
- Alpha claim allowed: false

Warnings:

- NOT ENOUGH EVIDENCE: 0/30 truth-valid trades
- 26 legacy/corrupted trades excluded
- market regime unknown due insufficient valid data
- edge confidence below 30

Interpretasi:

Ini hasil yang benar. Sistem memilih jujur daripada optimis palsu.

## 8. Learning Foundation

Ditambahkan `LiveLearningFoundation`.

Tracks:

- blocker effectiveness
- wallet truth improvement
- shadow candidate outcome
- challenger evolution
- confidence evolution
- regime context

VPS result:

- Status: `WAITING_FOR_FIRST_TRUTH_VALID_TRADE`
- blocker effectiveness: `PENDING_30_TRADES`
- wallet truth improvement: `PENDING_30_TRADES`
- shadow candidate outcome: `PENDING_30_TRADES`
- challenger evolution: `PENDING_50_TRADES`
- confidence evolution: `LOW_CONFIDENCE`
- regime context: `UNKNOWN`

Guardrails:

- no adaptation from corrupted legacy trades
- no promotion before minimum truth-valid sample
- defensive engine remains live source of truth
- learning is measurement-first, not auto-overfit

## 9. Files Changed

Created:

- `lib/live_validation.js`
- `document/change_temuan_18.md`

Modified:

- `dashboard.js`

Endpoint baru:

- `/api/live-validation`

## 10. Verification

Local:

- `node --check lib/live_validation.js`
- `node --check dashboard.js`
- local payload test against `data/pnl_log.json`

VPS:

- Deployed `lib/live_validation.js`
- Deployed updated `dashboard.js`
- Restarted `pool-dashboard`
- Verified `/api/health`
- Verified `/api/live-validation`

VPS summary:

- Golden trades: 0
- Corrupted excluded: 26
- Edge confidence: 0
- Edge state: `UNPROVEN`
- Statistical warning: `NOT_ENOUGH_EVIDENCE`

## 11. Known Limitations

- TEMUAN 18 cannot create evidence retroactively.
- Legacy trades remain excluded because they lack immutable entry truth.
- First meaningful validation starts only after future trades include `entry_truth` and `decision_snapshot`.
- No live edge claim should be made until at least 30 truth-valid closed trades.
- Stronger confidence requires 100+ truth-valid trades.

## 12. Final Status

TEMUAN 18 selesai dan live di VPS.

Final status:

`EDGE_UNPROVEN`

Quant confidence:

`0 / LOW_CONFIDENCE`

Objective verdict:

There is currently no truth-valid evidence to claim real edge. This is not a failure of the bot; it is the first honest baseline after source truth persistence was fixed. The system is now ready to accumulate valid evidence from future trades without mixing corrupted legacy history.
