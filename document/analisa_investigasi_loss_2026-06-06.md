# ANALISA INVESTIGASI: Penyebab Trade Sepi & Loss Setelah 4 Juni 2026

**Date:** 2026-06-06  
**Status:** Investigated  
**Author:** Buffy (Codebuff AI)

---

## Ringkasan Eksekutif

**Trade berhenti dan berubah menjadi loss bukan karena perubahan kode atau execution_intelligence.js.** Penyebabnya adalah kombinasi 6 faktor eksternal dan configurational yang terjadi bersamaan.

---

## Fakta-Fakta

### 1. TIDAK Ada Perubahan Kode di VPS

- Git log VPS: commit terakhir = `29eca0f` (13 Mei 2026)
- Tidak ada commit antara 4-6 Juni
- **Kesimpulan:** Bukan karena perubahan kode

### 2. execution_intelligence.js TIDAK Mempengaruhi Deploy Flow

- Module hanya diimport oleh: `dashboard.js` (display) dan `lib/backtest_engine.js` (backtest)
- **TIDAK diimport oleh:** `tools/executor.js`, `index.js`, `agent.js`
- Deploy flow di executor.js punya blocking logic sendiri (anti-OOR, allocation, shadow v2, decision layer, alpha edge)
- **Kesimpulan:** Advisory mode yang ditambahkan TIDAK mempengaruhi deploy

### 3. Decision Log: 271 dari 284 Keputusan = no_deploy

| Actor | Count | Persentase |
|-------|-------|------------|
| SCREENER | 238 | 83.8% |
| ANTI_OOR | 23 | 8.1% |
| ANTI_OOR_RECHECK | 23 | 8.1% |

### 4. Scanning Log: 101 Kandidat Ditolak per Hari

Penolakan utama:
- **wallet_filter** + **low_wallet_score**: Mayoritas penolakan
- **shift_up_not_supported**: 22x blok karena momentum breakout naik
- **allocation_engine**: Portfolio exposure >20% limit

### 5. AI Budget Habis

- Daily budget: $0.50 — sudah terpakai $0.5034 (100.7%)
- Mode: CRITICAL → AI calls dibatasi
- Screening dan management cycle tidak bisa pakai AI yang akurat

### 6. External Service Failures

- **OKX circuit breaker OPEN** untuk advanced/price data
- **Redis temporarily disabled** → cache tidak berfungsi
- Bot pakai fallback DexScreener → data risk kurang akurat

---

## Timeline: Profit → Loss

| Periode | Status | Penjelasan |
|---------|--------|------------|
| 30 Mei - 4 Juni | **PROFIT** | AI budget cukup, market sideways, OOR rate rendah |
| 5 Juni | **TRANSISI** | AI budget mulai habis, market mulai trending up |
| 6 Juni | **LOSS** | AI budget habis (CRITICAL), market trending up, 101 kandidat ditolak |

---

## Root Cause Analysis

### Faktor #1: AI Budget Exhaustion (Impact: SANGAT TINGGI)

- Screening cycle butuh AI untuk analisis kandidat
- Management cycle butuh AI untuk evaluasi posisi
- Ketika budget habis → AI tidak bisa analisis → kandidat bagus tidak ter-deteksi
- **Solusi:** Ganti model ke DeepSeek (gratis) untuk screening/management

### Faktor #2: Wallet Filter Terlalu Ketat (Impact: TINGGI)

- 101 kandidat/hari ditolak karena wallet score rendah
- Banyak pool dengan quality bagus (score 65-72) ditolak
- Decision engine memberikan SKIP langsung saat wallet score < minimum
- **Solusi:** Longgarkan wallet filter atau tambah rescue mode

### Faktor #3: Anti-OOR Shift-Up Not Supported (Impact: TINGGI)

- 22x blok karena momentum breakout naik
- Single-side SOL tidak bisa shift range ke atas
- Kandidat dibuang selamanya tanpa mekanisme retry
- **Solusi:** Implementasi retry mechanism setelah momentum stabil

### Faktor #4: Allocation Engine Block (Impact: SEDANG)

- Portfolio exposure >20% limit → posisi kedua/ketiga selalu diblokir
- Bot hanya bisa buka 1 posisi saja
- **Solusi:** Naikkan limit atau gunakan risk profile aggressive

### Faktor #5: OKX Service Down (Impact: SEDANG)

- Circuit breaker OPEN untuk advanced/price data
- Bot pakai fallback data yang kurang akurat
- **Solusi:** Set failOpenOnRiskDataUnavailable: true

### Faktor #6: Market Regime Change (Impact: SEDANG)

- Market berubah dari sideways (30 Mei - 4 Juni) ke trending up (5-6 Juni)
- DLMM LP performance menurun di trending market
- OOR above meningkat drastis
- **Solusi:** Adjust stop-loss dan outOfRangeWaitMinutes

---

## Perubahan yang Diterapkan

### Opsi B: Model AI Change

| Parameter | Sebelum | Sesudah |
|-----------|---------|---------|
| `screeningModel` | `anthropic/claude-haiku-4.5` | `deepseek/deepseek-v4-flash:free` |
| `managementModel` | `anthropic/claude-haiku-4.5` | `deepseek/deepseek-v4-flash:free` |
| `generalModel` | `anthropic/claude-haiku-4.5` | `deepseek/deepseek-v4-flash:free` |
| `aiReviewModel` | `anthropic/claude-haiku-4.5` | `anthropic/claude-haiku-4.5` (tetap) |
| `aiDailyBudgetUsd` | `0.5` | `1.0` |

**Dampak:**
- Daily cost turun drastis (DeepSeek gratis vs Haiku $0.50/hari)
- AI budget $1/hari sebagai buffer untuk review calls
- Haiku hanya untuk review keputusan penting

---

## Rekomendasi Selanjutnya

### Prioritas 1: Fix Executor.js Blockers

Dari document `rekomendasi_perubahan_20260606.md`:

1. `maxDeployVolatility: 2.5 → 4.0` — Segera. Mem buang terlalu banyak kandidat bagus
2. `allocationRiskProfile: moderate → aggressive` — Naikkan limit portfolio exposure
3. `failClosedOnMissingRiskMetrics: true → false` — Jangan blok saat data risk tidak lengkap
4. `maxConsecutiveLosses: 3 → 5` — Beri toleransi varian normal
5. `maxConsecutiveOorCloses: 3 → 5` — Beri toleransi OOR di trending market

### Prioritas 2: Fix Wallet Filter

- Tambah rescue mode untuk pool quality tinggi
- Turunkan minimum wallet score untuk dry-run testing

### Prioritas 3: Fix Anti-OOR

- Implementasi retry mechanism setelah momentum stabil
- Tambah mode `WIDEN_AND_SHIFT_UP` bukan hanya block

---

## Cara Rollback

Jika model change bermasalah:

```json
{
  "screeningModel": "anthropic/claude-haiku-4.5",
  "managementModel": "anthropic/claude-haiku-4.5",
  "generalModel": "anthropic/claude-haiku-4.5",
  "aiDailyBudgetUsd": 0.5
}
```

Atau restore backup:
```bash
cp user-config_backup_ai_model_change.json user-config.json
pm2 restart meridian --update-env
```

---

## Kesimpulan

**Trade sepi & loss BUKAN karena execution_intelligence.js atau perubahan kode.**

Penyebabnya adalah kombinasi:
1. AI budget habis → screening kurang akurat
2. Wallet filter terlalu ketat → 101 kandidat/hari ditolak
3. Anti-OOR shift-up not supported → 22x blok
4. OKX service down → data risk tidak lengkap
5. Market regime berubah dari sideways ke trending

Perubahan yang diterapkan (opsi B) mengatasi faktor #1. Faktor #2-5 perlu perubahan config tambahan dari document `rekomendasi_perubahan_20260606.md`.
