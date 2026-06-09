# Hasil Backtest Audit

Tanggal audit: 2026-06-02

Sumber utama: `GET /api/backtest?days=30&mode=all` di VPS `vps-trading`.

## 1. Overview

Audit ini mengecek apakah pipeline TEMUAN 07-09 punya edge yang bisa dipercaya:

- defensive ROI engine
- offensive edge engine
- execution intelligence
- TEMUAN 12 backtest engine
- data `pnl_log.json`

Kesimpulan singkat: angka mentah terlihat sangat profit, tetapi kualitas statistiknya tidak believable. Win rate terlalu tinggi, profit factor ekstrem, drawdown terlalu kecil, sample kecil, dan engine memblokir banyak trade yang justru profit besar. Ini bukan bukti edge yang solid; ini lebih cocok diklasifikasikan sebagai hasil suspicious / overfit atau data belum cukup matang.

## 2. Dataset Used

Perbandingan timeframe:

| Window | Closed trades | Executable | Blocked | Executable ratio |
| --- | ---: | ---: | ---: | ---: |
| 7 hari | 26 | 14 | 12 | 53.8% |
| 14 hari | 26 | 14 | 12 | 53.8% |
| 30 hari | 26 | 14 | 12 | 53.8% |

Catatan penting:

- Hasil 7/14/30 hari identik, artinya seluruh closed trade yang tersedia berada dalam window 7 hari terakhir.
- Sample hanya 26 closed trade. Ini terlalu kecil untuk menyimpulkan profitability jangka panjang.
- Karena window efektif sama, consistency check lintas timeframe belum valid.

## 3. Win Rate Analysis

Metric 30 hari:

| Segment | Trades | Wins | Losses | Win rate | Klasifikasi |
| --- | ---: | ---: | ---: | ---: | --- |
| Baseline semua trade | 26 | 21 | 5 | 80.8% | suspiciously high |
| Executable by engine | 14 | 11 | 3 | 78.6% | suspiciously high |
| Blocked by engine | 12 | 10 | 2 | 83.3% | suspiciously high |

Blocked avoided loss rate:

- Blocked trades: 12
- Avoided losses: 2
- Avoided loss rate: 16.7%
- Blocked winners: 10

Interpretasi:

Win rate executable 78.6% terlihat kuat di permukaan, tetapi masuk kategori suspiciously high. Yang lebih mengkhawatirkan: bucket blocked punya win rate 83.3%, lebih tinggi dari executable. Defensive engine tidak hanya memblokir rugi; ia juga memblokir banyak winner.

## 4. Profit Factor Analysis

Metric 30 hari:

| Segment | Profit factor | Total PnL | Avg PnL | Klasifikasi |
| --- | ---: | ---: | ---: | --- |
| Baseline semua trade | 149.34 | 140.92% | 5.42% | suspicious / overfit |
| Executable by engine | 69.04 | 31.98% | 2.28% | suspicious / overfit |
| Blocked by engine | 227.96 | 108.94% | 9.08% | suspicious / overfit |

Interpretasi:

Profit factor di atas 2.5 sudah masuk suspicious / overfit. Di sini PF executable 69.04 dan baseline 149.34. Ini tidak realistis untuk dianggap sebagai bukti edge live tanpa verifikasi data, fee/slippage, sizing, survivorship bias, dan kualitas log.

Fakta paling keras: blocked segment menghasilkan total PnL 108.94%, jauh lebih besar dari executable 31.98%. Jadi engine saat ini melewatkan sebagian besar PnL historis yang tercatat.

## 5. Drawdown Analysis

Metric 30 hari:

| Segment | Max drawdown | Klasifikasi |
| --- | ---: | --- |
| Baseline semua trade | -0.27% | excellent, tetapi suspicious |
| Executable by engine | -0.27% | excellent, tetapi suspicious |
| Blocked by engine | -0.24% | excellent, tetapi suspicious |

Interpretasi:

Drawdown di bawah 10% secara klasifikasi adalah excellent. Namun drawdown -0.27% pada strategi memecoin/pool baru dengan PF ekstrem dan win rate 78-83% bukan bukti risk control bagus; ini lebih mungkin tanda sample kecil, logging belum mencakup real adverse path, atau backtest belum menangkap slippage dan execution reality.

## 6. Feature Contribution

Analisis kontribusi memakai executable trades 30 hari.

### Positive Contribution

| Feature | Bucket | Trades | Win rate | Avg PnL | Total PnL | Catatan |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| Wallet | ELITE | 5 | 100.0% | 2.38% | 11.91% | positif, tapi sample kecil |
| Wallet | STRONG | 9 | 66.7% | 2.23% | 20.07% | positif |
| FeeTVL | EXCELLENT | 10 | 90.0% | 2.61% | 26.11% | kontribusi paling jelas |
| FeeTVL | HEALTHY | 2 | 50.0% | 2.91% | 5.81% | positif, sample sangat kecil |
| Timing | NOW | 10 | 90.0% | 2.61% | 26.11% | positif, tetapi sangat suspicious |
| Edge tier | STRONG EDGE | 4 | 100.0% | 3.59% | 14.37% | positif, sample kecil |
| Execution | AGGRESSIVE ENTRY | 10 | 90.0% | 2.61% | 26.11% | positif, tetapi berisiko overfit |
| OOR | NO OOR | 3 | 100.0% | 6.00% | 18.01% | positif, sample kecil |
| OOR | LOW OOR | 4 | 100.0% | 2.68% | 10.71% | positif, sample kecil |

### Negative / Weak Contribution

| Feature | Bucket | Trades | Win rate | Avg PnL | Total PnL | Catatan |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| FeeTVL | WEAK | 2 | 50.0% | 0.03% | 0.06% | hampir netral, edge sangat tipis |
| Timing | 5-15 MIN | 4 | 50.0% | 1.47% | 5.87% | masih profit, tapi lebih lemah dari NOW |
| OOR | MEDIUM OOR | 7 | 57.1% | 0.47% | 3.26% | kontribusi melemah jelas |
| Conviction | MEDIUM | 2 | 50.0% | 0.03% | 0.06% | hampir tidak ada edge |
| Execution | NORMAL ENTRY | 4 | 50.0% | 1.47% | 5.87% | lebih lemah dari aggressive entry |

### Neutral / Inconclusive

| Feature | Bucket | Reason |
| --- | --- | --- |
| Organic trend | STABLE only | Tidak ada variasi bucket, tidak bisa diuji sebagai pembeda |
| Alpha ranking | PASS only | Tidak ada variasi bucket executable, tidak bisa diuji sebagai pembeda |
| Crowding | LOW CROWDING only | Tidak ada variasi bucket, tidak bisa diuji sebagai pembeda |
| Survival | LOW/MID/HIGH semua profit | Arah kontribusi tidak masuk akal: LOW SURVIVAL justru tertinggi, sample terlalu kecil |

Interpretasi:

Feature paling masuk akal untuk dipertahankan adalah FeeTVL, timing NOW, OOR rendah, dan wallet quality. Namun karena semua bucket menghasilkan PF ekstrem, kontribusi ini belum bisa dianggap kausal. Organic, alpha, crowding, dan survival belum terbukti karena kurang variasi atau hasilnya tidak konsisten secara semantik.

## 7. False Positive Analysis

Bad trades yang masih lolos executable:

- Failed passed trades: 3
- Pola masing-masing muncul 1 kali:
  - wallet STRONG | fee HEALTHY | organic STABLE | edge GOOD EDGE | conviction HIGH
  - wallet STRONG | fee EXCELLENT | organic STABLE | edge ELITE EDGE | conviction EXTREME
  - wallet STRONG | fee WEAK | organic STABLE | edge GOOD EDGE | conviction MEDIUM

Interpretasi:

Tidak ada satu pola false positive dominan karena sample hanya 3 loss. Namun ada sinyal penting: bahkan kombinasi yang terlihat sangat bagus seperti STRONG wallet + EXCELLENT fee + ELITE edge + EXTREME conviction masih bisa rugi. Jadi threshold tidak boleh dinaikkan secara agresif hanya berdasarkan badge.

False blocked / missed winners:

- Blocked trades: 12
- Blocked winners: 10
- Blocked winner PnL: 109.42%
- Avoided loss PnL: -0.48%
- Top missed winners:
  - SQUIRE-SOL: +49.71%, BLOCKED, edge 0
  - SPCX-SOL: +49.66%, BLOCKED, edge 7
  - BABYTROLL-SOL: +3.36%, BLOCKED, edge 3
  - SQUIRE-SOL: +3.31%, BLOCKED, edge 0
  - SQUIRE-SOL: +1.90%, BLOCKED, edge 0

Ini adalah temuan terpenting. Defensive engine memang harus menang atas offensive engine, tetapi defensive truth saat ini kemungkinan terlalu kasar atau input historisnya kurang lengkap. Dua winner hampir +50% diberi edge 0/7 dan BLOCKED. Itu bukan sekadar conservative; itu indikasi salah baca sinyal, missing fields, atau threshold defensive terlalu menekan opportunity.

## 8. Executable Ratio

Executable ratio 30 hari:

- Executable: 14 dari 26
- Ratio: 53.8%

Klasifikasi:

- <20% = too defensive
- 25-50% = healthy
- >70% = too aggressive

Interpretasi:

53.8% sedikit di atas healthy range, tetapi belum masuk too aggressive. Namun ratio ini menipu, karena blocked bucket justru menyimpan 77.3% dari total PnL baseline. Masalah utama bukan jumlah trade yang lolos, melainkan trade selection: engine meloloskan sebagian winner, tetapi memblokir winner yang lebih besar.

## 9. Overfit Detection

Red flags:

- Win rate baseline 80.8% dan executable 78.6% masuk suspiciously high.
- Profit factor executable 69.04 jauh di atas batas suspicious / overfit 2.5.
- Max drawdown -0.27% terlalu kecil untuk konteks market yang volatil.
- 7/14/30 hari identik, jadi tidak ada bukti konsistensi lintas rezim.
- Sample hanya 26 closed trade.
- Blocked segment lebih profitable daripada executable segment.
- Blocked avoided loss rate hanya 16.7%.
- Beberapa feature bucket tidak punya variasi, sehingga kontribusinya belum bisa diuji.
- Top blocked winners hampir +50%, menunjukkan engine mungkin kehilangan upside besar.

Assessment:

Profitability saat ini tidak statistically believable. Ini bukan berarti tidak ada edge sama sekali, tetapi bukti yang ada belum layak dipakai untuk menaikkan risk, sizing, atau auto-execution agresif. Angka terlalu bagus untuk dipercaya, sementara error selection terlalu besar untuk diabaikan.

## 10. Executive Summary

1. Does this bot currently have real edge?

Belum terbukti. Ada indikasi promising signal pada FeeTVL, wallet quality, timing NOW, dan OOR rendah, tetapi evidence belum cukup.

2. Is profitability statistically believable?

Tidak. Win rate dan PF terlalu tinggi, drawdown terlalu kecil, sample terlalu kecil, dan window 7/14/30 identik.

3. Biggest strength?

Engine mampu mengelompokkan beberapa trade profit ke bucket yang masuk akal: EXCELLENT FeeTVL, NOW timing, STRONG/ELITE wallet, dan low/no OOR.

4. Biggest weakness?

False block / missed upside. Blocked trades menghasilkan +108.94% total PnL, jauh di atas executable +31.98%.

5. Highest ROI improvement recommendation?

Bangun attribution dan false-block audit sebelum tuning threshold. Fokus ke: kenapa SQUIRE-SOL dan SPCX-SOL +49% diblokir, apakah input historis wallet/FeeTVL/organic/alpha kosong atau salah, dan apakah defensive blockers perlu dibedakan antara hard truth dan soft caution.

6. Should we continue TEMUAN 13 yet?

Ya, tetapi dengan arah audit/attribution, bukan optimasi agresif. TEMUAN 13 harus dipakai untuk menjawab "kenapa winner besar diblokir" dan "fitur mana yang benar-benar punya causal contribution". Jangan lanjut ke auto-risk-up atau live scaling sebelum false-block problem dibereskan.

## 11. Final Verdict

SUSPICIOUS / OVERFIT

Alasan verdict:

- Profit factor terlalu ekstrem.
- Win rate terlalu tinggi.
- Drawdown terlalu rendah.
- Sample terlalu kecil.
- Tidak ada variasi timeframe efektif.
- Defensive engine memblokir sebagian besar PnL historis.

Status praktis:

Sistem ini punya sinyal awal yang menarik, tetapi belum punya bukti real edge yang bisa dipercaya. Next best step adalah TEMUAN 13 berbasis attribution dan false-block investigation, bukan mempercantik UI atau menaikkan agresivitas execution.
