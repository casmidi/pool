# Shadow v2 - Pre-Trade Truth Layer

Tanggal: 2026-06-05

## Status Saat Ini

Shadow v2 adalah layer observasi kedua di dalam panel `Shadow Engine`.

Status saat ini: `LEARNING`

Shadow v2 sudah memiliki backend collector dan endpoint dashboard. Shadow v2 belum mempengaruhi engine utama, belum menjadi hard gate, dan belum melakukan auto-deploy. Tujuannya adalah mengumpulkan bukti tambahan sebelum sebuah konsep risk/truth dipakai untuk keputusan trading.

File runtime yang aktif:
- `shadow/shadow_v2_engine.js`
- `data/shadow_v2_cases.json`
- `data/shadow_v2_summary.json`
- endpoint dashboard `/api/shadow-v2`

## Tujuan Utama

Shadow v2 dibuat untuk menjawab pertanyaan yang belum cukup dijawab oleh scoring, AI reasoning, dan Shadow v1:

1. Jika kandidat terlihat bagus, apakah token benar-benar bisa dijual lagi?
2. Apakah pembeli awal organik atau dikendalikan cluster wallet tertentu?
3. Apakah ada indikasi dev/funder/insider yang bisa dump setelah momentum muncul?
4. Apakah entry akan terlalu telat karena candle sudah bergerak besar?
5. Apakah rejection engine saat ini benar-benar salah, atau justru menyelamatkan modal?

Dengan kata lain, Shadow v2 bukan mencari sinyal baru untuk langsung beli. Shadow v2 mencari kebenaran pre-trade sebelum engine percaya pada sinyal.

## Perbedaan Shadow v1 dan Shadow v2

### Shadow v1

Shadow v1 fokus pada rejection replay.

Yang dipantau:
- kandidat yang ditolak engine,
- alasan reject,
- apakah setelah 5m/30m/1h/2h ternyata kandidat itu naik atau turun,
- apakah reject tersebut termasuk good rejection, false negative, atau neutral.

Shadow v1 menjawab:

> Apakah filter kita terlalu ketat atau sudah benar?

### Shadow v2

Shadow v2 fokus pada pre-trade truth.

Yang dipantau:
- exit route sebelum entry,
- slippage simulasi jual,
- liquidity real yang bisa dipakai keluar,
- wallet cluster pembeli awal,
- relasi funder/dev/early buyer,
- rapid-buy atau bundle-like behavior,
- konsentrasi supply,
- apakah volume terlihat organik atau hanya loop/cluster.

Shadow v2 menjawab:

> Apakah kandidat ini benar-benar aman untuk dimasuki sebelum engine mengambil risiko?

## Dasar Data Yang Akan Digunakan

### 1. Exit Route Preflight

Dasar:
- simulasi route jual sebelum entry,
- estimasi slippage,
- ada/tidaknya route keluar,
- liquidity yang benar-benar bisa menyerap posisi,
- perubahan route setelah 5m/30m/1h.

Alasan:
- Banyak token terlihat `HOT`, tetapi tidak mudah dijual.
- Entry yang profitable di chart bisa tetap rugi jika sell route buruk.
- Untuk sistem dry-run/live, kemampuan exit lebih penting daripada sekadar candle hijau.

Output yang diharapkan:
- `exit_route_status`: `OK`, `THIN`, `NO_ROUTE`, `UNSTABLE`
- `sell_slippage_pct`
- `route_liquidity_usd`
- `exit_truth_score`

### 2. Insider / Wallet Cluster Graph

Dasar:
- wallet pembeli awal,
- relasi funder antar wallet,
- wallet yang beli token yang sama dalam waktu sangat dekat,
- wallet baru yang sumber dananya sama,
- konsentrasi supply di cluster,
- dev/funder yang berhubungan dengan pembeli awal.

Alasan:
- Banyak pool/token terlihat organik karena volume naik, padahal volume berasal dari cluster yang sama.
- Kompetitor yang kuat biasanya tidak hanya membaca chart, tetapi membaca struktur wallet.
- Wallet graph bisa membantu membedakan momentum organik vs momentum buatan.

Output yang diharapkan:
- `cluster_risk`: `LOW`, `MEDIUM`, `HIGH`, `CRITICAL`
- `early_buyer_concentration_pct`
- `shared_funder_count`
- `new_wallet_ratio`
- `insider_truth_score`

### 3. Dev / Funder / Supply Risk

Dasar:
- dev wallet,
- creator/funder wallet,
- supply concentration,
- holder distribution,
- dev sold / dev still holding,
- top holder movement setelah listing.

Alasan:
- Risk rug terbesar pada token baru sering bukan kurang momentum, tetapi dump dari pihak yang menguasai supply.
- Filter biasa bisa melihat liquidity dan volume, tetapi belum tentu melihat siapa yang mengendalikan supply.

Output yang diharapkan:
- `dev_risk`: `LOW`, `MEDIUM`, `HIGH`, `CRITICAL`
- `top_holder_concentration_pct`
- `dev_wallet_activity`
- `supply_truth_score`

### 4. Bundle / Rapid Buy Suspicion

Dasar:
- banyak buy dalam window waktu sangat pendek,
- pattern wallet baru,
- transaksi dengan sumber dana mirip,
- kemungkinan bundle-like entry,
- buy pressure yang terlalu sinkron.

Alasan:
- Candle awal yang terlihat kuat bisa berasal dari coordinated buys.
- Jika engine masuk setelah coordinated pump, engine sering menjadi exit liquidity.

Output yang diharapkan:
- `bundle_suspicion`: `LOW`, `MEDIUM`, `HIGH`
- `rapid_buy_count`
- `same_slot_or_short_window_buys`
- `coordinated_buy_score`

### 5. Momentum Timing Truth

Dasar:
- 5m change,
- 15m/1h change,
- candle body,
- high-from-entry,
- pullback setelah peak,
- apakah kandidat `HOT` masih awal atau sudah telat.

Alasan:
- Contoh seperti `RECLAIM_READY` menunjukkan token bisa panas tetapi sudah naik terlalu jauh.
- Shadow v2 harus membedakan `HOT awal` vs `HOT telat`.

Output yang diharapkan:
- `timing_status`: `EARLY`, `VALID`, `LATE`, `EXHAUSTED`
- `late_after_big_move`
- `pullback_risk_pct`
- `timing_truth_score`

## Kenapa Harus Shadow Dulu

Shadow v2 tidak boleh langsung dipasang sebagai engine utama karena risikonya besar.

Alasan:

1. Data provider bisa noisy.
   - Wallet graph, route, dan holder data bisa delay atau incomplete.
   - Jika langsung hard block, sistem bisa menolak kandidat bagus karena data belum lengkap.

2. Bisa membuat trade terlalu jarang.
   - Engine saat ini sudah lebih ketat setelah perbaikan anti-OOR.
   - Menambah truth gate langsung ke deploy bisa membuat opportunity hilang sebelum kita tahu akurasinya.

3. Butuh pembuktian outcome.
   - Shadow v2 harus dibandingkan dengan hasil 5m/30m/1h/2h.
   - Tanpa outcome, semua label hanya dugaan.

4. Harus mencegah false learning.
   - Pelajaran dari forensic log: false negative tidak boleh dihitung sebelum ada observasi.
   - Shadow v2 juga harus memakai prinsip yang sama.

## Kapan Shadow v2 Digunakan

Shadow v2 digunakan pada tahap pre-trade, tetapi hanya sebagai observasi.

Dipakai saat:

1. Kandidat masuk shortlist screening.
2. Kandidat mendapat label menarik seperti `HOT`, `WATCH`, `RECLAIM_READY`, atau skor tinggi.
3. Kandidat ditolak oleh wallet filter, range filter, fee filter, organic filter, atau anti-OOR.
4. Kandidat hampir lolos deploy tetapi masih ada warning.
5. Ada token baru dengan momentum besar dan risiko telat masuk.

Shadow v2 akan menyimpan snapshot truth sebelum entry/reject, lalu membandingkan dengan outcome setelah beberapa waktu.

Window observasi:
- 5 menit
- 30 menit
- 1 jam
- 2 jam

Implementasi awal menutup case saat:
- pool keluar dari range DLMM yang disimulasikan,
- atau durasi observasi mencapai 120 menit.

Jika data market belum lengkap, case tetap dicatat tetapi ditandai `data_complete=false`. Case seperti ini tidak boleh dianggap bukti final untuk memperketat atau melonggarkan engine.

## Implementasi Yang Sudah Diterapkan

### 1. Truth Analyzer

File: `shadow/shadow_v2_engine.js`

Fungsi utama:
- `analyzePreTradeTruth(pool)`
- `recordShadowV2Candidate(pool, context)`
- `updateShadowV2FromMarket(pool)`
- `observeShadowV2Candidate(pool, context)`
- `buildShadowV2Payload({ date, limit })`

Analyzer membaca kandidat pool dan menghasilkan:
- `truth_score`
- `warning_level`: `CLEAR`, `WATCH`, `HIGH`, `CRITICAL`
- `exit_route.status`: `OK`, `THIN`, `NO_ROUTE`, `UNSTABLE`
- `cluster_risk.status`: `LOW`, `MEDIUM`, `HIGH`, `CRITICAL`
- `dev_risk.status`: `LOW`, `MEDIUM`, `HIGH`, `CRITICAL`
- `timing_truth.status`: `EARLY`, `VALID`, `LATE`, `EXHAUSTED`
- `data_completeness`
- daftar `warnings`

### 2. Data Collector

File yang mengirim kandidat ke Shadow v2:
- `tools/screening.js`
- `copy-engine/position-monitor.js`

Alasan dua sumber ini dipakai:
- `tools/screening.js` melihat kandidat sebelum keputusan deploy/reject, sehingga v2 bisa menilai pool yang lolos maupun yang tertahan oleh score gate.
- `tools/screening.js` juga mencatat `screening_early_eligible` sebelum enrichment OKX/indicator selesai. Ini membuat v2 tetap aktif sebagai forensic layer saat provider eksternal sedang lambat, 429, atau circuit breaker.
- `copy-engine/position-monitor.js` membawa update market/bin dari copy engine, sehingga v2 bisa menutup case saat market bergerak keluar range.

### 3. Dashboard API

File: `dashboard.js`

Endpoint:
- `/api/shadow-v2`

Payload berisi:
- `summary`
- `cases`
- lokasi table data
- aturan keamanan bahwa v2 masih `auto_deploy=false`, `hard_gate=false`, dan `production_learning=false`.

### 4. Panel Shadow Engine

File: `public/index.html`

Panel Shadow v2 sekarang tidak lagi hardcoded `STANDBY`. Nilai yang tampil berasal dari `/api/shadow-v2`:
- status,
- truth PnL,
- jumlah case,
- top exit route,
- top cluster risk,
- top cause.

### 5. Adaptive OOR Shadow

File: `shadow/shadow_v2_engine.js`

Shadow v2 sekarang juga membuat simulasi adaptive untuk kandidat yang menarik tetapi berisiko OOR.

Variant yang dicatat:
- `widen_shift_up`
- `wait_5m_recheck`
- `second_chance_queue`

Tujuannya bukan melonggarkan engine sekarang, tetapi mengukur apakah opsi seperti geser range ke atas, tunggu 5 menit, atau second-chance queue benar-benar memberi impact positif.

Metrik adaptive:
- `adaptive_shadow_cases`
- `adaptive_open_variants`
- `adaptive_closed_variants`
- `adaptive_impact_sol`
- `adaptive_pnl_sol`
- `adaptive_best_route`
- `adaptive_best_impact_sol`
- `adaptive_by_variant`

Aturan:
- tetap `auto_deploy=false`,
- tetap `hard_gate=false`,
- tetap `production_learning=false`.

Adaptive variant tetap bisa dipantau walaupun baseline Shadow v2 sudah close karena OOR. Ini penting karena pertanyaan yang diuji adalah: jika baseline keluar range, apakah range yang dilebarkan/digeser atau entry yang ditunda akan lebih baik setelah observasi penuh?

## Cara Impact Dihitung

Shadow v2 tidak menghitung impact hanya karena ada warning. Impact baru dihitung setelah case punya outcome.

Outcome:
- `TRUE_WARNING`: v2 memberi warning dan kandidat kemudian rugi. Ini dihitung sebagai loss yang berhasil dihindari.
- `FALSE_ALARM`: v2 memberi warning tetapi kandidat kemudian profit. Ini dihitung sebagai peluang profit yang hilang.
- `MISSED_RISK`: v2 tidak memberi warning tetapi kandidat kemudian rugi. Ini negatif untuk v2.
- `CLEAN_PASS`: v2 tidak memberi warning dan kandidat profit.
- `NEUTRAL`: pergerakan terlalu kecil.
- `DATA_INCOMPLETE`: data tidak cukup untuk disimpulkan.

Karena itu `truth_pnl_sol` bisa tetap `+0.0000 SOL` walaupun `cases` naik. Itu normal jika case masih `OPEN` atau data belum lengkap.

## Kapan Shadow v2 Boleh Mempengaruhi Engine

Shadow v2 boleh naik kelas secara bertahap jika sudah punya bukti cukup.

### Tahap 1 - Dashboard Only

Status: default saat ini.

Efek:
- hanya tampil di dashboard,
- tidak memblokir deploy,
- tidak mengubah size,
- tidak mengubah confidence.

Syarat lanjut:
- minimal 50-100 case dengan data lengkap,
- ada outcome setelah 30m/1h/2h,
- metrik truth score mulai stabil.

### Tahap 2 - Advisory Warning

Efek:
- alasan deploy/reject menampilkan warning Shadow v2,
- AI/agent boleh membaca sinyal ini,
- engine belum otomatis blok.

Contoh:
- `exit_route_thin`
- `cluster_risk_high`
- `hot_late_after_big_move`
- `dev_wallet_active`

Syarat lanjut:
- warning `HIGH/CRITICAL` terbukti sering mendahului rug atau pullback.

### Tahap 3 - Soft Sizing

Efek:
- jika Shadow v2 mendeteksi risiko tinggi, size dikurangi.
- contoh: deploy 0.1 SOL menjadi 0.05 SOL.

Contoh aturan:
- `cluster_risk=HIGH` -> size x 0.5
- `exit_route=THIN` -> size x 0.5
- `timing_status=LATE` -> size x 0.5

Syarat lanjut:
- soft sizing terbukti mengurangi drawdown tanpa menghilangkan terlalu banyak profit.

### Tahap 4 - Hard Block Ekstrem

Efek:
- hanya sinyal ekstrem yang boleh memblokir deploy.

Contoh hard block:
- `NO_ROUTE`
- `cluster_risk=CRITICAL`
- `dev_cluster_dumping`
- `honeypot_like`
- `sell_slippage` di atas threshold ekstrem

Syarat:
- minimal 100+ case tervalidasi,
- false block rendah,
- impact terhadap loss prevention jelas.

## Metrik Yang Harus Dipantau

Shadow v2 harus punya metrik sendiri:

- `truth_cases`
- `complete_cases`
- `incomplete_cases`
- `truth_pnl_sol`
- `avoided_loss_estimate`
- `missed_profit_estimate`
- `exit_route_fail_rate`
- `cluster_risk_hit_rate`
- `hard_block_candidate_count`
- `false_block_estimate`
- `top_truth_cause`

Metrik penting:

1. Complete case ratio
   - Jika banyak data incomplete, Shadow v2 belum layak jadi gate.

2. Hit rate per cause
   - Misalnya `cluster_risk_high` benar-benar rug berapa persen.

3. Avoided loss vs missed profit
   - Guard bagus bukan hanya banyak blok, tetapi blok yang menyelamatkan lebih besar daripada profit yang hilang.

4. Time-to-truth
   - Berapa lama sampai outcome jelas: 5m, 30m, 1h, atau 2h.

## Prinsip Keputusan

Shadow v2 harus mengikuti prinsip berikut:

1. Evidence before enforcement.
   - Tidak ada hard block tanpa bukti outcome.

2. No single weak signal.
   - Satu warning kecil tidak boleh memblokir.

3. Extreme risk can be special.
   - `NO_ROUTE` dan `CRITICAL cluster` boleh dipertimbangkan lebih cepat, tetapi tetap harus mulai dari advisory.

4. Separate potential from proven.
   - Sama seperti forensic false negative, kandidat menarik tidak otomatis benar.

5. Protect capital first.
   - Tujuan Shadow v2 adalah mencegah masuk ke token yang tidak bisa keluar atau dikendalikan insider.

## Risiko Jika Salah Diterapkan

Jika Shadow v2 langsung dipakai sebagai hard gate:

- trade bisa terlalu jarang,
- kandidat bagus bisa terblokir karena data provider delay,
- engine bisa terlalu defensif,
- false block meningkat,
- sistem belajar dari data incomplete.

Karena itu Shadow v2 harus dimulai sebagai shadow-only.

## Kesimpulan

Shadow v2 adalah layer kebenaran pre-trade. Ia bukan pengganti Shadow v1, tetapi pelengkap.

Shadow v1 menjawab:

> Apakah filter lama terlalu ketat?

Shadow v2 menjawab:

> Apakah kandidat yang terlihat bagus benar-benar aman untuk dimasuki?

Kapan digunakan:
- mulai sekarang sebagai dashboard learning/observasi,
- backend truth collector sudah dibuat,
- hanya boleh mempengaruhi engine setelah cukup case dan outcome tervalidasi.

Prioritas implementasi berikutnya:

1. Memperkaya data route jual dengan provider route yang lebih presisi.
2. Memperkaya wallet cluster graph dari transaksi early buyer.
3. Menambah dev/funder movement yang lebih real-time.
4. Mengukur hit-rate per warning setelah minimal 50-100 case lengkap.
5. Baru setelah itu mempertimbangkan advisory warning atau soft sizing.
