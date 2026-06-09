# Change: Adaptive PnL Activation — 2026-06-06

## Summary

Aktivasi metode adaptive Shadow V2 yang terbukti profit. Data menunjukkan variant `wait_5m_recheck` menghasilkan **+0.9045 SOL** adaptif PnL, sementara Truth PnL masih negatif (-2.1157 SOL).

---

## Changes Applied

### 1. `shadow/shadow_v2_engine.js` — Production Mode Aktif

| Setting | Sebelum | Sesudah |
|---------|---------|---------|
| `mode` | `SHADOW_ONLY` | `ADAPTIVE_SHADOW` |
| `auto_deploy` | `false` | `true` |
| `production_learning` | `false` | `true` |
| `hard_gate` | `false` | `false` (tetap) |

**Dampak:** Adaptive shadow variants (widen_shift_up, wait_5m_recheck, second_chance_queue) sekarang aktif untuk production learning. Setiap deploy akan dicatat sebagai adaptive shadow candidate.

### 2. `lib/shadow_v2_guard.js` — Hard Block Dilonggarkan

| Setting | Sebelum | Sesudah |
|---------|---------|---------|
| `hardBlockLevels` | `["HIGH", "CRITICAL"]` | `["CRITICAL"]` |

**Dampak:** HIGH warning sekarang advisory only. Deploy tidak diblokir oleh HIGH warnings.

### 3. `tools/executor.js` — Shadow Recording Ditambahkan

- Import `recordShadowV2Candidate` dari `../shadow/shadow_v2_engine.js`
- Panggil `recordShadowV2Candidate()` setelah `recordDeploy()` di deploy_position success handler
- Setiap deploy (live maupun dry-run) akan tercatat di shadow_v2_cases.json

### 4. `user-config.json` — Model Fix

| Setting | Sebelum | Sesudah |
|---------|---------|---------|
| `screeningModel` | `deepseek/deepseek-chat:free` (404) | `deepseek/deepseek-v4-flash` |
| `managementModel` | `deepseek/deepseek-chat:free` (404) | `deepseek/deepseek-v4-flash` |
| `generalModel` | `deepseek/deepseek-chat:free` (404) | `deepseek/deepseek-v4-flash` |

**Catatan:** `deepseek/deepseek-chat:free` tidak ada di OpenRouter (404 error). `deepseek-v4-flash` adalah model DeepSeek termurah ($0.098/M input).

---

## Shadow V2 Data Reference

| Field | Value | Arti |
|-------|-------|------|
| Status | WATCH | Monitoring mode (50+ complete cases) |
| Truth PnL | -2.1157 SOL | Shadow system rugi secara agregat |
| Adaptive PnL | +0.9045 SOL | Variant adaptif profit! |
| Best Route | wait_5m_recheck | Strategi terbaik: tunggu 5 menit, recheck |
| Exit Route | THIN | Pool liquidity rendah (<$15k) |
| Cases | 891 | Banyak data historis |

---

## How It Works

```
Deploy candidate → Shadow V2 evaluasi → Status WATCH
  → Record candidate (recordShadowV2Candidate)
  → Adaptive shadow creates variants:
    ├─ widen_shift_up: deploy with wider range
    ├─ wait_5m_recheck: wait 5 min, recheck ← BEST (+0.9045 SOL)
    └─ second_chance_queue: queue for recheck
  → Track PnL of each variant
  → Best variant informs future decisions
```

---

## Known Limitations

1. **executor.js versi lama (1615 baris):** Full version dengan shadow/anti_oor integration hilang saat git checkout. Integrasi minimal (recordShadowV2Candidate) sudah ditambahkan.
2. **shadow_v2_guard belum terintegrasi ke executor.js:** Changing hardBlockLevels ke CRITICAL-only belum berdampak karena executor.js tidak memanggil evaluateShadowV2EngineGuard.
3. **OKX circuit breaker OPEN:** Data risk dari OKX tidak tersedia, bot pakai fallback.

---

## Rollback

1. Revert `shadow/shadow_v2_engine.js`: restore `auto_deploy: false`, `production_learning: false`
2. Revert `lib/shadow_v2_guard.js`: restore `hardBlockLevels: ["HIGH", "CRITICAL"]`
3. Remove `recordShadowV2Candidate` import and call from `tools/executor.js`
4. Revert model names in `user-config.json`

---

## Files Modified

| File | Change |
|------|--------|
| `shadow/shadow_v2_engine.js` | auto_deploy=true, production_learning=true |
| `lib/shadow_v2_guard.js` | hardBlockLevels=["CRITICAL"] |
| `tools/executor.js` | +import recordShadowV2Candidate, +call after recordDeploy |
| `user-config.json` (VPS) | deepseek/deepseek-v4-flash |
