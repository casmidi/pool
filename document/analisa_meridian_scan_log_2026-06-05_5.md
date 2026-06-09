# Analisa Meridian Scan Log 2026-06-05 (5)

Sumber file:

- `C:\Users\midip\Downloads\meridian_scan_log_2026-06-05 (5).json`
- Source internal: `scanning_log/daily/2026-06-05.json`
- Generated at: `2026-06-05T15:03:38.466Z`

## Ringkasan

Log ini menunjukkan bahwa masalah utama hari ini belum berubah: trade masih sangat sedikit, 1 trade yang tercatat masih loss, dan kandidat yang diblok masih banyak.

Angka utama:

- Total trades: `1`
- Profit: `0`
- Loss: `1`
- Profit factor: `0`
- Total blocked: `282`
- Total watch: `56`
- Good rejections: `33`
- False negatives: `49`
- Unclear: `256`
- Top false negative cause: `wallet_filter_too_strict`

## Apa Yang Terjadi

### 1. Loss Goblin-SOL Masih Loss Lama

Trade yang tercatat:

- Pool: `Goblin-SOL`
- Result: `LOSS`
- Loss reason: `paper_stop-loss`
- Logic failure stage: `anti_oor`
- Verdict: `Anti-OOR timing or momentum detection is the likely first failure point.`

Timeline:

1. `screening_copy`
2. `candidate_deployed`
3. `anti_oor_wait_5_min`
4. `deploy_bid_ask`
5. `paper_stop-loss`

Ini menguatkan analisa sebelumnya: loss ini bukan disebabkan perubahan Shadow v2 guard terbaru, karena problem awalnya ada di anti-OOR timing/momentum.

### 2. Anti-OOR Recheck Masih Belum Menemukan Kandidat Aman

Range failure analysis:

- `wait_recheck_count`: `5`
- `recheck_success_count`: `0`
- `recheck_still_critical_count`: `5`
- `shift_up_not_supported_count`: `5`
- `single_side_bins_above_violation_count`: `0`

Artinya queue recheck berjalan, tetapi semua kandidat yang dicek ulang tetap critical. Ini valid sebagai alasan kenapa engine belum membuka trade dari jalur anti-OOR. Sistem tidak diam; sistem menolak karena setelah ditunggu pun risiko masih tinggi.

### 3. Wallet Filter Menjadi Red Flag Baru

Top false negative:

- `wallet_filter_too_strict`: `49`

Ini penting karena jumlahnya besar. Forensic menganggap ada kandidat yang ditolak oleh wallet filter tetapi kemudian terlihat positif pada observasi berikutnya.

Namun export ini hanya membawa 50 item terbaru, dan 50 item terbaru masih `PENDING_OBSERVATION`. Jadi detail lengkap 49 false negative tidak semuanya ikut dalam file download ini. Walaupun begitu, summary harian cukup untuk memberi sinyal bahwa wallet filter perlu diperiksa lebih dalam.

## Apakah Shadow v2 Guard Membuat Trade Makin Sepi?

Dari file ini tidak terlihat bukti bahwa Shadow v2 guard menjadi penyebab trade sepi.

Alasan:

- Rejection sample tidak menunjukkan stage `shadow_v2_guard`.
- `top_false_negative_causes` masih `wallet_filter_too_strict`.
- Anti-OOR recheck tetap critical.
- Shadow v2 API VPS setelah dicek menunjukkan truth layer makin positif:
  - `Truth PnL +0.439660 SOL`
  - `Status CANDIDATE`
  - `True warning 179`
  - `False alarm 71`
  - `Adaptive Impact -0.516008 SOL`
  - `Adaptive Best Route none`

Kesimpulan: Shadow v2 guard bukan red flag utama pada log ini.

## Temuan Cacat Logika / Risiko

### Wallet Score Berpotensi Menjadi Veto Tunggal

Di `decision/analysis-engine.js`, wallet score di bawah minimum membuat keputusan langsung `SKIP` sebelum kualitas pool lain dihitung lebih jauh.

Ini aman untuk copy trading murni, tetapi bisa terlalu keras untuk engine hybrid karena:

- pool score bisa tinggi,
- fee/TVL bisa bagus,
- organic bisa bagus,
- route bisa layak,
- tetapi tetap ditolak karena wallet score.

Log ini memberi sinyal bahwa wallet filter mungkin terlalu dominan.

### Export Forensic Belum Cukup Detail

File download hanya menampilkan 50 rejection terbaru. Karena banyak item terbaru masih `PENDING_OBSERVATION`, kita tidak bisa melihat semua contoh false negative yang sudah matang.

Perlu improvement pada incident/forensic export:

- tampilkan top false negative examples,
- tampilkan matured observations,
- pisahkan pending vs mature,
- jangan hanya slice 50 terbaru.

## Rekomendasi Improvement

### Jangan Langsung Melonggarkan Wallet Filter Live

Belum disarankan langsung menurunkan threshold wallet filter secara live. Alasannya:

- false negative memang tinggi,
- tetapi sample detail lengkap belum ikut dalam export,
- wallet score tetap penting untuk menghindari copy dari wallet lemah,
- bot baru saja memasukkan Shadow v2 guard ke engine.

### Improvement Aman Yang Disarankan

Tahap berikutnya sebaiknya dibuat `wallet rescue shadow`, bukan live loosen.

Konsep:

- Jika wallet filter menolak kandidat, tetapi pool quality tinggi, kandidat masuk shadow rescue.
- Shadow rescue mengecek:
  - pool score,
  - organic,
  - fee/TVL,
  - Shadow v2 truth guard,
  - anti-OOR,
  - hasil 30m/1h/2h.
- Jika rescue shadow terbukti positif, baru wallet filter boleh diubah.

Dengan cara ini, sistem belajar apakah wallet filter benar-benar terlalu ketat tanpa langsung menambah risiko loss.

## Keputusan Saat Ini

Belum ada perubahan engine baru dari file ini.

Alasannya:

- Red flag wallet filter valid, tetapi butuh pembuktian shadow lebih spesifik.
- Anti-OOR recheck masih menolak semua kandidat karena tetap critical.
- Shadow v2 truth guard justru makin positif.
- Adaptive route masih negatif dan tetap tidak boleh masuk engine.

## Kesimpulan

Log ini memberi sinyal kuat bahwa trade sedikit bukan karena Shadow v2 guard. Penyebab yang lebih dominan:

1. Anti-OOR recheck tetap critical.
2. Wallet filter berpotensi terlalu ketat.
3. Banyak rejection masih unclear/pending.

Langkah terbaik berikutnya adalah membuat `wallet rescue shadow` dan memperbaiki export forensic agar false negative yang matang terlihat jelas.
