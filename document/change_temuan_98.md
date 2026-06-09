# TEMUAN 08 - Offensive Edge Engine

## Overview

TEMUAN 08 menambahkan offensive edge layer di atas defensive ROI engine dari TEMUAN 07. Fokusnya adalah memprioritaskan peluang terbaik, bukan hanya memfilter peluang buruk.

## Features Implemented

- `EdgeScore` 0-100 untuk ranking opportunity.
- `Top Opportunities` panel pada dashboard.
- `EntryTimingEngine` dengan state `NOW`, `5-15 MIN`, `WAIT`, dan `LATE`.
- `MarketRegime` dengan state `HOT`, `NORMAL`, `COLD`, dan `CHAOTIC`.
- Explainability untuk ranking melalui `WHY TOP` dan warning compact.

## Files Changed

- `lib/offensive_edge.js`
- `dashboard.js`
- `public/index.html`
- `document/change_temuan_98.md`

## Technical Decisions

- Offensive logic dibuat sebagai modul baru agar tidak membesarkan `roi_priority.js`.
- Formula EdgeScore memakai ROI defensive result sebagai input, sehingga blocker dan alpha cap tetap dihormati.
- API `/api/pools` sekarang mengirim `offensive.topOpportunities` dan `offensive.marketRegime`.
- UI dibuat additive: tidak mengganti Opportunity Watchlist, hanya menambah panel prioritas dan kolom Edge.

## Logic Summary

EdgeScore dihitung dari:

- Wallet quality
- Organic trend
- FeeTVL normalized score
- Confidence
- Alpha bonus
- Blocker penalty

Hard cap:

- `AVOID` maksimal 40
- `HOLD` maksimal 70
- `PASS` maksimal 100

Entry timing:

- Momentum kuat + PASS alpha menjadi `NOW`
- Setup sehat tapi belum urgent menjadi `5-15 MIN`
- Sinyal campuran menjadi `WAIT`
- Trend melemah atau volatility tinggi menjadi `LATE`

Market regime:

- Candidate `>25` menjadi `HOT`
- Candidate `15-25` menjadi `NORMAL`
- Candidate `<15` menjadi `COLD`
- Rasio blocker tinggi menjadi `CHAOTIC`

## Backward Compatibility

- Existing ROI fields tetap dipertahankan.
- Existing Opportunity Watchlist tetap berjalan.
- Existing `/api/pools` tetap mengirim `candidates`, `dropped`, `total`, dan `solPrice`.
- Perubahan bersifat additive melalui field `offensive`.

## Future Improvements

- Tambahkan historical confidence trend dari beberapa cycle terakhir.
- Simpan EdgeScore history untuk mendeteksi momentum rank naik/turun.
- Tambahkan tie-breaker berdasarkan realized trade outcome per pool family.
- Integrasikan regime dengan position sizing.

## Final Status

TEMUAN 08 selesai diimplementasikan sebagai offensive opportunity prioritization engine. Dashboard sekarang dapat menampilkan peluang teratas, timing entry, market regime, dan alasan ranking secara compact.
