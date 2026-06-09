# Change Log TEMUAN 13

Tanggal: 2026-06-02

## Scope

Implementasi Experience Intelligence & False-Block Recovery Layer berdasarkan hasil `document/hasil_backtest.md`.

Tujuan utama:

- Membaca pengalaman historis dari backtest.
- Membedakan soft block dan hard block.
- Menginvestigasi missed winners tanpa melanggar aturan defensive engine.
- Menambahkan counterfactual replay.
- Menambahkan memory-aware conviction adjustment.

Core rule tetap:

Defensive engine always wins.

## Files Changed

- `lib/experience_intelligence.js`
- `lib/backtest_engine.js`
- `dashboard.js`
- `document/change_temuan_13.md`

## 1. MarketMemoryEngine

Ditambahkan di `lib/experience_intelligence.js`.

Fungsi utama:

- Membuat signal signature untuk setiap trade.
- Mengelompokkan performa berdasarkan kombinasi:
  - wallet
  - FeeTVL
  - organic trend
  - entry timing
  - alpha state
  - edge tier
  - conviction
  - survival
  - crowding
  - OOR behavior
- Mendeteksi positive historical patterns.
- Mendeteksi negative historical patterns.

Output tersedia melalui:

- `/api/backtest?days=30&mode=all`
- `/api/experience-memory?days=30`

## 2. FailureMemoryEngine

Ditambahkan untuk membaca executable trades yang tetap rugi.

Fungsi:

- Mengumpulkan failed-passed trades.
- Membuat pattern loss berdasarkan signal signature.
- Mengeluarkan weak threshold hints seperti:
  - FeeTVL weak masih bisa lolos.
  - Medium/low conviction loss masih bisa lolos.
  - OOR exposure memperlemah outcome.

## 3. MissedWinnerInvestigationEngine

Ditambahkan untuk false-block recovery audit.

Fungsi:

- Mengambil blocked trades yang historisnya profit.
- Mengelompokkan missed winners berdasarkan block tier.
- Menampilkan top missed winners.
- Menjelaskan suspected causes.

Hasil validasi VPS:

- Missed winners: 10
- Total missed winner PnL: 109.42%
- Semua missed winners saat ini masuk `HARD_BLOCK`.
- Top cases:
  - `SQUIRE-SOL` +49.71%
  - `SPCX-SOL` +49.66%

Interpretasi:

Ini bukan kandidat otomatis dilepas. Ini adalah sinyal bahwa data/threshold defensive perlu diaudit, terutama saat wallet terbaca `DANGEROUS` tetapi outcome historis menang besar.

## 4. Soft vs Hard Block

Ditambahkan `classifyBlockStrictness()`.

Tier:

- `NO_BLOCK`
- `SOFT_BLOCK`
- `HARD_BLOCK`

Rule:

- `HARD_BLOCK` tidak pernah dioverride.
- `SOFT_BLOCK` hanya audit-only dan recovery eligible, tetapi belum live override.
- Memory tidak boleh membuat blocked pool menjadi executable.

Hard block patterns mencakup:

- rug
- honeypot
- hard safety blocker
- dangerous wallet
- fee/TVL dangerous
- blacklist
- exploit

## 5. CounterfactualReplayEngine

Ditambahkan `buildCounterfactualReplay()`.

Fungsi:

- Menghitung replay hipotetis untuk soft block.
- Hard block selalu `releasedCount: 0`.
- Memberi verdict apakah soft block perlu review.

Hasil validasi VPS:

- Soft block replay: 0 trade.
- Hard block replay: 12 blocked, 0 released.
- Verdict soft block: `NO_SOFT_BLOCK_EDGE`.

Artinya missed winner problem saat ini bukan soft block yang bisa langsung dibuka. Masalahnya ada di defensive truth classification atau kualitas input historis.

## 6. Memory-Aware Conviction Adjustment

Ditambahkan `applyMemoryAwareConviction()`.

Perilaku:

- Untuk `HARD_BLOCK`: conviction tetap 0, no trade.
- Untuk `SOFT_BLOCK`: audit-only, tidak ada live override.
- Untuk `NO_BLOCK`: historical pattern bisa memberi boost atau penalty ke conviction.
- Adjustment juga memperbarui:
  - conviction score
  - conviction state
  - suggested position size
  - execution state
  - memory metadata

Memory metadata sekarang muncul di:

- pool execution object
- copy signal execution object
- backtest trades

## 7. Backend Integration

`dashboard.js`:

- Import `applyMemoryAwareConviction`.
- Menambahkan helper `getExperienceMemory(days)`.
- `/api/pools` sekarang menyertakan `experience.memory`.
- `/api/copy-signals` memakai memory-aware conviction.
- Endpoint baru:
  - `/api/experience-memory?days=30`

`lib/backtest_engine.js`:

- Menyertakan `experienceMemory` pada output backtest.
- Menambahkan memory signature per trade.
- Menambahkan block strictness per trade.
- Menambahkan memory metadata pada trade output.

## 8. Verification

Local:

- `node --check lib/experience_intelligence.js`
- `node --check lib/backtest_engine.js`
- `node --check dashboard.js`
- sample `runBacktest({ days: 30, mode: "all" })`

VPS:

- Deployed to `/opt/bot/meridian`.
- Restarted `pool-dashboard`.
- Verified `/api/backtest?days=30&mode=all`.
- Verified `/api/experience-memory?days=30`.
- Verified `/api/pools` includes execution memory metadata.

VPS validation summary:

- Backtest sample: 26 closed trades.
- Simulated trades: 14.
- Blocked by engine: 12.
- Missed winners: 10.
- Missed winner PnL: 109.42%.
- All missed winners classified as `HARD_BLOCK`.

## Final Notes

TEMUAN 13 tidak membuka trade yang diblokir defensive engine. Layer ini membuat sistem lebih jujur:

- Kalau missed winner terjadi karena soft block, ia akan muncul sebagai recovery candidate.
- Kalau missed winner terjadi karena hard block, ia tetap tidak dieksekusi, tetapi dipaksa masuk investigasi data/threshold.

Next highest-ROI follow-up:

Audit kenapa historical winners besar terbaca sebagai `wallet:DANGEROUS` dan `edge:AVOID EDGE`. Jika ternyata input historis tidak lengkap atau mapping wallet score salah, perbaiki data normalization sebelum tuning threshold.
