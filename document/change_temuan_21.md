# Change Log TEMUAN 21

Tanggal: 2026-06-02

## 1. Overview

TEMUAN 21 menambahkan Controlled Evidence Collection & Sandbox Capital Layer.

Tujuan:

- Memecahkan paradox `LOCKDOWN + NO_NEW_TRADE = no evidence forever`.
- Mengizinkan evidence collection secara sandbox-only.
- Menjaga capital firewall tetap lebih kuat dari offensive engine.
- Menyediakan graduation path berbasis truth-valid trades.

Core rule:

Defensive engine always wins. Sandbox evidence is information purchase, not profit seeking.

## 2. Root Problem

TEMUAN 18 menunjukkan golden dataset masih 0 truth-valid trades.

TEMUAN 20 dengan benar mengaktifkan `LOCKDOWN` dan `NO_NEW_TRADE` karena strategy health `CRITICAL`.

Masalahnya:

- Jika tidak ada trade valid baru, confidence tidak bisa tumbuh.
- Jika confidence tidak tumbuh, lockdown bisa menjadi permanen.
- Sistem perlu belajar tanpa membuka aggressive risk.

## 3. Sandbox Capital

Ditambahkan `SandboxCapitalEngine` di `lib/sandbox_evidence.js`.

Rules:

- State awal: `SANDBOX_ONLY_ACTIVE`
- Purpose: `INFORMATION_PURCHASE`
- Capital type: `SANDBOX_OR_DRY_RUN_ONLY`
- Recommended position: 0.25% saat evidence masih sangat kecil
- Maximum position: 1%
- Total exposure cap: 2.5%
- Daily risk cap: 1%
- Live risk override: false

Important:

Layer ini tidak mengirim order dan tidak menaikkan live risk. Ia hanya memberi batas evidence mode yang aman.

## 4. Evidence Collection

Ditambahkan `EvidenceCollectionMode`.

Aktif saat:

- truth-valid trades < 30

Mandatory gates:

- A+ setup only
- highest confidence bucket only
- strongest FeeTVL only
- lowest rug probability available
- low OOR preferred
- shadow comparison mandatory
- immutable entry truth required

Blocked actions:

- aggressive risk
- confidence promotion
- live capital escalation
- learning from corrupted legacy trades

## 5. Capital Firewall

Ditambahkan `CapitalFirewall`.

Output:

- `CAPITAL_FIREWALL_ACTIVE`

Caps:

- max position 1%
- max total sandbox exposure 2.5%
- max simultaneous sandbox positions 2
- max daily risk 1%

Firewall dapat memblok sandbox evidence walaupun evidence mode aktif.

## 6. Information Value Trades

Ditambahkan `HighInformationValueTrades`.

Metric:

- `INFORMATION_VALUE_SCORE`

Tiers:

- LOW
- MEDIUM
- HIGH
- CRITICAL

Sumber kandidat:

- shadow execution candidates
- wallet truth candidates jika tersedia

Rule:

Information value bukan approval entry. Kandidat tetap harus lolos defensive truth dan capital firewall.

## 7. Controlled Graduation

Ditambahkan `ControlledGraduation`.

Ladder:

- 0-29 truth-valid trades: `LOCKDOWN_SANDBOX_ONLY`
- 30 truth-valid trades: `DEFENSIVE`
- 50 truth-valid trades: `CAUTION`
- 100 truth-valid trades: `NORMAL_CANDIDATE`
- 250+ truth-valid trades: `TRUSTED`

Promotion tetap membutuhkan:

- stable PF
- acceptable drawdown
- signal integrity healthy
- no regression

## 8. Sandbox vs Shadow

Ditambahkan `SandboxVsShadowValidation`.

Metrics disiapkan:

- slippage
- execution quality
- pnl drift
- timing deviation
- OOR divergence

Current state akan `UNKNOWN` sampai ada sandbox truth-valid samples.

## 9. Learning Velocity

Ditambahkan `LearningVelocityEngine`.

States:

- STALLED
- SLOW
- HEALTHY
- FAST

Metrics:

- truth-valid total
- truth-valid last 7d
- truth-valid last 30d
- edge confidence
- blocker improvement
- wallet truth improvement
- false block reduction

## 10. Files Changed

Created:

- `lib/sandbox_evidence.js`
- `document/change_temuan_21.md`

Modified:

- `dashboard.js`

New endpoint:

- `/api/sandbox-evidence`

## 11. Verification

Local verification:

- `node --input-type=module` import test for `buildSandboxEvidencePayload`
- `/api/sandbox-evidence` should return:
  - `SANDBOX_ONLY_ACTIVE`
  - `EVIDENCE_COLLECTION_MODE`
  - `CAPITAL_FIREWALL_ACTIVE`
  - `LOCKDOWN_SANDBOX_ONLY`
  - learning state based on truth-valid sample count

VPS verification:

- Deploy `dashboard.js`
- Deploy `lib/sandbox_evidence.js`
- Restart `pool-dashboard`
- Query `/api/sandbox-evidence?days=30&mode=all`

## 12. Known Limitations

- Sandbox vs shadow alignment remains `UNKNOWN` until sandbox truth-valid trades exist.
- Information value candidates from historical shadow are advisory only.
- No real capital execution change was made in this patch.
- Dashboard UI was not redesigned.

## 13. Final Status

TEMUAN 21 implemented as backend-first safety layer.

The bot can now express a safe path out of infinite lockdown:

LOCKDOWN remains valid, but evidence collection can proceed through sandbox-only rules, hard capital firewall, and controlled graduation.
