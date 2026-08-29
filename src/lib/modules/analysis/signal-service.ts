/**
 * Signal service v4 — STATELESS orchestration between market data, engine
 * and API. NO database (target plan "اصل مهم معماری": nothing is persisted).
 *
 * How the old guarantees survive without storage:
 *
 *  - "One signal per day, same for every paying user" → the composite signal
 *    is computed ONCE per cache window and shared by every request hitting
 *    the same isolate window (30s freshness ladder from the plan §13).
 *  - "Track record / history" → DETERMINISTIC RECOMPUTATION: the engine is
 *    pure, daily candles are public and immutable, so any past day can be
 *    replayed exactly and verified by anyone — stronger than a private DB.
 *  - "Outcome evaluation (T+1)" → each past day is evaluated against the
 *    NEXT daily close from the same public series.
 *
 * Definitions (deterministic):
 *  - signal FOR day D = five-factor analysis of daily candles strictly
 *    BEFORE D (data known at D 00:00 UTC), price at signal = close of D-1.
 *  - outcome of day D = close(D) vs close(D-1).
 *  - today's live signal (the paid product) uses live multi-timeframe data
 *    and is NEVER exposed through the free history/preview endpoints.
 *
 * @module lib/modules/analysis/signal-service
 */
import { TTLCache } from "@/lib/cache";
import { serverConfig } from "@/lib/config";
import { createLogger } from "@/lib/logger";
import { getSnapshot, getTimeframe, getDailySeries } from "../market/service";
import type { Candle } from "../market/types";
import {
  runEngine,
  runTimeframe,
  riskLevels,
  type EngineOutput,
  type TimeframeResult,
} from "./engine";
import type { Timeframe } from "../market/types";

const log = createLogger("signal:service");

/** Live composite signal — cached at the shortest TF TTL (freshness ladder). */
const currentCache = new TTLCache<EngineOutput>(serverConfig.timeframeTtlMs["15m"]);

/** Full history payload — recomputed from public candles, cached 15 min. */
interface HistoryBase {
  /** ALL scored days, newest first */
  items: SignalHistoryItem[];
  stats: Record<string, number>;
  total: number;
  curve: Array<{ day: string; cum: number }>;
}
const historyCache = new TTLCache<HistoryBase>(serverConfig.HISTORY_CACHE_TTL_MS);

/** Per-day detail recomputation — cached 15 min each. */
const detailCache = new TTLCache<SignalDetail>(serverConfig.HISTORY_CACHE_TTL_MS);

/** Candle lookback (per window) for deterministic history replay — must
 *  match the live 1d timeframe window size for consistency. */
const HISTORY_WINDOW = 120;
/** Minimum warm-up candles before a day can be scored. */
const HISTORY_WARMUP = 60;

/** UTC day key (e.g. "2026-08-29"). */
export function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function dayKeyOf(candle: Candle): string {
  return new Date(candle.t).toISOString().slice(0, 10);
}

/* ------------------------------------------------------------------ */
/* Live composite signal (the paid product)                            */
/* ------------------------------------------------------------------ */

export async function getCurrentSignal(): Promise<EngineOutput> {
  return currentCache.getOrRefresh("current", async () => {
    const t0 = Date.now();
    const [snapshot, tf15, tf1h, tf4h, tf1d] = await Promise.all([
      getSnapshot(),
      getTimeframe("15m"),
      getTimeframe("1h"),
      getTimeframe("4h"),
      getTimeframe("1d"),
    ]);
    const engine = runEngine({
      timeframes: {
        "15m": tf15.candles,
        "1h": tf1h.candles,
        "4h": tf4h.candles,
        "1d": tf1d.candles,
      },
      price: snapshot.priceUsd,
    });
    log.info("signal computed", {
      action: engine.action,
      score: engine.score,
      confidence: engine.confidence,
      ms: Date.now() - t0,
    });
    return engine;
  });
}

/** Free preview — consensus + timeframe dots ONLY (no levels/reasoning). */
export interface PreviewData {
  day: string;
  updatedAt: number;
  /** factor consensus across the two dominant timeframes */
  consensus: { bullish: number; bearish: number; neutral: number; total: number };
  /** per-timeframe action dots (BUY/SELL/WAIT only — no scores) */
  timeframes: Array<{ timeframe: Timeframe; action: TimeframeResult["action"] }>;
  dataQuality: number;
  candlesUsed: number;
  indicatorsCount: number;
}

export async function getPreview(): Promise<PreviewData> {
  const signal = await getCurrentSignal();
  const dominant = [...signal.timeframes["4h"].factors, ...signal.timeframes["1d"].factors];
  const bullish = dominant.filter((f) => f.score > 0.05).length;
  const bearish = dominant.filter((f) => f.score < -0.05).length;
  const neutral = dominant.length - bullish - bearish;
  return {
    day: todayKey(),
    updatedAt: signal.generatedAt,
    consensus: { bullish, bearish, neutral, total: dominant.length },
    timeframes: (["15m", "1h", "4h", "1d"] as Timeframe[]).map((tf) => ({
      timeframe: tf,
      action: signal.timeframes[tf].action,
    })),
    dataQuality: signal.dataQuality,
    candlesUsed: signal.timeframes["4h"].candlesUsed,
    indicatorsCount: 5,
  };
}

/* ------------------------------------------------------------------ */
/* Deterministic history (public track record)                         */
/* ------------------------------------------------------------------ */

export interface SignalHistoryItem {
  day: string;
  action: string;
  band: string;
  confidence: number;
  score: number;
  priceAtSignal: number;
  outcome: "WIN" | "LOSS" | "EXPIRED" | "OPEN";
  outcomePrice: number | null;
  priceChangePct: number | null;
  correct: boolean | null;
}

export interface HistoryPayload {
  items: SignalHistoryItem[];
  stats: Record<string, number>;
  total: number;
  curve: Array<{ day: string; cum: number }>;
}

function evaluate(action: string, changePct: number): boolean {
  if (action === "BUY") return changePct > 0;
  if (action === "SELL") return changePct < 0;
  return Math.abs(changePct) < 3; // WAIT correct if flat
}

/**
 * Recompute the full track record from public daily candles.
 * Deterministic — identical output for identical candle data. The full list
 * is cached; paging happens per request outside the cache.
 */
export async function getSignalHistory(limit = 30, offset = 0): Promise<HistoryPayload> {
  const base = await historyCache.getOrRefresh("history", async (): Promise<HistoryBase> => {
    const series = await getDailySeries();
    const today = todayKey();

    // i = index of the day the signal was FOR (window = candles[:i])
    const scored: SignalHistoryItem[] = [];
    for (let i = HISTORY_WARMUP; i < series.length; i++) {
      const dayCandle = series[i];
      const day = dayKeyOf(dayCandle);
      if (day >= today) break; // today (and the live partial candle) = paid
      const window = series.slice(Math.max(0, i - HISTORY_WINDOW), i);
      if (window.length < HISTORY_WARMUP) continue;
      const prevClose = window[window.length - 1].c;
      if (!prevClose) continue;

      const result = runTimeframe(window, "1d", 1);
      const closeNow = dayCandle.c;
      const changePct =
        prevClose > 0 ? Math.round(((closeNow - prevClose) / prevClose) * 10000) / 100 : null;
      const correct = changePct !== null ? evaluate(result.action, changePct) : null;
      scored.push({
        day,
        action: result.action,
        band: result.band,
        confidence: result.confidence,
        score: result.score,
        priceAtSignal: prevClose,
        outcome: correct === null ? "EXPIRED" : correct ? "WIN" : "LOSS",
        outcomePrice: closeNow,
        priceChangePct: changePct,
        correct,
      });
    }

    // chronological ascending → newest first for paging
    scored.reverse();

    const closed = scored.filter((i) => i.outcome === "WIN" || i.outcome === "LOSS");
    const wins = closed.filter((i) => i.outcome === "WIN").length;
    const stats = {
      total: scored.length,
      closed: closed.length,
      wins,
      losses: closed.length - wins,
      winRate: closed.length > 0 ? Math.round((wins / closed.length) * 100) : 0,
      avgConfidence:
        scored.length > 0
          ? Math.round((scored.reduce((a, i) => a + i.confidence, 0) / scored.length) * 10) / 10
          : 0,
    };

    // equity curve — cumulative strategy return (%) over closed days,
    // chronological: BUY → +Δ%, SELL → −Δ%, WAIT → 0. Simple sum, honest.
    let cum = 0;
    const curve: Array<{ day: string; cum: number }> = [];
    for (const s of [...scored].reverse()) {
      if (s.outcome !== "WIN" && s.outcome !== "LOSS") continue;
      const ret =
        s.priceChangePct === null
          ? 0
          : s.action === "BUY"
            ? s.priceChangePct
            : s.action === "SELL"
              ? -s.priceChangePct
              : 0;
      cum += ret;
      curve.push({ day: s.day, cum: Math.round(cum * 100) / 100 });
    }

    log.debug("history recomputed", { days: scored.length, winRate: stats.winRate });
    return { items: scored, stats, total: scored.length, curve };
  });

  return {
    items: base.items.slice(offset, offset + limit),
    stats: base.stats,
    total: base.total,
    curve: base.curve,
  };
}

/* ------------------------------------------------------------------ */
/* Per-day detail (public drill-down for PAST days only)               */
/* ------------------------------------------------------------------ */

export interface SignalDetail {
  day: string;
  action: string;
  band: string;
  score: number;
  confidence: number;
  dataQuality: number;
  price: number;
  entryLow: number | null;
  entryHigh: number | null;
  stopLoss: number | null;
  takeProfit1: number | null;
  takeProfit2: number | null;
  riskReward: number | null;
  expectedRangeLow: number | null;
  expectedRangeHigh: number | null;
  atr: number | null;
  factors: TimeframeResult["factors"];
  reasoning: { fa: string; en: string };
  candlesUsed: number;
  outcome: string;
  outcomePrice: number | null;
  priceChangePct: number | null;
}

export async function getSignalDetail(
  day: string,
): Promise<{ ok: true; signal: SignalDetail } | { ok: false; code: "TODAY_PAYWALLED" | "NOT_FOUND" }> {
  const today = todayKey();
  if (day >= today) return { ok: false, code: "TODAY_PAYWALLED" };

  const cached = detailCache.get(day);
  if (cached) return { ok: true, signal: cached };

  const series = await getDailySeries();
  const idx = series.findIndex((c) => dayKeyOf(c) === day);
  if (idx < 0 || idx < HISTORY_WARMUP) return { ok: false, code: "NOT_FOUND" };

  const window = series.slice(Math.max(0, idx - HISTORY_WINDOW), idx);
  const prevClose = window[window.length - 1].c;
  const result = runTimeframe(window, "1d", 1);
  const levels = riskLevels(prevClose, result.atr, result.action);
  const closeNow = series[idx].c;
  const changePct =
    prevClose > 0 ? Math.round(((closeNow - prevClose) / prevClose) * 10000) / 100 : null;
  const correct = changePct !== null ? evaluate(result.action, changePct) : null;

  const detail: SignalDetail = {
    day,
    action: result.action,
    band: result.band,
    score: result.score,
    confidence: result.confidence,
    dataQuality: result.dataQuality,
    price: prevClose,
    ...levels,
    atr: result.atr,
    factors: result.factors,
    reasoning: {
      fa: `سیگنال روز ${day} با امتیاز ${result.score} از ۱۰۰ بازمحاسبه شد — ${result.factors
        .map((f) => `${f.key}: ${f.score >= 0 ? "+" : ""}${Math.round(f.score * 100)}`)
        .join(" ، ")}. این بازمحاسبه قطعی از کندل‌های عمومی است.`,
      en: `Signal for ${day} recomputed deterministically — score ${result.score}/100 — ${result.factors
        .map((f) => `${f.key}: ${f.score >= 0 ? "+" : ""}${Math.round(f.score * 100)}`)
        .join(", ")}. Replayable from public candles.`,
    },
    candlesUsed: result.candlesUsed,
    outcome: correct === null ? "EXPIRED" : correct ? "WIN" : "LOSS",
    outcomePrice: closeNow,
    priceChangePct: changePct,
  };
  detailCache.set(day, detail);
  return { ok: true, signal: detail };
}
