/**
 * Backtest optimizer
 *
 * Runs conservative grid search and walk-forward validation over historical
 * snapshots. The objective favors net PnL and fee capture, while penalizing
 * drawdown and low sample counts to avoid curve-fit parameter sets.
 */

import { runBacktest, backtestPools } from "./simulator.js";

const DEFAULT_GRID = {
  minScoreThreshold: [55, 60, 65, 70, 75],
  outOfRangeWaitMinutes: [15, 30, 45, 60],
  minBinsBelow: [35, 45, 55, 69],
  maxPositions: [1, 2, 3],
};

function cloneConfig(config) {
  return JSON.parse(JSON.stringify(config || {}));
}

function cartesian(grid) {
  const entries = Object.entries(grid || DEFAULT_GRID).filter(([, values]) => Array.isArray(values) && values.length);
  return entries.reduce((acc, [key, values]) => {
    const next = [];
    for (const item of acc) {
      for (const value of values) next.push({ ...item, [key]: value });
    }
    return next;
  }, [{}]);
}

function scoreResult(result) {
  const deployments = Number(result.totalDeployments || 0);
  const samplePenalty = deployments < 3 ? (3 - deployments) * 8 : 0;
  const pnl = Number(result.totalPnlSol || 0) * 120;
  const fees = Number(result.totalFeesSol || 0) * 45;
  const winRate = Number(result.winRate || 0) * 0.35;
  const sharpe = Number(result.sharpeRatio || 0) * 8;
  const drawdownPenalty = Number(result.maxDrawdown || 0) * 1.4;
  return Math.round((pnl + fees + winRate + sharpe - drawdownPenalty - samplePenalty) * 100) / 100;
}

function aggregateResults(results) {
  const valid = results.filter((r) => !r.error);
  const totalDeployments = valid.reduce((s, r) => s + Number(r.totalDeployments || 0), 0);
  const totalPnlSol = valid.reduce((s, r) => s + Number(r.totalPnlSol || 0), 0);
  const totalFeesSol = valid.reduce((s, r) => s + Number(r.totalFeesSol || 0), 0);
  const wins = valid.reduce((s, r) => s + Number(r.wins || 0), 0);
  const closes = valid.reduce((s, r) => s + Number(r.totalCloses || 0), 0);
  const maxDrawdown = valid.reduce((max, r) => Math.max(max, Number(r.maxDrawdown || 0)), 0);
  const sharpeRatio = valid.length
    ? valid.reduce((s, r) => s + Number(r.sharpeRatio || 0), 0) / valid.length
    : 0;

  return {
    pools: results.length,
    validPools: valid.length,
    totalDeployments,
    totalCloses: closes,
    wins,
    winRate: closes ? Math.round((wins / closes) * 10_000) / 100 : 0,
    totalPnlSol: Math.round(totalPnlSol * 1e9) / 1e9,
    totalFeesSol: Math.round(totalFeesSol * 1e9) / 1e9,
    maxDrawdown: Math.round(maxDrawdown * 100) / 100,
    sharpeRatio: Math.round(sharpeRatio * 100) / 100,
  };
}

function scoreAggregate(aggregate) {
  return scoreResult({
    ...aggregate,
    poolName: "aggregate",
  });
}

function splitSnapshots(pool, fromIdx, toIdx) {
  return {
    ...pool,
    snapshots: (pool.snapshots || []).slice(fromIdx, toIdx),
  };
}

export async function gridSearchBacktest(pools, baseConfig = {}, options = {}) {
  const grid = options.grid || DEFAULT_GRID;
  const combos = cartesian(grid).slice(0, Number(options.maxRuns || 240));
  const candidates = [];

  for (const params of combos) {
    const cfg = { ...cloneConfig(baseConfig), ...params };
    const results = await backtestPools(pools, cfg);
    const aggregate = aggregateResults(results);
    candidates.push({
      params,
      score: scoreAggregate(aggregate),
      aggregate,
      results: options.includePoolResults ? results : undefined,
    });
  }

  candidates.sort((a, b) => b.score - a.score);
  return {
    best: candidates[0] || null,
    candidates: candidates.slice(0, Number(options.topN || 20)),
    tested: combos.length,
    objective: "pnl+fees+winrate+sharpe-drawdown-sample_penalty",
  };
}

export async function optimizeSinglePool(pool, baseConfig = {}, options = {}) {
  const grid = options.grid || DEFAULT_GRID;
  const candidates = [];
  for (const params of cartesian(grid).slice(0, Number(options.maxRuns || 240))) {
    const cfg = { ...cloneConfig(baseConfig), ...params };
    const result = await runBacktest(pool, cfg);
    candidates.push({ params, score: scoreResult(result), result });
  }
  candidates.sort((a, b) => b.score - a.score);
  return {
    poolName: pool.name || pool.poolName || "unknown",
    best: candidates[0] || null,
    candidates: candidates.slice(0, Number(options.topN || 20)),
  };
}

export async function walkForwardOptimize(pools, baseConfig = {}, options = {}) {
  const trainRatio = Math.max(0.3, Math.min(0.8, Number(options.trainRatio ?? 0.6)));
  const folds = Math.max(1, Number(options.folds ?? 3));
  const foldResults = [];

  for (let fold = 0; fold < folds; fold++) {
    const trainPools = [];
    const testPools = [];

    for (const pool of pools) {
      const snaps = pool.snapshots || [];
      if (snaps.length < 10) continue;
      const windowSize = Math.floor(snaps.length / folds);
      const start = Math.max(0, fold * windowSize);
      const end = fold === folds - 1 ? snaps.length : Math.min(snaps.length, (fold + 1) * windowSize);
      const trainEnd = start + Math.max(2, Math.floor((end - start) * trainRatio));
      trainPools.push(splitSnapshots(pool, start, trainEnd));
      testPools.push(splitSnapshots(pool, trainEnd, end));
    }

    const train = await gridSearchBacktest(trainPools, baseConfig, options);
    const testConfig = { ...cloneConfig(baseConfig), ...(train.best?.params || {}) };
    const testResults = await backtestPools(testPools, testConfig);
    const testAggregate = aggregateResults(testResults);

    foldResults.push({
      fold: fold + 1,
      trainBest: train.best,
      testAggregate,
      testScore: scoreAggregate(testAggregate),
    });
  }

  const avgTestScore = foldResults.length
    ? foldResults.reduce((s, f) => s + Number(f.testScore || 0), 0) / foldResults.length
    : 0;

  return {
    folds: foldResults,
    avgTestScore: Math.round(avgTestScore * 100) / 100,
    robustParams: chooseRobustParams(foldResults),
  };
}

function chooseRobustParams(folds) {
  const counts = new Map();
  for (const fold of folds) {
    const params = fold.trainBest?.params || {};
    const key = JSON.stringify(params);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const [key] = Array.from(counts.entries()).sort((a, b) => b[1] - a[1])[0] || [];
  return key ? JSON.parse(key) : null;
}

export const DEFAULT_OPTIMIZER_GRID = DEFAULT_GRID;
