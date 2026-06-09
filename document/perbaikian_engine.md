# Perbaikian Engine - Risk Guard dan Anti-OOR

Tanggal: 2026-06-05

## Ringkasan

Perbaikan ini dibuat setelah audit kasus Goblin-SOL dry-run yang berakhir loss sekitar -20.26% setelah 12 jam 55 menit. Trade tersebut masuk pada 2026-06-04 13:15 UTC / 20:15 WIB dan close pada 2026-06-05 02:10 UTC / 09:10 WIB dengan alasan paper stop-loss.

Kesimpulan audit:
- Loss Goblin-SOL terjadi dari trade legacy yang sudah masuk sebelum anti-OOR hard-block benar-benar efektif.
- Saat close, posisi masih berada di dalam range bin -402 sampai -333, dengan active/exit bin sekitar -385. Jadi close bukan karena OOR wait, melainkan stop-loss PnL.
- Entry Goblin-SOL sebelumnya sudah diberi rekomendasi anti-OOR `NO_DEPLOY_OR_SANDBOX_ONLY` dan risiko `CRITICAL`, tetapi engine lama masih bisa lanjut deploy.
- Warning AI di dashboard bukan karena saldo/API habis. Penyebabnya internal daily paid call cap tercapai: pemakaian harian melewati batas cap sehingga engine memakai fallback/free mode.

## File Yang Diubah

1. `tools/executor.js`
   - `readPnlTradesForRisk()` sekarang mengembalikan status eksplisit `{ trades, error }`.
   - Jika `pnl_log.json` hilang, rusak, atau formatnya tidak valid, anti-OOR dan risk breaker dry-run akan fail-closed.
   - Posisi dry-run sekarang membawa `in_range`, `minutes_out_of_range`, `pnl_pct`, `amount_sol`, dan `position`.
   - Guard `maxConsecutiveLosses`, `maxDailyLossUsd`, dan `maxConsecutiveOorCloses` sekarang berlaku juga di dry-run.
   - Consecutive OOR check sekarang membaca close reason dengan pola yang lebih fleksibel, bukan hanya exact string `out_of_range` atau `oor`.

2. `lib/operator_intelligence.js`
   - `calculatePoolTrustScore()` sekarang diberi cap konservatif.
   - Pool dengan sampel kurang dari 3 tidak boleh mendapat skor trust di atas 50.
   - Pool dengan riwayat OOR tinggi diberi cap 45, dan OOR kritikal diberi cap 40.
   - Pool dengan sampel sedikit dan edge kecil diberi cap tambahan 45.

3. `config.js`
   - Default `maxDeployVolatility` dibuat aktif di 2.5.
   - Default `maxOorRatioForRedeploy` dibuat aktif di 0.6.
   - Default `minPoolWinRate` dibuat aktif di 50.
   - Default `lossTriggeredCooldown` dibuat aktif.

4. `user-config.json`
   - `maxDeployVolatility` diselaraskan ke 2.5.
   - Ditambahkan `maxOorRatioForRedeploy: 0.6`.
   - Ditambahkan `minPoolWinRate: 50`.
   - `outOfRangeWaitMinutes` diselaraskan ke 10.
   - Ditambahkan `lossTriggeredCooldown: true`, `lossCooldownThresholdPct: -15`, dan `lossCooldownHours: 6`.

5. `shadow/shadow_engine.js`
   - Shadow candidate sekarang membaca variasi field `pool_address`, `poolAddress`, `active_bin`, `activeBin`, `current_active_bin`, `lowerBin`, `upperBin`, `entryPrice`, `current_price`, dan field dalam `deployArgs`.
   - Update market shadow sekarang case-insensitive untuk status `OPEN`.
   - Tujuannya agar rejection replay punya harga/bin/range yang cukup untuk menghitung shadow PnL.
   - High-score rejection tidak lagi otomatis diberi verdict `FALSE_NEGATIVE`; sekarang disimpan sebagai `potential_false_negative` sampai ada bukti observasi.

6. `shadow/shadow_summary.js`
   - Summary sekarang case-insensitive untuk status `OPEN` dan `CLOSED`.
   - Mencegah data valid tidak ikut dihitung hanya karena beda kapitalisasi.

7. `copy-engine/position-monitor.js`
   - Pool detail yang dipakai copy engine sekarang meneruskan `active_bin`, `lower_bin`, `upper_bin`, dan `current_price` ke signal.
   - Tujuannya agar signal yang ditolak tetap bisa dipakai shadow replay.

8. `lib/forensic_scanner.js`
   - Rejection forensic sekarang memakai alamat pool dari `pool_address`, `poolAddress`, `pool`, atau `deployArgs.pool_address`.
   - Data yang dikirim ke `recordShadowCandidate()` sekarang membawa `pool_address` eksplisit.
   - `FALSE_NEGATIVE` sekarang hanya dihitung jika sudah ada observasi positif setelah reject.
   - High score/confidence tanpa observasi sekarang disimpan sebagai `potential_false_negatives`, bukan bukti final.

9. `public/index.html`
   - Sidebar kiri sekarang punya menu `Shadow Engine`.
   - Di dalamnya ada panel `Shadow v1` untuk rejection replay yang memakai endpoint `/api/shadow-intelligence`.
   - Ditambahkan panel `Shadow v2` dengan status `STANDBY` sebagai slot Pre-Trade Truth Layer.
   - `Shadow v2` belum mempengaruhi engine utama dan belum menjadi hard gate.
   - Tombol `Incident` sekarang langsung memulai download file Markdown setelah report berhasil dibuat.

10. `dashboard.js`
   - Ditambahkan endpoint `/api/incident-report/download`.
   - Endpoint generate incident sekarang mengembalikan `downloadUrl`.
   - Incident report diperkaya dengan primary finding, entry/exit geometry, anti-OOR snapshot, risk context, red flags, dan rekomendasi spesifik.

## Cacat Logika Yang Ditemukan

1. Dry-run portfolio guard buta terhadap kondisi posisi.
   - Sebelumnya dry-run hanya mengirim `pool`, `base_mint`, dan `amount_sol`.
   - Akibatnya `blockDeployIfAllOOR` dan `maxPortfolioHeat` tidak bisa menilai posisi OOR atau drawdown.

2. Risk breaker penting dilewati di dry-run.
   - `maxConsecutiveLosses`, `maxDailyLossUsd`, dan `maxConsecutiveOorCloses` sebelumnya hanya efektif untuk live.
   - Ini berbahaya karena dry-run dipakai untuk menilai strategi sebelum live.

3. Anti-OOR masih fail-open saat data risk tidak terbaca.
   - Jika `pnl_log.json` rusak atau tidak bisa di-parse, engine lama menganggap history kosong dan lanjut deploy.
   - Ini berisiko karena log sebelumnya pernah menunjukkan parse error pada data PnL.

4. History gate dan cooldown ada, tetapi default-nya mati.
   - `maxOorRatioForRedeploy`, `minPoolWinRate`, dan `lossTriggeredCooldown` sebelumnya tidak aktif jika user-config tidak mengaktifkan.
   - Akibatnya pool yang baru loss besar masih bisa masuk ulang terlalu cepat.

5. Pool trust terlalu optimistis pada sampel kecil.
   - Satu win kecil dengan OOR tinggi masih bisa menghasilkan score di atas netral.
   - Ini bisa membuat pool terlihat aman padahal evidence belum cukup.

6. Shadow Intelligence terlihat diam walaupun `cases` bertambah.
   - Penyebabnya bukan modul mati, tetapi mayoritas shadow candidate lama direkam tanpa `entry_price`, `active_bin`, dan range bin.
   - Akibatnya saat replay ditutup, hasilnya menjadi `NEUTRAL`, `shadow_pnl_sol` tetap 0, dan `false_negative_count` tetap 0.
   - Top cause `wallet_filter_too_strict` tetap muncul karena root cause dihitung dari jumlah rejection, bukan dari PnL yang tervalidasi.

7. Daily forensic log bisa terlalu cepat menyebut `FALSE_NEGATIVE`.
   - File `meridian_scan_log_2026-06-05 (1).json` menunjukkan false negative di summary, tetapi semua field observasi `after_30m`, `after_1h`, dan `after_2h` masih `PENDING_OBSERVATION`.
   - Penyebabnya klasifikasi lama menganggap `score >= 75` sebagai false negative, walaupun belum ada bukti market bahwa token yang ditolak benar-benar profit.
   - Ini bisa membuat sistem salah menyimpulkan `wallet_filter_too_strict` lalu melonggarkan filter terlalu cepat.

## Alasan Perubahan

Perbaikan ini perlu dilakukan sekarang karena menyangkut engine safety layer. Dry-run seharusnya menjadi tempat menemukan cacat strategi, bukan tempat cacat risk guard disembunyikan. Jika logic dry-run dibiarkan lebih longgar dari live, hasil evaluasi strategi bisa menyesatkan dan berisiko terbawa saat mode live.

Pendekatan yang dipilih adalah fail-closed untuk guard kritikal. Jika data risk tidak bisa dibaca, engine lebih aman berhenti deploy sementara daripada membuka posisi baru dengan blind spot.

## Validasi

Validasi lokal yang sudah dilakukan:
- `node --check D:\meridian-bot\tools\executor.js` berhasil.
- `node --check D:\meridian-bot\lib\operator_intelligence.js` berhasil.
- `node --check D:\meridian-bot\config.js` berhasil.
- `user-config.json` berhasil di-parse dengan Node.
- Import config menunjukkan nilai aktif:
  - `maxDeployVolatility: 2.5`
  - `maxOorRatioForRedeploy: 0.6`
  - `minPoolWinRate: 50`
  - `lossTriggeredCooldown: true`
  - `outOfRangeWaitMinutes: 10`

## Risiko Sisa

- Perubahan ini memperketat deploy. Dampaknya jumlah entry bisa turun, terutama saat data history tidak lengkap atau pool punya OOR tinggi.
- Jika `pnl_log.json` sering rusak, engine akan lebih sering menahan deploy. Ini benar dari sisi safety, tetapi perlu monitor sumber kerusakan file.
- Backtest/paper trade berikutnya perlu diamati untuk memastikan guard tidak terlalu agresif terhadap pool bagus yang datanya masih sedikit.

## Status

Perbaikan sudah diterapkan di lokal dan VPS `/opt/bot/meridian`.

Status setelah deploy:
- `meridian` dan `pool-dashboard` sudah direstart via PM2 dan kembali online.
- `user-config.json` valid.
- `data/pnl_log.json` valid.
- Dashboard `/api/status` menunjukkan bot running, mode `DRY RUN`, AI `blocked=false`, dan warning kosong.
- Log setelah restart menunjukkan guard baru aktif: deploy dry-run diblok oleh `Anti-OOR pre-entry guard` saat risiko `CRITICAL`.
- Shadow Intelligence patch sudah divalidasi dengan `test/test-shadow-intelligence.js`.
- Perubahan shadow tidak mengubah production deploy; efeknya hanya pada kualitas observability/rejection replay ke depan.
- Forensic false-negative patch sudah diterapkan di VPS; service `meridian` dan `pool-dashboard` sudah direstart.
- Dashboard `Shadow Engine` sudah diterapkan di VPS; `pool-dashboard` sudah direstart.
- Incident report download sudah diterapkan dan diuji di VPS; response memakai `Content-Disposition: attachment`.
- Incident report enriched sudah diuji di VPS; laporan Goblin sekarang menampilkan anti-OOR `CRITICAL`, in-range stop-loss, sparse pool trust, dan red flags.

Log yang diharapkan setelah perubahan ini adalah deploy baru diblok jika anti-OOR HIGH/CRITICAL atau jika risk history tidak terbaca.

---

# Update 2026-06-05 - Engine Tidak Terlalu Diam

## Latar Belakang

Ada instruksi perbaikan eksternal yang meminta engine tidak langsung live, memperbaiki dry-run learning, menambah rekomendasi manual `BUY/WATCH/SKIP/DANGER`, dan memastikan Darwin/lesson tidak belajar dari data dummy. Setelah dicek, sebagian instruksi benar, tetapi tidak semuanya boleh diterapkan mentah-mentah.

Temuan penting:
- Local `data/pnl_log.json` memang berisi 2 record dummy (`pool_a`, `pool_b`), sehingga tidak layak menjadi dasar learning.
- VPS tidak hanya berisi dummy. VPS punya puluhan closed trade valid, sehingga klaim "semua data PnL hanya dummy" dibantah untuk environment produksi.
- Klaim `wallet_filter_too_strict` sebagai false negative final juga belum terbukti jika outcome masih pending. Itu hanya boleh menjadi `WATCH_SHADOW`/observasi, bukan alasan langsung melonggarkan wallet filter.
- Trade yang cuma sedikit kemungkinan dipengaruhi gate `minPoolScore` yang terlalu ketat untuk kondisi sekarang. Sebelum perbaikan, log menunjukkan pool score 60-61 masih dibuang karena threshold 65.

## File Yang Diubah

1. `user-config.json`
   - `autoImprovementApplySuggestions` diubah dari `true` menjadi `false`.
   - `autoImprovementMinClosesToTune` dinaikkan dari `3` menjadi `10`.
   - `minPoolScore` diturunkan konservatif dari `65` menjadi `60`.

2. `config.js`
   - Default `autoImprovement.minClosesToTune` dinaikkan menjadi `10`.

3. `lib/training_record.js`
   - Modul baru untuk validasi training record.
   - Menolak dummy record, outcome tidak valid, timestamp hilang, market context hilang, dan PnL absurd.

4. `lessons.js`
   - Threshold evolution hanya jalan setelah 10 valid closed records.
   - Dummy/incomplete/low-confidence records tetap boleh tersimpan sebagai audit, tetapi tidak ikut lesson atau threshold evolution.

5. `signal-weights.js`
   - Darwin hanya memakai valid training records.
   - Recalculate ditahan sampai ada minimal 3 win dan 3 loss.
   - Numeric signal extraction punya fallback dari field langsung jika `signal_snapshot` tidak lengkap.

6. `lib/recommendation_engine.js`
   - Modul baru untuk label manual `BUY`, `WATCH`, `WATCH_SHADOW`, `SKIP`, dan `DANGER`.
   - Semua output bersifat manual-only dan `auto_buy_allowed=false`.

7. `tools/screening.js`
   - Hasil pool scorer diberi `manual_recommendation` dan `trade_recommendation`.
   - Log pool-score gate sekarang menyertakan rekomendasi agar kandidat yang tertahan bisa dianalisa.

8. `decision-log.js`
   - `MAX_DECISIONS` dinaikkan dari `100` menjadi `1000`.
   - Decision entry menambahkan `recommendation`, `score`, `grade`, dan `action`.

9. `test/test-engine-guardrails.js`
   - Test baru untuk memastikan dummy training ditolak, record valid diterima, rekomendasi BUY tetap manual-only, dan DANGER tidak pernah auto-buy.

## Alasan Perubahan

Perubahan ini diperlukan karena engine sedang terlalu defensif, tetapi tidak boleh diselesaikan dengan membuka semua filter. Solusi yang dipilih adalah:
- membuka sedikit kandidat dengan menurunkan `minPoolScore` dari 65 ke 60,
- tetap menjaga hard risk filter,
- membuat kandidat borderline menjadi observasi/rekomendasi manual,
- mencegah learning otomatis dari sample kecil atau data dummy.

Dengan begitu, jumlah kandidat bisa membaik tanpa menjadikan engine sembrono.

## Hal Yang Dibantah

- Tidak benar bahwa VPS hanya punya 2 dummy PnL. Itu benar untuk local stale file, bukan VPS.
- Tidak benar bahwa semua `wallet_filter_too_strict` otomatis false negative. Kalau outcome belum positif, statusnya harus observasi/potential, bukan bukti final.
- Tidak aman langsung memaksa executor hanya menerima `BUY`. Recommendation engine baru harus jadi advisory/manual dulu.
- Tidak aman mengedit historis `pnl_log.json` manual. Validasi dilakukan saat data dibaca.

## Validasi

Validasi lokal:
- `node --check D:\meridian-bot\lib\training_record.js` berhasil.
- `node --check D:\meridian-bot\lib\recommendation_engine.js` berhasil.
- `node --check D:\meridian-bot\lessons.js` berhasil.
- `node --check D:\meridian-bot\signal-weights.js` berhasil.
- `node --check D:\meridian-bot\tools\screening.js` berhasil.
- `node D:\meridian-bot\test\test-engine-guardrails.js` berhasil.

Validasi VPS:
- Syntax check file terkait berhasil.
- `node test/test-engine-guardrails.js` berhasil.
- `user-config.json` valid.
- `data/pnl_log.json` valid.
- PM2 restart berhasil dan proses `meridian`, `pool-dashboard`, `smart-wallet-observer`, dan `meme-alpha-finder` online.

## Risiko Sisa

- Jumlah trade belum tentu langsung naik jika provider risk seperti OKX sedang timeout/429. Saat kejadian ini, fallback risk aktif, tetapi screening tetap bisa lambat.
- `minPoolScore=60` masih konservatif. Jika tetap terlalu sepi setelah beberapa cycle, yang perlu dianalisa berikutnya adalah reason filter per candidate, bukan langsung menurunkan threshold besar-besaran.
- Recommendation `BUY` belum dieksekusi otomatis. Ini disengaja karena user menghendaki HOT/BUY benar-benar layak beli dan tetap aman.

---

# Update 2026-06-05 - Shadow Impact 0

## Temuan

Shadow Engine berjalan dan file `data/shadow_positions.json` aktif, tetapi impact tetap 0 karena mayoritas record lama tidak punya market geometry:
- `entry_price` kosong.
- `active_bin` kosong.
- `range_lower_bin` / `range_upper_bin` kosong.
- `bin_step` kosong.

Akibatnya shadow replay tidak bisa menghitung PnL. Posisi lama ditutup `shadow_max_duration` dan sebelumnya salah terlihat sebagai `NEUTRAL`.

## Perubahan

1. `copy-engine/position-monitor.js`
   - Ignored/copy rejection signal sekarang membawa:
     - `activeBin` / `active_bin`
     - `currentActiveBin` / `current_active_bin`
     - `lowerBin` / `lower_bin`
     - `upperBin` / `upper_bin`
     - `binStep` / `bin_step`
     - `entryPrice` / `entry_price`
     - `currentPrice` / `current_price`
   - Tujuannya agar shadow punya snapshot entry yang bisa dibandingkan dengan market update berikutnya.

2. `shadow/shadow_engine.js`
   - Shadow tidak lagi menutup kasus tanpa price/bin sebagai `NEUTRAL`.
   - Jika durasi maksimum tercapai tetapi geometri market tidak lengkap, status menjadi `DATA_INCOMPLETE` dan verdict `DATA_INCOMPLETE`.

3. `shadow/shadow_summary.js`
   - Summary menambahkan `data_incomplete_count`.

4. `test/test-shadow-intelligence.js`
   - Ditambahkan test agar missing geometry menghasilkan `DATA_INCOMPLETE`, bukan `NEUTRAL`.

## Perbaikan Data Lama

Data shadow lama yang sudah terlanjur `CLOSED/NEUTRAL` tanpa `entry_price` dan tanpa `active_bin` direklasifikasi menjadi `DATA_INCOMPLETE`.

Backup dibuat di VPS:
- `/opt/bot/meridian/data/shadow_positions.before_incomplete_repair.json`

Status setelah repair:
- `shadow_cases`: 268
- `open_cases`: 98
- `closed_cases`: 0
- `data_incomplete_count`: 170
- `neutral_count`: 0

Impact tetap 0 sementara karena sample baru yang memiliki geometri masih `OPEN`. Impact baru akan muncul setelah sample baru bergerak keluar range atau mencapai durasi evaluasi dengan data market lengkap.

---

# Update 2026-06-05 - Shadow v2 Pre-Trade Truth Engine

## Temuan

Panel `Shadow v2` di dashboard sebelumnya belum memiliki backend runtime. Nilai `STANDBY`, `Truth PnL +0.0000`, `Cases 0`, `Exit Route --`, dan `Cluster Risk --` masih berasal dari tampilan statis, bukan dari engine yang benar-benar mengamati kandidat.

Ini berarti Shadow v2 belum bisa memberi impact karena:
- belum ada file case khusus v2,
- belum ada summary khusus v2,
- belum ada endpoint API dashboard,
- belum ada collector dari screening/copy engine,
- belum ada aturan outcome untuk membedakan warning benar, false alarm, missed risk, atau data incomplete.

## File Yang Diubah

1. `shadow/shadow_v2_engine.js`
   - File baru untuk engine Shadow v2.
   - Menambahkan analyzer pre-trade truth:
     - exit route,
     - sell slippage estimate,
     - cluster risk,
     - dev/supply risk,
     - timing truth,
     - data completeness.
   - Menyimpan case ke `data/shadow_v2_cases.json`.
   - Menyimpan summary ke `data/shadow_v2_summary.json`.
   - Menghitung outcome `TRUE_WARNING`, `FALSE_ALARM`, `MISSED_RISK`, `CLEAN_PASS`, `NEUTRAL`, dan `DATA_INCOMPLETE`.

2. `tools/screening.js`
   - Pool scorer sekarang mengirim kandidat ke `observeShadowV2Candidate`.
   - Tujuannya agar Shadow v2 melihat kandidat sebelum score gate membuang pool.
   - Ini penting karena v2 harus belajar dari pool yang lolos maupun yang tertahan.
   - Ditambahkan juga early observe pada kandidat eligible sebelum enrichment OKX/indicator selesai.
   - Alasannya: jika provider eksternal sedang 429 atau circuit breaker, v2 tetap mencatat forensic snapshot dan tidak terlihat diam.

3. `copy-engine/position-monitor.js`
   - Copy engine sekarang mengirim snapshot/update market ke Shadow v2.
   - Tujuannya agar case v2 bisa ditutup saat market keluar range atau melewati durasi observasi.

4. `dashboard.js`
   - Menambahkan endpoint `/api/shadow-v2`.
   - Endpoint mengembalikan summary, recent cases, lokasi data table, dan aturan keamanan.

5. `public/index.html`
   - Panel Shadow v2 di `Shadow Engine` sekarang membaca data dari `/api/shadow-v2`.
   - Status, Truth PnL, Cases, Exit Route, Cluster Risk, dan Top Cause tidak lagi hardcoded.

6. `test/test-shadow-v2-engine.js`
   - Test baru untuk memastikan kandidat bersih menjadi `CLEAR`.
   - Kandidat berisiko harus menghasilkan warning.
   - Jika kandidat warning kemudian rugi/out-of-range, outcome harus `TRUE_WARNING` dan `truth_pnl_sol` positif.
   - Aturan v2 harus tetap `auto_deploy=false` dan `hard_gate=false`.

7. `document/shadow_v2.md`
   - Dokumentasi diperbarui dari konsep `STANDBY` menjadi implementasi `LEARNING`.
   - Menjelaskan file runtime, endpoint, sumber data, outcome, dan kapan v2 boleh dipakai.

## Alasan Perubahan

Perubahan ini perlu dilakukan karena Shadow v2 ditujukan sebagai edge besar: bukan sekadar melihat apakah filter lama terlalu ketat, tetapi menilai apakah kandidat yang terlihat bagus benar-benar aman dimasuki.

Edge yang ditargetkan:
- menghindari token yang terlihat `HOT` tetapi route jualnya tipis,
- membedakan momentum organik vs cluster/bundle-like movement,
- mendeteksi timing yang sudah telat setelah candle besar,
- memberi bukti apakah warning benar-benar menyelamatkan loss atau hanya membuat missed profit.

Namun v2 sengaja tetap shadow-only. Alasannya:
- data route/wallet/provider bisa incomplete,
- engine sudah cukup ketat sehingga hard gate baru bisa membuat trade makin jarang,
- warning belum boleh dianggap benar sebelum outcome muncul,
- impact baru valid setelah case ditutup.

## Apakah Ada Cacat Logika

Ada cacat logika sebelum perbaikan:
- dashboard memberi kesan Shadow v2 ada, padahal belum ada engine v2 aktif,
- tidak ada data `cases` untuk v2,
- tidak ada jalur update market untuk menutup outcome,
- tidak ada pemisahan antara warning potensial dan warning terbukti.

Perbaikan sekarang menutup cacat tersebut dengan collector dan outcome model, tetapi belum menjadikan v2 sebagai production gate.

## Dampak Terhadap Jumlah Trade

Perubahan ini tidak membuat aturan deploy lebih ketat sekarang, karena:
- `auto_deploy=false`,
- `hard_gate=false`,
- `production_learning=false`,
- v2 hanya mengamati dan menulis data.

Trade tidak seharusnya menjadi lebih jarang hanya karena Shadow v2 aktif. Risiko trade menjadi jarang baru muncul jika di masa depan v2 dinaikkan menjadi advisory/soft sizing/hard gate tanpa bukti cukup. Karena itu dokumen `shadow_v2.md` menetapkan syarat minimal case lengkap dan outcome tervalidasi sebelum v2 boleh mempengaruhi engine.

## Validasi Yang Perlu Dipantau

Metrik yang harus dicek setelah deploy:
- `cases` naik saat screening berjalan,
- `complete_cases` cukup tinggi,
- `data_incomplete_count` tidak mendominasi,
- `closed_cases` mulai naik setelah out-of-range atau 120 menit,
- `truth_pnl_sol` baru berubah setelah ada outcome,
- `TRUE_WARNING` lebih besar daripada `FALSE_ALARM` sebelum v2 dipertimbangkan menjadi advisory.

---

# Update 2026-06-05 - Adaptive OOR Masuk Shadow Dulu

## Temuan

Setelah dicek, trade hari ini sedikit bukan karena bot tidak punya kandidat. Cycle terbaru menemukan kandidat top seperti `WORLDCUP-USDC` dengan score 72 dan rekomendasi `BUY`, tetapi deploy diblok oleh anti-OOR guard karena:
- `MOMENTUM_BREAKOUT_UP`,
- recent fast OOR cluster,
- high recent OOR rate,
- OOR sudah menghasilkan repeated losses,
- active bin dekat upper edge.

Membuka guard secara mentah berisiko mengulang loss yang sama. Tetapi membuang semua kandidat juga bisa membuat bot terlalu diam.

## Perubahan

Adaptive OOR dimasukkan ke Shadow v2, bukan ke production engine.

File yang diubah:

1. `shadow/shadow_v2_engine.js`
   - Menambahkan adaptive shadow variants:
     - `widen_shift_up`
     - `wait_5m_recheck`
     - `second_chance_queue`
   - Variant tetap dipantau walaupun baseline case sudah close karena OOR.
   - Summary menambahkan adaptive impact:
     - `adaptive_impact_sol`
     - `adaptive_pnl_sol`
     - `adaptive_best_route`
     - `adaptive_by_variant`

2. `public/index.html`
   - Panel Shadow v2 menampilkan:
     - `Adaptive PnL`
     - `Best Route`

3. `test/test-shadow-v2-engine.js`
   - Test memastikan adaptive variant tetap jalan setelah baseline OOR close.
   - Test memastikan impact adaptive bisa dihitung terhadap baseline.

4. `document/shadow_adaptive_oor.md`
   - Dokumentasi khusus untuk adaptive OOR shadow.

## Alasan Perubahan

Ini termasuk pelonggaran perilaku jika langsung masuk engine, sehingga tidak boleh diterapkan ke deploy sekarang.

Dengan shadow-first:
- engine utama tetap aman,
- semua opsi adaptive bisa diukur,
- kita bisa tahu apakah wait/shift/widen benar-benar mengurangi loss,
- keputusan berikutnya berbasis impact, bukan asumsi.

## Risiko Sisa

- `widen_shift_up` bisa rugi jika breakout palsu.
- `wait_5m_recheck` bisa membuat entry telat.
- `second_chance_queue` bisa mengejar token exhausted.
- Impact belum boleh dipercaya sebelum ada cukup closed adaptive variants.

## Status

Perubahan ini shadow-only:
- `auto_deploy=false`
- `hard_gate=false`
- `production_learning=false`

Engine utama belum dilonggarkan.

---

# Update 2026-06-05 - Range / Anti-OOR Recheck Queue

## Dasar

File `argument_range_01.md` dianalisa dan sebagian besar argumennya valid. Bukti yang mendukung:
- OOR rate tinggi.
- OOR dominan ke atas.
- Anti-OOR mendeteksi `MOMENTUM_BREAKOUT_UP`.
- Kandidat bagus ada, tetapi diblok anti-OOR.
- `WIDEN_AND_SHIFT_UP` sudah muncul di anti-OOR intelligence, tetapi belum menjadi recheck nyata.

## Perubahan

1. `strategy/dlmm-edge.js`
   - Menambahkan `evaluateAntiOorRangeAdaptation`.
   - `WIDEN_AND_SHIFT_UP` pada single-side SOL tidak dipaksa menjadi bins_above ilegal.
   - Jika shift-up tidak legal, action menjadi `SHIFT_UP_NOT_SUPPORTED_FOR_SINGLE_SIDE_SOL`.

2. `lib/anti_oor_recheck_queue.js`
   - Modul baru untuk menyimpan kandidat yang diblok anti-OOR.
   - Queue menyimpan snapshot active bin, range, score, anti-OOR risk, dan final range action.

3. `tools/executor.js`
   - HIGH/CRITICAL anti-OOR tetap memblok deploy.
   - Kandidat yang diblok masuk queue recheck.
   - Decision log diperkaya dengan field range/OOR.

4. `tools/screening.js`
   - Screening cycle memproses due recheck queue.
   - Active bin dan market detail diambil ulang.
   - Anti-OOR dihitung ulang.
   - Hasil dicatat sebagai `STILL_CRITICAL`, `IMPROVED_TO_SANDBOX_CANDIDATE`, atau `DATA_UNAVAILABLE`.
   - Tidak ada auto-deploy dari recheck.

5. `decision-log.js`
   - Menyimpan field range/OOR top-level.

6. `lib/forensic_scanner.js`
   - Daily forensic menambahkan `range_failure_analysis`.

7. `test/test-anti-oor-range.js`
   - Test anti-OOR range + queue.

8. `test/test-dlmm-edge.js`
   - Test range planner.

## Alasan

Perbaikan ini membuat sistem tidak hanya `CRITICAL -> BLOCK`, tetapi:

`CRITICAL -> BLOCK + WAIT_RECHECK + FORENSIC_LOG`

Ini lebih aman daripada melonggarkan filter. Engine tetap tidak deploy saat CRITICAL, tetapi kandidat tidak hilang tanpa jejak.

## Risiko Sisa

- Queue recheck masih bergantung pada provider detail pool.
- `IMPROVED_TO_SANDBOX_CANDIDATE` belum auto-deploy; ini disengaja.
- `SHIFT_UP` belum legal untuk single-side SOL jika membutuhkan bins_above.
- Perlu beberapa cycle untuk melihat apakah recheck benar-benar menghasilkan kandidat yang lebih aman.

---

# Update 2026-06-05 20:52 WIB - Shadow v2 Truth Guard Masuk Engine

## Dasar

Shadow v2 menunjukkan impact defensif positif:
- `Truth PnL +0.304167 SOL`
- `665` cases
- `338` closed cases
- `146` true warning
- `63` false alarm
- top cause `exit_route_thin`

Adaptive route masih negatif:
- `Adaptive Impact -0.282932 SOL`
- `Adaptive PnL -3.402352 SOL`
- best route `none`

## Perubahan

1. `lib/shadow_v2_guard.js`
   - Modul baru untuk menerjemahkan truth warning Shadow v2 menjadi `PASS`, `PENALIZE`, atau `BLOCK`.

2. `tools/screening.js`
   - Shadow v2 guard diterapkan setelah pool scorer.
   - `WATCH/THIN` menurunkan score.
   - `HIGH/CRITICAL/NO_ROUTE/UNSTABLE` difilter sebelum shortlist final.

3. `tools/executor.js`
   - Shadow v2 guard menjadi pagar terakhir sebelum deploy.
   - Hard block dicatat ke decision log.

4. `config.js`
   - Menambahkan konfigurasi `shadowV2Guard`.

5. `test/test-shadow-v2-guard.js`
   - Test clean pass, thin penalty, high-risk block, dan data incomplete.

## Implikasi

Engine sekarang memakai Shadow v2 secara defensif.

Yang masuk engine:
- truth warning
- penalty untuk warning ringan
- hard block untuk warning berat

Yang belum masuk engine:
- `widen_shift_up`
- `wait_5m_recheck`
- `second_chance_queue`
- semua adaptive route

## Alasan

Perubahan ini tidak melonggarkan engine. Justru engine menjadi lebih selektif terhadap kandidat dengan exit route buruk. Ini sesuai bukti shadow karena impact positif berasal dari kemampuan menghindari kandidat buruk, bukan dari membuka entry baru.

## Risiko Sisa

- Trade bisa sedikit lebih jarang jika banyak kandidat berada di area `WATCH/THIN`.
- Karena `WATCH/THIN` hanya penalti, kandidat yang benar-benar kuat masih bisa lewat.
- Jika ingin lebih longgar, turunkan `shadowV2WatchPenalty` atau `shadowV2ThinRoutePenalty` di `user-config.json`.

---

# Update 2026-06-05 - Shadow v3 Wallet Rescue

## Dasar

Forensic terbaru menunjukkan `wallet_filter_too_strict` sebagai top false negative cause. Karena itu dibuat Shadow v3 untuk menguji apakah kandidat yang ditolak wallet filter memang seharusnya diselamatkan.

## Perubahan

1. `shadow/shadow_v3_wallet_rescue.js`
   - Modul baru untuk merekam dan menghitung simulasi wallet rescue.

2. `copy-engine/position-monitor.js`
   - Rejection `wallet_filter` direkam ke Shadow v3.
   - Observasi market berikutnya meng-update case Shadow v3 yang masih open.

3. `dashboard.js`
   - Menambahkan endpoint `/api/shadow-v3-wallet-rescue`.

4. `public/index.html`
   - Menambahkan panel `Shadow v3` di halaman Shadow Engine.

5. `test/test-shadow-v3-wallet-rescue.js`
   - Test record, win, truth block, dan summary.

## Alasan

Wallet filter belum boleh dilonggarkan live sebelum ada bukti. Shadow v3 membuat dugaan wallet rescue bisa dibuktikan dengan PnL dan false rescue count.

## Status

Shadow-only:
- tidak auto-deploy
- tidak hard gate
- tidak production learning

Promosi ke engine baru dipertimbangkan jika minimal `50` closed eligible cases, rescue PnL positif `> +0.10 SOL`, dan wins lebih banyak dari losses.
