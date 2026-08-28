/**
 * Per-indicator signal evaluators.
 *
 * Each evaluator inspects one indicator family and returns:
 *  - score: normalized opinion in [-1, +1]  (negative = bearish / sell)
 *  - weight: relative importance in the composite (sums to 100)
 *  - label: i18n key describing the factor
 *  - detail: machine values used for the bilingual explanation
 *
 * Design notes:
 *  - Families cover trend, momentum, volatility, volume, mean-reversion and
 *    market microstructure — a genuine multi-method composite.
 *  - Scores use smooth (continuous) mappings, not hard thresholds, so the
 *    composite reacts proportionally to evidence strength.
 *
 * @module lib/modules/analysis/signals
 */
import type { Candle } from "../market/types";
import {
  sma,
  ema,
  rsi,
  macd,
  bollinger,
  stochastic,
  atr,
  obv,
  rollingVwap,
  returnsStdDev,
  roc,
  linregSlope,
  swingLevels,
} from "./indicators";

export interface FactorResult {
  key: string;
  score: number; // -1..1
  weight: number;
  values: Record<string, number | string | null>;
}

export interface FactorsInput {
  candles: Candle[]; // daily candles, ascending
  snapshot: {
    priceUsd: number;
    volume24hUsd: number;
    liquidityUsd: number;
    change24h: number;
  };
}

const clamp = (x: number, lo = -1, hi = 1) => Math.min(hi, Math.max(lo, x));
const lastOf = (arr: (number | null)[]): number | null => {
  const v = arr[arr.length - 1];
  return v === undefined ? null : v;
};
const prevOf = (arr: (number | null)[]): number | null => {
  const v = arr[arr.length - 2];
  return v === undefined ? null : v;
};

/* ---------------- Trend: EMA9/EMA21 + price position (w:14) -------------- */
function emaTrend(closes: number[]): FactorResult {
  const ema9 = lastOf(ema(closes, 9));
  const ema21 = lastOf(ema(closes, 21));
  const price = closes[closes.length - 1];
  const values = { ema9, ema21, price };
  if (ema9 === null || ema21 === null) return { key: "emaTrend", score: 0, weight: 14, values };
  const spread = (ema9 - ema21) / ema21; // positive in uptrend
  const priceVs = (price - ema21) / ema21;
  const score = clamp(spread * 25 + priceVs * 8);
  return { key: "emaTrend", score, weight: 14, values };
}

/* ------------- Long trend: SMA20/SMA50 structure (w:10) ------------------ */
function smaStructure(closes: number[]): FactorResult {
  const sma20 = lastOf(sma(closes, 20));
  const sma50 = lastOf(sma(closes, 50));
  const price = closes[closes.length - 1];
  const values = { sma20, sma50, price };
  if (sma20 === null || sma50 === null) return { key: "smaStructure", score: 0, weight: 10, values };
  const goldenSpread = (sma20 - sma50) / sma50;
  const priceAbove = price > sma20 ? 1 : price < sma50 ? -1 : 0;
  const score = clamp(goldenSpread * 30 + priceAbove * 0.25);
  return { key: "smaStructure", score, weight: 10, values };
}

/* ----------------------- RSI 14 (w:14) ----------------------------------- */
function rsiFactor(closes: number[]): FactorResult {
  const series = rsi(closes, 14);
  const r = lastOf(series);
  const rPrev = prevOf(series);
  const values = { rsi: r, rsiPrev: rPrev };
  if (r === null) return { key: "rsi", score: 0, weight: 14, values };
  let score: number;
  if (r <= 30) score = clamp((30 - r) / 20 * 0.9 + 0.1); // deep oversold → strong buy
  else if (r < 45) score = clamp((45 - r) / 15 * 0.45);   // mild oversold
  else if (r <= 55) score = clamp((r - 50) / 5 * 0.12);   // neutral zone
  else if (r < 70) score = clamp(-(r - 55) / 15 * 0.45);  // mild overbought
  else score = clamp(-(r - 70) / 20 * 0.9 - 0.1);         // deep overbought → strong sell
  // RSI direction adds momentum information
  if (rPrev !== null) score = clamp(score + Math.sign(r - rPrev) * 0.08);
  return { key: "rsi", score, weight: 14, values };
}

/* ----------------------- MACD 12/26/9 (w:14) ----------------------------- */
function macdFactor(closes: number[]): FactorResult {
  const { histogram, macd: macdLine, signal } = macd(closes);
  const h = lastOf(histogram);
  const hPrev = prevOf(histogram);
  const m = lastOf(macdLine);
  const s = lastOf(signal);
  const values = { hist: h, histPrev: hPrev, macd: m, signal: s };
  if (h === null || m === null) return { key: "macd", score: 0, weight: 14, values };
  const price = closes[closes.length - 1] || 1;
  const histNorm = clamp((h / price) * 400); // scale histogram relative to price
  let score = histNorm;
  // histogram momentum — expanding histogram strengthens the signal
  if (hPrev !== null) {
    const expanding = Math.abs(h) > Math.abs(hPrev);
    if (expanding) score = clamp(score + Math.sign(h) * 0.15);
  }
  return { key: "macd", score, weight: 14, values };
}

/* ---------------- Bollinger Bands position (w:10) ------------------------ */
function bollingerFactor(closes: number[]): FactorResult {
  const bb = bollinger(closes, 20, 2);
  const pb = lastOf(bb.percentB);
  const bw = lastOf(bb.bandwidth);
  const upper = lastOf(bb.upper);
  const lower = lastOf(bb.lower);
  const values = { percentB: pb, bandwidth: bw, upper, lower };
  if (pb === null) return { key: "bollinger", score: 0, weight: 10, values };
  // %B < 0 → below lower band (oversold), > 1 → above upper (overbought)
  let score: number;
  if (pb < 0) score = clamp(0.55 + Math.min(0.35, -pb * 1.4));
  else if (pb < 0.2) score = clamp((0.2 - pb) * 2.2 * 0.5);
  else if (pb <= 0.8) score = clamp(-(pb - 0.5) * 0.25);
  else if (pb <= 1) score = clamp(-(pb - 0.8) * 2.2 * 0.5);
  else score = clamp(-0.55 - Math.min(0.35, (pb - 1) * 1.4));
  // squeeze: very low bandwidth → breakout pending, reduce conviction
  const bwSeries = bb.bandwidth.filter((v): v is number => v !== null);
  if (bw !== null && bwSeries.length > 20) {
    const avgBw = bwSeries.slice(-20).reduce((a, b) => a + b, 0) / Math.min(20, bwSeries.length);
    if (avgBw > 0 && bw < avgBw * 0.6) {
      // squeeze halves conviction — direction unclear
      score *= 0.5;
    }
  }
  return { key: "bollinger", score, weight: 10, values };
}

/* --------------------- Stochastic 14/3 (w:9) ------------------------------ */
function stochasticFactor(highs: number[], lows: number[], closes: number[]): FactorResult {
  const st = stochastic(highs, lows, closes, 14, 3);
  const k = lastOf(st.k);
  const d = lastOf(st.d);
  const values = { k, d };
  if (k === null || d === null) return { key: "stochastic", score: 0, weight: 9, values };
  let score = clamp((50 - k) / 50 * 0.5); // low %K → buy pressure building
  if (k < 20) score = clamp(score + 0.25);
  if (k > 80) score = clamp(score - 0.25);
  if (k > d) score = clamp(score + 0.1); // %K crossing above %D → bullish
  else score = clamp(score - 0.1);
  return { key: "stochastic", score, weight: 9, values };
}

/* ----------------- OBV trend vs price (w:8) ------------------------------- */
function obvFactor(closes: number[], volumes: number[]): FactorResult {
  const obvSeries = obv(closes, volumes);
  const slope = linregSlope(obvSeries.slice(-20).map((v) => v / 1e6), 20); // scaled for numeric stability
  const priceSlope = linregSlope(closes.slice(-20), 20);
  const obvNow = obvSeries[obvSeries.length - 1];
  const values = { obvSlope: slope, priceSlope, obv: obvNow };
  if (slope === null || priceSlope === null) return { key: "obv", score: 0, weight: 8, values };
  // divergence detection: price up but OBV down (bearish) and vice versa
  const priceDir = Math.sign(priceSlope);
  const obvDir = Math.sign(slope);
  let score = clamp(obvDir * 0.4);
  if (priceDir !== 0 && obvDir !== 0 && priceDir !== obvDir) {
    score = clamp(obvDir * 0.75); // divergence — strong evidence
  }
  return { key: "obv", score, weight: 8, values };
}

/* --------------------- Rolling VWAP 20 (w:7) ------------------------------ */
function vwapFactor(highs: number[], lows: number[], closes: number[], volumes: number[]): FactorResult {
  const vw = lastOf(rollingVwap(highs, lows, closes, volumes, 20));
  const price = closes[closes.length - 1];
  const values = { vwap: vw, price };
  if (vw === null || vw === 0) return { key: "vwap", score: 0, weight: 7, values };
  const dist = (price - vw) / vw;
  // above VWAP = buyers in control; extreme distance = stretched
  let score = clamp(dist * 18);
  if (Math.abs(dist) > 0.15) score *= 0.6; // stretched → mean reversion risk
  return { key: "vwap", score, weight: 7, values };
}

/* ------------------- Momentum composite (w:7) ----------------------------- */
function momentumFactor(closes: number[]): FactorResult {
  const r10 = roc(closes, 10);
  const slope20 = linregSlope(closes.slice(-20), 20);
  const values = { roc10: r10, slope20 };
  if (r10 === null || slope20 === null) return { key: "momentum", score: 0, weight: 7, values };
  const score = clamp(r10 / 30 + slope20 * 30);
  return { key: "momentum", score, weight: 7, values };
}

/* --------------------- Volume regime (w:7) -------------------------------- */
function volumeFactor(closes: number[], volumes: number[], snapshot: FactorsInput["snapshot"]): FactorResult {
  const volAvg = lastOf(sma(volumes, 20));
  const volNow = volumes[volumes.length - 1];
  const priceChange = snapshot.change24h / 100;
  const values = { volumeNow: volNow, volumeAvg: volAvg, priceChange24hPct: snapshot.change24h };
  if (volAvg === null || volAvg === 0) return { key: "volume", score: 0, weight: 7, values };
  const ratio = volNow / volAvg;
  // volume confirms price moves: high volume + up move = bullish confirmation
  let confirmation = 0;
  if (ratio > 1.2) confirmation = Math.sign(priceChange) * Math.min(0.35, (ratio - 1.2) * 0.3);
  else if (ratio < 0.6) confirmation = -Math.sign(priceChange) * 0.15; // weak volume → doubtful move
  const score = clamp(confirmation + priceChange * 1.5);
  return { key: "volume", score, weight: 7, values };
}

/* ------------------- Support/Resistance proximity ------------------------- */
export interface SRContext {
  nearestSupport: number | null;
  nearestResistance: number | null;
  levels: { price: number; kind: "support" | "resistance"; touches: number }[];
}

function srFactor(highs: number[], lows: number[], closes: number[]): { result: FactorResult; sr: SRContext } {
  const levels = swingLevels(highs, lows, closes, 30, 0.02);
  const price = closes[closes.length - 1];
  const supports = levels.filter((l) => l.price <= price).sort((a, b) => b.price - a.price);
  const resistances = levels.filter((l) => l.price > price).sort((a, b) => a.price - b.price);
  const nearestSupport = supports[0]?.price ?? null;
  const nearestResistance = resistances[0]?.price ?? null;
  const values = { nearestSupport, nearestResistance, price } as Record<string, number | string | null>;
  let score = 0;
  if (nearestSupport && nearestResistance) {
    const posInRange = (price - nearestSupport) / (nearestResistance - nearestSupport);
    // near support (pos→0) = upside room → buy-side; near resistance = sell-side
    score = clamp((0.5 - posInRange) * 1.2);
  }
  return {
    result: { key: "srLevels", score, weight: 8, values },
    sr: { nearestSupport, nearestResistance, levels },
  };
}

/** Compute all factors for a daily candle series. */
export function computeFactors(input: FactorsInput): { factors: FactorResult[]; sr: SRContext; atr: number | null; volatility: number | null } {
  const { candles } = input;
  const closes = candles.map((c) => c.c);
  const highs = candles.map((c) => c.h);
  const lows = candles.map((c) => c.l);
  const volumes = candles.map((c) => c.v);

  const factors: FactorResult[] = [
    emaTrend(closes),
    smaStructure(closes),
    rsiFactor(closes),
    macdFactor(closes),
    bollingerFactor(closes),
    stochasticFactor(highs, lows, closes),
    obvFactor(closes, volumes),
    vwapFactor(highs, lows, closes, volumes),
    momentumFactor(closes),
    volumeFactor(closes, volumes, input.snapshot),
  ];
  const { result: srRes, sr } = srFactor(highs, lows, closes);
  factors.push(srRes);

  const atrSeries = atr(highs, lows, closes, 14);
  const atrNow = lastOf(atrSeries);
  const vol = returnsStdDev(closes, 20);

  return { factors, sr, atr: atrNow, volatility: vol };
}
