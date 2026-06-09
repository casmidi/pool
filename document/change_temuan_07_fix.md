# TEMUAN 07 FIX - Edge Correction

Tanggal: 2026-06-02

## Ringkasan

TEMUAN 07 FIX diterapkan untuk mengurangi false positive pada Opportunity Watchlist. Fokus perubahan adalah memastikan status, alpha, wallet, confidence, dan organic trend tidak saling kontradiktif.

## Perubahan Logic

- Status decision sekarang berasal dari ROI engine:
  - `AVOID` atau hard blocker menjadi `BLOCKED`.
  - `HOLD` menjadi `WATCH`.
  - `PASS` dengan wallet sehat menjadi `CANDIDATE`.
- Wallet override ditambahkan:
  - Wallet `< 40` memaksa alpha maksimum `AVOID`.
  - Wallet `40-55` memaksa alpha maksimum `HOLD`.
  - FeeTVL tinggi tidak bisa mengalahkan wallet lemah.
- Confidence dikoreksi:
  - `AVOID` dibatasi maksimal `45%`.
  - Wallet `< 40` memakai multiplier `0.6`.
  - Hard blocker memberi penalti `-15`.
- Organic trend engine ditambahkan:
  - `ACCELERATING`
  - `STABLE`
  - `DECELERATING`
- Explainability visible:
  - `WHY BLOCKED`
  - `WHY HOLD`
  - `WHY PASS`

## UI

- Opportunity Watchlist menampilkan status akhir dari ROI engine.
- Organic menampilkan angka, dot, dan arah momentum.
- Pool row menampilkan alasan utama secara compact.
- Confidence detail menampilkan breakdown dan koreksi confidence.

## Validasi

- Wallet 36 + FeeTVL tinggi menghasilkan `AVOID/BLOCKED`, bukan `CANDIDATE`.
- Wallet 48 + FeeTVL tinggi menghasilkan `HOLD/WATCH`.
- Wallet sehat + FeeTVL kuat tetap `PASS/CANDIDATE`.
