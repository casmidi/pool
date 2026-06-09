# Change Log TEMUAN 20

Tanggal: 2026-06-02

## 1. Overview

TEMUAN 20 mengimplementasikan Meta Edge Decay & Self-Preservation Intelligence Layer.

Tujuan:

- Mendeteksi edge decay.
- Mengukur strategy health.
- Mengompresi risk saat sistem melemah.
- Mengaktifkan survival mode saat evidence belum cukup atau market berbahaya.
- Mendeteksi recovery secara lambat.
- Menyediakan regime-specific brain.
- Menjaga bot tetap hidup cukup lama untuk compound.

Core rule:

Survival first. Defensive engine always wins. Risk compression only.

## 2. Root Problem

Sebelum TEMUAN 20, bot bisa audit defensive, persist source truth, dan menolak fake confidence. Tetapi bot belum punya meta-layer yang menjawab:

Apakah edge saya masih hidup?

Karena TEMUAN 18 menunjukkan golden dataset masih 0, sistem harus memilih survival-first, bukan mengklaim stabilitas.

## 3. Edge Decay Detection

Ditambahkan `EdgeDecayDetection` di `lib/self_preservation.js`.

Lookback:

- last 10 truth-valid trades
- last 30 truth-valid trades
- last 50 truth-valid trades

Metrics:

- profit factor
- win rate
- expectancy
- drawdown
- statistical maturity
- edge confidence

VPS result:

- Edge state: `EDGE_CRITICAL`
- Truth-valid trades: 0
- Edge confidence: 0
- Edge state from live validation: `UNPROVEN`

Warnings:

- insufficient rolling sample for edge decay
- statistical evidence not mature

## 4. Strategy Health

Ditambahkan `StrategyHealthEngine`.

Score categories:

- 90-100 HEALTHY
- 70-89 STABLE
- 50-69 WARNING
- 30-49 DETERIORATING
- 0-29 CRITICAL

VPS result:

- Health score: 0
- Category: `CRITICAL`

Factors:

- confidence: 0
- truth valid sample: 0
- signal integrity score: 0
- PF score: 0
- drawdown score: 0
- regime score: 0
- decay penalty: -35

Interpretasi:

Karena belum ada golden evidence, health tidak boleh terlihat stabil.

## 5. Auto Risk Compression

Ditambahkan `AutoRiskCompression`.

Rules:

- HEALTHY: multiplier 1.0
- STABLE: multiplier 0.75
- WARNING: multiplier 0.5
- DETERIORATING: multiplier 0.25
- CRITICAL: multiplier 0, no new trade

VPS result:

- Action: `NO_NEW_TRADE`
- Multiplier: 0
- Max position pct: 0
- Reason: strategy health CRITICAL

Important:

Ini adalah meta-risk recommendation. Tidak ada aggressive auto-risk increase.

## 6. Survival Mode

Ditambahkan `SurvivalMode`.

Triggers:

- regime CHAOTIC/UNKNOWN
- edge critical
- health critical/deteriorating
- golden dataset below 30 trades

VPS result:

- Survival active: true
- State: `SURVIVAL_MODE`

Triggers:

- regime UNKNOWN
- EDGE_CRITICAL
- health CRITICAL
- golden dataset below 30 trades

Rules:

- only A+ setups
- smaller size
- lower frequency
- pause aggressive experiments
- defensive engine always wins

## 7. Recovery Detection

Ditambahkan `RecoveryDetection`.

Recovery hanya bisa muncul jika:

- minimum 30 truth-valid trades
- edge stable
- PF stabil
- expectancy positif
- regime bukan UNKNOWN/CHAOTIC/DEAD
- health STABLE/HEALTHY

Current result:

- `NO_RECOVERY`

Reason:

- recovery evidence insufficient

## 8. Regime Brain

Ditambahkan `RegimeSpecificBrain`.

Supported regimes:

- BULLISH
- RISK_ON
- CHOPPY
- CHAOTIC
- DEAD
- UNKNOWN

VPS result:

- Regime: `UNKNOWN`
- Health: `CRITICAL`

Preset:

- wallet strictness: conservative
- FeeTVL floor: higher
- blocker strictness: defensive
- conviction bias: truth collection only
- shadow weight: paused

Rule:

Context adjusts thresholds; defensive engine preserved; no automatic aggressive risk increase.

## 9. Self Preservation

Ditambahkan `SelfPreservationEngine`.

States:

- NORMAL
- CAUTION
- DEFENSIVE
- SURVIVAL
- LOCKDOWN

VPS result:

- State: `LOCKDOWN`
- shouldTradeLess: true
- shouldCompressRisk: true
- shouldPauseChallenger: true
- shouldStopExperiments: true

Reasons:

- edge EDGE_CRITICAL
- health CRITICAL
- risk NO_NEW_TRADE
- survival mode active

Interpretasi:

Ini hasil yang tepat untuk kondisi tanpa truth-valid evidence. Bot tidak boleh berpura-pura punya edge.

## 10. Files Changed

Created:

- `lib/self_preservation.js`
- `document/change_temuan_20.md`

Modified:

- `dashboard.js`

Endpoint baru:

- `/api/self-preservation`

## 11. Verification

Local:

- `node --check lib/self_preservation.js`
- `node --check dashboard.js`
- sample payload against local `data/pnl_log.json`

VPS:

- Deployed `lib/self_preservation.js`
- Deployed updated `dashboard.js`
- Restarted `pool-dashboard`
- Verified `/api/health`
- Verified `/api/self-preservation`

VPS summary:

- Edge: `EDGE_CRITICAL`
- Health: `CRITICAL`
- Self preservation: `LOCKDOWN`
- Risk compression: `NO_NEW_TRADE`
- Survival mode: active
- Regime: `UNKNOWN`
- Truth-valid trades: 0

## 12. Known Limitations

- Current result is intentionally conservative because golden dataset is still empty.
- TEMUAN 20 does not fabricate edge decay metrics from corrupted legacy trades.
- Risk compression is exposed as backend meta-intelligence; live execution still obeys existing defensive engine and config.
- Recovery detection cannot activate before minimum truth-valid sample.

## 13. Final Status

TEMUAN 20 selesai dan live di VPS.

Final state:

`SELF_PRESERVATION_STATE = LOCKDOWN`

Objective verdict:

The bot currently has no truth-valid evidence to prove its edge is alive. Therefore, the correct survival-first state is LOCKDOWN / NO_NEW_TRADE recommendation until new immutable-truth trades accumulate. This prevents false confidence and protects the system from compounding bad assumptions.
