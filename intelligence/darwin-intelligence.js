const SIGNAL_MAP = Object.freeze({
  fee_active_tvl_ratio: "fee_active_tvl_ratio",
  fee_tvl_ratio: "fee_active_tvl_ratio",
  volume_window: "volume_window",
  fee_change_pct: "fee_change_pct",
  volume_change_pct: "volume_change_pct",
  active_pct: "active_pct",
  organic_score: "organic_score",
  holders: "holders",
  smart_money_buy: "smart_money",
  discord_signal_count: "discord_signal",
  price_change_pct: "price_trend",
});

function finite(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function tradePnl(trade) {
  return finite(trade.pnl_pct ?? trade.net_return_pct ?? trade.pnlPercent ?? trade.pnl, 0);
}

function normalize(value, values) {
  const nums = values.map((v) => Number(v)).filter(Number.isFinite);
  if (nums.length < 2) return 0.5;
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  if (max === min) return 0.5;
  return (finite(value) - min) / (max - min);
}

export function learnFromOutcomes(trades = [], options = {}) {
  const list = Array.isArray(trades) ? trades : [];
  const maxAdjustment = clamp(finite(options.maxAdjustment, 0.2), 0.01, 0.5);
  const decay = clamp(finite(options.decay, 0.96), 0.5, 1);
  const samples = list.length;
  const learned = {};

  for (const [sourceKey, scorerKey] of Object.entries(SIGNAL_MAP)) {
    const values = list.map((t) => t[sourceKey] ?? t.signals?.[sourceKey]).filter((v) => Number.isFinite(Number(v)));
    if (values.length < 3) continue;
    let weightedLift = 0;
    let weightTotal = 0;
    for (let i = 0; i < list.length; i += 1) {
      const trade = list[i];
      const raw = trade[sourceKey] ?? trade.signals?.[sourceKey];
      if (!Number.isFinite(Number(raw))) continue;
      const recencyWeight = Math.pow(decay, list.length - i - 1);
      const signal = normalize(raw, values) - 0.5;
      weightedLift += signal * tradePnl(trade) * recencyWeight;
      weightTotal += recencyWeight;
    }
    if (weightTotal <= 0) continue;
    const lift = weightedLift / weightTotal;
    const multiplier = clamp(1 + lift / 50, 1 - maxAdjustment, 1 + maxAdjustment);
    learned[scorerKey] = {
      multiplier: Math.round(multiplier * 1000) / 1000,
      lift: Math.round(lift * 1000) / 1000,
      samples: values.length,
    };
  }

  return {
    generatedAt: new Date().toISOString(),
    samples,
    maxAdjustment,
    signals: learned,
  };
}

export function applyAdaptiveWeights(baseWeights = {}, learned = {}, options = {}) {
  const maxAdjustment = clamp(finite(options.maxAdjustment ?? learned.maxAdjustment, 0.2), 0.01, 0.5);
  const signals = learned.signals ?? learned;
  const adjusted = { ...baseWeights };
  for (const [key, data] of Object.entries(signals ?? {})) {
    if (adjusted[key] == null) continue;
    const multiplier = clamp(finite(data.multiplier ?? data, 1), 1 - maxAdjustment, 1 + maxAdjustment);
    adjusted[key] = Math.round(finite(adjusted[key]) * multiplier * 10) / 10;
  }
  return adjusted;
}
