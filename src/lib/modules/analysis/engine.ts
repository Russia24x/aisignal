/**
 * The PenguSignals analysis engine v4 — multi-timeframe, stateless.
 *
 * Per the target plan (§4, §14):
 *  - Each timeframe (15m / 1h / 4h / 1d) is scored independently by the
 *    five factors into a 0–100 score, where 50 = neutral.
 *  - Primary signal = weighted aggregation (1d & 4h dominant).
 *  - User-facing states: BUY / SELL / WAIT. Behind the scenes a five-band
 *    classification is kept for nuance:
 *        score >= 75 → BUY        55–74 → WATCH (bullish bias)
 *        45–54      → WAIT        25–44 → WEAK (bearish bias)
 *        score < 25 → SELL
 *  - Confidence = strength × agreement × data-quality, penalized when
 *    volatility is elevated (⚠ per §16).
 *  - Risk levels (entry / stop / targets) are ATR-based off the 4h series —
 *    the plan's "trading timeframe".
 *
 * The engine is DETERMINISTIC given identical candle data — same input, same
 * signal — which is what makes database-free history recomputation possible:
 * any past day can be replayed from public candles and verified by anyone.
 *
 * @module lib/modules/analysis/engine
 */
import type { Candle, Timeframe } from "../market/types";
import { computeFactors, type FactorResult } from "./signals";

export type SignalAction = "BUY" | "SELL" | "WAIT";
export type SignalBand = "BUY" | "WATCH" | "WAIT" | "WEAK" | "SELL";

/** Score thresholds on the 0–100 scale (plan §4). */
export const BUY_SCORE_THRESHOLD = 75;
export const SELL_SCORE_THRESHOLD = 25;
const WATCH_THRESHOLD = 55;
const WEAK_THRESHOLD = 45;

/** Primary = weighted blend of timeframes; higher timeframes dominate. */
export const PRIMARY_TF_WEIGHTS: Record<Timeframe, number> = {
  "1d": 0.35,
  "4h": 0.35,
  "1h": 0.2,
  "15m": 0.1,
};

export interface EngineFactor {
  key: string;
  score: number; // -1..1
  weight: number;
  values: Record<string, number | string | null>;
  contribution: number; // weight * score (signed)
}

export interface TimeframeResult {
  timeframe: Timeframe;
  /** 0–100 (50 = neutral) */
  score: number;
  action: SignalAction;
  band: SignalBand;
  /** single-window confidence 0–100 (magnitude + factor agreement) */
  confidence: number;
  factors: EngineFactor[];
  atr: number | null;
  /** ATR as percent of price (human-readable volatility) */
  atrPct: number | null;
  dataQuality: number;
  candlesUsed: number;
}

export interface EngineOutput {
  action: SignalAction;
  band: SignalBand;
  /** 0–100 primary score */
  score: number;
  confidence: number;
  dataQuality: number;
  price: number;
  timeframes: Record<Timeframe, TimeframeResult>;
  /** risk-management levels (ATR-based, from the 4h series) */
  entryLow: number | null;
  entryHigh: number | null;
  stopLoss: number | null;
  takeProfit1: number | null;
  takeProfit2: number | null;
  riskReward: number | null;
  expectedRangeLow: number | null;
  expectedRangeHigh: number | null;
  /** daily-return stddev (20) */
  volatility: number | null;
  /** true when ATR is elevated vs its own average → confidence penalty */
  volatilityWarning: boolean;
  reasoning: { fa: string; en: string };
  generatedAt: number;
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function fmt(n: number | null | undefined, digits = 5): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  if (Math.abs(n) >= 1000) return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
  return n.toFixed(digits);
}
function fmtPct(n: number | null | undefined, digits = 1): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return `${n >= 0 ? "+" : ""}${n.toFixed(digits)}%`;
}

export function bandForScore(score: number): SignalBand {
  if (score >= BUY_SCORE_THRESHOLD) return "BUY";
  if (score >= WATCH_THRESHOLD) return "WATCH";
  if (score >= WEAK_THRESHOLD) return "WAIT";
  if (score >= SELL_SCORE_THRESHOLD) return "WEAK";
  return "SELL";
}

export function actionForScore(score: number): SignalAction {
  if (score >= BUY_SCORE_THRESHOLD) return "BUY";
  if (score < SELL_SCORE_THRESHOLD) return "SELL";
  return "WAIT";
}

/** 0–100 score from a raw weighted factor composite in [-1, 1]. */
export function scoreFromFactors(factors: FactorResult[]): number {
  const totalWeight = factors.reduce((a, f) => a + f.weight, 0) || 1;
  const raw = factors.reduce((a, f) => a + f.weight * f.score, 0) / totalWeight;
  return Math.round((50 + raw * 50) * 10) / 10;
}

/** raw composite in [-1,1] from a 0–100 score. */
function rawFromScore(score: number): number {
  return (score - 50) / 50;
}

/** Single-window confidence: magnitude + factor agreement. */
function windowConfidence(score: number, factors: FactorResult[], dataQuality: number): number {
  const raw = rawFromScore(score);
  const direction = Math.sign(raw) || 0;
  const agreeing = factors.filter((f) => Math.sign(f.score) === direction && direction !== 0);
  const agreementRatio = factors.length > 0 ? agreeing.length / factors.length : 0;
  const magnitudeConf = Math.min(70, Math.abs(raw) * 100 * 0.85);
  const agreementConf = agreementRatio * 30;
  let confidence = Math.round((magnitudeConf + agreementConf) * dataQuality);
  return Math.max(5, Math.min(95, confidence));
}

/**
 * Run the five-factor analysis on ONE candle window (any timeframe).
 * Pure & deterministic — also used to replay history.
 */
export function runTimeframe(
  candles: Candle[],
  timeframe: Timeframe,
  dataQuality: number,
): TimeframeResult {
  const { factors, atr } = computeFactors(candles);
  const score = scoreFromFactors(factors);
  const price = candles[candles.length - 1]?.c ?? 0;
  return {
    timeframe,
    score,
    action: actionForScore(score),
    band: bandForScore(score),
    confidence: windowConfidence(score, factors, dataQuality),
    factors: factors.map((f) => ({
      key: f.key,
      score: Math.round(f.score * 1000) / 1000,
      weight: f.weight,
      values: f.values,
      contribution: Math.round(f.weight * f.score * 100) / 100,
    })),
    atr,
    atrPct: atr !== null && price > 0 ? Math.round((atr / price) * 10000) / 100 : null,
    dataQuality,
    candlesUsed: candles.length,
  };
}

/** ATR-based risk levels for an action at `price`. */
export function riskLevels(price: number, atrValue: number | null, action: SignalAction) {
  const atrNow = atrValue !== null && atrValue > 0 ? atrValue : price * 0.05;
  let entryLow: number | null = null;
  let entryHigh: number | null = null;
  let stopLoss: number | null = null;
  let takeProfit1: number | null = null;
  let takeProfit2: number | null = null;
  let riskReward: number | null = null;
  if (action === "BUY") {
    entryLow = price * 0.99;
    entryHigh = price * 1.005;
    stopLoss = price - 1.2 * atrNow;
    takeProfit1 = price + 1.8 * atrNow;
    takeProfit2 = price + 3.0 * atrNow;
    const risk = price - stopLoss;
    const reward = takeProfit1 - price;
    riskReward = risk > 0 ? Math.round((reward / risk) * 100) / 100 : null;
  } else if (action === "SELL") {
    // exit zone around current price; buy-back targets below
    entryLow = price * 0.995;
    entryHigh = price * 1.01;
    stopLoss = price + 1.2 * atrNow; // invalidation: price breaking above
    takeProfit1 = price - 1.8 * atrNow; // buy-back zone 1
    takeProfit2 = price - 3.0 * atrNow; // buy-back zone 2
    const risk = stopLoss - price;
    const reward = price - takeProfit1;
    riskReward = risk > 0 ? Math.round((reward / risk) * 100) / 100 : null;
  }
  return {
    entryLow,
    entryHigh,
    stopLoss,
    takeProfit1,
    takeProfit2,
    riskReward,
    expectedRangeLow: price - atrNow,
    expectedRangeHigh: price + atrNow,
  };
}

/* ------------------------------------------------------------------ */
/* Reasoning (plan §15–§16 — human language, never a promise)           */
/* ------------------------------------------------------------------ */

function describeFactor(k: string, v: Record<string, number | string | null>): { fa: string; en: string } {
  switch (k) {
    case "trend":
      return {
        fa: `روند: EMA20 در ${fmt(v.ema20 as number)} ${Number(v.ema20) >= Number(v.ema50) ? "بالاتر از" : "پایین‌تر از"} EMA50 (${fmt(v.ema50 as number)}) و قیمت ${Number(v.price) > Number(v.ema20) ? "بالاتر از" : "پایین‌تر از"} EMA20`,
        en: `Trend: EMA20 at ${fmt(v.ema20 as number)} ${Number(v.ema20) >= Number(v.ema50) ? "above" : "below"} EMA50 (${fmt(v.ema50 as number)}); price ${Number(v.price) > Number(v.ema20) ? "above" : "below"} EMA20`,
      };
    case "momentum":
      return {
        fa: `مومنتوم ۱۰کندلی ${fmtPct(v.roc10 as number)} با شیب ${Number(v.slope20) >= 0 ? "صعودی" : "نزولی"}`,
        en: `10-candle momentum ${fmtPct(v.roc10 as number)} with ${Number(v.slope20) >= 0 ? "rising" : "falling"} slope`,
      };
    case "macd":
      return {
        fa: `هیستوگرام MACD ${Number(v.hist) >= 0 ? "مثبت" : "منفی"} (${fmt(v.hist as number, 6)})`,
        en: `MACD histogram ${Number(v.hist) >= 0 ? "positive" : "negative"} (${fmt(v.hist as number, 6)})`,
      };
    case "rsi":
      return {
        fa: `RSI(14) = ${fmt(v.rsi as number, 1)}`,
        en: `RSI(14) = ${fmt(v.rsi as number, 1)}`,
      };
    case "volume":
      return {
        fa: `حجم معاملات نسبت به میانگین ۲۰کندلی ${Number(v.volumeNow) >= Number(v.volumeAvg) ? "بالاتر" : "پایین‌تر"}`,
        en: `Volume ${Number(v.volumeNow) >= Number(v.volumeAvg) ? "above" : "below"} the 20-candle average`,
      };
    default:
      return { fa: k, en: k };
  }
}

function buildReasoning(out: EngineOutput): { fa: string; en: string } {
  const t4h = out.timeframes["4h"];
  // top 3 contributing factors on the dominant trading timeframe
  const top = [...t4h.factors]
    .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution))
    .slice(0, 3);
  const topFa = top.map((t) => describeFactor(t.key, t.values).fa).join(" • ");
  const topEn = top.map((t) => describeFactor(t.key, t.values).en).join(" • ");

  const conf = Math.round(out.confidence);
  const volWarnFa = out.volatilityWarning
    ? " توجه: نوسانات بالاتر از حد معمول است و ریسک معامله بیشتر شده."
    : "";
  const volWarnEn = out.volatilityWarning
    ? " Note: volatility is elevated — trade risk is higher than usual."
    : "";

  if (out.action === "BUY") {
    return {
      fa: `گرایش خرید — امتیاز ${fmt(out.score, 0)} از ۱۰۰ با اطمینان ${conf}٪. مومنتوم و روند در تایم‌فریم‌های اصلی هم‌جهت صعودی هستند؛ شرایط ورود در حال بهبود است. عوامل اصلی: ${topFa}. نواحی کلیدی: ورود ${fmt(out.entryLow)}–${fmt(out.entryHigh)}، حد ضرر ${fmt(out.stopLoss)}، هدف اول ${fmt(out.takeProfit1)} و هدف دوم ${fmt(out.takeProfit2)}.${volWarnFa} این تحلیل الگوریتمی است، نه توصیه مالی.`,
      en: `BUY BIAS — score ${fmt(out.score, 0)}/100 at ${conf}% confidence. Momentum and trend are aligned bullishly on the primary timeframes; entry conditions are improving. Top factors: ${topEn}. Key levels: entry ${fmt(out.entryLow)}–${fmt(out.entryHigh)}, stop-loss ${fmt(out.stopLoss)}, TP1 ${fmt(out.takeProfit1)}, TP2 ${fmt(out.takeProfit2)}.${volWarnEn} Algorithmic analysis only — not financial advice.`,
    };
  }
  if (out.action === "SELL") {
    return {
      fa: `گرایش فروش — امتیاز ${fmt(out.score, 0)} از ۱۰۰ با اطمینان ${conf}٪. مومنتوم و روند هم‌جهت نزولی هستند. عوامل اصلی: ${topFa}. در صورت حفظ دارایی، حد ضرر پیشنهادی بالای ${fmt(out.stopLoss)} و ناحیه بازخرید ${fmt(out.takeProfit1)}–${fmt(out.takeProfit2)} است.${volWarnFa} این تحلیل الگوریتمی است، نه توصیه مالی.`,
      en: `SELL BIAS — score ${fmt(out.score, 0)}/100 at ${conf}% confidence. Momentum and trend are aligned bearishly. Top factors: ${topEn}. If holding, suggested stop above ${fmt(out.stopLoss)} with buy-back zone ${fmt(out.takeProfit1)}–${fmt(out.takeProfit2)}.${volWarnEn} Algorithmic analysis only — not financial advice.`,
    };
  }
  return {
    fa: `انتظار — امتیاز ${fmt(out.score, 0)} از ۱۰۰ با اطمینان ${conf}٪. بازار جهت مشخصی ندارد (امتیاز نزدیک ۵۰) و ورود زودهنگام ریسک دارد. عوامل اصلی: ${topFa}. محدوده انتظاری قیمت ${fmt(out.expectedRangeLow)} تا ${fmt(out.expectedRangeHigh)} است؛ منطقی‌تر است تا شکل‌گیری جهت روشن‌تر صبر کنیم.${volWarnFa} این تحلیل الگوریتمی است، نه توصیه مالی.`,
    en: `WAIT — score ${fmt(out.score, 0)}/100 at ${conf}% confidence. The market has no clear direction (score near 50); early entries carry risk. Top factors: ${topEn}. Expected price range ${fmt(out.expectedRangeLow)}–${fmt(out.expectedRangeHigh)}; waiting for clearer direction is prudent.${volWarnEn} Algorithmic analysis only — not financial advice.`,
  };
}

/* ------------------------------------------------------------------ */
/* Multi-timeframe engine                                              */
/* ------------------------------------------------------------------ */

export interface EngineInput {
  /** candle windows per timeframe (ascending, warm-up included) */
  timeframes: Record<Timeframe, Candle[]>;
  /** live price (fresh ticker); falls back to the latest 15m close */
  price: number;
  /** data quality per timeframe (0..1) */
  dataQuality?: Partial<Record<Timeframe, number>>;
}

/** Run the full multi-timeframe engine. Deterministic on candle data. */
export function runEngine(input: EngineInput): EngineOutput {
  const tfResults = {} as Record<Timeframe, TimeframeResult>;
  for (const tf of ["15m", "1h", "4h", "1d"] as Timeframe[]) {
    const candles = input.timeframes[tf] ?? [];
    const dq =
      input.dataQuality?.[tf] ??
      (candles.length >= 60 ? 1 : Math.max(0.4, candles.length / 60));
    tfResults[tf] = runTimeframe(candles, tf, dq);
  }

  // primary score = weighted blend of TF scores
  let weighted = 0;
  let wsum = 0;
  for (const tf of ["15m", "1h", "4h", "1d"] as Timeframe[]) {
    weighted += PRIMARY_TF_WEIGHTS[tf] * rawFromScore(tfResults[tf].score);
    wsum += PRIMARY_TF_WEIGHTS[tf];
  }
  const primaryRaw = weighted / wsum;
  const score = Math.round((50 + primaryRaw * 50) * 10) / 10;
  const action = actionForScore(score);
  const band = bandForScore(score);

  // timeframe agreement (share of TFs whose ACTION matches the primary action)
  const tfActions = (["15m", "1h", "4h", "1d"] as Timeframe[]).map((tf) => tfResults[tf].action);
  const agreementRatio =
    action === "WAIT"
      ? tfActions.filter((a) => a === "WAIT").length / 4
      : tfActions.filter((a) => a === action).length / 4;

  // factor agreement on the two dominant timeframes
  const dominantFactors = [...tfResults["4h"].factors, ...tfResults["1d"].factors];
  const direction = Math.sign(primaryRaw) || 0;
  const factorAgree =
    direction !== 0
      ? dominantFactors.filter((f) => Math.sign(f.score) === direction).length /
        dominantFactors.length
      : 0.5;

  // data quality = worst across TFs
  const dataQuality = Math.min(
    ...(["15m", "1h", "4h", "1d"] as Timeframe[]).map((tf) => tfResults[tf].dataQuality),
  );

  // volatility: daily ATR elevated vs its own 20-candle average? (⚠ §16)
  const t4h = tfResults["4h"];
  const t1d = tfResults["1d"];
  const atrPctNow = t1d.atrPct ?? t4h.atrPct;
  // heuristic: elevated when 1d ATR% ≥ 6% (PENGU's calm regime is ~3–4%)
  const volatilityWarning = atrPctNow !== null && atrPctNow >= 6;

  let confidence =
    Math.min(70, Math.abs(primaryRaw) * 100 * 0.85) +
    agreementRatio * 15 +
    factorAgree * 15;
  confidence = Math.round(confidence * dataQuality);
  if (volatilityWarning) confidence = Math.round(confidence * 0.85);
  confidence = Math.max(5, Math.min(95, confidence));

  const price = input.price > 0 ? input.price : (input.timeframes["15m"]?.slice(-1)[0]?.c ?? 0);
  const levels = riskLevels(price, t4h.atr, action);

  const out: EngineOutput = {
    action,
    band,
    score,
    confidence,
    dataQuality,
    price,
    timeframes: tfResults,
    ...levels,
    volatility: null,
    volatilityWarning,
    reasoning: { fa: "", en: "" },
    generatedAt: Date.now(),
  };
  // daily-return stddev as volatility context
  const dailyCloses = input.timeframes["1d"]?.map((c) => c.c) ?? [];
  if (dailyCloses.length >= 21) {
    const rets: number[] = [];
    for (let i = dailyCloses.length - 20; i < dailyCloses.length; i++) {
      rets.push((dailyCloses[i] - dailyCloses[i - 1]) / dailyCloses[i - 1]);
    }
    const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
    out.volatility = Math.sqrt(
      rets.reduce((a, r) => a + (r - mean) ** 2, 0) / rets.length,
    );
  }
  out.reasoning = buildReasoning(out);
  return out;
}
