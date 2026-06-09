# Analisa Trade Sepi dan Loss - 2026-06-05

Tanggal analisa: 2026-06-05
Environment: VPS `/opt/bot/meridian`
Mode: `DRY RUN`

## Ringkasan

Hari ini terlihat hanya ada 1 trade yang menghasilkan PnL, dan hasilnya loss. Setelah dicek, trade tersebut bukan entry baru hari ini, melainkan posisi `Goblin-SOL` yang dibuka pada 2026-06-04 dan ditutup pada 2026-06-05.

Trade Goblin:
- Pool: `Goblin-SOL`
- Deploy time: `2026-06-04T13:15:32.540Z`
- Close time: `2026-06-05T02:10:42.925Z`
- Amount: `0.118 SOL`
- Strategy: `bid_ask`
- Entry bin: `-333`
- Exit bin: `-385`
- PnL: `-0.023912 SOL`
- PnL pct: `-20.26%`
- Close reason: `paper stop-loss`

Jadi, yang terjadi hari ini adalah 1 posisi lama ditutup loss. Bukan berarti engine berhasil membuka 1 trade baru hari ini lalu langsung loss.

## Apakah Wajar

Sebagian wajar, sebagian perlu dimonitor.

Wajar karena engine sedang masuk mode defensif setelah beberapa loss dan OOR berulang. Dashboard menunjukkan:
- `capital protection active`
- `4 consecutive losing closes`
- `oorRate` tinggi
- `Anti-OOR risk CRITICAL`
- `MOMENTUM_BREAKOUT_UP`

Dalam kondisi seperti ini, trade sedikit adalah efek yang diharapkan dari guard. Guard menahan bot agar tidak mengulang loss yang sama.

Namun tidak boleh dianggap normal permanen. Kalau dalam beberapa cycle berikutnya tetap tidak ada trade, berarti engine terlalu sering hanya bisa melihat kandidat bagus tetapi tidak punya route eksekusi aman. Itu perlu tuning strategy, bukan sekadar melonggarkan filter.

## Penyebab Utama Trade Sepi

### 1. Anti-OOR Guard Memblok Semua Kandidat Top

Log terbaru menunjukkan kandidat terbaik sebenarnya ada:
- `WORLDCUP-USDC` score 72 rec `BUY`
- `WORLDCUP-SOL` score 70
- `TripleT-SOL` score 70
- `SQUIRE-SOL` score 69
- `SPCX-SOL` score 69
- `Goblin-SOL` score 68
- `BURNIE-SOL` score 65
- `BULL-SOL` score 64

Tetapi saat agent mencoba deploy, hasilnya:

`Anti-OOR pre-entry guard blocked dry-run deploy: CRITICAL NO_DEPLOY_OR_SANDBOX_ONLY. MOMENTUM_BREAKOUT_UP; recent fast OOR cluster; high recent OOR rate; OOR has produced repeated losses; active bin near upper edge`

Artinya kandidat ada, tetapi kondisi entry dianggap rawan keluar range sangat cepat.

### 2. Riwayat OOR Sedang Buruk

Endpoint anti-OOR menunjukkan:
- closed sample: 44
- OOR count: 33
- OOR rate: 75%
- OOR above: 33
- fast OOR under 30m: 16
- losing OOR: 11
- average time to OOR: 9.87 menit

Root cause:
- range terlalu rendah saat momentum naik,
- entry terjadi saat acceleration window,
- active bin sering lari ke atas.

Ini menjelaskan kenapa guard memblok deploy walaupun pool score terlihat bagus.

### 3. Capital Protection Aktif

Dashboard menunjukkan:
- health score: 23
- label: `RISK`
- 4 consecutive losing closes
- deploy multiplier: 0.5
- confidence boost: 0.1

Capital protection tidak selalu memblok deploy, tetapi membuat engine lebih defensif dan mengurangi size.

### 4. Provider Eksternal Tidak Stabil

Log menunjukkan banyak:
- OKX `429 Too Many Requests`
- OKX circuit breaker open
- HiveMind 504
- Top LPer warmup 504
- Redis temporarily disabled

Fallback risk memang mengisi data 30/30 pool via Dexscreener, tetapi kualitas data fallback tidak setajam OKX/HiveMind. Dalam kondisi provider noisy, engine lebih banyak masuk mode aman.

### 5. LLM Sempat Empty Response

Pada cycle terbaru agent sempat mendapat:
- `Empty response, retrying`

Setelah retry, agent akhirnya final `NO DEPLOY`, bukan karena tidak ada kandidat, tetapi karena deploy diblok oleh anti-OOR.

## Kenapa Loss Goblin Terjadi

Goblin ditutup karena `paper stop-loss` dengan loss `-20.26%`. Ini konsisten dengan masalah yang sedang diperbaiki:
- entry/range tidak cukup adaptif terhadap pergerakan aktif bin,
- posisi tertahan lama sekitar 775 menit,
- exit terjadi jauh dari entry bin,
- guard lama belum cukup cepat menahan pola ini sebelum perbaikan terbaru.

Dengan kata lain, loss ini adalah contoh problem yang membuat anti-OOR guard sekarang menjadi sangat agresif.

## Apakah Perlu Melonggarkan Filter

Tidak disarankan melonggarkan filter mentah sekarang.

Alasannya:
- OOR rate 75% terlalu tinggi.
- 4 loss beruntun menunjukkan regime sedang tidak sehat.
- Kandidat top diblok bukan karena score rendah, tetapi karena risk pattern yang spesifik: upward breakout dan active bin dekat upper edge.
- Melonggarkan guard bisa membuat bot masuk lagi ke pola loss yang sama.

Yang lebih tepat bukan membuka filter, tetapi memperbaiki route eksekusi saat momentum naik.

## Rekomendasi Berikutnya

Prioritas perbaikan yang lebih sehat:

1. Buat anti-OOR tidak hanya memblok, tetapi memberi alternatif `WIDEN_AND_SHIFT_UP`.
   - Jika momentum breakout naik, range jangan ditempatkan terlalu rendah.
   - Range perlu digeser mengikuti active bin, bukan mengejar dari bawah.

2. Tambahkan `WAIT_5_MIN_RECHECK` sebagai mode nyata.
   - Saat OOR risk critical, jangan langsung buang kandidat selamanya.
   - Tunggu 5 menit, recheck active bin, fee/TVL, dan volume persistence.

3. Pisahkan kandidat `BUY` yang diblok OOR ke queue shadow/second-chance.
   - Contoh: `WORLDCUP-USDC` rec `BUY` tetapi diblok OOR.
   - Ini harus dipantau apakah setelah 5m/30m sebenarnya bisa aman dengan range berbeda.

4. Gunakan Shadow v2 sebagai bukti sebelum melonggarkan.
   - Saat analisa ini dibuat, Shadow v2 sudah aktif:
     - `cases`: 54
     - `open_cases`: 54
     - `closed_cases`: 0
     - `status`: `WATCH`
     - `top_cause`: `exit_route_thin`
   - Belum ada closed outcome, jadi belum cukup bukti untuk mengubah gate produksi.

## Kesimpulan

Trade cuma 1 dan loss hari ini bukan kondisi ideal, tetapi dapat dijelaskan.

Kesimpulan utama:
- Loss hari ini berasal dari posisi Goblin yang dibuka 2026-06-04 dan ditutup 2026-06-05.
- Setelah itu bot tidak benar-benar kosong kandidat; ada 8 kandidat top pada cycle terbaru.
- Semua kandidat top ditahan oleh anti-OOR guard karena OOR risk `CRITICAL`.
- Dalam jangka pendek ini wajar sebagai reaksi defensif setelah OOR/loss berulang.
- Jika berlanjut, solusinya bukan melonggarkan filter secara kasar, tetapi memperbaiki eksekusi momentum: widen range, shift up, wait-recheck, dan second-chance queue.
