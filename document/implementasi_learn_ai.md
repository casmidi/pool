# Analisis Implementasi AI Learning

Dibahas: 2026-06-09

## 1. Mekanisme Belajar Aktif (Live)

### 1a. Darwin Signal Weights (`signal-weights.js`)
- Setiap posisi close, signal_snapshot dicek: signal mana yang sering muncul di winner vs loser
- Winner signal → weight ×1.05, Loser signal → weight ×0.95
- Trigger: 5 closed trade → recalculate
- Output: Darwin multipliers masuk ke pool scoring + LLM prompt
- Butuh `signal_snapshot` terisi di lessons.json

### 1b. Adaptive Thresholds (`lessons.js` → `evolveThresholds()`)
- 10 closed trade → evaluasi 3 parameter:
  - `maxDeployVolatility` (turun kalau high vol sering loss)
  - `minFeeActiveTvlRatio` (naik kalau low fee rugi)
  - `minOrganic` (naik kalau low organic gagal)
- Output: langsung ubah user-config.json

### 1c. Daily Auto-Tuning (`auto-improvement.js`)
- Setiap hari evaluasi aggregated:
  - Win rate < 45% → minPoolScore +3
  - OOR rate ≥ 50% → turunkan outOfRangeWaitMinutes + maxDeployVolatility
  - Sharpe < 0 → deployAmountSol -20%
- Output: ubah config langsung

## 2. Mekanisme Belajar Tidak Aktif / Belum Terintegrasi

| Mekanisme | Status | Keterangan |
|-----------|--------|------------|
| `experience_intelligence.js` | Dashboard only | Signature-based pattern matching. Belum di-wire ke screening |
| `feature_impact.js` | Dashboard only | Estimasi ROI fitur screening. Bisa auto-tune threshold |
| `darwin-intelligence.js` | Unused | Alternatif regresi, ketinggalan |
| `signal-tracker.js` | Not wired | Stage sinyal di memori, gak disimpan ke disk |
| HiveMind | Parsial | Sharing lesson ke external server |

## 3. Analisis Dampak per Improvement

### 3a. experience_intelligence → screening

| Aspek | Efek |
|-------|------|
| False positive | Turun — pool pola mirip historical loser kena penalty |
| False negative | Bisa naik — pool bagus beda pola gak dapet bonus |
| Deploy count | Turun 5-15% di awal (lebih konservatif) |
| Kompleksitas | Rendah — panggil applyMemoryAwareConviction() |
| Resiko | Overfitting ke data historis |

### 3b. feature_impact auto-tune

| Aspek | Efek |
|-------|------|
| False positive | Turun — fitur overblock dilonggarkan |
| Deploy count | Naik 10-25% — pool lebih banyak lolos |
| Akurasi | Stabil — fitur efektif tetap jalan |
| Kompleksitas | Medium — butuh safety bounds |
| Resiko | Osilasi tuning tanpa validasi |

### 3c. signal-tracker persistence

| Aspek | Efek |
|-------|------|
| Training data | Naik drastis — dari copy signals jadi semua signals |
| Darwin accuracy | Naik — lebih banyak sampel |
| Deploy count | Tidak langsung — weight lebih akurat |
| Kompleksitas | Rendah — tinggal tambah save ke disk |
| Resiko | Minimal — cuma penyimpanan |

### 3d. Retrofitting 72 closed trades

| Aspek | Efek |
|-------|------|
| Darwin weight | Langsung aktif — 0 → 72 records |
| Threshold evolution | Langsung aktif — butuh ≥10 records |
| Sample observer | Bisa link wallet dari copy signals |
| Resiko | Rendah — data sudah ada |

## 4. Keputusan: Tahan Learning Sampai Live Deploy

**Alasan:**
- 72 closed trade adalah **dry-run simulation**, bukan real market
- Simulasi punya bias: PnL dari fee TVL ratio, exit pakai rule, slippage/IL disederhanakan
- Belajar dari data simulasi = risiko overfitting ke simulasi, bukan ke market real

**Rekomendasi:**
Tunggu sampai ada **30-50 real closed trade** dengan real PnL. Baru:
- Retrofitting training records → meaningful
- Darwin weights → akurat
- experience_intelligence → relevant

**Yang aman dikerjakan sekarang (tanpa risiko overfitting):**
1. `signal-tracker persistence` — cuma simpan data, tidak ubah keputusan
2. `feature_impact auto-tune` — bisa dibatasi safety bounds ±20%, tuning dari real PnL nanti

## 5. Perubahan Lain (Sesi Ini)

### 5a. Smart Wallet Observer Fix
**Masalah:** Observer tidak pernah akumulasi samples karena:
1. `sourceWallet` tidak diteruskan dari executor.js ke pnl_tracker → closed trade tidak punya source_wallet
2. Interval observer crash diam-diam (no try/catch)

**Fix:**
- executor.js: pass `args.source_wallet` ke recordDeploy
- smart-wallet-observer.js: try/catch di interval, error ke stderr
- pnl_tracker.js: export `loadStore()` untuk akses langsung

**Status:** Observer live, samples akan terisi setelah copy-engine deploy baru.

### 5b. Forensic Scanner Integration
Screening/executor/management data baru di-log ke forensic scanner:
- `probe_candidate` — flag probe mode
- `overridden` — high-conviction override
- `fee_velocity_boost` — boost/penalti fee velocity
- `oor_classification` — klasifikasi OOR 3-kategori

## 6. Arsitektur Belajar

```
Closed Trade → signal_snapshot + pnl_pct
                    │
         ┌──────────┼────────────┐
         ▼          ▼            ▼
   signal-weights  lessons.js  auto-improvement
   (weight lift)   (threshold)  (daily tuning)
         │          │            │
         ▼          ▼            ▼
   Pool Scoring ── LLM Prompt ── Config (user-config.json)
         │          │
         └──────────┼────────┐
                    ▼        ▼
             Screening → Deploy → Close (loop)
```

## 7. Files Referensi

| File | Peran |
|------|-------|
| `signal-weights.js` | Darwin weight learning |
| `lessons.js` | Lesson derivation + threshold evolution |
| `auto-improvement.js` | Daily config tuning |
| `experience_intelligence.js` | Signature-based pattern memory |
| `feature_impact.js` | Feature ROI analytics |
| `signal-tracker.js` | Signal staging (belum persist) |
| `hivemind.js` | Cross-instance lesson sharing |
| `ai_optimizer.js` | AI budget management |
| `training_record.js` | Data quality gate untuk training |
| `pool-memory.js` | Pool-level cooldown adaptation |
