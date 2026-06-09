# Fix: useFloor — Activate for All Wallet Types — 2026-06-07

## Problem

Floor amount (`useFloor`) hanya aktif untuk `walletEntry.type === "copy_signal_wallet"` (prev COPY signal wallets). Tapi signal dari ranked wallets (wallet #1-#10) tidak masuk type ini → `useFloor = false` → amount tetap 0.07-0.09 SOL → kena safety gate.

## Fix

**File:** `copy-engine/position-monitor.js`

**Before:**
```javascript
amountSol: recommendAmount(walletEntry, {
  useFloor: walletEntry.type === "copy_signal_wallet"
})
```

**After:**
```javascript
amountSol: recommendAmount(walletEntry, {
  useFloor: true
})
```

## Dampak

| Wallet | Sebelum | Sesudah |
|--------|:-------:|:-------:|
| Ranked wallet (score 50-58) | 0.07-0.09 SOL → ❌ Blocked | **0.10 SOL** (floor) → ✅ Lolos |
| Prev COPY signal wallet | 0.10 SOL (floor) ✅ | 0.10 SOL (floor) ✅ |
