# TEMUAN 08 FIX - Offensive Edge Correction

Tanggal: 2026-06-02

## Ringkasan

TEMUAN 08 FIX diterapkan untuk menghilangkan kontradiksi antara offensive ranking dan defensive ROI engine. Prinsip utama: pool `BLOCKED` atau alpha `AVOID` tidak boleh terlihat menarik secara visual.

## Perubahan

- EdgeScore untuk `BLOCKED` sekarang hard cap `35`.
- EdgeScore untuk `AVOID` tetap hard cap `40`.
- Hard blocker penalty dinaikkan menjadi `-25`.
- Setiap EdgeScore punya semantic tier:
  - `85+` = `ELITE EDGE`
  - `75-84` = `STRONG EDGE`
  - `60-74` = `GOOD EDGE`
  - `45-59` = `WEAK EDGE`
  - `<45` = `AVOID EDGE`
- Entry timing sekarang terlihat langsung sebagai `ENTRY NOW`, `ENTRY 5-15 MIN`, `ENTRY WAIT`, atau `ENTRY LATE`.
- Market regime ditampilkan sebagai label semantik seperti `HOT MARKET`, `NORMAL MARKET`, `COLD MARKET`, atau `CHAOTIC MARKET`.

## Validasi

- `BLOCKED` pool tidak bisa tampil di atas Edge 35.
- `AVOID` pool tidak bisa tampil di atas Edge 40.
- Hard blocker mendominasi ranking.
- Edge, Alpha, dan Status sekarang selaras secara psikologis.
