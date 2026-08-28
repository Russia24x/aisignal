/**
 * The PenguSignals analysis engine.
 *
 * Combines 11 factor families (trend, momentum, volatility, volume,
 * mean-reversion, market structure) into one weighted composite score,
 * derives a BUY / SELL / HOLD decision with confidence, and computes
 * ATR-based risk-management levels (entry zone, stop-loss, take-profits).
 *
 * The engine is deterministic given identical market data — same input,
 * same signal — so the stored per-day signal is reproducible & auditable.
 *
 * @module lib/modules/analysis/engine
 */
import type { Candle, MarketSnapshot } from "../market/types";
import { computeFactors, type FactorResult, type SRContext } from "./signals";

export type SignalAction = "BUY" | "SELL" | "HOLD";

export interface EngineFactor {
  key: string;
  score: number; // -1..1
  weight: number;
  values: Record<string, number | string | null>;
  contribution: number; // weight * score (signed)
}

export interface EngineOutput {
  action: SignalAction;
  score: number; // -100..100
  confidence: number; // 0..100
  dataQuality: number; // 0..1
  price: number;
  entryLow: number | null;
  entryHigh: number | null;
  stopLoss: number | null;
  takeProfit1: number | null;
  takeProfit2: number | null;
  riskReward: number | null;
  expectedRangeLow: number | null;
  expectedRangeHigh: number | null;
  factors: EngineFactor[];
  atr: number | null;
  volatility: number | null; // 20d stddev of daily returns
  support: number | null;
  resistance: number | null;
  reasoning: { fa: string; en: string };
  generatedAt: number;
  candlesUsed: number;
}

/** Decision thresholds (composite units). */
const BUY_THRESHOLD = 20;
const SELL_THRESHOLD = -20;

function fmt(n: number | null | undefined, digits = 5): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  if (Math.abs(n) >= 1000) return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
  return n.toFixed(digits);
}
function fmtPct(n: number | null | undefined, digits = 1): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return `${n >= 0 ? "+" : ""}${n.toFixed(digits)}%`;
}

/** Build human-readable, fully data-grounded reasoning in fa & en. */
function buildReasoning(
  action: SignalAction,
  score: number,
  confidence: number,
  factors: EngineFactor[],
  sr: SRContext,
  out: Pick<
    EngineOutput,
    | "price"
    | "stopLoss"
    | "takeProfit1"
    | "takeProfit2"
    | "entryLow"
    | "entryHigh"
    | "expectedRangeLow"
    | "expectedRangeHigh"
  >,
  snapshot: MarketSnapshot,
): { fa: string; en: string } {
  // top 3 contributing factors by |contribution|
  const top = [...factors].sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution)).slice(0, 3);
  const f = (x: FactorResult) => x.values;

  const describeFactor = (k: string, v: Record<string, number | string | null>): { fa: string; en: string } => {
    switch (k) {
      case "emaTrend":
        return {
          fa: `روند EMA: EMA9 در ${fmt(v.ema9 as number)} و EMA21 در ${fmt(v.ema21 as number)}`,
          en: `EMA trend: EMA9 at ${fmt(v.ema9 as number)} vs EMA21 at ${fmt(v.ema21 as number)}`,
        };
      case "smaStructure":
        return {
          fa: `ساختار SMA: SMA20=${fmt(v.sma20 as number)} ، SMA50=${fmt(v.sma50 as number)}`,
          en: `SMA structure: SMA20=${fmt(v.sma20 as number)}, SMA50=${fmt(v.sma50 as number)}`,
        };
      case "rsi":
        return {
          fa: `RSI(14) = ${fmt(v.rsi as number, 1)}`,
          en: `RSI(14) = ${fmt(v.rsi as number, 1)}`,
        };
      case "macd":
        return {
          fa: `هیستوگرام MACD = ${fmt(v.hist as number, 6)}`,
          en: `MACD histogram = ${fmt(v.hist as number, 6)}`,
        };
      case "bollinger":
        return {
          fa: `موقعیت %B بولینگر = ${fmt(v.percentB as number, 2)}`,
          en: `Bollinger %B = ${fmt(v.percentB as number, 2)}`,
        };
      case "stochastic":
        return {
          fa: `استوکاستیک %K=${fmt(v.k as number, 1)} ، %D=${fmt(v.d as number, 1)}`,
          en: `Stochastic %K=${fmt(v.k as number, 1)}, %D=${fmt(v.d as number, 1)}`,
        };
      case "obv":
        return {
          fa: `شیب OBV نسبت به روند قیمت ${Number(v.obvSlope as number) >= 0 ? "مثبت" : "منفی"}`,
          en: `OBV slope is ${Number(v.obvSlope as number) >= 0 ? "positive" : "negative"} vs price trend`,
        };
      case "vwap":
        return {
          fa: `قیمت ${Number(v.price) > Number(v.vwap) ? "بالاتر از" : "پایین‌تر از"} VWAP(${fmt(v.vwap as number)})`,
          en: `Price is ${Number(v.price) > Number(v.vwap) ? "above" : "below"} VWAP(${fmt(v.vwap as number)})`,
        };
      case "momentum":
        return {
          fa: `مومنتوم ۱۰روزه = ${fmtPct(v.roc10 as number)}`,
          en: `10-day momentum = ${fmtPct(v.roc10 as number)}`,
        };
      case "volume":
        return {
          fa: `حجم معاملات نسبت به میانگین ${v.volumeAvg ? "بالا" : "پایین"}`,
          en: `Volume ${v.volumeAvg ? "elevated" : "subdued"} vs 20d average`,
        };
      case "srLevels":
        return {
          fa: `حمایت ${fmt(v.nearestSupport as number)} / مقاومت ${fmt(v.nearestResistance as number)}`,
          en: `Support ${fmt(v.nearestSupport as number)} / Resistance ${fmt(v.nearestResistance as number)}`,
        };
      default:
        return { fa: k, en: k };
    }
  };

  const topFa = top.map((t) => describeFactor(t.key, t.values).fa).join(" • ");
  const topEn = top.map((t) => describeFactor(t.key, t.values).en).join(" • ");

  const conf = Math.round(confidence);
  if (action === "BUY") {
    return {
      fa: `امتیاز مرکب ${fmt(score, 0)} از ۱۰۰- → سیگنال خرید با اطمینان ${conf}٪. قیمت فعلی $${fmt(snapshot.priceUsd)} (تغییر ۲۴س $${fmtPct(snapshot.change24h)}). نواحی کلیدی: ورود ${fmt(out.entryLow)}–${fmt(out.entryHigh)}، حد ضرر ${fmt(out.stopLoss)}، هدف اول ${fmt(out.takeProfit1)} و هدف دوم ${fmt(out.takeProfit2)}. عوامل اصلی: ${topFa}. این سیگنال صرفاً تحلیل الگوریتمی است، نه توصیه مالی.`,
      en: `Composite score ${fmt(score, 0)}/±100 → BUY with ${conf}% confidence. Current price $${fmt(snapshot.priceUsd)} (24h ${fmtPct(snapshot.change24h)}). Key levels: entry ${fmt(out.entryLow)}–${fmt(out.entryHigh)}, stop-loss ${fmt(out.stopLoss)}, TP1 ${fmt(out.takeProfit1)}, TP2 ${fmt(out.takeProfit2)}. Top factors: ${topEn}. Algorithmic analysis only — not financial advice.`,
    };
  }
  if (action === "SELL") {
    return {
      fa: `امتیاز مرکب ${fmt(score, 0)} از ۱۰۰- → سیگنال فروش با اطمینان ${conf}٪. قیمت فعلی $${fmt(snapshot.priceUsd)} (تغییر ۲۴س $${fmtPct(snapshot.change24h)}%). عوامل اصلی: ${topFa}. در صورت حفظ دارایی، حد ضرر پیشنهادی بالای ${fmt(out.stopLoss)} و ناحیه بازخرید ${fmt(out.takeProfit1)}–${fmt(out.takeProfit2)} است. این سیگنال صرفاً تحلیل الگوریتمی است، نه توصیه مالی.`,
      en: `Composite score ${fmt(score, 0)}/±100 → SELL with ${conf}% confidence. Current price $${fmt(snapshot.priceUsd)} (24h ${fmtPct(snapshot.change24h)}%). Top factors: ${topEn}. If holding, suggested stop above ${fmt(out.stopLoss)} with buy-back zone ${fmt(out.takeProfit1)}–${fmt(out.takeProfit2)}. Algorithmic analysis only — not financial advice.`,
    };
  }
  return {
    fa: `امتیاز مرکب ${fmt(score, 0)} از ۱۰۰- → بازار بی‌طرف (نگهداری/انتظار) با اطمینان ${conf}٪. قیمت فعلی $${fmt(snapshot.priceUsd)} در محدوده انتظاری ${fmt(out.expectedRangeLow ?? null)} تا ${fmt(out.expectedRangeHigh ?? null)}. عوامل اصلی: ${topFa}. صبر تا شکست حمایت ${fmt(sr.nearestSupport)} یا مقاومت ${fmt(sr.nearestResistance)} منطقی‌تر است. این سیگنال صرفاً تحلیل الگوریتمی است، نه توصیه مالی.`,
    en: `Composite score ${fmt(score, 0)}/±100 → neutral market (HOLD/wait) at ${conf}% confidence. Current price $${fmt(snapshot.priceUsd)} inside expected range ${fmt(out.expectedRangeLow ?? null)}–${fmt(out.expectedRangeHigh ?? null)}. Top factors: ${topEn}. Waiting for a break of support ${fmt(sr.nearestSupport)} or resistance ${fmt(sr.nearestResistance)} is prudent. Algorithmic analysis only — not financial advice.`,
  };
}

export interface EngineInput {
  candles: Candle[]; // daily, ascending
  snapshot: MarketSnapshot;
  dataQuality: number;
}

/** Run the engine over daily candles + live snapshot. */
export function runEngine(input: EngineInput): EngineOutput {
  const { candles, snapshot, dataQuality } = input;
  const { factors, sr, atr, volatility } = computeFactors({
    candles,
    snapshot: {
      priceUsd: snapshot.priceUsd,
      volume24hUsd: snapshot.volume24hUsd,
      liquidityUsd: snapshot.liquidityUsd,
      change24h: snapshot.change24h,
    },
  });

  const totalWeight = factors.reduce((a, f) => a + f.weight, 0);
  const rawScore = factors.reduce((a, f) => a + f.weight * f.score, 0) / totalWeight; // -1..1
  const score = Math.round(rawScore * 100 * 10) / 10; // -100..100

  const action: SignalAction = score >= BUY_THRESHOLD ? "BUY" : score <= SELL_THRESHOLD ? "SELL" : "HOLD";

  // confidence: magnitude + agreement across factors
  const direction = Math.sign(score) || 0;
  const agreeing = factors.filter((f) => Math.sign(f.score) === direction && direction !== 0);
  const agreementRatio = factors.length > 0 ? agreeing.length / factors.length : 0;
  const magnitudeConf = Math.min(70, Math.abs(score) * 0.85);
  const agreementConf = agreementRatio * 30;
  let confidence = Math.round((magnitudeConf + agreementConf) * dataQuality);
  confidence = Math.max(5, Math.min(95, confidence));

  const price = snapshot.priceUsd;
  const atrNow = atr !== null && atr > 0 ? atr : price * 0.05; // fallback 5% daily range

  // Risk management (ATR-based)
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
  const expectedRangeLow = price - atrNow;
  const expectedRangeHigh = price + atrNow;

  const engineFactors: EngineFactor[] = factors.map((f) => ({
    key: f.key,
    score: Math.round(f.score * 1000) / 1000,
    weight: f.weight,
    values: f.values,
    contribution: Math.round(f.weight * f.score * 100) / 100,
  }));

  const partial = {
    price,
    entryLow,
    entryHigh,
    stopLoss,
    takeProfit1,
    takeProfit2,
    expectedRangeLow,
    expectedRangeHigh,
  };

  const reasoning = buildReasoning(action, score, confidence, engineFactors, sr, partial, snapshot);

  return {
    action,
    score,
    confidence,
    dataQuality,
    ...partial,
    riskReward,
    factors: engineFactors,
    atr: atrNow,
    volatility,
    support: sr.nearestSupport,
    resistance: sr.nearestResistance,
    reasoning,
    generatedAt: Date.now(),
    candlesUsed: candles.length,
  };
}
