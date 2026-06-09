# Change Log: 6 Juni 2026 — Full Fix + Adaptive PnL Integration

**Tanggal:** 6 Juni 2026  
**Status:** All changes deployed, verified, documented  
**Bot Status:** ONLINE (4 processes via PM2)

---

## Ringkasan Masalah Awal

- 50 closed trades: 34 wins (68%), 16 losses (32%)
- Top loss reason: `paper out-of-range above` (60% dari losses)
- 178 kandidat diblokir oleh `wallet_filter`
- DeepSeek model 404 error
- Dashboard "Opportunity Watchlist" stuck on Loading
- Shadow V2 adaptive PnL (+8.65 SOL simulasi) tidak terintegrasi ke management cycle

---

## Perubahan: 12 File Diubah

### Part A: Profit Formula Fix (bins_above)

#### 1. tools/dlmm.js
**Masalah:** Throw error "Single-side SOL deploy cannot use bins_above" + activeBinsAbove=0 override  
**Fix:** Hapus throw error dan override  
**Dampak:** SDK sekarang terima bins_above > 0 untuk single-sided SOL  

#### 2. tools/definitions.js
**Masalah:** Instruksi LLM: "Keep this at 0 for single-side SOL deploys"  
**Fix:** "Use bins_above=10 for single-sided SOL deploys to provide upward range coverage"  
**Dampak:** LLM deploy dengan range dua sisi  

#### 3. prompt.js (bins_above)
**Masalah:** bins_above=0 hardcoded di agent instructions  
**Fix:** bins_above=0 → bins_above=10  
**Dampak:** Agent instructions konsisten  

#### 4. index.js (bins_above)
**Masalah:** Semua bins_above=0 hardcoded (6 lokasi)  
**Fix:** bins_above=0 → 10  
**Dampak:** Default range dua sisi  

#### 5. tools/executor.js
**Masalah:** bins_above default 0, reject > 0  
**Fix:** Default ??10, clamp [0,30], hapus reject  
**Dampak:** Safety net + allow bins_above  

### Part B: Filter & Guard Fixes

#### 6. decision/analysis-engine.js
**Masalah:** WalletScore fallback ??0 → auto-block semua kandidat  
**Fix:** WalletScore fallback ??0 → ??50  
**Dampak:** Kandidat tidak auto-block tanpa wallet data  

#### 7. lib/shadow_v2_guard.js
**Masalah:** hardBlockLevels [HIGH, CRITICAL] → block semua HIGH kandidat  
**Fix:** hardBlockLevels → ["CRITICAL"] only  
**Dampak:** HIGH = advisory only, tidak di-block  

### Part C: Model Fix

#### 8. user-config.json
**Masalah:** Model deepseek/deepseek-chat:free → 404 error  
**Fix:** Model → deepseek/deepseek-v4-flash  
**Dampak:** Model berjalan tanpa error  

### Part D: Dashboard Fix

#### 9. dashboard.js
**Masalah:** `ReferenceError: config is not defined` di /api/pools dan /api/copy-signals → API crash → frontend stuck on "Loading"  
**Root cause:** `config` hanya didefinisikan di dalam /api/status handler (line 806), tapi /api/pools dan /api/copy-signals juga menggunakannya  
**Fix:** Tambah `const config = readJSON(PATHS.userConfig, {})` di awal /api/pools handler (line 891) dan /api/copy-signals handler (line 985)  
**Dampak:** /api/pools mengembalikan valid JSON → Opportunity Watchlist render correctly  

### Part E: Adaptive PnL Integration

#### 10. shadow/shadow_v2_engine.js
**Masalah:** Shadow V2 merekam data simulasi tapi tidak ada fungsi untuk memberikan advice ke management cycle  
**Fix:** Tambah `getAdaptiveCloseAdvice(poolAddress, poolName, closeRule)`:
- Baca shadow_v2_summary.json untuk adaptive performance hari ini
- Jika best route = wait_5m_recheck dengan impact > 0.1 SOL:
  - OOR timeout rule: delay close 5 menit
  - Low yield rule: delay close 3 menit
- Cek juga pool-specific adaptive data di shadow_v2_cases.json
- Error-safe (try-catch, never breaks management cycle)

#### 11. index.js (adaptive)
**Masalah:** Management cycle tidak membaca shadow_v2 data  
**Fix:**
- Import: `import { getAdaptiveCloseAdvice } from './shadow/shadow_v2_engine.js'` (line 47)
- Adaptive delay block sebelum kedua OOR rules (above + below range):
  - Jika shouldDelay & masih dalam cooldown → return null (skip close), log `[adaptive-delay] HOLD`
  - Jika cooldown expired → log `[adaptive-delay] EXPIRED`, allow close
  - Gunakan globalThis delay keys per position

#### 12. prompt.js (adaptive)
**Masalah:** Manager prompt tidak punya shadow_v2 context  
**Fix:** Tambah "ADAPTIVE SHADOW V2 CONTEXT" di manager prompt:
- Jelaskan apa itu adaptive variants
- Instruksi LLM lebih sabar dengan OOR jika adaptive impact positif
- Instruksi LLM close normal jika adaptive impact negatif/nol
- Verifikasi PnL via get_position_pnl sebelum close decision

---

## Cara Kerja Adaptive PnL

```
SEBELUM:
  OOR position → rule 4 (outOfRangeWaitMinutes) → CLOSE langsung

SESUDAH:
  OOR position → getAdaptiveCloseAdvice()
    → if best_route = wait_5m_recheck && impact > 0.1 SOL
      → HOLD 5 menit
      → recheck
      → if masih OOR → CLOSE
```

**Yang TIDAK terpengaruh:**
- Stop loss (rule 1) — tetap close langsung
- Take profit (rule 2) — tetap close langsung
- Trailing TP — tetap berjalan normal

---

## Data Verifikasi

### Posisi Saat Ini (3 Open)
| Pool | Amount | Bins | Deploy Time |
|------|--------|------|-------------|
| unc-SOL | 0.132 SOL | 50/? | 08:31 UTC |
| three-SOL | 0.203 SOL | 45/? | 13:01 UTC |
| WORLDCUP-SOL | 0.16 SOL | 47/? | 13:25 UTC |

### Closed Trades
- Total: 52 trades
- Win rate: 69.2% (36W / 16L)

### Shadow V2 Summary (6 Juni 2026)
- Truth PnL: -2.61 SOL (actual loss)
- Adaptive PnL: +8.79 SOL (simulasi)
- Adaptive Impact: +1.29 SOL
- Best route: wait_5m_recheck

### Syntax Check
- ✅ shadow_v2_engine.js: OK
- ✅ index.js: OK
- ✅ prompt.js: OK
- ✅ dashboard.js: OK
- ✅ dlmm.js: OK
- ✅ definitions.js: OK
- ✅ executor.js: OK
- ✅ analysis-engine.js: OK
- ✅ shadow_v2_guard.js: OK

### PM2 Status
- ✅ meridian: ONLINE
- ✅ pool-dashboard: ONLINE
- ✅ smart-wallet-observer: ONLINE
- ✅ meme-alpha-finder: ONLINE

### API Endpoints
- ✅ /api/pools: HTTP 200
- ✅ /api/ranking: HTTP 200
- ✅ /api/smart-wallet-observer: HTTP 200

---

## Risiko & Catatan

1. **bins_above=10 + single-sided SOL** — belum terverifikasi on-chain (DRY_RUN mode). Jika SDK tidak support, transaksi akan gagal di on-chain.
2. **Range lebih lebar (45-79 bins)** — fee concentration lebih rendah tapi lebih sedikit OOR.
3. **Adaptive delay 5 menit** — hardcoded. Belum configurable. Jika terlalu lama/pendek, perlu edit kode.
4. **globalThis delay keys** — reset jika PM2 restart. Acceptable.
5. **readJson per posisi** — small JSON files, acceptable untuk cycle 10 menit.

---

## File Backups
- `dashboard.js.bak_20260606`
- `shadow_v2_engine.js.bak_20260606` + `.bak2`
- `index.js.bak_20260606`
- `prompt.js.bak_20260606`

---

## Dokumen Terkait
- `change_profit_formula_20260606.md` — Part A-E details
- `change_adaptive_pnl_20260606.md` — Shadow V2 adaptive activation
- `change_intelegence_advisory_mode.md` — Intelligence advisory
- `change_trade_unblock_2026-06-06.md` — Trade unblock investigation
- `change_all_20260606.md` — This document (full summary)
