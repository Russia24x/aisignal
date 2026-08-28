"use client";

/**
 * FaqSection + Footer.
 *
 * @module components/pengu/FaqFooter
 */
import { useI18n } from "@/components/i18n/I18nProvider";
import { publicConfig } from "@/lib/public-config";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { HelpCircle, ShieldCheck, Snowflake } from "lucide-react";

export function FaqSection() {
  const { t } = useI18n();
  const faqs = [
    { q: t("faq.q1"), a: t("faq.a1") },
    { q: t("faq.q2"), a: t("faq.a2") },
    { q: t("faq.q3"), a: t("faq.a3") },
    { q: t("faq.q4"), a: t("faq.a4") },
  ];
  return (
    <section id="faq" className="scroll-mt-20 px-4 py-16">
      <div className="mx-auto max-w-3xl">
        <h2 className="mb-8 flex items-center justify-center gap-2.5 text-2xl font-black sm:text-3xl">
          <HelpCircle className="size-7 text-primary" />
          {t("faq.title")}
        </h2>
        <Accordion type="single" collapsible className="glass-card px-5 py-2">
          {faqs.map((f, i) => (
            <AccordionItem key={i} value={`q${i}`} className="border-border/50">
              <AccordionTrigger className="text-sm font-bold hover:no-underline">{f.q}</AccordionTrigger>
              <AccordionContent className="text-[13px] leading-7 text-muted-foreground">{f.a}</AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </div>
    </section>
  );
}

export function Footer() {
  const { t } = useI18n();
  return (
    <footer className="mt-auto border-t border-border/50 bg-background/60 px-4 py-8 backdrop-blur-xl">
      <div className="mx-auto flex max-w-6xl flex-col items-center gap-4 text-center">
        <div className="flex items-center gap-2 text-sm font-black">
          <span className="grid size-7 place-items-center rounded-lg bg-primary/15 text-primary ring-1 ring-primary/30">
            <Snowflake className="size-4" />
          </span>
          Pengu<span className="text-primary">Signals</span>
        </div>
        <p className="max-w-2xl text-xs leading-6 text-muted-foreground">{t("footer.disclaimer")}</p>
        <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <ShieldCheck className="size-3.5 text-primary" />
            {t("footer.security")}
          </span>
          <span>
            {t("footer.treasury")}:{" "}
            <a
              href={`${publicConfig.explorerUrl}/address/${publicConfig.treasury}`}
              target="_blank"
              rel="noreferrer noopener"
              className="font-mono text-primary hover:underline"
              dir="ltr"
            >
              {publicConfig.treasury.slice(0, 8)}…{publicConfig.treasury.slice(-6)}
            </a>
          </span>
          <a
            href="https://abs.xyz"
            target="_blank"
            rel="noreferrer noopener"
            className="hover:text-foreground"
          >
            {t("footer.builtOn")} ↗
          </a>
        </div>
      </div>
    </footer>
  );
}
