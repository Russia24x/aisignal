"use client";

/**
 * PenguSignals — single-page application.
 *
 * Composition: Header → LiveTicker (WS) → Hero → PriceChart →
 * SignalSection (paywalled product) → MyDashboard (gated) →
 * PricingSection → TrackRecord → EngineSection → FAQ → Footer.
 *
 * Everything below is real: live market data, real engine output,
 * on-chain payment verification. No demo/mock data anywhere.
 *
 * @module app/page
 */
import { Header } from "@/components/pengu/Header";
import { LiveTicker } from "@/components/pengu/LiveTicker";
import { Hero } from "@/components/pengu/Hero";
import { PriceChart } from "@/components/pengu/PriceChart";
import { SignalSection } from "@/components/pengu/SignalSection";
import { MyDashboard } from "@/components/pengu/MyDashboard";
import { PricingSection } from "@/components/pengu/PricingSection";
import { PriceAlerts } from "@/components/pengu/PriceAlerts";
import { TrackRecord } from "@/components/pengu/TrackRecord";
import { EngineSection } from "@/components/pengu/EngineSection";
import { FaqSection, Footer } from "@/components/pengu/FaqFooter";
import { Reveal } from "@/components/pengu/Reveal";
import { BackToTop } from "@/components/pengu/BackToTop";

export default function Home() {
  return (
    <div className="relative flex min-h-screen flex-col">
      {/* ambient background layers */}
      <div className="aurora-bg" aria-hidden />
      <div className="ice-grid" aria-hidden />
      <div className="noise-overlay" aria-hidden />

      <Header />
      <LiveTicker />

      <main className="flex-1">
        <Hero />
        <Reveal>
          <PriceChart />
        </Reveal>
        <Reveal delay={60}>
          <SignalSection />
        </Reveal>
        <MyDashboard />
        <Reveal delay={60}>
          <PricingSection />
        </Reveal>
        <PriceAlerts />
        <Reveal>
          <TrackRecord />
        </Reveal>
        <Reveal delay={60}>
          <EngineSection />
        </Reveal>
        <Reveal delay={120}>
          <FaqSection />
        </Reveal>
      </main>

      <Footer />
      <BackToTop />
    </div>
  );
}
