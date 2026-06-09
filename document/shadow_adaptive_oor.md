# Shadow Adaptive OOR

Tanggal: 2026-06-05
Status: `SHADOW_ONLY`

## Latar Belakang

Bot beberapa kali menemukan kandidat bagus, tetapi deploy diblok oleh anti-OOR karena kondisi `MOMENTUM_BREAKOUT_UP`, OOR rate tinggi, dan active bin dekat upper edge. Jika guard langsung dilonggarkan, risiko loss tetap besar. Karena itu opsi adaptive tidak langsung dimasukkan ke engine produksi.

Perubahan ini memasukkan opsi adaptive ke Shadow v2 lebih dulu.

Tujuannya:
- melihat apakah kandidat yang diblok OOR sebenarnya bisa aman jika range digeser atau entry ditunda,
- mengukur impact tanpa mengubah deploy engine,
- mencegah keputusan berdasarkan asumsi.

## File Yang Diubah

1. `shadow/shadow_v2_engine.js`
   - Menambahkan adaptive shadow variants:
     - `widen_shift_up`
     - `wait_5m_recheck`
     - `second_chance_queue`
   - Variant tetap dipantau walaupun baseline Shadow v2 sudah close karena OOR.
   - Summary menambahkan:
     - `adaptive_shadow_cases`
     - `adaptive_open_variants`
     - `adaptive_closed_variants`
     - `adaptive_impact_sol`
     - `adaptive_pnl_sol`
     - `adaptive_best_route`
     - `adaptive_best_impact_sol`
     - `adaptive_by_variant`

2. `public/index.html`
   - Panel Shadow v2 menambahkan:
     - `Adaptive PnL`
     - `Best Route`

3. `test/test-shadow-v2-engine.js`
   - Test baru memastikan adaptive variant bisa tetap hidup setelah baseline OOR close.
   - Test memastikan impact adaptive positif jika range adaptive menghasilkan outcome lebih baik daripada baseline.

4. `document/shadow_v2.md`
   - Dokumentasi Shadow v2 diperbarui agar menjelaskan adaptive OOR shadow.

5. `document/perbaikian_engine.md`
   - Catatan perbaikan engine diperbarui dengan alasan dan batasan adaptive shadow.

## Cara Kerja

Saat Shadow v2 melihat kandidat yang punya warning atau rekomendasi menarik, ia membuat simulasi adaptive:

### 1. `widen_shift_up`

Simulasi masuk sekarang, tetapi range dilebarkan dan digeser ke atas.

Alasan:
- Banyak OOR terjadi karena active bin lari ke atas.
- Range lama terlalu rendah untuk momentum breakout.

Yang diukur:
- apakah range lebih lebar/lebih atas mengurangi OOR,
- apakah PnL setelah durasi observasi lebih baik daripada baseline.

### 2. `wait_5m_recheck`

Simulasi tidak langsung masuk. Variant menunggu 5 menit lalu memakai snapshot market saat recheck sebagai entry shadow.

Alasan:
- Candle awal bisa terlalu liar.
- Delay bisa menghindari entry saat acceleration window.

Yang diukur:
- apakah menunggu membuat entry lebih aman,
- apakah delay menyebabkan missed profit atau justru menyelamatkan loss.

### 3. `second_chance_queue`

Simulasi kandidat yang diblok dimasukkan ke queue recheck, bukan dibuang selamanya.

Alasan:
- Kandidat `BUY` yang diblok OOR bisa saja menjadi aman setelah market stabil.
- Kita perlu bukti apakah re-entry/recheck berguna.

Yang diukur:
- apakah kandidat blocked bisa menghasilkan outcome lebih baik setelah recheck,
- apakah second chance hanya mengejar token exhausted.

## Bagaimana Impact Dihitung

Baseline Shadow v2 tetap menjadi pembanding.

Jika baseline loss `-0.001 SOL` dan adaptive variant akhirnya `+0.008 SOL`, maka:

`adaptive_impact_sol = +0.009 SOL`

Jika adaptive lebih buruk dari baseline, impact menjadi negatif.

Impact baru dianggap berguna setelah variant close. Variant bisa close karena:
- out-of-range,
- durasi maksimum observasi,
- data tidak lengkap.

## Kenapa Belum Masuk Engine

Adaptive OOR tetap shadow-only karena ini termasuk pelonggaran perilaku. Walaupun tidak membuka filter mentah, ia tetap bisa meningkatkan risiko loss jika langsung dipakai.

Risiko:
- `widen_shift_up` bisa rugi jika breakout palsu lalu harga balik turun.
- `wait_5m_recheck` bisa masuk terlalu telat.
- `second_chance_queue` bisa mengejar token exhausted.

Karena itu aturan runtime tetap:
- `auto_deploy=false`
- `hard_gate=false`
- `production_learning=false`

## Syarat Naik Ke Engine

Adaptive OOR baru boleh dipertimbangkan masuk engine jika:
- ada cukup closed variant,
- `adaptive_impact_sol` positif konsisten,
- `widen_shift_up` tidak meningkatkan loss besar,
- `wait_5m_recheck` tidak terlalu banyak missed profit,
- false improvement rendah,
- Shadow v2 punya data lengkap, bukan mayoritas incomplete.

Minimal awal:
- 30 closed adaptive variants untuk sinyal awal,
- 50-100 closed adaptive variants untuk keputusan lebih serius.

## Kesimpulan

Perubahan ini bukan melonggarkan engine produksi. Ini adalah eksperimen shadow untuk membuktikan apakah anti-OOR harus punya jalur yang lebih cerdas daripada sekadar block.

Jika impact positif, nanti engine bisa dinaikkan bertahap:
1. advisory,
2. manual recommendation,
3. soft execution in dry-run,
4. baru setelah cukup bukti masuk production rule.
