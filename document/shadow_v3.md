# Shadow v3 - Wallet Rescue

## Tujuan

Shadow v3 dibuat untuk menguji dugaan bahwa `wallet_filter_too_strict` membuat bot kehilangan kandidat bagus.

Versi ini tidak membuka trade dan tidak mengubah engine live. Semua hasil bersifat shadow-only.

## Dasar Dibuat

Forensic log `meridian_scan_log_2026-06-05 (5).json` menunjukkan:

- total trades hari ini hanya `1`
- trade tersebut loss
- `false_negatives: 49`
- top false negative cause: `wallet_filter_too_strict`
- anti-OOR recheck masih `0/5` success
- Shadow v2 truth layer positif, adaptive route negatif

Kesimpulan awal:

- masalah trade sepi bukan karena Shadow v2 guard,
- wallet filter kemungkinan menjadi veto tunggal,
- tetapi wallet filter tidak boleh langsung dilonggarkan live tanpa bukti impact.

## Apa Yang Diuji

Shadow v3 merekam kandidat yang ditolak karena:

- `wallet_filter`
- `low_wallet_score`
- reason yang menyebut wallet score rendah

Kemudian Shadow v3 bertanya:

> Jika wallet veto dilewati, apakah kandidat ini menghasilkan simulasi positif atau malah rugi?

## Cara Kerja

1. Copy engine membuat keputusan.
2. Jika keputusan ditolak karena wallet filter, Shadow v3 merekam kandidat.
3. Shadow v3 mengecek apakah kandidat layak rescue:
   - candidate/pool score minimal `70`, atau
   - organic minimal `70` dan fee/TVL minimal `0.02`
4. Shadow v3 menjalankan Shadow v2 truth guard.
5. Jika Shadow v2 hard block, kandidat tetap dicatat tetapi tidak dihitung eligible.
6. Jika eligible, kandidat dipantau sebagai simulasi rescue.
7. Saat harga/bin berubah atau umur case cukup, case ditutup sebagai:
   - `RESCUE_WIN`
   - `RESCUE_LOSS`
   - `NEUTRAL`
   - `TRUTH_BLOCKED`
   - `NOT_ELIGIBLE`

## File Yang Dibuat / Diubah

- `shadow/shadow_v3_wallet_rescue.js`
- `copy-engine/position-monitor.js`
- `dashboard.js`
- `public/index.html`
- `test/test-shadow-v3-wallet-rescue.js`
- `document/shadow_v3.md`

## File Data

Shadow v3 menyimpan data ke:

- `data/shadow_v3_wallet_rescue_cases.json`
- `data/shadow_v3_wallet_rescue_summary.json`

Endpoint dashboard:

- `/api/shadow-v3-wallet-rescue`

## Panel Dashboard

Shadow v3 tampil di menu kiri `Shadow Engine`.

Metric utama:

- `Status`
- `Rescue PnL`
- `Cases`
- `Eligible`
- `Wins / Losses`
- `False Rescue`
- `Truth Block`
- `Top Cause`

## Status dan Promosi

Status default: `LEARNING`

Status bisa naik ke `WATCH` jika:

- minimal `30` closed eligible cases

Status bisa naik ke `CANDIDATE` jika:

- minimal `50` closed eligible cases
- `rescue_pnl_sol > +0.10 SOL`
- rescue wins lebih banyak dari rescue losses

## Kapan Dipakai Ke Engine

Shadow v3 belum dipakai ke engine live sekarang.

Wallet rescue boleh dipertimbangkan masuk engine hanya jika:

- closed eligible sample cukup,
- Rescue PnL positif,
- false rescue tidak dominan,
- kandidat rescue tidak diblok Shadow v2 truth guard,
- anti-OOR tidak critical,
- hasil stabil beberapa cycle.

Jika lolos, bentuk engine-nya nanti bukan full override. Bentuk aman:

- soft override,
- size kecil,
- wajib Shadow v2 `CLEAR/WATCH`,
- anti-OOR `LOW/MEDIUM`,
- tetap dicatat forensic.

## Kenapa Tidak Langsung Live

Wallet filter adalah guard penting. Jika langsung dilonggarkan:

- bot bisa mengikuti wallet lemah,
- kandidat bisa terlihat bagus sesaat tetapi buruk secara sumber,
- loss bisa bertambah,
- sulit tahu apakah perbaikan berasal dari wallet rescue atau kebetulan market.

Shadow v3 membuat keputusan berbasis evidence, bukan tebakan.

## Kesimpulan

Shadow v3 adalah eksperimen khusus untuk membuktikan atau membantah dugaan `wallet_filter_too_strict`.

Jika hasilnya positif, barulah wallet rescue menjadi kandidat perubahan engine. Jika negatif, dugaan ini dibantah dan wallet filter tetap dipertahankan.

## Validasi Awal VPS

Setelah deploy dan satu siklus copy-engine:

- `cases: 17`
- `eligible_cases: 0`
- `truth_blocked_count: 17`
- top cause: `shadow_v2_truth_block`

Interpretasi awal:

- low wallet score memang banyak muncul,
- tetapi 17 kandidat pertama belum layak rescue karena Shadow v2 melihat route/truth risk,
- ini belum membuktikan wallet filter terlalu ketat,
- Shadow v3 harus menunggu lebih banyak kasus dan closed eligible sample.
