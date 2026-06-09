# Change Argument Range 01

Tanggal: 2026-06-05
Dasar perubahan: `argument_range_01.md`
Status implementasi: sudah diterapkan lokal dan VPS
Mode: aman / shadow-recheck / tidak melonggarkan deploy langsung

## Ringkasan

Isi `argument_range_01.md` dianalisa dan sebagian besar argumennya dinilai benar.

Kesimpulan utamanya:

Meridian bukan kekurangan kandidat. Masalah yang lebih kuat adalah kandidat bagus sering tidak punya route eksekusi aman karena active bin bergerak cepat ke atas, range tertinggal, lalu anti-OOR memblok deploy atau posisi lama berakhir OOR/stop-loss.

Perubahan yang diterapkan tidak membuka filter secara kasar. Anti-OOR `HIGH` atau `CRITICAL` tetap memblok deploy. Bedanya, kandidat yang diblok sekarang tidak hilang tanpa jejak. Kandidat akan masuk queue recheck, dicatat forensic, lalu dicek ulang setelah wait.

Prinsip baru:

`CRITICAL -> BLOCK + QUEUE_RECHECK + FORENSIC_LOG`

Bukan:

`CRITICAL -> DEPLOY`

## File Yang Diubah

### 1. `strategy/dlmm-edge.js`

Perubahan:
- Menambahkan fungsi `evaluateAntiOorRangeAdaptation`.
- Fungsi ini membaca rekomendasi anti-OOR seperti:
  - `WIDEN_AND_SHIFT_UP`
  - `WIDEN_AND_SHIFT_DOWN`
  - `WIDEN_RANGE`
  - `KEEP_STANDARD_RANGE`
- Fungsi ini mengecek apakah rekomendasi range legal untuk mode deploy saat ini.

Implikasi:
- Rekomendasi anti-OOR tidak lagi hanya menjadi teks.
- Engine sekarang punya pemeriksa formal apakah range adaptation bisa diterapkan atau tidak.
- Untuk single-side SOL, `bins_above` harus tetap `0`.
- Jika anti-OOR memberi `WIDEN_AND_SHIFT_UP`, sistem tidak memalsukan shift-up dengan membuat `bins_above > 0`.
- Hasilnya dicatat sebagai:

`SHIFT_UP_NOT_SUPPORTED_FOR_SINGLE_SIDE_SOL`

Kenapa penting:
- Single-side SOL tidak boleh sembarang punya range atas.
- Jika dipaksakan, deploy bisa melanggar constraint executor dan menghasilkan behavior palsu.
- Dengan perubahan ini, sistem jujur: shift-up mungkin masuk akal secara konsep, tetapi belum legal untuk format single-side SOL saat ini.

### 2. `lib/anti_oor_recheck_queue.js`

Perubahan:
- File baru.
- Menyimpan kandidat yang diblok anti-OOR ke queue.
- Queue disimpan di:

`data/anti_oor_recheck_queue.json`

Data yang disimpan:
- `pool_address`
- `pool_name`
- `score`
- `recommendation`
- `anti_oor_risk`
- `anti_oor_score`
- `anti_oor_reasons`
- `momentum_state`
- `dynamic_range_recommendation`
- `active_bin_before_wait`
- `lower_bin_before_wait`
- `upper_bin_before_wait`
- `bins_below_before_wait`
- `bins_above_before_wait`
- `fee_tvl_ratio_before_wait`
- `volume_before_wait`
- `volatility_before_wait`
- `final_range_action`
- `shift_up_legal`
- `available_at`
- `recheck_result`

Implikasi:
- Kandidat bagus yang diblok tidak langsung hilang.
- Ada bukti apakah setelah 5 menit kondisi membaik atau tetap berbahaya.
- Bisa diketahui apakah anti-OOR terlalu ketat atau memang menyelamatkan modal.
- Queue ini belum melakukan auto-deploy.

### 3. `tools/executor.js`

Perubahan:
- Executor sekarang memakai `evaluateAntiOorRangeAdaptation`.
- Saat anti-OOR `HIGH` atau `CRITICAL`, deploy tetap diblok.
- Kandidat yang diblok dimasukkan ke `anti_oor_recheck_queue`.
- Decision log diperkaya dengan data range/OOR.
- Log anti-OOR sekarang mencatat `range_action`.

Field forensic yang sekarang dihitung:
- `active_bin_before_plan`
- `active_bin_before_deploy`
- `lower_bin`
- `upper_bin`
- `bins_below`
- `bins_above`
- `range_width_bins`
- `active_bin_position_pct`
- `active_bin_near_upper_edge`
- `active_bin_near_lower_edge`
- `anti_oor_risk`
- `anti_oor_score`
- `momentum_state`
- `dynamic_range_recommendation`
- `final_range_action`

Implikasi:
- Deploy yang diblok oleh anti-OOR sekarang punya jejak teknis yang jelas.
- Kita bisa membedakan:
  - range terlalu rendah,
  - active bin dekat upper edge,
  - shift-up tidak legal,
  - anti-OOR masih critical,
  - kandidat hanya perlu recheck.
- Ini membantu forensic berikutnya agar tidak menebak.

Yang tidak berubah:
- Anti-OOR `CRITICAL` tetap tidak deploy.
- Tidak ada bypass safety.
- Tidak ada perubahan `dryRun`.
- Tidak ada peningkatan size.

### 4. `tools/screening.js`

Perubahan:
- Screening cycle sekarang memproses due recheck queue.
- Item yang sudah melewati waktu tunggu akan:
  1. mengambil detail pool ulang,
  2. membaca active bin terbaru,
  3. menghitung ulang range plan,
  4. menghitung ulang anti-OOR,
  5. mencatat hasil recheck.

Hasil recheck:
- `STILL_CRITICAL`
- `IMPROVED_TO_SANDBOX_CANDIDATE`
- `DATA_UNAVAILABLE`

Implikasi:
- `WAIT_5_MIN_RECHECK` sekarang menjadi mekanisme nyata, bukan hanya teks.
- Jika setelah wait masih critical, kandidat tetap tidak deploy.
- Jika membaik, kandidat hanya ditandai sebagai sandbox candidate, belum auto-deploy.
- Ini membuat sistem lebih pintar tanpa menjadi agresif.

### 5. `decision-log.js`

Perubahan:
- Decision log sekarang menyimpan field range/OOR sebagai top-level field, bukan hanya di `metrics`.

Field baru:
- `anti_oor_risk`
- `anti_oor_score`
- `momentum_state`
- `dynamic_range_recommendation`
- `range_width_bins`
- `bins_below`
- `bins_above`
- `active_bin`
- `lower_bin`
- `upper_bin`
- `active_bin_position_pct`
- `recheck_status`
- `recheck_result`
- `final_range_action`
- `deploy_block_reason`

Implikasi:
- Dashboard/API decision akan lebih mudah membaca alasan teknis block.
- Analisa ke depan tidak hanya melihat `reason` berupa kalimat panjang.
- Bisa dibuat statistik: berapa kali CRITICAL terjadi, berapa kali recheck membaik, berapa kali shift-up tidak legal.

### 6. `lib/forensic_scanner.js`

Perubahan:
- Daily forensic sekarang menambahkan `range_failure_analysis`.

Field baru:
- `active_bin_escape_count`
- `fast_oor_under_30m`
- `oor_above_rate`
- `avg_time_to_oor`
- `widen_recommendation_used_count`
- `wait_recheck_count`
- `recheck_success_count`
- `recheck_still_critical_count`
- `shift_up_not_supported_count`
- `single_side_bins_above_violation_count`

Implikasi:
- Forensic harian bisa menjawab:
  - apakah active-bin escape masih sering,
  - apakah OOR masih dominan ke atas,
  - apakah wait-recheck menghasilkan perbaikan,
  - apakah rekomendasi widen dipakai,
  - apakah constraint single-side SOL dilanggar.
- Ini penting sebelum kita memutuskan apakah route adaptive boleh naik ke engine.

### 7. `test/test-anti-oor-range.js`

Perubahan:
- Test baru untuk anti-OOR range dan recheck queue.

Yang diuji:
- OOR above berulang menghasilkan `MOMENTUM_BREAKOUT_UP`.
- Anti-OOR menghasilkan `WIDEN_AND_SHIFT_UP`.
- Risk menjadi `CRITICAL`.
- CRITICAL masuk queue recheck.
- Queue belum due sebelum 5 menit.
- Queue due setelah 5 menit.
- Recheck bisa dicatat sebagai `STILL_CRITICAL`.
- Single-side SOL tidak boleh memakai `bins_above` ilegal.
- `WIDEN_AND_SHIFT_UP` menjadi `SHIFT_UP_NOT_SUPPORTED_FOR_SINGLE_SIDE_SOL`.

Implikasi:
- Perubahan safety sekarang punya test.
- Jika nanti ada perubahan yang diam-diam membuat CRITICAL langsung deploy atau membuat bins_above ilegal, test bisa menangkap.

### 8. `test/test-dlmm-edge.js`

Perubahan:
- Test baru untuk planner DLMM edge.

Yang diuji:
- volatility rendah menghasilkan range balanced/tight fee capture.
- volatility tinggi menghasilkan wide defensive.
- price change positif besar memberi warning jangan mengejar harga.
- active liquidity rendah memperlebar range dan memberi warning.
- binsBelow tidak turun di bawah minimum aman.
- binsBelow tidak melewati max.
- `WIDEN_RANGE` legal untuk single-side SOL selama `bins_above=0`.

Implikasi:
- Planner range punya coverage dasar.
- Perubahan berikutnya pada range planning tidak boleh merusak constraint minimum/maximum.

### 9. `document/analisa_argument_range_01.md`

Perubahan:
- Dokumentasi analisa khusus untuk isi `argument_range_01.md`.
- Menjelaskan bagian yang diterima, bagian yang dibatasi, audit teknis, perubahan, dan validasi.

Implikasi:
- Ada catatan eksplisit kenapa argumen ini dijalankan, bukan dibantah.
- Ada catatan bahwa perubahan ini bukan pelonggaran deploy.

### 10. `document/perbaikian_engine.md`

Perubahan:
- Menambahkan update `Range / Anti-OOR Recheck Queue`.

Implikasi:
- Perubahan ini masuk arsip utama perbaikan engine.
- Ke depan gampang dilacak bahwa WAIT_RECHECK mulai dibuat nyata pada update ini.

## Perubahan Perilaku Bot

### Sebelum

Saat anti-OOR `HIGH` atau `CRITICAL`:

1. Executor memblok deploy.
2. Log hanya menyebut alasan block.
3. Kandidat tidak otomatis punya recheck nyata.
4. Rekomendasi `WIDEN_AND_SHIFT_UP` hanya terlihat sebagai informasi.
5. Forensic belum cukup detail untuk membuktikan range action.

### Sesudah

Saat anti-OOR `HIGH` atau `CRITICAL`:

1. Executor tetap memblok deploy.
2. Range adaptation dievaluasi.
3. Jika shift-up tidak legal untuk single-side SOL, dicatat eksplisit.
4. Kandidat masuk recheck queue.
5. Decision log menyimpan data range/OOR.
6. Screening cycle berikutnya memproses recheck.
7. Forensic harian bisa menghitung hasil recheck.

## Implikasi Ke Safety

Perubahan ini aman karena:
- Tidak mematikan anti-OOR.
- Tidak mengubah `dryRun` ke live.
- Tidak menaikkan size.
- Tidak membuat `CRITICAL` deploy langsung.
- Tidak menghapus toxic OOR pool gate.
- Tidak mengubah meme finder.
- Tidak membuka wallet filter.
- Tidak mengubah Darwin/pool scorer.

Trade tetap bisa sepi jika anti-OOR terus critical. Itu disengaja sampai recheck/shadow memberi bukti bahwa kandidat tertentu membaik.

## Implikasi Ke Jumlah Trade

Jangka pendek:
- Jumlah trade belum tentu naik.
- Anti-OOR masih memblok kandidat berbahaya.
- Queue baru hanya mencatat dan recheck.

Jangka menengah:
- Jika banyak recheck berubah dari `CRITICAL` ke `MEDIUM/LOW`, kita punya bukti bahwa wait-recheck berguna.
- Setelah cukup bukti, baru bisa dipertimbangkan sandbox deploy kecil.

Jangka panjang:
- Jika recheck sering tetap critical, artinya anti-OOR benar dan bot memang harus menunggu regime berubah.
- Jika recheck sering membaik dan adaptive shadow impact positif, barulah engine bisa dinaikkan bertahap.

## Implikasi Ke Range Planning

Perubahan ini belum membuat range otomatis shift-up di deploy production.

Alasannya:
- Single-side SOL saat ini mewajibkan `bins_above=0`.
- Upward shift yang benar mungkin membutuhkan range atas.
- Memalsukan shift-up tanpa range atas akan menyesatkan forensic.

Jadi sistem sekarang akan mengatakan:

`SHIFT_UP_NOT_SUPPORTED_FOR_SINGLE_SIDE_SOL`

Lalu memakai jalur aman:
- wait-recheck,
- shadow,
- sandbox evidence,
- forensic logging.

## Implikasi Ke Forensic

Forensic berikutnya akan lebih kuat karena dapat melihat:
- active bin sebelum plan,
- active bin sebelum deploy/block,
- range bawah/atas,
- posisi active bin di dalam range,
- apakah active bin dekat upper edge,
- dynamic range recommendation,
- final range action,
- apakah recheck sukses,
- apakah recheck tetap critical.

Ini mengurangi analisa berbasis dugaan.

## Validasi Yang Sudah Dilakukan

Lokal:
- `node --check strategy/dlmm-edge.js`
- `node --check tools/executor.js`
- `node --check tools/screening.js`
- `node --check lib/anti_oor_recheck_queue.js`
- `node --check decision-log.js`
- `node --check lib/forensic_scanner.js`
- `node test/test-anti-oor-range.js`
- `node test/test-dlmm-edge.js`
- `node test/test-shadow-v2-engine.js`
- `node test/test-shadow-intelligence.js`

VPS:
- syntax check file terkait berhasil,
- `node test/test-anti-oor-range.js` berhasil,
- `node test/test-dlmm-edge.js` berhasil,
- `npm test` berhasil,
- `meridian` dan `pool-dashboard` sudah direstart dan online.

Catatan:
- `npm test` lokal Windows gagal karena script package memakai Unix `find`, bukan karena kode gagal. Validasi `npm test` dilakukan di VPS Linux dan berhasil.

## Risiko Sisa

1. Queue recheck bergantung pada provider pool detail.
   - Jika provider timeout/429, hasil bisa `DATA_UNAVAILABLE`.

2. `IMPROVED_TO_SANDBOX_CANDIDATE` belum deploy otomatis.
   - Ini disengaja agar tidak langsung melonggarkan engine.

3. `SHIFT_UP` belum benar-benar bisa diterapkan untuk single-side SOL.
   - Perlu desain eksekusi yang legal jika suatu saat ingin mendukung upward range.

4. Jumlah trade bisa tetap sedikit.
   - Ini wajar jika regime masih OOR critical.

5. Perlu data beberapa cycle.
   - Queue baru berguna setelah ada kandidat yang diblok dan setelah recheck berjalan.

## Rollback

Rollback aman jika diperlukan:
- hapus penggunaan `queueAntiOorRecheck` di `tools/executor.js`,
- hapus pemanggilan `processAntiOorRecheckQueue` di `tools/screening.js`,
- kembalikan `decision-log.js` ke field lama,
- abaikan/hapus `data/anti_oor_recheck_queue.json`,
- `strategy/dlmm-edge.js` bisa tetap menyimpan fungsi tambahan karena tidak mengubah deploy jika tidak dipanggil.

## Kesimpulan

Perubahan ini menjawab inti `argument_range_01.md` dengan cara aman.

Masalah:

`active-bin escape / OOR upward momentum`

Solusi yang diterapkan:

`block tetap jalan, tetapi kandidat masuk recheck dan forensic menjadi jelas`

Engine belum dilonggarkan. Yang ditambahkan adalah jalur pembuktian agar nanti keputusan melonggarkan atau mengubah range benar-benar berbasis data.
