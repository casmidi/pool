# Change Dashboard Revision Timestamp

Tanggal: 2026-06-05

## Masalah

Badge dashboard `Rev.` sebelumnya hanya mengikuti waktu modifikasi:
- `dashboard.js`
- `public/index.html`

Akibatnya, perubahan engine seperti:
- `tools/executor.js`
- `tools/screening.js`
- `strategy/dlmm-edge.js`
- `lib/anti_oor_recheck_queue.js`
- dokumentasi perubahan

tidak selalu membuat badge revision berubah.

Contoh yang terlihat:

`Rev. 2026-06-05 16:24 WIB`

Padahal setelah itu ada perubahan range/anti-OOR dan dokumentasi baru.

## Perubahan

File diubah:

`dashboard.js`

Fungsi `getDashboardRevision()` diperluas agar membaca waktu modifikasi terbaru dari:
- `dashboard.js`
- `public/index.html`
- `tools`
- `strategy`
- `lib`
- `shadow`
- `copy-engine`
- `decision-log.js`
- `config.js`
- `document`

Folder yang sengaja diabaikan:
- `node_modules`
- `.git`
- `data`
- `logs`
- `scanning_log`
- `Backup`
- `garbage`

## Implikasi

Badge `Rev.` sekarang lebih akurat untuk perubahan bot secara keseluruhan, bukan hanya perubahan dashboard.

Jika ada perubahan engine atau dokumentasi, timestamp revision akan ikut berubah setelah `pool-dashboard` restart atau saat backend membaca file terbaru.

## Risiko

Risiko rendah.

Fungsi hanya membaca metadata file (`mtime`), tidak membaca isi file besar dan tidak mengubah engine deploy.

## Validasi

Validasi yang perlu dilakukan:
- `node --check dashboard.js`
- deploy `dashboard.js` ke VPS
- restart `pool-dashboard`
- cek `/api/status` field `dashboard.label`
