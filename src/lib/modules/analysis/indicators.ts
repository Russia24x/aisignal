/**
 * Technical indicator math library — pure functions, zero dependencies.
 *
 * Every function takes a numeric series (oldest → newest) and returns either
 * the full series of values (aligned so that result[i] corresponds to
 * input[i], using null for warm-up periods) or the latest value helper.
 *
 * Conventions follow industry standards (Wilder smoothing for RSI/ATR,
 * standard MACD 12/26/9, Bollinger 20/2, etc.).
 *
 * @module lib/modules/analysis/indicators
 */

/** Simple Moving Average — full series, null during warm-up. */
export function sma(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  if (period <= 0) return out;
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

/** Exponential Moving Average — full series. */
export function ema(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  if (values.length === 0 || period <= 0) return out;
  const k = 2 / (period + 1);
  let prev: number | null = null;
  for (let i = 0; i < values.length; i++) {
    if (i === period - 1) {
      // seed with SMA of first `period` values
      let s = 0;
      for (let j = 0; j < period; j++) s += values[j];
      prev = s / period;
      out[i] = prev;
    } else if (prev !== null) {
      prev = values[i] * k + prev * (1 - k);
      out[i] = prev;
    }
  }
  return out;
}

/** Wilder's smoothing (used by RSI / ATR). */
function wilder(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  if (values.length < period || period <= 0) return out;
  let prev = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  out[period - 1] = prev;
  for (let i = period; i < values.length; i++) {
    prev = (prev * (period - 1) + values[i]) / period;
    out[i] = prev;
  }
  return out;
}

/** Relative Strength Index (Wilder, default period 14). */
export function rsi(closes: number[], period = 14): (number | null)[] {
  const out: (number | null)[] = new Array(closes.length).fill(null);
  if (closes.length <= period) return out;
  const gains: number[] = [];
  const losses: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    gains.push(Math.max(0, d));
    losses.push(Math.max(0, -d));
  }
  const avgGain = wilder(gains, period);
  const avgLoss = wilder(losses, period);
  for (let i = 0; i < closes.length; i++) {
    const g = avgGain[i - 1];
    const l = avgLoss[i - 1];
    if (g === null || l === null) continue;
    if (l === 0) {
      out[i] = g === 0 ? 50 : 100;
    } else {
      const rs = g / l;
      out[i] = 100 - 100 / (1 + rs);
    }
  }
  return out;
}

export interface MacdResult {
  macd: (number | null)[];
  signal: (number | null)[];
  histogram: (number | null)[];
}

/** MACD (default 12/26/9). */
export function macd(closes: number[], fast = 12, slow = 26, signalPeriod = 9): MacdResult {
  const emaFast = ema(closes, fast);
  const emaSlow = ema(closes, slow);
  const macdLine: (number | null)[] = closes.map((_, i) =>
    emaFast[i] !== null && emaSlow[i] !== null ? (emaFast[i] as number) - (emaSlow[i] as number) : null,
  );
  // signal = EMA(macdLine) over non-null region
  const firstIdx = macdLine.findIndex((v) => v !== null);
  const signal: (number | null)[] = new Array(closes.length).fill(null);
  if (firstIdx >= 0) {
    const region = macdLine.slice(firstIdx) as number[];
    const sig = ema(region, signalPeriod);
    for (let i = 0; i < sig.length; i++) signal[firstIdx + i] = sig[i];
  }
  const histogram = closes.map((_, i) =>
    macdLine[i] !== null && signal[i] !== null ? (macdLine[i] as number) - (signal[i] as number) : null,
  );
  return { macd: macdLine, signal, histogram };
}

export interface BollingerResult {
  middle: (number | null)[];
  upper: (number | null)[];
  lower: (number | null)[];
  bandwidth: (number | null)[];
  percentB: (number | null)[];
}

/** Bollinger Bands (default 20, 2 std devs). */
export function bollinger(closes: number[], period = 20, mult = 2): BollingerResult {
  const middle = sma(closes, period);
  const upper: (number | null)[] = new Array(closes.length).fill(null);
  const lower: (number | null)[] = new Array(closes.length).fill(null);
  const bandwidth: (number | null)[] = new Array(closes.length).fill(null);
  const percentB: (number | null)[] = new Array(closes.length).fill(null);
  for (let i = period - 1; i < closes.length; i++) {
    const m = middle[i];
    if (m === null) continue;
    let variance = 0;
    for (let j = i - period + 1; j <= i; j++) variance += (closes[j] - m) ** 2;
    const sd = Math.sqrt(variance / period);
    upper[i] = m + mult * sd;
    lower[i] = m - mult * sd;
    bandwidth[i] = m !== 0 ? (upper[i] as number) - (lower[i] as number) / m : null;
    const range = (upper[i] as number) - (lower[i] as number);
    percentB[i] = range !== 0 ? (closes[i] - (lower[i] as number)) / range : 0.5;
  }
  return { middle, upper, lower, bandwidth, percentB };
}

export interface StochasticResult {
  k: (number | null)[];
  d: (number | null)[];
}

/** Stochastic Oscillator (default 14,3,3 — we use 14/3 smoothing). */
export function stochastic(
  highs: number[],
  lows: number[],
  closes: number[],
  kPeriod = 14,
  dPeriod = 3,
): StochasticResult {
  const kRaw: (number | null)[] = new Array(closes.length).fill(null);
  for (let i = kPeriod - 1; i < closes.length; i++) {
    let hh = -Infinity;
    let ll = Infinity;
    for (let j = i - kPeriod + 1; j <= i; j++) {
      hh = Math.max(hh, highs[j]);
      ll = Math.min(ll, lows[j]);
    }
    kRaw[i] = hh === ll ? 50 : ((closes[i] - ll) / (hh - ll)) * 100;
  }
  // %K smoothing (3) then %D = SMA(%K,3)
  const kSeries: number[] = [];
  const kIdx: number[] = [];
  for (let i = 0; i < kRaw.length; i++) {
    if (kRaw[i] === null) continue;
    kSeries.push(kRaw[i] as number);
    kIdx.push(i);
  }
  const kSmoothedVals = sma(kSeries, 3);
  const k: (number | null)[] = new Array(closes.length).fill(null);
  for (let i = 0; i < kIdx.length; i++) k[kIdx[i]] = kSmoothedVals[i];
  // %D
  const validK: number[] = [];
  const validIdx: number[] = [];
  for (let i = 0; i < k.length; i++) {
    if (k[i] !== null) {
      validK.push(k[i] as number);
      validIdx.push(i);
    }
  }
  const dVals = sma(validK, dPeriod);
  const d: (number | null)[] = new Array(closes.length).fill(null);
  for (let i = 0; i < validIdx.length; i++) d[validIdx[i]] = dVals[i];
  return { k, d };
}

/** True Range series. */
function trueRange(highs: number[], lows: number[], closes: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    out.push(
      Math.max(
        highs[i] - lows[i],
        Math.abs(highs[i] - closes[i - 1]),
        Math.abs(lows[i] - closes[i - 1]),
      ),
    );
  }
  return out;
}

/** Average True Range (Wilder, default 14). */
export function atr(highs: number[], lows: number[], closes: number[], period = 14): (number | null)[] {
  const tr = trueRange(highs, lows, closes);
  const smoothed = wilder(tr, period);
  // realign: tr[i-1] corresponds to candle i
  const out: (number | null)[] = new Array(closes.length).fill(null);
  for (let i = 1; i < closes.length; i++) out[i] = smoothed[i - 1];
  return out;
}

/** On-Balance Volume. */
export function obv(closes: number[], volumes: number[]): number[] {
  const out: number[] = [0];
  for (let i = 1; i < closes.length; i++) {
    const prev = out[i - 1];
    if (closes[i] > closes[i - 1]) out.push(prev + volumes[i]);
    else if (closes[i] < closes[i - 1]) out.push(prev - volumes[i]);
    else out.push(prev);
  }
  return out;
}

/** Rolling Volume-Weighted Average Price. */
export function rollingVwap(highs: number[], lows: number[], closes: number[], volumes: number[], period = 20): (number | null)[] {
  const out: (number | null)[] = new Array(closes.length).fill(null);
  for (let i = period - 1; i < closes.length; i++) {
    let pv = 0;
    let vol = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const typical = (highs[j] + lows[j] + closes[j]) / 3;
      pv += typical * volumes[j];
      vol += volumes[j];
    }
    out[i] = vol > 0 ? pv / vol : null;
  }
  return out;
}

/** Standard deviation of simple returns (periods). */
export function returnsStdDev(closes: number[], period = 20): number | null {
  if (closes.length < period + 1) return null;
  const rets: number[] = [];
  for (let i = closes.length - period; i < closes.length; i++) {
    rets.push((closes[i] - closes[i - 1]) / closes[i - 1]);
  }
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const variance = rets.reduce((a, r) => a + (r - mean) ** 2, 0) / rets.length;
  return Math.sqrt(variance);
}

/** Rate of Change over `period` candles (percent). */
export function roc(closes: number[], period = 10): number | null {
  if (closes.length <= period) return null;
  const prev = closes[closes.length - 1 - period];
  return prev !== 0 ? ((closes[closes.length - 1] - prev) / prev) * 100 : null;
}

/** Least-squares slope of the last `period` closes (normalized per price). */
export function linregSlope(closes: number[], period = 20): number | null {
  if (closes.length < period) return null;
  const y = closes.slice(-period);
  const n = y.length;
  const xMean = (n - 1) / 2;
  const yMean = y.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - xMean) * (y[i] - yMean);
    den += (i - xMean) ** 2;
  }
  if (den === 0) return null;
  const slope = num / den;
  return yMean !== 0 ? slope / yMean : null;
}

export interface SwingLevel {
  price: number;
  kind: "support" | "resistance";
  touches: number;
}

/**
 * Detect swing-based support & resistance:
 * pivots (local extremes over `lookback` candles) clustered within tolerance.
 */
export function swingLevels(
  highs: number[],
  lows: number[],
  closes: number[],
  lookback = 30,
  clusterTolerance = 0.02,
): SwingLevel[] {
  const n = closes.length;
  if (n < lookback * 2) return [];
  const start = Math.max(1, n - lookback * 2);
  const pivot = 3;
  const rawLevels: { price: number; kind: "support" | "resistance" }[] = [];
  for (let i = start + pivot; i < n - pivot; i++) {
    // local maximum?
    let isMax = true;
    let isMin = true;
    for (let j = i - pivot; j <= i + pivot; j++) {
      if (j === i) continue;
      if (highs[j] >= highs[i]) isMax = false;
      if (lows[j] <= lows[i]) isMin = false;
    }
    if (isMax) rawLevels.push({ price: highs[i], kind: "resistance" });
    if (isMin) rawLevels.push({ price: lows[i], kind: "support" });
  }
  // cluster nearby levels
  const sorted = [...rawLevels].sort((a, b) => a.price - b.price);
  const clusters: { prices: number[]; kinds: ("support" | "resistance")[] }[] = [];
  for (const lvl of sorted) {
    const last = clusters[clusters.length - 1];
    if (last) {
      const avg = last.prices.reduce((a, b) => a + b, 0) / last.prices.length;
      if (Math.abs(lvl.price - avg) / avg <= clusterTolerance) {
        last.prices.push(lvl.price);
        last.kinds.push(lvl.kind);
        continue;
      }
    }
    clusters.push({ prices: [lvl.price], kinds: [lvl.kind] });
  }
  const price = closes[n - 1];
  return clusters.map((c) => {
    const avg = c.prices.reduce((a, b) => a + b, 0) / c.prices.length;
    const kind: "support" | "resistance" = avg <= price ? "support" : "resistance";
    return { price: avg, kind, touches: c.prices.length };
  });
}
