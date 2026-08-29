/**
 * Five-factor signal evaluators (target plan §3–§4).
 *
 * Deliberately SMALL: five families, transparent weights that sum to 100:
 *
 *   Trend (EMA20/EMA50 structure)     — 30
 *   Momentum (ATR-normalized ROC+slope) — 25
 *   MACD (ATR-normalized histogram)   — 20
 *   RSI 14                            — 15
 *   Volume (vs 20-period average)     — 10
 *
 * Not 20 indicators. Every mapping is continuous (no hard thresholds) so the
 * composite reacts proportionally to evidence strength, and every magnitude
 * is normalized by ATR so the SAME code works on 15m / 1h / 4h / 1d candles
 * (a "3 ATR move" means the same thing on every timeframe).
 *
 * Each evaluator returns:
 *  - score: normalized opinion in [-1, +1]  (negative = bearish / sell)
 *  - weight: relative importance in the composite
 *  - values: machine values used for the bilingual explanation
 *
 * @module lib/modules/analysis/signals
 */
import type { Candle } from "../market/types";
import { sma, ema, rsi, macd, atr, roc, linregSlope } from "./indicators";

export type FactorKey = "trend" | "momentum" | "macd" | "rsi" | "volume";

export interface FactorResult {
  key: FactorKey;
  score: number; // -1..1
  weight: number;
  values: Record<string, number | string | null>;
}

export const FACTOR_WEIGHTS: Record<FactorKey, number> = {
  trend: 30,
  momentum: 25,
  macd: 20,
  rsi: 15,
  volume: 10,
};

const clamp = (x: number, lo = -1, hi = 1) => Math.min(hi, Math.max(lo, x));
const lastOf = (arr: (number | null)[]): number | null => {
  const v = arr[arr.length - 1];
  return v === undefined ? null : v;
};
const prevOf = (arr: (number | null)[]): number | null => {
  const v = arr[arr.length - 2];
  return v === undefined ? null : v;
};

/* -------- Trend: EMA20/EMA50 structure + price position (w:30) ---------- */
function trendFactor(closes: number[]): FactorResult {
  const ema20 = lastOf(ema(closes, 20));
  const ema50 = lastOf(ema(closes, 50));
  const price = closes[closes.length - 1];
  const values = { ema20, ema50, price };
  if (ema20 === null || ema50 === null || ema50 === 0) {
    return { key: "trend", score: 0, weight: FACTOR_WEIGHTS.trend, values };
  }
  const spread = (ema20 - ema50) / ema50; // positive in uptrend
  const priceVs = (price - ema20) / ema20; // positive above the fast EMA
  const score = clamp(spread * 25 + priceVs * 6);
  return { key: "trend", score, weight: FACTOR_WEIGHTS.trend, values };
}

/* --- Momentum: ATR-normalized 10-candle move + slope (w:25) ------------- */
function momentumFactor(closes: number[], atrNow: number | null): FactorResult {
  const price = closes[closes.length - 1];
  const slope = linregSlope(closes.slice(-20), 20);
  const roc10 = roc(closes, 10);
  const values = { roc10, slope20: slope, price };
  if (closes.length < 11 || price === undefined) {
    return { key: "momentum", score: 0, weight: FACTOR_WEIGHTS.momentum, values };
  }
  const prev = closes[closes.length - 11];
  const move = prev !== 0 ? price - prev : 0;
  if (atrNow && atrNow > 0) {
    // scale-free: how many ATRs did price travel over 10 candles?
    const moveAtr = move / atrNow;
    // slope in ATR-units per candle
    const slopeAtr = slope !== null ? (slope * price) / atrNow : null;
    const moveScore = clamp(moveAtr / 4); // 4 ATRs = full conviction
    const slopeScore = slopeAtr !== null ? clamp(slopeAtr * 4) : 0;
    const score = clamp(moveScore * 0.6 + slopeScore * 0.4);
    return { key: "momentum", score, weight: FACTOR_WEIGHTS.momentum, values };
  }
  // ATR unavailable (very short window) → price-normalized fallback
  const score = clamp((roc10 ?? 0) / 30 + (slope ?? 0) * 30);
  return { key: "momentum", score, weight: FACTOR_WEIGHTS.momentum, values };
}

/* ---- MACD 12/26/9, histogram normalized by ATR (w:20) ------------------ */
function macdFactor(closes: number[], atrNow: number | null): FactorResult {
  const { histogram, macd: macdLine, signal } = macd(closes);
  const h = lastOf(histogram);
  const hPrev = prevOf(histogram);
  const m = lastOf(macdLine);
  const s = lastOf(signal);
  const values = { hist: h, histPrev: hPrev, macd: m, signal: s };
  if (h === null || m === null) {
    return { key: "macd", score: 0, weight: FACTOR_WEIGHTS.macd, values };
  }
  let score: number;
  if (atrNow && atrNow > 0) {
    // scale-free: histogram expressed in ATR units
    score = clamp((h / atrNow) * 2); // 0.5 ATR of histogram = full conviction
  } else {
    const price = closes[closes.length - 1] || 1;
    score = clamp((h / price) * 400);
  }
  // histogram momentum — expanding histogram strengthens the signal
  if (hPrev !== null) {
    const expanding = Math.abs(h) > Math.abs(hPrev);
    if (expanding) score = clamp(score + Math.sign(h) * 0.15);
  }
  return { key: "macd", score, weight: FACTOR_WEIGHTS.macd, values };
}

/* ------------------------- RSI 14 (w:15) -------------------------------- */
function rsiFactor(closes: number[]): FactorResult {
  const series = rsi(closes, 14);
  const r = lastOf(series);
  const rPrev = prevOf(series);
  const values = { rsi: r, rsiPrev: rPrev };
  if (r === null) return { key: "rsi", score: 0, weight: FACTOR_WEIGHTS.rsi, values };
  let score: number;
  if (r <= 20) score = 0.7; // deep oversold — bounce zone
  else if (r <= 40) score = ((40 - r) / 20) * 0.2; // mild oversold tilt
  else if (r <= 60) score = ((r - 50) / 10) * 0.25; // neutral, trend-tilt (58 → +0.2 healthy-bull)
  else if (r <= 75) score = 0.25 + ((r - 60) / 15) * 0.2; // bullish momentum
  else score = 0.45 - ((r - 75) / 15) * 1.2; // overbought exhaustion
  // RSI direction adds momentum information
  if (rPrev !== null) score = clamp(score + Math.sign(r - rPrev) * 0.08);
  return { key: "rsi", score, weight: FACTOR_WEIGHTS.rsi, values };
}

/* ------------------- Volume regime (w:10) ------------------------------- */
function volumeFactor(candles: Candle[], atrNow: number | null): FactorResult {
  const volumes = candles.map((c) => c.v);
  const closes = candles.map((c) => c.c);
  const volAvg = lastOf(sma(volumes, 20));
  const volNow = volumes[volumes.length - 1];
  const price = closes[closes.length - 1];
  const prev = closes.length >= 2 ? closes[closes.length - 2] : null;
  const values = { volumeNow: volNow, volumeAvg: volAvg };
  if (volAvg === null || volAvg === 0 || prev === null || prev === 0) {
    return { key: "volume", score: 0, weight: FACTOR_WEIGHTS.volume, values };
  }
  const ratio = volNow / volAvg;
  const change = price - prev;
  const dir = Math.sign(change);
  // base: last candle move in ATR units (volume confirms direction of travel)
  let base = 0;
  if (atrNow && atrNow > 0) {
    base = clamp((change / atrNow) * 0.6, -0.4, 0.4);
  } else {
    base = clamp((change / prev) * 20, -0.4, 0.4);
  }
  let score = base;
  if (ratio > 1.2) {
    // elevated volume confirming the move
    score = clamp(score + dir * Math.min(0.35, (ratio - 1.2) * 0.3));
  } else if (ratio < 0.6) {
    // weak volume → doubtful move, halve conviction
    score *= 0.5;
  }
  return { key: "volume", score, weight: FACTOR_WEIGHTS.volume, values };
}

/** Compute all five factors for ONE candle series (any timeframe). */
export function computeFactors(candles: Candle[]): {
  factors: FactorResult[];
  atr: number | null;
  volatility: number | null;
} {
  const closes = candles.map((c) => c.c);
  const highs = candles.map((c) => c.h);
  const lows = candles.map((c) => c.l);

  const atrNow = lastOf(atr(highs, lows, closes, 14));

  const factors: FactorResult[] = [
    trendFactor(closes),
    momentumFactor(closes, atrNow),
    macdFactor(closes, atrNow),
    rsiFactor(closes),
    volumeFactor(candles, atrNow),
  ];

  // daily-return stddev (volatility context, not a scored factor)
  let volatility: number | null = null;
  if (closes.length >= 21) {
    const rets: number[] = [];
    for (let i = closes.length - 20; i < closes.length; i++) {
      rets.push((closes[i] - closes[i - 1]) / closes[i - 1]);
    }
    const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
    volatility = Math.sqrt(rets.reduce((a, r) => a + (r - mean) ** 2, 0) / rets.length);
  }

  return { factors, atr: atrNow, volatility };
}
