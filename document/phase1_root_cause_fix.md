# Phase 1 Root Cause Fix

## Temuan utama

Executor sebelumnya masih mengizinkan Anti-OOR HIGH/CRITICAL melewati guard pada mode dry-run melalui `anti_oor_sandbox_override`. Jalur ini membuat rekomendasi `WIDEN_AND_SHIFT_UP` tetap dapat berakhir pada deploy simulasi walaupun planner menyatakan `SHIFT_UP_NOT_SUPPORTED_FOR_SINGLE_SIDE_SOL`.

## File yang diubah

- `tools/executor.js`
- `tools/screening.js`
- `agent.js`
- `user-config.json`
- `lib/intelligence_ledger.js`
- `test/test-phase1-hard-block.js`

## Patch

1. Hard block berlaku untuk dry-run dan live ketika shift-up dibutuhkan tetapi tidak legal.
2. Anti-OOR HIGH/CRITICAL tidak lagi memiliki sandbox override.
3. Recheck menghitung ulang active bin, range, momentum, dan Anti-OOR; hasil unsupported tetap ditolak.
4. Screening model aktif dikembalikan ke `anthropic/claude-haiku-4.5`.
5. Screener tidak memakai fallback model gratis.
6. AI screening, keputusan, deploy, exit, attribution, dan konflik strategi ditulis sebagai JSONL di `data/intelligence/`.

## Log baru

- `shift_up_not_supported_block`
- `strategy_conflict_report_written`
- `ai_screening_log_written`

## Dampak yang diharapkan

Loss OOR-above dari range lama saat breakout naik berkurang karena kandidat yang membutuhkan shift-up tidak dapat dideploy dalam format single-side SOL.

## Risiko

Jumlah deploy dapat turun. Panggilan Claude dapat gagal tertutup ketika provider atau budget bermasalah karena screener tidak lagi pindah diam-diam ke model gratis.

## Pantauan 7 hari

- Jumlah `shift_up_not_supported_block`.
- Jumlah kandidat HIGH/CRITICAL yang ditolak.
- OOR-above dan loss cepat setelah entry.
- Latensi, error, token, dan biaya screening Claude.
- Kandidat yang membaik setelah recheck dibanding kandidat yang tetap diblok.
