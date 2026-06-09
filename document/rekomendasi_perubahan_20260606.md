# Rekomendasi Perubahan user-config.json — 2026-06-06

Tanggal analisa: 2026-06-06
Environment: VPS `/opt/bot/meridian` (DRY RUN)
Sumber data: decision-log.json (256 entries), scanning_log/daily, pm2 logs, kode source

---

## Ringkasan Masalah

Bot menghasilkan **244 keputusan "no_deploy" dari 256 total keputusan** (95%). Trade sangat sedikit bukan karena tidak ada kandidat, tetapi karena **terlalu banyak barrier yang saling menumpuk** sehingga hampir semua kandidat ditolak di berbagai tahap berbeda.

Berikut barrier teridentifikasi dari decision log VPS, diurutkan berdasarkan frekuensi kemunculan.

---

## Barrier #1: maxDeployVolatility (Frekuensi: ~30% dari rejection)

### Nilai Saat Ini

```json
"maxDeployVolatility": 2.5
```

### Apa Yang Terjadi

Decision log menunjukkan penolakan berulang:

```
"Market regime gate: pool volatility 3.8471 exceeds maxDeployVolatility threshold of 2.5"
"Market regime gate: pool volatility 2.7335 exceeds maxDeployVolatility threshold of 2.5"
"Market regime gate: pool volatility 2.7723 exceeds maxDeployVolatility threshold of 2.5"
```

### Kenapa Ini Masalah

Di Meteora DLMM, pool berkualitas tinggi sering memiliki volatility 2.5–4.0. Volatility ini bukan tanda buruk — justru menunjukkan ada aktivitas trading yang cukup untuk menghasilkan fee. Threshold 2.5 terlalu ketat dan membuang kandidat yang:

- Organic score tinggi (86 dari contoh WORLDCUP-SOL)
- Fee/TVL ratio bagus (373 SOL fees)
- Volume aktif ($53k)

Semua ditolak HANYA karena volatility 3.8 > 2.5.

### Rekomendasi

```json
"maxDeployVolatility": 4.0
```

### Alasan 4.0

- Pool dengan volatility < 4.0 masih dalam range "moderate" untuk DLMM
- Risk profile MODERATE di `allocation/types.js` sudah mengizinkan `volatilityCap: 6.0`
- Volatility 4.0 memberi ruang untuk pool yang sedang trending tapi belum ekstrem
- Volatility > 5.0 tetap ditangkap oleh dynamic position sizing (volatilityPositionScaling)

### Risiko

- Pool volatility 2.5–4.0 bisa lebih volatile dari yang diharapkan
- Tapi dynamic position scaling sudah aktif (`volatilityPositionScaling: true`) — deploy amount otomatis turun di volatility tinggi

---

## Barrier #2: Allocation Engine Exposure Limit (Frekuensi: ~25% dari rejection)

### Nilai Saat Ini

```json
"positionSizePct": 0.25
```

Dari `allocation/types.js`, risk profile `MODERATE`:

```js
MODERATE: {
  maxPortfolioRisk: 0.20,  // maksimal 20% exposure
  maxPositionPct: 0.25,    // maksimal 25% per posisi
}
```

### Apa Yang Terjadi

Decision log:

```
"Allocation engine blocked deploy: After sizing: Portfolio exposure 34.3% exceeds 20% limit"
"Allocation engine blocked deploy: After sizing: Portfolio exposure 33.8% exceeds 20% limit"
"Allocation engine blocked deploy: After sizing: Portfolio exposure 34.4% exceeds 20% limit"
```

### Kenapa Ini Masalah

Dengan wallet 10 SOL dan `computeDeployAmount` menghasilkan ~2.4 SOL per posisi:

- Setelah 1 posisi: exposure = 2.4/10 = **24%** — sudah melebihi 20%
- Posisi ke-2 dan ke-3 **SELALU diblokir**
- Bot hanya bisa buka **1 posisi** padahal `maxPositions: 3`

Artinya `maxPositions: 3` menjadi **no-op** — tidak ada gunanya mengizinkan 3 posisi jika exposure limit hanya 20%.

### Rekomendasi

Ubah risk profile dari `MODERATE` ke `AGGRESSIVE`:

```json
"allocationRiskProfile": "aggressive"
```

Atau override langsung. Dari `allocation/types.js`:

```js
AGGRESSIVE: {
  maxPortfolioRisk: 0.35,  // 35% — cukup untuk 2-3 posisi
  maxPositionPct: 0.35,    // 35% per posisi
  volatilityCap: 10.0,     // volatility cap lebih longgar
}
```

### Alasan AGGRESSIVE

- Dengan `maxPortfolioRisk: 0.35`, bot bisa buka 2-3 posisi sebelum diblokir
- `volatilityCap: 10.0` konsisten dengan `maxDeployVolatility: 4.0` yang diusulkan
- Bot masih punya guard lain (maxPositions, maxWalletHeatPct, capital protection) sebagai safety net
- Dalam mode DRY RUN, ini aman untuk eksperimen

### Alternatif: Naikkan maxWalletHeatPct

Jika tidak ingin ganti risk profile, bisa naikkan `maxWalletHeatPct`:

```json
"maxWalletHeatPct": 85
```

Tapi ini hanya mengatasi wallet heat gate, bukan allocation engine exposure limit. Lebih baik ganti risk profile.

---

## Barrier #3: failClosedOnMissingRiskMetrics (Frekuensi: ~15% dari rejection)

### Nilai Saat Ini

```json
"failClosedOnMissingRiskMetrics": true
```

### Apa Yang Terjadi

Log VPS menunjukkan:

```
Circuit breaker OPEN for okx:advanced — 3 consecutive failures, cooldown 5 min
Circuit breaker OPEN for okx:price — 3 consecutive failures, cooldown 5 min
```

OKX API sering kena rate limit (429) atau timeout. Ketika circuit breaker terbuka, data risk (bundle_pct, sniper_pct, suspicious_pct) tidak tersedia. Dengan `failClosedOnMissingRiskMetrics: true`, kandidat yang datanya tidak lengkap **langsung ditolak**.

### Kenapa Ini Masalah

- OKX API tidak stabil — rate limit dan timeout adalah hal normal
- Fallback risk dari Dexscreener sudah tersedia (`fallbackRiskEnabled: true`)
- Menolak kandidat hanya karena OKX timeout membuat banyak peluang hilang

### Rekomendasi

```json
"failClosedOnMissingRiskMetrics": false
```

### Alasan

- Fallback risk profile dari Dexscreener sudah cukup akurat untuk screening awal
- OKX data bersifat tambahan (nice-to-have), bukan critical
- Dengan `failOpenOnRiskDataUnavailable: false` (saat ini), kandidat tetap ditolak jika SELURUH risk data tidak tersedia — jadi ada double guard

### Risiko

- Beberapa kandidat berisiko mungkin lolos tanpa data OKX lengkap
- Tapi guard lain (shadow v2, anti-OOR, pool scorer) masih aktif

---

## Barrier #4: blockNegativeEV + minNetEVPct (Frekuensi: ~10% dari rejection)

### Nilai Saat Ini

```json
"blockNegativeEV": true,
"minNetEVPct": 0.2
```

### Apa Yang Terjadi

Kandidat dengan projected net EV di bawah 0.2% per hari diblokir. EV dihitung dari fee/TVL ratio dikurangi estimasi IL berdasarkan volatility dan bin step.

### Kenapa Ini Masalah

- Threshold 0.2% per hari terlihat kecil, tapi untuk pool dengan fee/TVL rendah (0.02-0.05), EV bersih sering jatuh di bawah 0.2% karena IL proxy
- Pool bagus dengan fee/TVL 0.03 dan volatility 3 bisa memiliki EV negatif karena IL proxy yang agresif
- Formula EV masih menggunakan estimasi kasar, bukan data historis nyata

### Rekomendasi

```json
"blockNegativeEV": false
```

### Alasan

- EV estimation masih experimental — belum terbukti akurat
- Pool scorer sudah memberikan scoring komprehensif yang mempertimbangkan fee, volatility, organic
- Dengan `minPoolScore: 60`, sudah ada guard kualitas sebelum EV gate
- Lebih baik gunakan pool scorer sebagai gate utama, bukan EV estimation

---

## Barrier #5: failOpenOnRiskDataUnavailable (Frekuensi: ~5% dari rejection)

### Nilai Saat Ini

```json
"failOpenOnRiskDataUnavailable": false
```

### Apa Yang Terjadi

Ketika OKX data benar-benar tidak tersedia (bukan hanya部分), kandidat ditolak.

### Rekomendasi

```json
"failOpenOnRiskDataUnavailable": true
```

### Alasan

- Kombinasi dengan `failClosedOnMissingRiskMetrics: false` memberikan pendekatan bertingkat
- Jika data risk benar-benar kosong (OKX down + fallback gagal), pool scorer dan anti-OOR masih menjadi gate terakhir
- Dalam DRY RUN, ini aman untuk mengumpulkan lebih banyak data

---

## Ringkasan Perubahan

| Parameter | Saat Ini | Rekomendasi | Alasan Utama |
|-----------|----------|-------------|-------------|
| `maxDeployVolatility` | 2.5 | **4.0** | Terlalu banyak kandidat bagus dibuang |
| `allocationRiskProfile` | moderate | **aggressive** | Hanya 1 posisi bisa dibuka, maxPositions=3 jadi no-op |
| `failClosedOnMissingRiskMetrics` | true | **false** | OKX sering timeout, fallback sudah tersedia |
| `blockNegativeEV` | true | **false** | EV estimation masih experimental |
| `failOpenOnRiskDataUnavailable` | false | **true** | Beri kesempatan pada fallback risk |

### Parameter Yang TIDAK Diubah

| Parameter | Saat Ini | Alasan |
|-----------|----------|--------|
| `minPoolScore` | 60 | Sudah cukup selektif |
| `minOrganic` | 70 | Standar industri, jangan turunkan |
| `minFeeActiveTvlRatio` | 0.02 | Sudah reasonable |
| `stopLossPct` | -18 | Bisa di-review nanti setelah trade berjalan |
| `takeProfitPct` | 6 | Sudah konservatif dan aman |
| `outOfRangeWaitMinutes` | 10 | Bisa di-review nanti |
| `maxPositions` | 3 | Sudah benar, yang perlu diubah adalah exposure limit |
| `maxConsecutiveLosses` | 3 | Cukup untuk dry run |

---

## Urutan Penerapan

1. **maxDeployVolatility: 2.5 → 4.0** — Paling berdampak, paling aman
2. **allocationRiskProfile: moderate → aggressive** — Membuka jalur untuk 2-3 posisi
3. **failClosedOnMissingRiskMetrics: true → false** — Mengurangi false rejection dari OKX timeout
4. **blockNegativeEV: true → false** — Mengurangi false rejection dari EV estimation
5. **failOpenOnRiskDataUnavailable: false → true** — Backup untuk nomor 3

---

## Validasi Setelah Perubahan

Setelah perubahan diterapkan, pantau selama 24-48 jam:

1. **Screening log** — pastikan kandidat lebih banyak yang lolos ke agent
2. **Decision log** — pastikan rejection rate turun dari 95%
3. **Deploy count** — pastikan bot mulai membuka posisi
4. **PnL** — pastikan tidak ada loss besar yang tidak terduga
5. **OOR rate** — pantau apakah OOR meningkat karena volatilitas lebih tinggi

Jika OOR meningkat setelah perubahan, langkah mitigasi:
- Naikkan `outOfRangeWaitMinutes` dari 10 ke 15
- Pertimbangkan turunkan `maxDeployVolatility` ke 3.5

---

## Backup

Backup config saat ini sudah tersedia di:

```bash
/opt/bot/meridian/user-config_20260606.json
```

Untuk restore jika perubahan bermasalah:

```bash
ssh vps-trading 'cd /opt/bot/meridian && cp user-config_20260606.json user-config.json && pm2 restart meridian --update-env'
```

---

## Kesimpulan

Masalah utama trade sepi bukan modal, tetapi **5 barrier yang saling menumpuk**:

1. Volatility gate terlalu ketat (2.5) membuang kandidat bagus
2. Allocation exposure 20% hanya mengizinkan 1 posisi
3. Risk metrics gate menolak kandidat saat OKX timeout
4. EV estimation menolak kandidat berdasarkan formula yang belum terbukti
5. Risk data gate menolak kandidat saat semua provider data tidak tersedia

Perubahan yang diusulkan bersifat **melonggarkan barrier yang terlalu ketat**, bukan menghilangkan safety guard. Pool scorer, anti-OOR, shadow v2, dan capital protection tetap aktif sebagai lapisan pertahanan.
