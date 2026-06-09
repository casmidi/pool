import "dotenv/config";
import fs from "fs";
import path from "path";
import https from "https";
import { fileURLToPath } from "url";
import { sendMessage, isEnabled as telegramEnabled } from "./telegram.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "data");

const PATHS = {
  output: path.join(DATA_DIR, "meme_alpha_finder.json"),
  alerts: path.join(DATA_DIR, "meme_alpha_alerts.json"),
};

const INTERVAL_MS = Number(process.env.MEME_ALPHA_FINDER_INTERVAL_MS || 10 * 60 * 1000);
const MAX_SOLANA_PROFILES = Number(process.env.MEME_ALPHA_MAX_PROFILES || 30);
const MAX_DETAIL_FETCHES = Number(process.env.MEME_ALPHA_MAX_DETAILS || 12);
const OHLCV_LIMIT = Number(process.env.MEME_ALPHA_OHLCV_LIMIT || 20);
const TELEGRAM_ALERTS_ENABLED = String(process.env.MEME_ALPHA_TELEGRAM_ALERTS || "true").toLowerCase() !== "false";
const TELEGRAM_ALERT_STATUSES = new Set(
  String(process.env.MEME_ALPHA_TELEGRAM_STATUSES || "HOT")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean)
);
const TELEGRAM_ALERT_COOLDOWN_MS = Number(process.env.MEME_ALPHA_TELEGRAM_COOLDOWN_MS || 6 * 60 * 60 * 1000);

function writeJSON(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function readJSON(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function shortAddress(address = "") {
  const s = String(address || "");
  if (s.length <= 14) return s || "--";
  return `${s.slice(0, 6)}...${s.slice(-5)}`;
}

function fmtUsd(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "--";
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (Math.abs(n) >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

function fmtPct(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "--";
  return `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;
}

function fetchJSON(url, timeoutMs = 12_000) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        accept: "application/json",
        "user-agent": "meridian-meme-alpha-finder/1.0",
      },
      timeout: timeoutMs,
    }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }
        try {
          resolve(JSON.parse(body));
        } catch (err) {
          reject(err);
        }
      });
    });
    req.on("timeout", () => {
      req.destroy(new Error("request timeout"));
    });
    req.on("error", reject);
  });
}

function bestPair(pairs = []) {
  const solPairs = pairs.filter((p) => p?.chainId === "solana");
  return solPairs.sort((a, b) => num(b.liquidity?.usd) - num(a.liquidity?.usd))[0] || null;
}

function normalizeOhlcv(payload = {}) {
  const rows = payload?.data?.attributes?.ohlcv_list;
  if (!Array.isArray(rows)) return [];
  return rows
    .map((row) => ({
      ts: num(row?.[0], null),
      open: num(row?.[1], null),
      high: num(row?.[2], null),
      low: num(row?.[3], null),
      close: num(row?.[4], null),
      volume: num(row?.[5], 0),
    }))
    .filter((c) => c.ts && c.open > 0 && c.high > 0 && c.low > 0 && c.close > 0)
    .sort((a, b) => a.ts - b.ts);
}

async function fetchOhlcv(pairAddress = "") {
  if (!pairAddress) return [];
  const url = `https://api.geckoterminal.com/api/v2/networks/solana/pools/${encodeURIComponent(pairAddress)}/ohlcv/minute?aggregate=1&limit=${OHLCV_LIMIT}&currency=usd`;
  try {
    return normalizeOhlcv(await fetchJSON(url, 8_000));
  } catch {
    return [];
  }
}

function tokenSide(pair = {}, tokenAddress = "") {
  const target = String(tokenAddress || "").toLowerCase();
  const base = String(pair.baseToken?.address || "").toLowerCase();
  const quote = String(pair.quoteToken?.address || "").toLowerCase();
  if (base === target) return pair.baseToken;
  if (quote === target) return pair.quoteToken;
  return pair.baseToken || {};
}

function riskFlags(pair = {}, profile = {}) {
  const flags = [];
  const liquidity = num(pair.liquidity?.usd);
  const mcap = num(pair.marketCap ?? pair.fdv);
  const volume5m = num(pair.volume?.m5);
  const volume1h = num(pair.volume?.h1);
  const change5m = num(pair.priceChange?.m5);
  const change1h = num(pair.priceChange?.h1);
  const change6h = num(pair.priceChange?.h6);
  const tx5m = num(pair.txns?.m5?.buys) + num(pair.txns?.m5?.sells);
  const buys5m = num(pair.txns?.m5?.buys);
  const sells5m = num(pair.txns?.m5?.sells);
  const ageMs = Date.now() - num(pair.pairCreatedAt, Date.now());
  const ageMinutes = Math.max(0, ageMs / 60_000);
  const infoLinks = Array.isArray(profile.links) ? profile.links.length : 0;

  if (liquidity < 5_000) flags.push("thin_liquidity");
  if (liquidity > 0 && mcap > 0 && liquidity / mcap < 0.03) flags.push("low_liquidity_to_mcap");
  if (volume1h > 0 && liquidity > 0 && volume1h / liquidity > 8) flags.push("very_hot_volume");
  if (sells5m > buys5m * 1.25 && sells5m - buys5m >= 10) flags.push("sell_pressure_5m");
  if (change5m <= -8) flags.push("dumping_5m");
  if (change1h >= 40 && change5m < 0) flags.push("post_pump_pullback");
  if (change1h >= 120 || change6h >= 200) flags.push("hot_late_after_big_move");
  if (tx5m < 8) flags.push("low_recent_tx");
  if (ageMinutes < 10) flags.push("very_new_pair");
  if (infoLinks === 0) flags.push("no_social_links");
  if (!pair.url) flags.push("missing_dex_url");
  return flags;
}

function scoreCandidate(pair = {}, profile = {}) {
  const liquidity = num(pair.liquidity?.usd);
  const mcap = num(pair.marketCap ?? pair.fdv);
  const volume5m = num(pair.volume?.m5);
  const volume1h = num(pair.volume?.h1);
  const buys5m = num(pair.txns?.m5?.buys);
  const sells5m = num(pair.txns?.m5?.sells);
  const buys1h = num(pair.txns?.h1?.buys);
  const sells1h = num(pair.txns?.h1?.sells);
  const change5m = num(pair.priceChange?.m5);
  const change1h = num(pair.priceChange?.h1);
  const ageMs = Date.now() - num(pair.pairCreatedAt, Date.now());
  const ageHours = Math.max(0, ageMs / 3_600_000);
  const links = Array.isArray(profile.links) ? profile.links.length : 0;
  const flags = riskFlags(pair, profile);

  let score = 0;
  if (liquidity >= 8_000) score += 12;
  if (liquidity >= 20_000) score += 10;
  if (mcap > 0 && mcap <= 2_000_000) score += 10;
  if (mcap > 0 && mcap <= 250_000) score += 8;
  if (volume5m >= 5_000) score += 12;
  if (volume1h >= 25_000) score += 10;
  if (buys5m > sells5m) score += 8;
  if (buys1h > sells1h) score += 6;
  if (change5m > 5 && change5m < 80) score += 8;
  if (change1h > 10 && change1h < 250) score += 8;
  if (ageHours <= 6) score += 8;
  if (links >= 2) score += 6;
  if (profile.description) score += 4;

  if (flags.includes("thin_liquidity")) score -= 18;
  if (flags.includes("low_recent_tx")) score -= 12;
  if (flags.includes("no_social_links")) score -= 8;
  if (flags.includes("very_new_pair")) score -= 14;
  if (flags.includes("very_hot_volume")) score -= 8;
  if (flags.includes("sell_pressure_5m")) score -= 18;
  if (flags.includes("post_pump_pullback")) score -= 14;
  if (flags.includes("hot_late_after_big_move")) score -= 12;
  if (flags.includes("dumping_5m")) score -= 24;
  if (change5m > 120 || change1h > 400) score -= 12;

  score = Math.max(0, Math.min(100, Math.round(score)));

  let status = "HOLD";
  if (flags.includes("thin_liquidity") || flags.includes("missing_dex_url")) status = "DANGER";
  else if (flags.includes("dumping_5m")) status = "DUMPED";
  else if (flags.includes("sell_pressure_5m") && change1h > 20) status = "PULLBACK";
  else if (flags.includes("post_pump_pullback")) status = "PULLBACK";
  else if (flags.includes("very_new_pair")) status = score >= 72 ? "HOT_LATE" : "WATCH";
  else if (flags.includes("hot_late_after_big_move") || flags.includes("very_hot_volume")) status = score >= 60 ? "HOT_LATE" : "WATCH";
  else if (score >= 72 && liquidity >= 10_000 && volume5m >= 5_000) status = "HOT";
  else if (score >= 48) status = "WATCH";

  return { score, status, flags };
}

function avg(values = []) {
  const nums = values.map((v) => Number(v)).filter(Number.isFinite);
  return nums.length ? nums.reduce((sum, v) => sum + v, 0) / nums.length : 0;
}

function pctMove(from, to) {
  const a = Number(from);
  const b = Number(to);
  if (!Number.isFinite(a) || !Number.isFinite(b) || a <= 0) return 0;
  return ((b - a) / a) * 100;
}

function buildMemeRiskOracle(pair = {}, alpha = {}, candles = []) {
  if (!candles.length) {
    return {
      available: false,
      phase: "NO_CANDLE_DATA",
      action: alpha.status === "HOT" ? "WATCH" : "WAIT",
      score: 45,
      reasons: ["OHLC candle data unavailable; Dex metrics only"],
      metrics: {},
    };
  }

  const recent = candles[candles.length - 1];
  const last5 = candles.slice(-5);
  const previous = candles.slice(-6, -1);
  const recentHigh = Math.max(...candles.map((c) => c.high));
  const recentLow = Math.min(...candles.map((c) => c.low));
  const candlePct = pctMove(recent.open, recent.close);
  const dumpFromHighPct = recentHigh > 0 ? pctMove(recentHigh, recent.close) : 0;
  const bounceFromLowPct = recentLow > 0 ? pctMove(recentLow, recent.close) : 0;
  const redCount = last5.filter((c) => c.close < c.open).length;
  const greenCount = last5.filter((c) => c.close >= c.open).length;
  const avgPrevVol = avg(previous.map((c) => c.volume));
  const volumeRatio = avgPrevVol > 0 ? recent.volume / avgPrevVol : 1;
  const prevClose = candles[candles.length - 2]?.close || recent.open;
  const isReclaiming = candlePct > 2 && recent.close > prevClose && dumpFromHighPct > -45 && dumpFromHighPct < -8;
  const veryNew = (alpha.flags || []).includes("very_new_pair");

  let phase = "WATCH";
  let action = "WAIT";
  let score = 50;
  const reasons = [];

  if (candlePct <= -10 || dumpFromHighPct <= -65) {
    phase = "DUMPED";
    action = "AVOID";
    score = 10;
    reasons.push("large red candle or deep dump from recent high");
  } else if (redCount >= 4 || dumpFromHighPct <= -40) {
    phase = "PULLBACK";
    action = "WAIT_RECLAIM";
    score = 25;
    reasons.push("pullback/red streak after move");
  } else if (isReclaiming) {
    phase = "RECLAIM_READY";
    action = "MANUAL_CHECK_SMALL_ONLY";
    score = 68;
    reasons.push("green reclaim attempt after pullback");
  } else if (alpha.status === "HOT" && candlePct > 0 && dumpFromHighPct > -25 && greenCount >= redCount && !veryNew) {
    phase = "EARLY";
    action = "MANUAL_CHECK_SMALL_ONLY";
    score = 74;
    reasons.push("early momentum with candle still constructive");
  } else if (veryNew || dumpFromHighPct <= -25 || volumeRatio > 3) {
    phase = "HOT_LATE";
    action = "WAIT_MORE_CANDLES";
    score = 38;
    reasons.push(veryNew ? "pair is too new" : "move is extended or volume spike is crowded");
  } else {
    reasons.push("not enough confirmation for entry");
  }

  return {
    available: true,
    phase,
    action,
    score,
    reasons,
    metrics: {
      candlePct: Math.round(candlePct * 100) / 100,
      dumpFromHighPct: Math.round(dumpFromHighPct * 100) / 100,
      bounceFromLowPct: Math.round(bounceFromLowPct * 100) / 100,
      redCount,
      greenCount,
      volumeRatio: Math.round(volumeRatio * 100) / 100,
      candles: candles.length,
    },
  };
}

function applyOracleStatus(alpha = {}, oracle = {}) {
  if (!oracle?.available) return alpha;
  let status = alpha.status;
  if (oracle.phase === "DUMPED") status = "DUMPED";
  else if (oracle.phase === "PULLBACK") status = "PULLBACK";
  else if (oracle.phase === "RECLAIM_READY") status = "RECLAIM_READY";
  else if (oracle.phase === "HOT_LATE" && status === "HOT") status = "HOT_LATE";
  return {
    ...alpha,
    status,
    score: Math.max(0, Math.min(100, Math.round((Number(alpha.score || 0) * 0.65) + (Number(oracle.score || 0) * 0.35)))),
  };
}

async function enrichProfile(profile = {}) {
  const tokenAddress = profile.tokenAddress;
  const pairs = await fetchJSON(`https://api.dexscreener.com/token-pairs/v1/solana/${encodeURIComponent(tokenAddress)}`);
  const pair = bestPair(Array.isArray(pairs) ? pairs : []);
  if (!pair) return null;
  const token = tokenSide(pair, tokenAddress);
  const rawAlpha = scoreCandidate(pair, profile);
  const candles = await fetchOhlcv(pair.pairAddress);
  const oracle = buildMemeRiskOracle(pair, rawAlpha, candles);
  const alpha = applyOracleStatus(rawAlpha, oracle);
  const ageMs = Date.now() - num(pair.pairCreatedAt, Date.now());
  const ageMinutes = Math.max(0, Math.round(ageMs / 60_000));

  return {
    token: {
      address: tokenAddress,
      shortAddress: shortAddress(tokenAddress),
      name: token.name || profile.description || "--",
      symbol: token.symbol || "--",
      image: profile.icon || null,
      dexUrl: pair.url || profile.url || null,
      chartUrl: pair.url ? `${pair.url}?embed=1&theme=dark&trades=0&info=0` : null,
    },
    status: alpha.status,
    score: alpha.score,
    riskFlags: alpha.flags,
    oracle,
    market: {
      dexId: pair.dexId || "--",
      pairAddress: pair.pairAddress || null,
      priceUsd: num(pair.priceUsd, null),
      marketCapUsd: num(pair.marketCap ?? pair.fdv, null),
      liquidityUsd: num(pair.liquidity?.usd, null),
      volume5mUsd: num(pair.volume?.m5, 0),
      volume1hUsd: num(pair.volume?.h1, 0),
      priceChange5mPct: num(pair.priceChange?.m5, 0),
      priceChange1hPct: num(pair.priceChange?.h1, 0),
      priceChange6hPct: num(pair.priceChange?.h6, 0),
      priceChange24hPct: num(pair.priceChange?.h24, 0),
      buys5m: num(pair.txns?.m5?.buys, 0),
      sells5m: num(pair.txns?.m5?.sells, 0),
      buys1h: num(pair.txns?.h1?.buys, 0),
      sells1h: num(pair.txns?.h1?.sells, 0),
      ageMinutes,
    },
    entryHint: buildEntryHint(alpha, pair, oracle),
    reason: buildReason(alpha, pair),
    firstSeenSource: "dexscreener_token_profiles",
    observedAt: new Date().toISOString(),
  };
}

function buildReason(alpha, pair = {}) {
  const parts = [];
  const liquidity = num(pair.liquidity?.usd);
  const volume5m = num(pair.volume?.m5);
  const buys5m = num(pair.txns?.m5?.buys);
  const sells5m = num(pair.txns?.m5?.sells);
  const change5m = num(pair.priceChange?.m5);
  const change1h = num(pair.priceChange?.h1);
  if (volume5m >= 5_000) parts.push(`5m volume $${Math.round(volume5m)}`);
  if (liquidity >= 8_000) parts.push(`liquidity $${Math.round(liquidity)}`);
  if (buys5m > sells5m) parts.push(`buy pressure ${buys5m}/${sells5m}`);
  if (sells5m > buys5m) parts.push(`sell pressure ${buys5m}/${sells5m}`);
  if (change5m > 0) parts.push(`5m change ${change5m.toFixed(1)}%`);
  if (change5m < 0) parts.push(`5m pullback ${change5m.toFixed(1)}%`);
  if (change1h > 40) parts.push(`1h already +${change1h.toFixed(1)}%`);
  if (alpha.flags.length) parts.push(`risk ${alpha.flags.slice(0, 3).join(", ")}`);
  return parts.join(" | ") || "new Solana token profile observed";
}

function buildEntryHint(alpha, pair = {}, oracle = {}) {
  const flags = alpha.flags || [];
  const change5m = num(pair.priceChange?.m5);
  const change1h = num(pair.priceChange?.h1);
  if (oracle?.available && oracle.action === "AVOID") return `ORACLE AVOID: ${oracle.reasons?.[0] || "chart risk too high"}.`;
  if (oracle?.available && oracle.phase === "RECLAIM_READY") return "RECLAIM READY: only manual small check after confirming chart and sell route.";
  if (oracle?.available && oracle.phase === "HOT_LATE") return `ORACLE HOT LATE: ${oracle.reasons?.[0] || "activity may be crowded"}.`;
  if (flags.includes("sell_pressure_5m")) return "SELL PRESSURE: 5m sells dominate buys. Wait, do not chase.";
  if (alpha.status === "HOT") return "EARLY MOMENTUM: still verify chart before manual buy.";
  if (alpha.status === "HOT_LATE" && flags.includes("very_new_pair")) return "TOO NEW / HOT LATE: first candles are unreliable. Wait for more candles and liquidity stability.";
  if (alpha.status === "HOT_LATE") return "HOT LATE: activity is high, but move may already be crowded. Do not chase green candles.";
  if (alpha.status === "PULLBACK") return "PULLBACK: pump happened, now price is weakening. Wait for reclaim/base.";
  if (alpha.status === "DUMPED") return "DUMPED: current 5m move is red. Treat as skip unless a new base forms.";
  if (alpha.status === "WATCH") return "WATCH: not a buy signal yet; wait for confirmation.";
  if (alpha.status === "DANGER") return "DANGER: avoid unless manual risk check says otherwise.";
  if (flags.includes("very_new_pair")) return "TOO NEW: first candles are unreliable. Wait for more candles and liquidity stability.";
  if (flags.includes("very_hot_volume")) return "Very hot volume can mean exit liquidity. Check chart first.";
  if (change1h > 80 && change5m <= 0) return "Likely late after pump; wait.";
  return "Report only. This is an activity signal, not a buy signal.";
}

function alertKey(candidate = {}) {
  return String(candidate?.market?.pairAddress || candidate?.token?.address || candidate?.token?.symbol || "").toLowerCase();
}

function formatMemeHotAlert(candidate = {}) {
  const token = candidate.token || {};
  const market = candidate.market || {};
  const oracle = candidate.oracle || {};
  const risk = Array.isArray(candidate.riskFlags) && candidate.riskFlags.length
    ? candidate.riskFlags.slice(0, 4).join(", ")
    : "none";
  const oracleLine = oracle.available
    ? `${oracle.phase || "WATCH"} | ${oracle.action || "WAIT"}`
    : "NO_CANDLE_DATA | manual chart check required";
  return [
    "MEME ALPHA HOT",
    "",
    `${token.symbol || "--"} - ${token.name || "--"}`,
    `Score: ${candidate.score ?? "?"} | Status: ${candidate.status}`,
    `MCap: ${fmtUsd(market.marketCapUsd)} | Liq: ${fmtUsd(market.liquidityUsd)} | Vol 5m: ${fmtUsd(market.volume5mUsd)}`,
    `5m: ${fmtPct(market.priceChange5mPct)} | 1h: ${fmtPct(market.priceChange1hPct)} | Age: ${market.ageMinutes ?? "?"}m`,
    `Buy/Sell 5m: ${market.buys5m ?? 0}/${market.sells5m ?? 0}`,
    `Oracle: ${oracleLine}`,
    `Risk: ${risk}`,
    "",
    "ACTION: manual check only. Not auto-buy. Verify chart, liquidity, sell route, and rug risk first.",
    token.dexUrl ? `Dex: ${token.dexUrl}` : null,
  ].filter(Boolean).join("\n");
}

async function notifyHotCandidates(snapshot = {}) {
  if (!TELEGRAM_ALERTS_ENABLED || !telegramEnabled()) return { sent: 0, skipped: "telegram_disabled" };
  const candidates = Array.isArray(snapshot.candidates) ? snapshot.candidates : [];
  const alertable = candidates.filter((c) => TELEGRAM_ALERT_STATUSES.has(String(c.status || "").toUpperCase()));
  if (!alertable.length) return { sent: 0, skipped: "no_alertable_candidates" };

  const now = Date.now();
  const state = readJSON(PATHS.alerts, { sent: {} });
  state.sent = state.sent && typeof state.sent === "object" ? state.sent : {};

  let sent = 0;
  for (const candidate of alertable) {
    const key = alertKey(candidate);
    if (!key) continue;
    const prev = state.sent[key];
    const prevMs = prev?.lastSentAt ? new Date(prev.lastSentAt).getTime() : 0;
    if (Number.isFinite(prevMs) && now - prevMs < TELEGRAM_ALERT_COOLDOWN_MS) continue;

    await sendMessage(formatMemeHotAlert(candidate)).catch(() => {});
    state.sent[key] = {
      symbol: candidate.token?.symbol || null,
      status: candidate.status,
      score: candidate.score,
      lastSentAt: new Date(now).toISOString(),
    };
    sent += 1;
  }

  const cutoff = now - 7 * 24 * 60 * 60 * 1000;
  for (const [key, value] of Object.entries(state.sent)) {
    const ts = value?.lastSentAt ? new Date(value.lastSentAt).getTime() : 0;
    if (!Number.isFinite(ts) || ts < cutoff) delete state.sent[key];
  }
  writeJSON(PATHS.alerts, state);
  return { sent };
}

export async function buildMemeAlphaSnapshot() {
  const profiles = await fetchJSON("https://api.dexscreener.com/token-profiles/latest/v1");
  const solana = (Array.isArray(profiles) ? profiles : [])
    .filter((p) => p?.chainId === "solana" && p?.tokenAddress)
    .slice(0, MAX_SOLANA_PROFILES);

  const candidates = [];
  const errors = [];
  for (const profile of solana.slice(0, MAX_DETAIL_FETCHES)) {
    try {
      const candidate = await enrichProfile(profile);
      if (candidate) candidates.push(candidate);
    } catch (err) {
      errors.push({ tokenAddress: profile.tokenAddress, error: err.message });
    }
  }

  const sorted = candidates.sort((a, b) => b.score - a.score);
  const counts = sorted.reduce((acc, c) => {
    acc[c.status] = (acc[c.status] || 0) + 1;
    return acc;
  }, {});
  const top = sorted[0];
  const overallStatus = counts.HOT ? "HOT"
    : counts.HOT_LATE ? "HOT_LATE"
      : counts.RECLAIM_READY ? "RECLAIM_READY"
        : counts.PULLBACK ? "PULLBACK"
          : counts.WATCH ? "WATCH"
            : counts.DUMPED || counts.DANGER ? "DANGER"
              : "HOLD";

  return {
    ok: true,
    finder: "meme-alpha-finder",
    mode: "REPORT_ONLY",
    status: overallStatus,
    engineUseAllowed: false,
    engineImpact: "NONE",
    buySell: "MANUAL_ONLY",
    source: "DexScreener public API",
    generatedAt: new Date().toISOString(),
    summary: {
      scannedProfiles: solana.length,
      detailedCandidates: sorted.length,
      hot: counts.HOT || 0,
      hotLate: counts.HOT_LATE || 0,
      reclaimReady: counts.RECLAIM_READY || 0,
      pullback: counts.PULLBACK || 0,
      watch: counts.WATCH || 0,
      hold: counts.HOLD || 0,
      danger: (counts.DANGER || 0) + (counts.DUMPED || 0),
      topScore: top?.score || 0,
      topSymbol: top?.token?.symbol || null,
      errors: errors.length,
    },
    thresholds: {
      HOT: "score >= 72 with liquidity >= $10k and 5m volume >= $5k",
      HOT_LATE: "high activity but move may already be extended/crowded",
      RECLAIM_READY: "pullback exists but candle is trying to reclaim; manual check only",
      PULLBACK: "recent pump exists but current 5m action is weakening",
      DUMPED: "current 5m move is red enough to avoid chasing",
      WATCH: "score >= 48 without danger flags",
      HOLD: "visible but not enough momentum/liquidity",
      DANGER: "thin liquidity or missing core market data",
    },
    candidates: sorted.slice(0, 30),
    errors: errors.slice(0, 10),
  };
}

export async function runOnce() {
  const snapshot = await buildMemeAlphaSnapshot();
  writeJSON(PATHS.output, snapshot);
  await notifyHotCandidates(snapshot).catch(() => {});
  return snapshot;
}

const directRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
const pm2Run = process.env.NODE_APP_INSTANCE != null && !process.argv.includes("--import-only");

if (directRun || pm2Run) {
  const once = process.argv.includes("--once");
  const run = async () => {
    try {
      const snapshot = await runOnce();
      console.log(`[meme-alpha-finder] ${snapshot.status} hot=${snapshot.summary.hot} watch=${snapshot.summary.watch} danger=${snapshot.summary.danger}`);
    } catch (err) {
      const fallback = {
        ok: false,
        finder: "meme-alpha-finder",
        mode: "REPORT_ONLY",
        status: "HOLD",
        engineUseAllowed: false,
        engineImpact: "NONE",
        buySell: "MANUAL_ONLY",
        error: err.message,
        generatedAt: new Date().toISOString(),
        summary: { scannedProfiles: 0, detailedCandidates: 0, hot: 0, watch: 0, hold: 0, danger: 0, errors: 1 },
        candidates: [],
      };
      writeJSON(PATHS.output, fallback);
      console.error(`[meme-alpha-finder] ${err.message}`);
    }
  };
  await run();
  if (!once) {
    setInterval(run, INTERVAL_MS);
  }
}
