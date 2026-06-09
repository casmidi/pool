# Penjelasan File Penting Meridian

Dokumen ini merangkum file dan folder penting di project Meridian. Fokusnya adalah peta kerja operator/developer, bukan daftar seluruh file.

## Tree Ringkas

```text
D:\meridian-bot
|-- index.js
|-- agent.js
|-- cli.js
|-- config.js
|-- dashboard.js
|-- ecosystem.config.cjs
|-- package.json
|-- user-config.json
|-- user-config.example.json
|-- state.js
|-- state.json
|-- logger.js
|-- telegram.js
|-- ai-budget.js
|-- pool-memory.js
|-- token-blacklist.js
|-- dev-blocklist.js
|-- signal-tracker.js
|-- signal-weights.js
|-- strategy/
|   |-- pool-scorer.js
|   |-- dlmm-edge.js
|   `-- position-manager.js
|-- tools/
|   |-- screening.js
|   |-- executor.js
|   |-- dlmm.js
|   |-- okx.js
|   |-- wallet.js
|   |-- token.js
|   |-- study.js
|   |-- chart-indicators.js
|   |-- agent-meridian.js
|   `-- definitions.js
|-- intelligence/
|   |-- fusion-layer.js
|   |-- fallback-chain.js
|   |-- cache-manager.js
|   |-- redis-cache.js
|   |-- rate-limiter.js
|   |-- gmgn-provider.js
|   |-- helius-provider.js
|   |-- dune-provider.js
|   |-- market-regime.js
|   |-- darwin-intelligence.js
|   |-- pool-decay.js
|   |-- capital-allocator.js
|   |-- position-sizing.js
|   |-- crowding-engine.js
|   `-- explainable-intelligence.js
|-- lib/
|   |-- operator_intelligence.js
|   |-- alpha_edge.js
|   |-- ai_optimizer.js
|   |-- feature_impact.js
|   `-- pnl_tracker.js
|-- decision/
|   |-- analysis-engine.js
|   `-- types.js
|-- copy-engine/
|   |-- copy-state.js
|   `-- position-monitor.js
|-- ranking/
|   |-- ranking-db.js
|   |-- scorer.js
|   `-- top-performers.js
|-- public/
|   `-- index.html
|-- data/
|-- logs/
|-- test/
|-- document/
`-- garbage/
```

## Root Files

| File | Fungsi |
|---|---|
| `index.js` | Entrypoint utama bot. Mengatur siklus kerja utama seperti screening, agent decision, deployment, monitoring, dan integrasi modul lain. |
| `agent.js` | Layer agent/LLM yang membaca kandidat, menganalisis peluang, dan memberi keputusan berbasis prompt serta konteks sistem. |
| `cli.js` | Interface command line untuk menjalankan fungsi tertentu secara manual. Berguna untuk debug/operator task. |
| `config.js` | Pusat konfigurasi runtime. Membaca `user-config.json`, environment variable, dan default sistem. |
| `dashboard.js` | Server dashboard/API lokal untuk menampilkan status bot, PnL, ranking, calendar, feature impact, dan observability. |
| `ecosystem.config.cjs` | Konfigurasi PM2 untuk menjalankan service di VPS. |
| `package.json` | Metadata Node.js project, dependency, dan script npm. |
| `package-lock.json` | Lockfile dependency agar instalasi package konsisten. |
| `user-config.json` | Konfigurasi lokal/live yang dipakai bot. File sensitif, jangan sembarang overwrite. |
| `user-config.example.json` | Contoh konfigurasi untuk referensi aman. |
| `.env` | Environment secret/API key lokal. File sensitif. |
| `.env.example` | Contoh environment variable tanpa secret. |
| `state.js` | Helper baca/tulis state runtime. |
| `state.json` | Data state runtime bot. Jangan dihapus saat bot berjalan. |
| `logger.js` | Helper logging standar project. |
| `telegram.js` | Integrasi notifikasi Telegram. |
| `ai-budget.js` | Kontrol budget/cap pemakaian AI. |
| `pool-memory.js` | Memory pool/base mint cooldown agar bot tidak mengulang pool yang sedang dihindari. |
| `token-blacklist.js` | Blacklist token/pool yang tidak boleh diproses. |
| `dev-blocklist.js` | Blacklist creator/deployer berisiko. |
| `signal-tracker.js` | Tracking sinyal dan outcome untuk pembelajaran. |
| `signal-weights.js` | Bobot sinyal/Darwin yang dipakai dalam scoring. |

## Folder `strategy`

| File | Fungsi |
|---|---|
| `strategy/pool-scorer.js` | Mesin scoring pool. Mengubah metrik pool menjadi score, grade, recommendation, breakdown, dan penalty. |
| `strategy/dlmm-edge.js` | Planner entry DLMM, termasuk range/bin logic dan kualitas entry. |
| `strategy/position-manager.js` | Evaluasi posisi aktif. Menghasilkan rekomendasi `HOLD`, `CLAIM_AND_HOLD`, `EXIT`, atau `EXIT_URGENT`. Tidak mengeksekusi trade langsung. |

## Folder `tools`

| File | Fungsi |
|---|---|
| `tools/screening.js` | Pipeline utama pencarian kandidat pool: discovery, filter, enrichment, scoring, ranking, dan output kandidat final. |
| `tools/executor.js` | Eksekusi aksi deploy/exit/claim sesuai keputusan agent dan aturan sistem. Ini area sensitif karena menyentuh behavior live. |
| `tools/dlmm.js` | Integrasi teknis DLMM/Meteora untuk operasi pool/position. |
| `tools/okx.js` | Fetch data risiko/token dari OKX atau sumber terkait. |
| `tools/wallet.js` | Helper wallet/balance/posisi. |
| `tools/token.js` | Helper metadata token. |
| `tools/study.js` | Tool untuk study pool/wallet sebelum decision. |
| `tools/chart-indicators.js` | Konfirmasi indikator teknikal/chart. |
| `tools/agent-meridian.js` | Helper komunikasi dengan agent Meridian API. |
| `tools/definitions.js` | Definisi tool/function yang bisa dipakai agent. |

## Folder `intelligence`

| File | Fungsi |
|---|---|
| `intelligence/fusion-layer.js` | Menggabungkan data intelligence dari beberapa provider. |
| `intelligence/fallback-chain.js` | Fallback risk/intelligence saat provider utama tidak lengkap. |
| `intelligence/cache-manager.js` | Cache data intelligence agar API tidak boros. |
| `intelligence/redis-cache.js` | Cache Redis untuk environment yang memakai Redis. |
| `intelligence/rate-limiter.js` | Rate limiter provider intelligence. |
| `intelligence/gmgn-provider.js` | Provider data GMGN. |
| `intelligence/helius-provider.js` | Provider data Helius. |
| `intelligence/dune-provider.js` | Provider data Dune. |
| `intelligence/market-regime.js` | Deteksi market regime: `EUPHORIC`, `TRENDING`, `DEFENSIVE`, `DEAD_MARKET`. Default advisory. |
| `intelligence/darwin-intelligence.js` | Learning dari outcome trade untuk rekomendasi bobot adaptif. Default tidak mengubah scoring kecuali dipakai eksplisit. |
| `intelligence/pool-decay.js` | Prediksi decay pool: half-life, fee decay, sustainability, dan decay risk. |
| `intelligence/capital-allocator.js` | Analisis opportunity cost posisi saat ada pool yang lebih baik. |
| `intelligence/position-sizing.js` | Rekomendasi ukuran posisi berbasis conviction. Default advisory. |
| `intelligence/crowding-engine.js` | Analisis crowding, LP competition, dan fee compression risk. |
| `intelligence/explainable-intelligence.js` | Menggabungkan regime, decay, crowding, sizing menjadi penjelasan operator. |

## Folder `lib`

| File | Fungsi |
|---|---|
| `lib/operator_intelligence.js` | Intelligence operasional seperti market condition, capital protection, dan shadow decision. |
| `lib/alpha_edge.js` | Analytics/filter alpha edge seperti survival, euphoria, crowding, trust, organic, dan rank. |
| `lib/ai_optimizer.js` | Optimasi pemakaian AI: cache, bypass, cooldown, mode hemat, dan kualitas keputusan. |
| `lib/feature_impact.js` | Analytics feature impact untuk mengukur apakah filter membantu atau overblocking. |
| `lib/pnl_tracker.js` | Tracking PnL, calendar, summary, dan data performa. |

## Folder `decision`

| File | Fungsi |
|---|---|
| `decision/analysis-engine.js` | Layer analisis keputusan sebelum deploy/copy. |
| `decision/types.js` | Tipe/shape data decision layer. |

## Folder `copy-engine`

| File | Fungsi |
|---|---|
| `copy-engine/copy-state.js` | State copy trading. |
| `copy-engine/position-monitor.js` | Monitoring posisi copy trading dan blacklist otomatis jika diperlukan. |

## Folder `ranking`

| File | Fungsi |
|---|---|
| `ranking/ranking-db.js` | Database/state ranking wallet. |
| `ranking/scorer.js` | Scoring wallet/ranking. |
| `ranking/top-performers.js` | Mengambil dan mengolah top wallet/LP performer. |

## Dashboard

| File/Folder | Fungsi |
|---|---|
| `public/index.html` | UI dashboard utama. Menampilkan overview, calendar, trade history, ranking, pool candidates, log activity, wallet, dan feature impact. |
| `dashboard.js` | Backend API dashboard yang menyuplai data ke `public/index.html`. |

## Data, Log, Test, dan Dokumen

| Folder | Fungsi |
|---|---|
| `data/` | File data analytics/runtime seperti cache, feature impact, AI quality, dan data pendukung lain. |
| `logs/` | Output log runtime. Jangan dianggap source code. |
| `test/` | Test manual/Node untuk validasi modul penting. |
| `document/` | Dokumentasi project, laporan perubahan, dan catatan operator. Semua `.md` sebaiknya berada di sini. |
| `garbage/` | Tempat file tidak terpakai yang dipindahkan dari root agar tidak mengganggu struktur project. |
| `scripts/` | Script utilitas/backtest/deployment yang dijalankan manual. |
| `backtesting/` | Modul backtest/optimizer. |
| `monitoring/` | Modul monitoring dan auto-improvement. |

## File yang Perlu Hati-hati Saat Diubah

| File | Alasan |
|---|---|
| `tools/executor.js` | Bisa mengubah behavior deploy/exit live. |
| `tools/screening.js` | Bisa mengubah kandidat yang masuk ke agent. |
| `strategy/pool-scorer.js` | Bisa mengubah ranking dan filter pool. |
| `config.js` | Bisa mengubah semua behavior sistem. |
| `user-config.json` | Konfigurasi live dan secret/operator preference. |
| `.env` | Berisi secret/API key. |
| `state.json` | State runtime bot. Mengubah manual bisa mengacaukan memory bot. |

## Alur Kerja Singkat

```text
index.js
  -> tools/screening.js
     -> intelligence/* enrichment
     -> strategy/pool-scorer.js
     -> strategy/dlmm-edge.js
  -> agent.js / decision/*
  -> tools/executor.js
  -> state.js, logs/, data/
  -> dashboard.js + public/index.html
```

## Catatan Operator

- Untuk perubahan UI dashboard, biasanya file utama adalah `public/index.html` dan API-nya di `dashboard.js`.
- Untuk perubahan filter kandidat, mulai dari `tools/screening.js`, lalu cek efeknya ke `strategy/pool-scorer.js`.
- Untuk perubahan eksekusi live, baca `tools/executor.js` dengan sangat hati-hati.
- Untuk analytics-only, tempat paling aman biasanya `lib/`, `intelligence/`, `data/`, dan endpoint dashboard.
- Setelah mengubah file runtime di VPS, restart PM2 process yang relevan.
