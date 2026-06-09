# Shadow Intelligence

Tanggal implementasi: 2026-06-04
Mode: report-only / observation-only
Target dashboard: pool.quantum.or.id

## Tujuan

Shadow Intelligence dibuat untuk mengukur opportunity yang mungkin terlewat karena kandidat pool ditolak oleh filter.

Fitur ini tidak mengganti keputusan engine utama. Ia hanya mencatat kandidat yang ditolak, membuat paper position, menghitung paper PnL, lalu membandingkan hasil shadow dengan real PnL.

Tujuan utamanya:

- Melihat apakah filter terlalu ketat.
- Mengukur missed PnL dari kandidat `FALSE_NEGATIVE`.
- Memisahkan rejection yang benar dari rejection yang mungkin terlalu defensif.
- Memberi bukti sebelum tuning wallet filter atau decision filter.
- Menjaga production engine tetap stabil.

## Larangan Penting

Shadow Intelligence tidak boleh:

- Mengubah keputusan deploy utama.
- Mengubah wallet filter.
- Mengubah decision filter.
- Mengubah threshold existing.
- Melakukan auto-deploy.
- Melakukan auto-learning ke production.
- Mengubah strategi live/dry-run yang sedang berjalan.

Output shadow hanya untuk laporan dan analisa.

## Flow

1. Copy engine atau forensic scanner mencatat kandidat yang ditolak.
2. Shadow engine menerima kandidat rejection.
3. Kandidat dicek major risk.
4. Jika lolos major risk guard, dibuat shadow position `OPEN`.
5. Saat pool yang sama terlihat lagi, shadow engine update harga/bin.
6. Paper PnL dihitung.
7. Jika keluar range atau melewati max duration, shadow position ditutup.
8. Hasil diklasifikasikan:
   - `FALSE_NEGATIVE`
   - `GOOD_REJECTION`
   - `NEUTRAL`
9. Shadow summary menghitung impact terhadap real PnL.
10. Dashboard menampilkan panel Shadow Intelligence.

## Kandidat Yang Dilacak

Shadow hanya melacak kandidat rejection dari:

- `FALSE_NEGATIVE`
- `UNCLEAR`
- `wallet_filter`
- `decision_filter`

Kandidat dari filter lain tidak menjadi prioritas shadow, kecuali sudah dinormalisasi sebagai decision rejection.

## Major Risk Guard

Kandidat tidak dimasukkan ke shadow jika mengandung major risk:

- Rug risk tinggi.
- TVL terlalu kecil.
- Liquidity terlalu kecil.
- Invalid price feed.
- Mint authority risk.
- Freeze authority risk.
- Spread abnormal.
- Dangerous/thin liquidity marker.

Tujuannya agar shadow tidak mempromosikan pool yang memang seharusnya dibuang.

## Database / Table

Project ini memakai banyak file JSON sebagai runtime database. Shadow memakai dua JSON table:

```text
data/shadow_positions.json
data/shadow_daily_summary.json
```

### `shadow_positions`

Menyimpan semua paper position shadow.

Field utama:

- `pool_name`
- `pool_address`
- `pair`
- `created_at`
- `reject_stage`
- `reject_reason`
- `verdict`
- `likely_cause`
- `entry_price`
- `active_bin`
- `range_lower_bin`
- `range_upper_bin`
- `simulated_size_sol`
- `wallet_score`
- `fee_tvl_ratio`
- `volatility_pct`
- `decision_score`
- `status`

Field tambahan:

- `current_price`
- `current_active_bin`
- `pnl_pct`
- `pnl_sol`
- `out_of_range`
- `close_reason`
- `closed_at`

### `shadow_daily_summary`

Menyimpan ringkasan harian.

Field utama:

- `real_pnl_sol`
- `shadow_pnl_sol`
- `simulated_total_pnl_sol`
- `impact_ratio_pct`
- `shadow_cases`
- `false_negative_count`
- `good_rejection_count`
- `top_root_cause`
- `status`

## Paper PnL

Shadow PnL dihitung dari pergerakan harga/bin.

Jika harga tersedia:

```text
pnl_pct = (current_price - entry_price) / entry_price * 100
```

Jika harga tidak tersedia tetapi bin tersedia:

```text
pnl_pct = ((1 + bin_step / 10000) ^ bin_delta - 1) * 100
```

Paper PnL SOL:

```text
pnl_sol = simulated_size_sol * pnl_pct / 100
```

## Close Rule

Shadow position ditutup jika:

- Current active bin keluar dari `range_lower_bin` / `range_upper_bin`.
- Max duration tercapai.

Default max duration:

```text
180 menit
```

## Klasifikasi Hasil

Setelah shadow position ditutup:

### `FALSE_NEGATIVE`

Kandidat profit dan tidak OOR.

Makna:

Filter kemungkinan terlalu ketat.

### `GOOD_REJECTION`

Kandidat rugi atau OOR.

Makna:

Filter benar menolak kandidat.

### `NEUTRAL`

Hasil mendekati nol.

Makna:

Tidak cukup bukti untuk menaikkan atau menurunkan filter.

## Status Dashboard

Status dihitung dari sample dan impact:

```text
LEARNING  = sample < 100
WATCH     = sample >= 100 dan impact >= 10%
CANDIDATE = sample >= 100, impact >= 25%, false negative >= 20
READY     = sample >= 100, impact >= 40%, false negative >= 30, shadow pnl positif
```

Makna status:

- `LEARNING`: data belum cukup.
- `WATCH`: mulai menarik, tapi belum cukup untuk tuning.
- `CANDIDATE`: layak dianalisa serius.
- `READY`: cukup kuat untuk dipertimbangkan masuk rencana tuning, tetap tidak otomatis mengubah engine.

## Dashboard

Panel berada di Overview, tepat di bawah panel PNL.

Isi panel:

- Status.
- Shadow PnL.
- Impact Ratio.
- Cases.
- False Negative.
- Top Root Cause.

API:

```text
GET /api/shadow-intelligence
```

## Telegram

Command:

```text
/shadow
```

Isi command:

- Status.
- Shadow PnL.
- Real PnL.
- Impact.
- Cases.
- False Negative.
- Good Rejection.
- Top Cause.

## Prinsip Operasional

Shadow Intelligence adalah alat ukur, bukan alat eksekusi.

Jika status nanti menjadi `READY`, langkah berikutnya tetap harus manual:

1. Review sample.
2. Cek apakah profit bukan kebetulan.
3. Cek OOR dan drawdown.
4. Buat proposal tuning.
5. Uji lagi secara dry-run.
6. Baru pertimbangkan perubahan engine.

Tidak ada auto-promotion dari shadow ke production.
