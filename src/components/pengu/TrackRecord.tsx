"use client";

/**
 * TrackRecord — public table of past signals with real outcomes.
 * Built from the Signal table (auto-evaluated T+24h). No demo data:
 * starts empty and fills as days pass.
 *
 * @module components/pengu/TrackRecord
 */
import { useEffect, useState } from "react";
import { useI18n } from "@/components/i18n/I18nProvider";
import { fmt } from "./useMarket";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Trophy } from "lucide-react";
import { cn } from "@/lib/utils";

interface Item {
  day: string;
  action: string;
  confidence: number;
  priceAtSignal: number;
  outcome: string;
  outcomePrice: number | null;
  priceChangePct: number | null;
}

interface Stats {
  total: number;
  closed: number;
  wins: number;
  losses: number;
  winRate: number;
  avgConfidence: number;
}

export function TrackRecord() {
  const { t } = useI18n();
  const [items, setItems] = useState<Item[] | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    fetch("/api/signal/history?limit=30", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (d.ok) {
          setItems(d.items);
          setStats(d.stats);
        }
      })
      .catch(() => setItems([]));
  }, []);

  return (
    <section id="track" className="scroll-mt-20 px-4 py-16">
      <div className="mx-auto max-w-6xl">
        <header className="mb-6">
          <h2 className="flex items-center gap-2.5 text-2xl font-black sm:text-3xl">
            <Trophy className="size-7 text-primary" />
            {t("track.title")}
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">{t("track.subtitle")}</p>
        </header>

        {/* stats */}
        {stats && (
          <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard label={t("track.winRate")} value={`${stats.winRate}%`} accent />
            <StatCard label={t("track.closedSignals")} value={String(stats.closed)} />
            <StatCard label={t("track.avgConfidence")} value={`${stats.avgConfidence}%`} />
            <StatCard label={t("signal.day")} value={String(stats.total)} />
          </div>
        )}

        {/* table */}
        <div className="glass-card overflow-hidden">
          {items === null ? (
            <div className="space-y-2 p-5">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-2/3" />
            </div>
          ) : items.length === 0 ? (
            <div className="empty-grid relative px-6 py-14 text-center">
              <div className="mx-auto mb-3 grid size-12 place-items-center rounded-2xl bg-primary/15 text-primary ring-2 ring-primary/30">
                <Trophy className="size-6" />
              </div>
              <p className="text-sm font-bold">🐧 {t("track.empty")}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {t("track.subtitle")}
              </p>
            </div>
          ) : (
            <div className="max-h-96 overflow-y-auto nice-scroll">
              <Table>
                <TableHeader className="sticky top-0 bg-popover/95 backdrop-blur">
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="text-xs">{t("track.day")}</TableHead>
                    <TableHead className="text-xs">{t("track.action")}</TableHead>
                    <TableHead className="text-xs">{t("signal.confidence")}</TableHead>
                    <TableHead className="text-xs">{t("track.priceAtSignal")}</TableHead>
                    <TableHead className="text-xs">{t("track.change")}</TableHead>
                    <TableHead className="text-xs">{t("track.outcome")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((it) => (
                    <TableRow key={it.day} className="text-xs">
                      <TableCell className="font-mono font-semibold">{it.day}</TableCell>
                      <TableCell>
                        <ActionBadge action={it.action} />
                      </TableCell>
                      <TableCell className="font-mono">{it.confidence}%</TableCell>
                      <TableCell className="font-mono" dir="ltr">
                        {fmt.price(it.priceAtSignal)}
                      </TableCell>
                      <TableCell
                        dir="ltr"
                        className={cn(
                          "font-mono font-bold",
                          (it.priceChangePct ?? 0) >= 0 ? "text-buy" : "text-sell",
                        )}
                      >
                        {it.priceChangePct !== null ? fmt.pct(it.priceChangePct) : "—"}
                      </TableCell>
                      <TableCell>
                        <OutcomeBadge outcome={it.outcome} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function StatCard({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="glass-card px-4 py-3">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className={cn("mt-1 font-mono text-xl font-black", accent && "text-primary")} dir="ltr">
        {value}
      </div>
    </div>
  );
}

export function ActionBadge({ action }: { action: string }) {
  const { t } = useI18n();
  const cls =
    action === "BUY"
      ? "bg-buy/15 text-buy ring-buy/30"
      : action === "SELL"
        ? "bg-sell/15 text-sell ring-sell/30"
        : "bg-hold/15 text-hold ring-hold/30";
  return (
    <Badge variant="outline" className={cn("px-2 font-black", cls)}>
      {t(`signal.${action}`)}
    </Badge>
  );
}

export function OutcomeBadge({ outcome }: { outcome: string }) {
  const { t } = useI18n();
  const cls =
    outcome === "WIN"
      ? "bg-buy/15 text-buy ring-buy/30"
      : outcome === "LOSS"
        ? "bg-sell/15 text-sell ring-sell/30"
        : "bg-muted text-muted-foreground ring-border";
  return (
    <Badge variant="outline" className={cn("px-2 font-bold", cls)}>
      {t(`track.${outcome}`)}
    </Badge>
  );
}
