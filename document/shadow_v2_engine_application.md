# Shadow v2 Engine Application

Tanggal aplikasi: `2026-06-05 20:52 WIB`

## Jawaban Singkat

Shadow v2 mulai diaplikasikan ke engine sekarang, tetapi hanya bagian `truth warning` yang masuk. Bagian adaptive route belum diaplikasikan karena hasil shadow masih negatif.

## Dasar Keputusan

Snapshot Shadow v2 sebelum aplikasi engine:

- Status: `CANDIDATE`
- Truth PnL: `+0.304167 SOL`
- Cases: `665`
- Closed cases: `338`
- True warning: `146`
- False alarm: `63`
- Missed risk: `38`
- Top cause: `exit_route_thin`
- Adaptive Impact: `-0.282932 SOL`
- Adaptive PnL: `-3.402352 SOL`
- Adaptive Best Route: `none`

Interpretasi:

- Truth layer sudah memberi nilai defensif positif.
- Adaptive route belum memberi nilai positif.
- Perubahan engine harus bersifat defensif, bukan melonggarkan entry.

## File Yang Diubah

- `lib/shadow_v2_guard.js`
- `tools/screening.js`
- `tools/executor.js`
- `config.js`
- `test/test-shadow-v2-guard.js`

## Detail Perubahan

### `lib/shadow_v2_guard.js`

File baru untuk mengubah hasil `analyzePreTradeTruth` menjadi keputusan engine yang bisa dipakai ulang.

Output utama:

- `PASS`
- `PENALIZE`
- `BLOCK`

Aturan default:

- `CLEAR`: tidak ada penalti
- `WATCH`: penalti score
- `THIN`: penalti score
- `HIGH`: hard block
- `CRITICAL`: hard block
- `NO_ROUTE`: hard block
- `UNSTABLE`: hard block
- data tidak lengkap: tidak hard block dan tidak penalti

Alasan desain:

- Shadow v2 sudah positif, tetapi belum sempurna.
- `exit_route_thin` sering menjadi sinyal risiko, tetapi tidak semua thin route harus langsung diblok.
- Hard block hanya dipakai untuk warning berat agar trade tidak menjadi terlalu jarang.

### `tools/screening.js`

Shadow v2 guard diterapkan setelah pool scorer dan sebelum `minPoolScore` gate.

Implikasi:

- Candidate dengan warning Shadow v2 turun ranking.
- Candidate `WATCH/THIN` masih bisa lewat jika score awal cukup kuat.
- Candidate `HIGH/CRITICAL` atau route `NO_ROUTE/UNSTABLE` akan difilter.
- LLM/agent tidak lagi melihat kandidat yang sudah jelas buruk menurut Shadow v2.

### `tools/executor.js`

Shadow v2 guard juga diterapkan sebagai pagar terakhir sebelum deploy.

Implikasi:

- Jika candidate masuk dari jalur lain, executor tetap mengecek Shadow v2.
- Jika warning berat terdeteksi, deploy diblok dan dicatat ke `decision-log`.
- Jika hanya `WATCH/THIN`, executor tidak memblok, tetapi metadata guard ikut tersimpan di args.

### `config.js`

Ditambahkan konfigurasi:

- `shadowV2GuardEnabled`
- `shadowV2GuardEnforce`
- `shadowV2HardBlockLevels`
- `shadowV2HardBlockExitRoutes`
- `shadowV2WatchPenalty`
- `shadowV2HighPenalty`
- `shadowV2CriticalPenalty`
- `shadowV2ThinRoutePenalty`
- `shadowV2UnstableRoutePenalty`
- `shadowV2NoRoutePenalty`
- `shadowV2MaxPenalty`

Default aktif:

- guard enabled
- enforce enabled
- hard block hanya untuk `HIGH`, `CRITICAL`, `NO_ROUTE`, `UNSTABLE`
- `WATCH/THIN` hanya penalti score

## Apakah Membuat Trade Terlalu Jarang?

Tidak seharusnya terlalu ketat karena `exit_route_thin` tidak langsung hard block. Kandidat yang masih kuat tetap bisa lewat.

Yang akan berkurang adalah kandidat yang kualitas exit route-nya buruk atau warning-nya berat. Ini sesuai bukti Shadow v2 karena impact positif berasal dari kemampuan menahan kandidat berisiko, bukan dari membuka lebih banyak entry.

## Risiko Perubahan

Risiko utama:

- Jika data liquidity/volume tidak akurat, candidate bagus bisa terkena penalti.
- Jika `minPoolScore` terlalu tinggi, penalti `WATCH/THIN` bisa membuat trade semakin jarang.

Mitigasi:

- Data tidak lengkap tidak dihukum.
- `WATCH/THIN` hanya penalti, bukan hard block.
- Semua angka penalti bisa diatur lewat `user-config.json`.
- Adaptive route tetap shadow dan belum mempengaruhi engine.

## Validasi

Test lokal:

- `node D:\meridian-bot\test\test-shadow-v2-guard.js`
- `node D:\meridian-bot\test\test-shadow-v2-engine.js`
- `node -c D:\meridian-bot\tools\screening.js`
- `node -c D:\meridian-bot\tools\executor.js`
- `node -c D:\meridian-bot\lib\shadow_v2_guard.js`

Semua validasi lulus.

## Kesimpulan

Shadow v2 sudah diaplikasikan ke engine pada tahap defensif.

Yang masuk engine:

- truth warning
- score penalty untuk warning ringan
- hard block untuk warning berat
- logging keputusan di executor

Yang belum masuk engine:

- `widen_shift_up`
- `wait_5m_recheck`
- `second_chance_queue`
- semua adaptive route yang masih negatif
