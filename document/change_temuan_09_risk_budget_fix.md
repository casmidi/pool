# TEMUAN 09 Risk Budget Fix

Tanggal: 2026-06-02

## Ringkasan

Risk budget sekarang mengendalikan allocation display. Sebelumnya dashboard bisa menampilkan `OVEREXPOSED` tetapi masih menyarankan banyak `AGGRESSIVE ENTRY` 14%-15%. Itu kontradiktif.

## Perubahan

- Raw suggested position tetap dihitung untuk conviction.
- Portfolio allocation sekarang memakai budget cap:
  - `SAFE`: cap 60%
  - `MODERATE`: cap 45%
  - `HIGH RISK`: cap 30%
  - `OVEREXPOSED`: cap 20%
- Per-position cap saat `OVEREXPOSED` menjadi 4%.
- Saat `OVEREXPOSED`, execution allocation diturunkan menjadi `SMALL TEST POSITION` atau `NO ENTRY`.
- UI `Size` memakai adjusted portfolio allocation, dengan raw size tetap ada di tooltip.

## Validasi

- 23 pool executable dengan raw size 15% tidak lagi tampil sebagai 23 aggressive entries.
- Output menjadi portfolio-capped allocation, contoh 4% small test untuk top slots dan 0% untuk sisa setelah cap habis.
