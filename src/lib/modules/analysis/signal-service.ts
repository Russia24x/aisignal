/**
 * Signal service — persistence layer between the engine and the API.
 *
 * Guarantees:
 *  - exactly one signal per UTC day (idempotent generation, race-safe)
 *  - the stored signal is the same for every paying user (fairness)
 *  - outcome tracking builds a genuine track record (evaluated T+24h)
 *
 * @module lib/modules/analysis/signal-service
 */
import { db } from "@/lib/db";
import { createLogger } from "@/lib/logger";
import { getSnapshot, getHistory, analysisWindow } from "../market/service";
import { runEngine, type EngineOutput } from "./engine";
import { todayKey } from "../access/entitlements";

const log = createLogger("signal:service");

/** Get today's signal; generate & store it if absent (race-safe via upsert-ish create). */
export async function getOrCreateTodaySignal(): Promise<{ engine: EngineOutput; day: string; id: string; createdAt: Date }> {
  const day = todayKey();

  const existing = await db.signal.findUnique({ where: { day } });
  if (existing) {
    return {
      id: existing.id,
      day,
      createdAt: existing.generatedAt,
      engine: JSON.parse(existing.indicatorsJson) as EngineOutput,
    };
  }

  const t0 = Date.now();
  const [snapshot, history] = await Promise.all([getSnapshot(), getHistory()]);
  const { candles, dataQuality } = analysisWindow(history);
  if (candles.length < 35) {
    throw new Error("INSUFFICIENT_HISTORY");
  }
  const engine = runEngine({ candles, snapshot, dataQuality });
  const generationMs = Date.now() - t0;

  // race-safe: concurrent creators → unique(day) rejects the loser; re-read
  let row;
  try {
    row = await db.signal.create({
      data: {
        day,
        action: engine.action,
        confidence: engine.confidence,
        score: engine.score,
        price: engine.price,
        entryLow: engine.entryLow,
        entryHigh: engine.entryHigh,
        stopLoss: engine.stopLoss,
        takeProfit1: engine.takeProfit1,
        takeProfit2: engine.takeProfit2,
        reasoning: JSON.stringify(engine.reasoning),
        indicatorsJson: JSON.stringify(engine),
        dataQuality: engine.dataQuality,
        generationMs,
      },
    });
  } catch {
    row = await db.signal.findUniqueOrThrow({ where: { day } });
  }

  log.info("signal generated", { day, action: engine.action, score: engine.score, ms: generationMs });
  return { id: row.id, day, createdAt: row.generatedAt, engine: JSON.parse(row.indicatorsJson) as EngineOutput };
}

export interface SignalHistoryItem {
  day: string;
  action: string;
  confidence: number;
  score: number;
  priceAtSignal: number;
  outcome: string;
  outcomePrice: number | null;
  /** percent price change from signal to evaluation */
  priceChangePct: number | null;
  /** did the call beat a passive hold? for SELL: price down = correct */
  correct: boolean | null;
  generatedAt: string;
}

/** Evaluate OPEN signals older than 24h against current price. */
export async function evaluateOpenSignals(): Promise<number> {
  const cutoff = new Date(Date.now() - 24 * 3600 * 1000);
  const open = await db.signal.findMany({
    where: { outcome: "OPEN", generatedAt: { lt: cutoff } },
    orderBy: { generatedAt: "asc" },
    take: 10,
  });
  if (open.length === 0) return 0;

  const snapshot = await getSnapshot();
  const priceNow = snapshot.priceUsd;
  let updated = 0;
  for (const s of open) {
    const change = s.price > 0 ? ((priceNow - s.price) / s.price) * 100 : null;
    let correct: boolean | null = null;
    if (change !== null) {
      if (s.action === "BUY") correct = change > 0;
      else if (s.action === "SELL") correct = change < 0;
      else correct = Math.abs(change) < 3; // HOLD correct if flat
    }
    await db.signal.update({
      where: { id: s.id },
      data: {
        outcome: correct === null ? "EXPIRED" : correct ? "WIN" : "LOSS",
        outcomePrice: priceNow,
        evaluatedAt: new Date(),
      },
    });
    updated++;
  }
  log.info("evaluated signals", { count: updated, price: priceNow });
  return updated;
}

/** Public track record (no auth) — proves the engine's real performance.
 *  NEVER includes today's signal: the current day's action is the paid
 *  product and must not leak through the free track record.
 *  Paginated: `offset` skips rows ("load more"); `stats`/`total` always
 *  cover the ENTIRE history, not just the current page. */
export async function getSignalHistory(
  limit = 30,
  offset = 0,
): Promise<{ items: SignalHistoryItem[]; stats: Record<string, number>; total: number }> {
  await evaluateOpenSignals();
  const today = new Date().toISOString().slice(0, 10);
  const where = { day: { lt: today } };
  const [rows, statRows, total] = await Promise.all([
    db.signal.findMany({ where, orderBy: { day: "desc" }, take: limit, skip: offset }),
    db.signal.findMany({ where, select: { action: true, confidence: true, price: true, outcome: true, outcomePrice: true } }),
    db.signal.count({ where }),
  ]);
  const toChange = (s: { outcomePrice: number | null; price: number }) =>
    s.outcomePrice !== null && s.price > 0 ? ((s.outcomePrice - s.price) / s.price) * 100 : null;
  const items: SignalHistoryItem[] = rows.map((s) => {
    const change = toChange(s);
    let correct: boolean | null = null;
    if (change !== null) {
      if (s.action === "BUY") correct = change > 0;
      else if (s.action === "SELL") correct = change < 0;
      else correct = Math.abs(change) < 3;
    }
    return {
      day: s.day,
      action: s.action,
      confidence: s.confidence,
      score: s.score,
      priceAtSignal: s.price,
      outcome: s.outcome,
      outcomePrice: s.outcomePrice,
      priceChangePct: change !== null ? Math.round(change * 100) / 100 : null,
      correct,
      generatedAt: s.generatedAt.toISOString(),
    };
  });

  // stats over ALL history (stable while paging)
  const closed = statRows.filter((i) => i.outcome === "WIN" || i.outcome === "LOSS");
  const wins = closed.filter((i) => i.outcome === "WIN").length;
  const stats = {
    total: statRows.length,
    closed: closed.length,
    wins,
    losses: closed.length - wins,
    winRate: closed.length > 0 ? Math.round((wins / closed.length) * 100) : 0,
    avgConfidence:
      statRows.length > 0
        ? Math.round((statRows.reduce((a, i) => a + i.confidence, 0) / statRows.length) * 10) / 10
        : 0,
  };
  return { items, stats, total };
}
