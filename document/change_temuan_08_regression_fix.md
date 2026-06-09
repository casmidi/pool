# TEMUAN 08 Regression Fix - Signal Integrity Restoration

Tanggal: 2026-06-02

## Ringkasan

Regression fix ini mengunci ulang relasi antara defensive ROI engine dan offensive edge engine. Prinsip utama: offensive engine hanya boleh memperkaya prioritas, tidak boleh mengubah defensive truth.

## Perubahan Utama

- Defensive copy signal digabung ke `/api/pools` sebelum ROI dan offensive edge dihitung.
- `validateSignalIntegrity(pool)` ditambahkan di offensive engine.
- Blocked pool tidak bisa masuk Top Opportunities (`canRank=false`).
- Alpha `AVOID` selalu membuat offensive output tidak rankable dan defensive truth menjadi `BLOCKED`.
- UI memakai defensive view terkeras ketika ada copy-signal dan screener data untuk pool yang sama.
- Edge tier, entry timing, market regime, dan top opportunity panel tetap terlihat.
- WHY PASS/BLOCKED sekarang multi-factor, bukan satu alasan dangkal.

## Integrity Violations

Validator mendeteksi:

- `blocked_with_high_edge`
- `avoid_with_high_edge`
- `avoid_with_candidate_status`
- `dangerous_wallet_pass_state`
- `blocked_pool_rankable`

## Final Rule

Defensive engine always wins.

Offensive engine may enhance prioritization, but never override protection.
