# Change Log TEMUAN 15

Tanggal: 2026-06-02

## Overview

TEMUAN 15 mengimplementasikan Shadow Execution & Adaptive Experimentation Layer.

Tujuan:

- Membuat bot belajar tanpa uang real.
- Membandingkan champion live logic vs challenger shadow logic.
- Menggunakan Bayesian learning untuk menghindari kesimpulan dari sample kecil.
- Memblokir promotion jika bukti belum cukup.
- Menyediakan rollback plan eksplisit.

Core rules:

- No real money.
- Defensive engine always wins.
- Backend-first.
- No dashboard redesign.
- No reckless promotion.

## Features Implemented

File baru:

- `lib/shadow_execution.js`

File diubah:

- `lib/backtest_engine.js`
- `dashboard.js`
- `document/change_temuan_15.md`

Endpoint baru:

- `/api/shadow-execution?days=30`

Output shadow juga tersedia lewat:

- `/api/backtest?days=30&mode=all`

## 1. ShadowExecutionEngine

Ditambahkan `buildShadowExecution()`.

Perilaku:

- Mode selalu `SHADOW_ONLY`.
- `realMoney: false`.
- Tidak mengirim order.
- Tidak mengubah live executable state.
- Hanya mengumpulkan candidate dari contextual soft block / watchlist / test-position recommendation.

VPS result 30 hari:

- Shadow trades: 6
- Wins: 5
- Losses: 1
- Win rate: 83.3%
- Avg PnL: 17.66%
- Total PnL: 105.93%
- Max drawdown: -0.24%
- Profit factor: 442.38

Interpretasi:

Shadow challenger terlihat menarik, tetapi angka terlalu bagus dan sample terlalu kecil. Ini belum layak promotion.

## 2. ExperimentBucketEngine

Ditambahkan `buildExperimentBuckets()`.

Bucket deterministic berbasis hash:

- `CONTROL_CHAMPION` 50%
- `CHALLENGER_CONTEXTUAL` 30%
- `CHALLENGER_MEMORY` 20%

VPS bucket result:

| Bucket | Trades | Win Rate | Avg PnL | Total PnL | Conservative WR |
| --- | ---: | ---: | ---: | ---: | ---: |
| CONTROL_CHAMPION | 16 | 81.3% | 4.72% | 75.44% | 62.1% |
| CHALLENGER_CONTEXTUAL | 4 | 100.0% | 2.13% | 8.52% | 60.2% |
| CHALLENGER_MEMORY | 6 | 66.7% | 9.49% | 56.96% | 36.0% |

Catatan:

Bucket adalah shadow analysis, bukan routing uang real.

## 3. ChallengerVsChampion

Ditambahkan `buildChallengerVsChampion()`.

Champion:

- Current defensive/live decision source.
- 14 trades.
- Win rate 78.6%.
- Avg PnL 2.28%.
- Total PnL 31.98%.
- PF 69.04.

Challenger:

- Contextual defensive shadow candidate.
- 6 trades.
- Win rate 83.3%.
- Avg PnL 17.66%.
- Total PnL 105.93%.
- PF 442.38.

Delta:

- Challenger avg PnL lebih tinggi.
- Challenger total PnL lebih tinggi.
- Tetapi challenger sample hanya 6.

Final judgement:

Challenger promising, not promotable.

## 4. BayesianLearningEngine

Ditambahkan `buildBayesianLearning()`.

Prior:

- `Beta(1,1)`

Output:

- expected win rate
- conservative win rate
- confidence
- bucket verdict

VPS champion Bayesian:

- Alpha: 12
- Beta: 4
- Expected WR: 75.0%
- Conservative WR: 57.8%
- Confidence: 56

VPS challenger Bayesian:

- Alpha: 6
- Beta: 2
- Expected WR: 75.0%
- Conservative WR: 51.3%
- Confidence: 24

Interpretasi:

Challenger raw WR tinggi, tetapi Bayesian conservative WR belum melewati threshold 55%. Ini tepat untuk mencegah overfitting.

## 5. SafePromotionEngine

Ditambahkan `buildSafePromotion()`.

Promotion requirements:

- no real money
- minimum 30 challenger samples
- conservative WR >= 55%
- challenger avg PnL > champion avg PnL
- regression safety OK

VPS result:

`NOT_PROMOTED`

Requirement status:

- no real money: PASS
- min 30 challenger samples: FAIL, only 6
- conservative WR >= 55: FAIL, 51.3%
- beats champion avg PnL: PASS
- regression safe: FAIL

Decision:

Keep champion live; continue shadow collection.

## 6. RegressionSafetyEngine

Ditambahkan `buildRegressionSafety()`.

Rules:

- Promotion blocked jika defensive regression masih aktif.
- Promotion blocked jika challenger sample < 30.
- Promotion blocked jika challenger drawdown/win rate lebih buruk.
- Promotion blocked jika challenger PF < 1.3.

VPS result:

`PROMOTION_BLOCKED`

Warnings:

- defensive regression already detected; promotion requires extra evidence
- challenger sample 6 < 30

Rollback required:

`true`

Rollback plan:

- keep champion as live decision source
- disable challenger by ignoring `/api/shadow-execution` recommendations
- revert promotion only through backend config after 30+ additional closed samples

## API Contract

Endpoint:

`GET /api/shadow-execution?days=30`

Returns:

- `shadowExperiment.shadowExecution`
- `shadowExperiment.experimentBuckets`
- `shadowExperiment.challengerVsChampion`
- `shadowExperiment.bayesianLearning`
- `shadowExperiment.safePromotion`
- `shadowExperiment.regressionSafety`

No live execution side effect.

## Verification

Local:

- `node --check lib/shadow_execution.js`
- `node --check lib/backtest_engine.js`
- `node --check dashboard.js`
- local `runBacktest({ days: 30, mode: "all" })`

VPS:

- Deployed `lib/shadow_execution.js`
- Deployed updated `lib/backtest_engine.js`
- Deployed updated `dashboard.js`
- Restarted `pool-dashboard`
- Verified `/api/health`
- Verified `/api/shadow-execution?days=30`

## Known Limitations

- Challenger sample is only 6 trades.
- Backtest sample is still small.
- Shadow results are not live execution proof.
- Profit factor remains suspiciously high.
- No real money should be allocated based on this result.
- Promotion is intentionally blocked.

## Final Status

TEMUAN 15 selesai dan live di VPS.

Final decision:

`NOT_PROMOTED`

Operational state:

`SHADOW_ONLY`

Best next step:

Collect more shadow samples until at least 30 challenger outcomes, then re-run Bayesian promotion checks. Champion remains the only live decision source.
