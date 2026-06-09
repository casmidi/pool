/**
 * intelligence/fallback-chain.js
 * Provider fallback chain: Birdeye → Dexscreener → TrackLP.
 * Each is tried in order when primary sources fail or are unavailable.
 * 
 * These are public/free APIs — no key required.
 */

import { rateLimitedFetch } from "./rate-limiter.js";
import { cacheWrap, cacheSet } from "./cache-manager.js";
import { log } from "../logger.js";

// ─── Birdeye (Public) ──────────────────────────────────────────

const BIRDEYE_BASE = "https://public-api.birdeye.so/v1";
const CACHE_TTL = 5 * 60 * 1000;
const BITQUERY_BASE = "https://graphql.bitquery.io";

function hasBitqueryKey() {
  return !!(process.env.BITQUERY_API_KEY || process.env.BITQUERY_KEY);
}

function hasBirdeyeKey() {
  return !!process.env.BIRDEYE_API_KEY;
}

/**
 * Fetch wallet portfolio from Birdeye public API.
 * @param {string} address
 * @returns {object|null}
 */
async function fetchBirdeyePortfolio(address) {
  const cacheKey = `birdeye:portfolio:${address}`;
  return cacheWrap(cacheKey, async () => {
    try {
      const result = await rateLimitedFetch("birdeye", async () => {
        const res = await fetch(
          `${BIRDEYE_BASE}/wallet/token_list?wallet=${address}`,
          { signal: AbortSignal.timeout(8000) }
        );
        if (!res.ok) return null;
        return res.json();
      });
      return result?.data || null;
    } catch (err) {
      log("birdeye", `portfolio error [${address.slice(0, 8)}]: ${err.message}`);
      return null;
    }
  }, { namespace: "birdeye", ttlMs: CACHE_TTL });
}

/**
 * Fetch token overview / metadata from Birdeye.
 * @param {string} mint — token mint address
 * @returns {object|null}
 */
async function fetchBirdeyeTokenOverview(mint) {
  const cacheKey = `birdeye:token:${mint}`;
  return cacheWrap(cacheKey, async () => {
    try {
      const result = await rateLimitedFetch("birdeye", async () => {
        const res = await fetch(
          `${BIRDEYE_BASE}/public/token_overview?address=${mint}`,
          { signal: AbortSignal.timeout(8000) }
        );
        if (!res.ok) return null;
        return res.json();
      });
      return result?.data || null;
    } catch (err) {
      log("birdeye", `token overview error [${mint.slice(0, 8)}]: ${err.message}`);
      return null;
    }
  }, { namespace: "birdeye", ttlMs: CACHE_TTL });
}

async function fetchBitqueryTokenSignals(mint) {
  if (!hasBitqueryKey()) return null;
  const cacheKey = `bitquery:token:${mint}`;
  return cacheWrap(cacheKey, async () => {
    try {
      const query = {
        query: `query ($mint: String!) {
          Solana {
            DEXTrades(
              limit: {count: 50}
              orderBy: {descending: Block_Time}
              where: {Trade: {Currency: {MintAddress: {is: $mint}}}}
            ) {
              Block { Time }
              Trade {
                Dex { ProtocolName }
                Currency { Symbol MintAddress }
                PriceInUSD
                Amount
                Side { AmountInUSD }
              }
            }
          }
        }`,
        variables: { mint },
      };
      const result = await rateLimitedFetch("bitquery", async () => {
        const res = await fetch(BITQUERY_BASE, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${process.env.BITQUERY_API_KEY || process.env.BITQUERY_KEY}`,
          },
          body: JSON.stringify(query),
          signal: AbortSignal.timeout(10_000),
        });
        if (!res.ok) return null;
        return res.json();
      });
      return result?.data?.Solana?.DEXTrades || null;
    } catch (err) {
      log("bitquery", `token signals error [${mint.slice(0, 8)}]: ${err.message}`);
      return null;
    }
  }, { namespace: "bitquery", ttlMs: CACHE_TTL });
}

// ─── Dexscreener (Public) ──────────────────────────────────────

const DEXSCREENER_BASE = "https://api.dexscreener.com/latest/dex";

/**
 * Search for token pairs on Dexscreener.
 * @param {string} query — token address or symbol
 * @returns {Array<object>}
 */
async function fetchDexscreenerPairs(query) {
  const cacheKey = `dexscreener:pairs:${query}`;
  return cacheWrap(cacheKey, async () => {
    try {
      const result = await rateLimitedFetch("dexscreener", async () => {
        const res = await fetch(
          `${DEXSCREENER_BASE}/search?q=${encodeURIComponent(query)}`,
          { signal: AbortSignal.timeout(8000) }
        );
        if (!res.ok) return [];
        return res.json();
      });
      return result?.pairs || [];
    } catch (err) {
      log("dexscreener", `search error [${query.slice(0, 12)}]: ${err.message}`);
      return [];
    }
  }, { namespace: "dexscreener", ttlMs: CACHE_TTL });
}

/**
 * Fetch pairs by token address.
 * @param {string} mint — token mint
 * @returns {Array<object>}
 */
async function fetchDexscreenerTokenPairs(mint) {
  const cacheKey = `dexscreener:token:${mint}`;
  return cacheWrap(cacheKey, async () => {
    try {
      const result = await rateLimitedFetch("dexscreener", async () => {
        const res = await fetch(
          `${DEXSCREENER_BASE}/tokens/${mint}`,
          { signal: AbortSignal.timeout(8000) }
        );
        if (!res.ok) return [];
        return res.json();
      });
      return result?.pairs || [];
    } catch (err) {
      log("dexscreener", `token pairs error [${mint.slice(0, 8)}]: ${err.message}`);
      return [];
    }
  }, { namespace: "dexscreener", ttlMs: CACHE_TTL });
}

// ─── TrackLP (Public) ──────────────────────────────────────────

const TRACKLP_BASE = "https://tracklp.com/api";

/**
 * Fetch wallet LP positions from TrackLP (Meteora-focused).
 * @param {string} address
 * @returns {Array<object>}
 */
async function fetchTrackLpPositions(address) {
  const cacheKey = `tracklp:positions:${address}`;
  return cacheWrap(cacheKey, async () => {
    try {
      const result = await rateLimitedFetch("tracklp", async () => {
        // TrackLP may have different endpoints; this is a common pattern
        const res = await fetch(
          `${TRACKLP_BASE}/solana/wallet/${address}/positions`,
          { signal: AbortSignal.timeout(8000) }
        );
        if (res.status === 404) return []; // wallet not tracked
        if (!res.ok) return null;
        return res.json();
      });
      return result?.positions || result?.data || [];
    } catch (err) {
      log("tracklp", `positions error [${address.slice(0, 8)}]: ${err.message}`);
      return null; // null = provider failed
    }
  }, { namespace: "tracklp", ttlMs: CACHE_TTL });
}

// ─── Fallback Chain ────────────────────────────────────────────

/**
 * Available fallback providers with their priority order.
 * Each has a fetch function and a priority (lower = tried first).
 */
const FALLBACK_PROVIDERS = [
  { name: "birdeye",     priority: 1, fetchPortfolio: fetchBirdeyePortfolio, fetchTokenInfo: fetchBirdeyeTokenOverview, available: true },
  { name: "dexscreener", priority: 2, fetchPairs: fetchDexscreenerPairs, fetchTokenInfo: fetchDexscreenerTokenPairs, available: true },
  { name: "tracklp",     priority: 3, fetchPositions: fetchTrackLpPositions, available: true },
  { name: "bitquery",    priority: 4, fetchTokenInfo: fetchBitqueryTokenSignals, available: hasBitqueryKey() },
];

/**
 * Try to fetch data from fallback providers in priority order.
 * Returns first successful result.
 * 
 * @param {string} dataType — type of data ("portfolio" | "positions" | "token-info")
 * @param {string} identifier — wallet address or token mint
 * @returns {Promise<{provider: string, data: any}|null>}
 */
export async function fallbackFetch(dataType, identifier) {
  const providers = [...FALLBACK_PROVIDERS].sort((a, b) => a.priority - b.priority);

  // Filter providers by data type capability
  const relevant = providers.filter((p) => {
    switch (dataType) {
      case "portfolio": return typeof p.fetchPortfolio === "function";
      case "positions": return typeof p.fetchPositions === "function";
      case "token-info": return typeof p.fetchTokenInfo === "function" || typeof p.fetchPairs === "function";
      default: return false;
    }
  });

  for (const provider of relevant) {
    try {
      let data = null;
      switch (dataType) {
        case "portfolio":
          data = await provider.fetchPortfolio(identifier);
          break;
        case "positions":
          data = await provider.fetchPositions(identifier);
          break;
        case "token-info":
          data = provider.fetchTokenInfo
            ? await provider.fetchTokenInfo(identifier)
            : await provider.fetchPairs(identifier);
          break;
      }

      if (data != null && (Array.isArray(data) ? data.length > 0 : true)) {
        log("fallback", `[${provider.name}] returned ${dataType} for ${identifier.slice(0, 8)}`);
        return { provider: provider.name, data };
      }
    } catch (err) {
      log("fallback", `[${provider.name}] failed for ${dataType}: ${err.message}`);
      continue;
    }
  }

  log("fallback", `All fallbacks exhausted for ${dataType}:${identifier.slice(0, 8)}`);
  return null;
}

/**
 * Fetch wallet portfolio via fallback chain.
 * @param {string} address
 * @returns {Promise<{provider: string, data: any}|null>}
 */
export async function fallbackWalletPortfolio(address) {
  return fallbackFetch("portfolio", address);
}

/**
 * Fetch wallet positions via fallback chain.
 * @param {string} address
 * @returns {Promise<{provider: string, data: any}|null>}
 */
export async function fallbackWalletPositions(address) {
  return fallbackFetch("positions", address);
}

/**
 * Fetch token info via fallback chain.
 * @param {string} mint — token mint address
 * @returns {Promise<{provider: string, data: any}|null>}
 */
export async function fallbackTokenInfo(mint) {
  return fallbackFetch("token-info", mint);
}

function num(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function pickBestDexPair(pairs = []) {
  return (Array.isArray(pairs) ? pairs : [])
    .filter((p) => String(p.chainId || "").toLowerCase() === "solana" || !p.chainId)
    .sort((a, b) => num(b?.liquidity?.usd, 0) - num(a?.liquidity?.usd, 0))[0] || null;
}

function normalizeFallbackRisk({ birdeye, dexPairs, mint }) {
  const dex = pickBestDexPair(dexPairs);
  const liquidityUsd = num(dex?.liquidity?.usd ?? birdeye?.liquidity ?? birdeye?.liquidityUsd, null);
  const fdv = num(dex?.fdv ?? birdeye?.fdv ?? birdeye?.marketCap ?? birdeye?.mc, null);
  const volume24h = num(dex?.volume?.h24 ?? birdeye?.v24hUSD ?? birdeye?.volume24hUSD, null);
  const buys24h = num(dex?.txns?.h24?.buys, null);
  const sells24h = num(dex?.txns?.h24?.sells, null);
  const pairCreatedAt = num(dex?.pairCreatedAt, null);
  const ageHours = pairCreatedAt ? (Date.now() - pairCreatedAt) / 3_600_000 : null;
  const priceChange24h = num(dex?.priceChange?.h24 ?? birdeye?.priceChange24hPercent, null);
  const holderCount = num(birdeye?.holder ?? birdeye?.holderCount ?? birdeye?.holders, null);

  const liqFdvRatio = liquidityUsd != null && fdv > 0 ? liquidityUsd / fdv : null;
  const volLiqRatio = volume24h != null && liquidityUsd > 0 ? volume24h / liquidityUsd : null;
  const sellRatio = buys24h != null && sells24h != null && buys24h + sells24h > 0
    ? sells24h / (buys24h + sells24h)
    : null;

  const warnings = [];
  if (liquidityUsd != null && liquidityUsd < 5_000) warnings.push("low_liquidity");
  if (liqFdvRatio != null && liqFdvRatio < 0.01) warnings.push("thin_liquidity_vs_fdv");
  if (volLiqRatio != null && volLiqRatio > 80) warnings.push("wash_volume_proxy");
  if (sellRatio != null && sellRatio > 0.78) warnings.push("sell_pressure_proxy");
  if (ageHours != null && ageHours < 1) warnings.push("very_new_pair");
  if (priceChange24h != null && priceChange24h < -65) warnings.push("crash_proxy");

  const enoughCoverage = liquidityUsd != null && (fdv != null || volume24h != null || buys24h != null || holderCount != null);
  const highRisk = warnings.some((w) => [
    "low_liquidity",
    "thin_liquidity_vs_fdv",
    "wash_volume_proxy",
    "crash_proxy",
  ].includes(w));

  if (!enoughCoverage) return null;
  return {
    mint,
    source: [
      birdeye ? "birdeye" : null,
      dex ? "dexscreener" : null,
    ].filter(Boolean).join("+") || "fallback",
    risk_level: highRisk ? "high" : "medium",
    risk_data_confidence: dex && birdeye ? "medium" : "low",
    risk_data_fallback: true,
    is_rugpull: false,
    is_wash: warnings.includes("wash_volume_proxy"),
    fallback_warnings: warnings,
    liquidity_usd: liquidityUsd,
    fdv,
    volume_24h_usd: volume24h,
    holder_count: holderCount,
    age_hours: ageHours,
    liq_fdv_ratio: liqFdvRatio,
    vol_liq_ratio: volLiqRatio,
    sell_ratio_24h: sellRatio,
    price_change_24h_pct: priceChange24h,
  };
}

export async function fallbackTokenRiskProfile(mint) {
  const cacheKey = `fallback:risk:${mint}`;
  return cacheWrap(cacheKey, async () => {
    const dexPairs = await fetchDexscreenerTokenPairs(mint);
    const birdeye = hasBirdeyeKey() ? await fetchBirdeyeTokenOverview(mint) : null;
    const profile = normalizeFallbackRisk({
      mint,
      birdeye,
      dexPairs,
    });
    if (profile) log("fallback", `risk profile ${mint.slice(0, 8)} via ${profile.source} (${profile.risk_data_confidence})`);
    return profile;
  }, { namespace: "fallback-risk", ttlMs: CACHE_TTL });
}

/**
 * Get status of all fallback providers.
 */
export function getFallbackStatus() {
  return {
    name: "Fallback Chain",
    providers: FALLBACK_PROVIDERS.map((p) => ({
      name: p.name,
      priority: p.priority,
      available: p.available,
      authenticated: false, // public APIs
      optionalKey: p.name === "bitquery",
    })),
  };
}
