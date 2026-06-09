# Change Trade Unblock 2026-06-06

Waktu eksekusi: 2026-06-06 07:07 WIB
Target lokal: `D:\meridian-bot`
Target VPS: `/opt/bot/meridian` via `ssh vps-trading`

## Ringkasan

Investigasi menemukan bahwa bot tidak masuk trading karena beberapa blocker terjadi berlapis:

1. Ada proses manual lama `node scripts/run-copy-engine-once.js` yang masih hidup di VPS sekitar 7 jam.
2. Bot berjalan dengan `DRY_RUN=true`, sehingga tidak akan mengirim transaksi on-chain.
3. Wallet live terdeteksi 0 SOL pada log, sehingga real trading tetap tidak mungkin tanpa funding.
4. Konfigurasi screening/copy terlalu ketat, terutama filter wallet.
5. Model screening lama memakai jalur gratis OpenRouter yang sering kena 429/rate-limit.
6. Ada bug runtime di `tools/screening.js`: callback memakai variabel `pool` yang tidak ada, sehingga screening bisa gagal sebelum kandidat diproses.
7. Candidate discovery bisa menggantung lama dan terlihat seperti siklus screening sebelumnya masih berjalan.
8. Anti-OOR guard memblok dry-run deploy, padahal rekomendasinya `NO_DEPLOY_OR_SANDBOX_ONLY`.
9. Deploy gate hanya mengenali pool address, sedangkan agent kadang mengirim nama pool seperti `67-SOL`.

Setelah perbaikan, dry-run trading sudah kembali berjalan. VPS membuka 1 posisi dry-run pada pool `three-SOL`.

## Perubahan VPS

Proses manual lama dihentikan:

- Parent PID: `360396`
- Child PID: `360412`
- Command: `node scripts/run-copy-engine-once.js`

Backup konfigurasi dibuat di VPS:

- `/opt/bot/meridian/user-config.json.bak_trade_unblock_20260606_0639`
- `/opt/bot/meridian/user-config.json.bak_trade_unblock_20260606_0640b`

Konfigurasi yang disesuaikan di `/opt/bot/meridian/user-config.json`:

- `screeningModel`: `anthropic/claude-haiku-4.5`
- `decisionMinScoreToCopy`: `45`
- `decisionMinConfidence`: `0.5`
- `copyTradingTopWalletCount`: `12`
- `copyTradingIntervalMin`: `20`
- `maxBotHoldersPct`: `45`
- `failOpenOnRiskDataUnavailable`: `true`
- `failClosedOnMissingRiskMetrics`: `false`
- `aiDailyBudgetUsd`: `0.75`
- `aiMaxCallsPerDay`: `240`
- `aiTargetCallsPerDay`: `160`

Catatan: `DRY_RUN` tetap tidak diubah. Real trading belum diaktifkan.

## Patch Code

File yang diperbaiki dan diunggah ke VPS:

- `tools/screening.js`
- `index.js`
- `tools/executor.js`

Detail patch:

1. `tools/screening.js`
   - Memperbaiki `ReferenceError: pool is not defined` pada filter kandidat.
   - Semua akses di callback filter diganti memakai objek kandidat yang benar, yaitu `p`.

2. `index.js`
   - Menambahkan timeout untuk `getTopCandidates` memakai `screening.candidateFetchTimeoutMs` dengan default 90 detik.
   - Jika candidate discovery timeout/null, bot sekarang mencatat status `Candidate discovery unavailable` ke decision log, bukan diam seolah tidak ada kandidat.
   - Candidate map sekarang mengenali address dan nama pool.
   - Jika agent mengirim nama pool, misalnya `three-SOL`, sistem otomatis resolve ke address kandidat sebelum deploy gate.

3. `tools/executor.js`
   - Anti-OOR `HIGH/CRITICAL` tetap memblok live deploy.
   - Untuk `DRY_RUN=true`, rekomendasi `NO_DEPLOY_OR_SANDBOX_ONLY` sekarang diizinkan sebagai sandbox dry-run dengan recheck queue.
   - Log dan decision entry sekarang membedakan live block vs dry-run sandbox override.

## Validasi

Syntax check lokal berhasil:

- `node -c D:\meridian-bot\tools\screening.js`
- `node -c D:\meridian-bot\index.js`
- `node -c D:\meridian-bot\tools\executor.js`

Service VPS:

- `pm2 restart meridian` berhasil.
- Proses `meridian` kembali online.
- Proses manual stale `run-copy-engine-once.js` sudah tidak ada.

Hasil log setelah patch:

- Pool scorer berhasil ranking 3 kandidat.
- Agent memilih pool `three-SOL`.
- Pre-deploy copy confidence lolos: `0.77`, minimum `0.61`.
- Wallet score lolos: `75 >= 45`.
- Shadow v2 guard: `PASS`.
- Anti-OOR risk tetap `CRITICAL`, tetapi diizinkan hanya untuk dry-run sandbox.
- Executor mencatat: `[Dry run] Would deploy: three-SOL 0.115 SOL`.

Posisi dry-run yang terbuka:

- Pool: `three-SOL`
- Address: `CnK82s8exdsK9nwqQ55kd9wcxoA22NwTchZJCBdu8LDa`
- Amount: `0.115 SOL`
- Deploy time: `2026-06-06T00:04:23.811Z`
- Status: `open`

`state.json` juga menunjukkan report terakhir:

```text
DRY RUN - NO REAL DEPLOY
Pool: three-SOL
Address: CnK82s8exdsK9nwqQ55kd9wcxoA22NwTchZJCBdu8LDa
Amount: 0.115 SOL
Strategy: bid_ask
No on-chain transaction was sent because DRY_RUN is enabled.
```

## Risiko Tersisa

1. Real trading belum aktif karena `DRY_RUN=true`.
2. Wallet live masih perlu SOL jika nanti `DRY_RUN=false`.
3. Anti-OOR live block tetap aktif untuk risiko `HIGH/CRITICAL`; patch hanya membuka jalur sandbox dry-run.
4. OKX advanced/price lookup sempat tidak tersedia sehingga beberapa risk check memakai fallback.
5. Redis sempat timeout/disabled pada log, jadi cache/telemetry bisa tidak maksimal.
6. OpenRouter 429 masih muncul di log historis; model sudah diganti agar tidak bergantung ke model free lama.

## Kesimpulan

Penyebab utama sepinya trading bukan satu hal, melainkan kombinasi proses stale, konfigurasi terlalu ketat, rate-limit AI, bug screening, guard Anti-OOR yang terlalu keras untuk dry-run, dan mismatch nama pool vs address saat deploy.

Setelah patch dan restart VPS, dry-run deploy sudah berhasil lagi. Live deploy tetap aman karena belum diaktifkan dan tetap diblok untuk risiko Anti-OOR kritikal.
