# Analisa argument_range_01

Tanggal: 2026-06-05
Sumber: `C:\Users\midip\Downloads\argument_range_01.md`

## Kesimpulan

Argumen utama masuk akal dan tidak dibantah.

Yang benar:
- masalah saat ini bukan kekurangan kandidat,
- OOR rate terlalu tinggi,
- OOR dominan ke atas,
- anti-OOR sudah mendeteksi `MOMENTUM_BREAKOUT_UP`,
- `anti_oor_intelligence.js` memang menghasilkan rekomendasi `WIDEN_AND_SHIFT_UP`,
- executor memang memakai `planDlmmEntry`,
- rekomendasi dynamic range sebelumnya belum menjadi jalur recheck nyata.

Yang harus dibatasi:
- `WIDEN_AND_SHIFT_UP` tidak boleh langsung dipakai untuk single-side SOL jika caranya membutuhkan `bins_above > 0`,
- CRITICAL anti-OOR tetap tidak boleh deploy langsung,
- perbaikan harus masuk recheck/shadow/logging dulu, bukan membuka filter.

## Audit Teknis

### `lib/anti_oor_intelligence.js`

File ini sudah menghasilkan:
- `MOMENTUM_BREAKOUT_UP`
- `WIDEN_AND_SHIFT_UP`
- `WAIT_5_MIN`
- `NO_DEPLOY_OR_SANDBOX_ONLY`

Jadi otak anti-OOR sudah ada.

### `strategy/dlmm-edge.js`

Planner utama menghasilkan:
- `bins_below`
- `bins_above=0`
- strategy `bid_ask`

Sebelum perubahan, belum ada fungsi eksplisit untuk mengecek apakah rekomendasi anti-OOR legal untuk single-side SOL.

### `tools/executor.js`

Executor sudah:
- memanggil `planDlmmEntry`,
- mengevaluasi anti-OOR,
- memblok HIGH/CRITICAL.

Namun sebelumnya:
- belum queue recheck,
- belum menyimpan field range forensic secara lengkap ke decision log,
- belum mencatat legalitas `SHIFT_UP` untuk single-side SOL.

## Perubahan Yang Dilakukan

1. `strategy/dlmm-edge.js`
   - Menambahkan `evaluateAntiOorRangeAdaptation`.
   - Jika anti-OOR memberi `WIDEN_AND_SHIFT_UP` pada single-side SOL, hasilnya:
     - `legal=false`
     - `final_range_action=SHIFT_UP_NOT_SUPPORTED_FOR_SINGLE_SIDE_SOL`
     - `bins_above=0`
   - Jika rekomendasi `WIDEN_RANGE`, range bisa dilebarkan dalam batas aman.

2. `lib/anti_oor_recheck_queue.js`
   - Modul baru untuk queue kandidat yang diblok anti-OOR.
   - Menyimpan snapshot:
     - pool,
     - score,
     - anti-OOR risk,
     - active bin sebelum wait,
     - range sebelum wait,
     - fee/TVL,
     - volume,
     - volatility,
     - final range action.

3. `tools/executor.js`
   - Saat anti-OOR HIGH/CRITICAL, deploy tetap diblok.
   - Kandidat masuk `anti_oor_recheck_queue`.
   - Decision log diperkaya dengan:
     - `anti_oor_risk`,
     - `anti_oor_score`,
     - `momentum_state`,
     - `dynamic_range_recommendation`,
     - `range_width_bins`,
     - `bins_below`,
     - `bins_above`,
     - `active_bin`,
     - `lower_bin`,
     - `upper_bin`,
     - `active_bin_position_pct`,
     - `recheck_status`,
     - `final_range_action`,
     - `deploy_block_reason`.

4. `tools/screening.js`
   - Cycle screening memproses due recheck queue.
   - Setelah wait, pool detail diambil ulang.
   - Anti-OOR dan range plan dihitung ulang.
   - Hasil dicatat sebagai:
     - `STILL_CRITICAL`,
     - `IMPROVED_TO_SANDBOX_CANDIDATE`,
     - `DATA_UNAVAILABLE`.
   - Tidak ada auto-deploy dari recheck.

5. `decision-log.js`
   - Menambahkan field top-level untuk data range/OOR agar tidak hanya terkubur di `metrics`.

6. `lib/forensic_scanner.js`
   - Daily forensic menambahkan `range_failure_analysis`.
   - Field yang ditambahkan:
     - `active_bin_escape_count`,
     - `fast_oor_under_30m`,
     - `oor_above_rate`,
     - `avg_time_to_oor`,
     - `widen_recommendation_used_count`,
     - `wait_recheck_count`,
     - `recheck_success_count`,
     - `recheck_still_critical_count`,
     - `shift_up_not_supported_count`,
     - `single_side_bins_above_violation_count`.

7. `test/test-anti-oor-range.js`
   - Test baru untuk anti-OOR range dan queue.

8. `test/test-dlmm-edge.js`
   - Test baru untuk planner DLMM edge.

## Perilaku Setelah Perubahan

Jika anti-OOR `CRITICAL`:
- deploy tetap tidak jalan,
- kandidat masuk queue recheck,
- after wait akan dicek ulang,
- hasil recheck dicatat,
- tidak ada perubahan live mode,
- tidak ada size increase,
- tidak ada bypass safety.

Jika `WIDEN_AND_SHIFT_UP` muncul pada single-side SOL:
- sistem tidak membuat `bins_above` ilegal,
- action dicatat sebagai `SHIFT_UP_NOT_SUPPORTED_FOR_SINGLE_SIDE_SOL`,
- jalur aman yang tersisa adalah wait/recheck/shadow/sandbox evidence.

## Hal Yang Sengaja Tidak Dilakukan

- Tidak mematikan anti-OOR.
- Tidak membuka CRITICAL menjadi deploy.
- Tidak mengubah `dryRun`.
- Tidak menaikkan size.
- Tidak mengubah meme finder.
- Tidak mengubah wallet filter/Darwin/pool scorer.

## Validasi

Validasi lokal:
- `node --check strategy/dlmm-edge.js`
- `node --check tools/executor.js`
- `node --check tools/screening.js`
- `node --check lib/anti_oor_recheck_queue.js`
- `node test/test-anti-oor-range.js`
- `node test/test-dlmm-edge.js`
- `node test/test-shadow-v2-engine.js`
- `node test/test-shadow-intelligence.js`

## Kesimpulan Akhir

Argumen `argument_range_01.md` benar pada diagnosis utama: Meridian sedang kalah pada kondisi active-bin escape/OOR, terutama upward momentum.

Perbaikan yang diterapkan mengikuti prinsip aman:

`CRITICAL -> BLOCK + QUEUE_RECHECK + FORENSIC_LOG`

Bukan:

`CRITICAL -> DEPLOY`
