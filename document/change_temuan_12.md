# TEMUAN 12 - Backtest Engine

Tanggal: 2026-06-02

## Overview

Roadmap TEMUAN 10-15 menetapkan prioritas ROI-first: mulai dari backtest engine. TEMUAN 12 mengubah layer 07-09 dari "feels right" menjadi "measurable edge" dengan simulasi atas trade history.

## Features Implemented

- Modul `lib/backtest_engine.js`.
- Endpoint `/api/backtest?days=30&mode=all`.
- Simulasi defensive ROI, offensive edge, dan execution intelligence pada historical closed trades.
- Output baseline vs simulated strategy.
- Metrics:
  - Win Rate
  - Average PnL
  - Total PnL
  - Max Drawdown
  - Profit Factor
  - Sharpe-like ratio
  - Feature contribution
  - False positive analytics

## Files Changed

- `lib/backtest_engine.js`
- `dashboard.js`
- `document/change_temuan_12.md`

## Technical Decisions

- Backend-first sesuai roadmap: less UI, more edge.
- Backtest memakai `data/pnl_log.json` agar tidak membutuhkan external dependency.
- Existing defensive/offensive/execution modules direuse, bukan duplikasi formula.
- Endpoint additive, tidak mengubah behavior trading atau dashboard existing.

## Logic Summary

Setiap closed trade diubah menjadi pool-like input:

- wallet score dari source wallet / decision breakdown
- FeeTVL dari stored fee ratio
- organic dari stored organic score
- confidence dari decision confidence
- alpha edge dari stored alpha edge

Lalu pipeline dijalankan:

1. ROI defensive enrichment
2. Offensive edge enrichment
3. Execution intelligence enrichment
4. Simulated executable trade filter
5. Metric aggregation

## Backward Compatibility

- Tidak ada perubahan pada existing API fields.
- `/api/backtest` bersifat optional.
- Jika history minim, endpoint tetap return metric kosong tanpa crash.

## Future Improvements

- Simulasikan alternative thresholds untuk TEMUAN 15.
- Tambahkan time-series equity curve.
- Tambahkan fee/cost adjustment lebih detail.
- Gunakan pool snapshots historical jika tersedia.

## Final Status

TEMUAN 12 Backtest Engine selesai sebagai fondasi profitability quality untuk roadmap TEMUAN 10-15.
