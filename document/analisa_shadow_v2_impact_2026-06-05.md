# Analisa Shadow v2 Impact - 2026-06-05

## Ringkasan

Shadow v2 sudah menunjukkan impact positif pada lapisan truth warning, tetapi belum menunjukkan bukti bahwa adaptive route layak dipromosikan ke engine produksi.

Snapshot dashboard/API setelah perbaikan summary dan restart VPS:

- Status Shadow v2: `CANDIDATE`
- Truth PnL: `+0.304167 SOL`
- Total cases: `665`
- Closed cases: `338`
- Open cases: `327`
- Complete cases: `665`
- True warning: `146`
- False alarm: `63`
- Missed risk: `38`
- Clean pass: `36`
- Top cause: `exit_route_thin`
- Exit route top: `THIN`
- Cluster risk top: `LOW`

## Arti Truth PnL Positif

`Truth PnL +0.266397 SOL` berarti Shadow v2 berhasil membuktikan bahwa warning pra-trade memberi nilai defensif. Dalam simulasi shadow, kandidat yang diberi warning lebih sering berakhir sebagai trade yang seharusnya dihindari dibanding profit yang terlewat.

Dengan data ini, Shadow v2 truth layer sudah tidak lagi diam. Ia sudah memberi sinyal bahwa masalah utama saat ini bukan hanya "kurang longgar", tetapi kualitas exit route dan risiko pre-trade yang belum cukup sehat.

## Arti Adaptive PnL Negatif

Adaptive layer masih negatif:

- Adaptive Impact: `-0.282932 SOL`
- Adaptive PnL: `-3.402352 SOL`
- Adaptive closed variants: `564`
- Adaptive Best Route: `none`

Breakdown adaptive route:

- `widen_shift_up`: closed `204`, wins `51`, losses `140`, impact `0`, pnl `-1.090680 SOL`
- `wait_5m_recheck`: closed `180`, wins `38`, losses `135`, impact `-0.141466 SOL`, pnl `-1.155836 SOL`
- `second_chance_queue`: closed `180`, wins `38`, losses `135`, impact `-0.141466 SOL`, pnl `-1.155836 SOL`

Kesimpulannya, adaptive route belum layak masuk engine. Jika adaptive dipromosikan sekarang, risiko utamanya adalah bot membuka ulang peluang yang secara statistik shadow masih rugi.

## Temuan Cacat Logika Dashboard

Dashboard sebelumnya dapat menampilkan `Best Route: widen_shift_up` walaupun route tersebut tidak menghasilkan impact positif.

Masalahnya bukan pada data shadow, tetapi pada cara summary memilih route terbaik. Route dengan impact `0` masih bisa dianggap terbaik hanya karena route lain lebih negatif. Ini berpotensi menyesatkan keputusan, seolah-olah `widen_shift_up` sudah layak, padahal PnL route tersebut masih negatif.

Perbaikan:

- File diubah: `shadow/shadow_v2_engine.js`
- Best route sekarang hanya dipilih jika `impact_sol > 0`
- Jika semua adaptive route negatif atau nol, dashboard akan menampilkan `none`

## Implikasi Ke Engine

Belum disarankan melonggarkan engine berdasarkan adaptive route.

Yang masuk akal untuk tahap berikutnya adalah memakai Shadow v2 truth sebagai lapisan defensif, bukan sebagai pembuka trade baru. Contoh arah yang aman:

- `exit_route_thin` menjadi warning lebih kuat
- candidate dengan route tipis masuk soft-block atau wajib recheck
- tidak otomatis deploy
- tidak menaikkan jumlah trade dengan cara membuka range adaptif yang belum terbukti

## Kesimpulan

Ada impact, tetapi impact yang sehat saat ini berasal dari kemampuan Shadow v2 menolak atau mewaspadai kandidat buruk. Belum ada bukti bahwa adaptive route seperti `widen_shift_up`, `wait_5m_recheck`, atau `second_chance_queue` meningkatkan hasil.

Keputusan yang benar:

- Truth layer: kandidat untuk dipakai sebagai warning/soft gate engine
- Adaptive layer: tetap shadow
- Engine live: jangan dilonggarkan dari adaptive route sampai adaptive impact positif dan stabil
