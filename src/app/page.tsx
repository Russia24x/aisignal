"use client";

/**
 * PenguSignals — single-page application.
 *
 * Composition: Header → Hero → PriceChart → SignalSection (paywalled
 * product) → PricingSection → TrackRecord → EngineSection → FAQ → Footer.
 *
 * Everything below is real: live market data, real engine output,
 * on-chain payment verification. No demo/mock data anywhere.
 *
 * @module app/page
 */
import { Header } from "@/components/pengu/Header";
import { Hero } from "@/components/pengu/Hero";
import { PriceChart } from "@/components/pengu/PriceChart";
import { SignalSection } from "@/components/pengu/SignalSection";
import { PricingSection } from "@/components/pengu/PricingSection";
import { TrackRecord } from "@/components/pengu/TrackRecord";
import { EngineSection } from "@/components/pengu/EngineSection";
import { FaqSection, Footer } from "@/components/pengu/FaqFooter";

export default function Home() {
  return (
    <div className="relative flex min-h-screen flex-col">
      {/* ambient background layers */}
      <div className="aurora-bg" aria-hidden />
      <div className="ice-grid" aria-hidden />

      <Header />

      <main className="flex-1">
        <Hero />
        <PriceChart />
        <SignalSection />
        <PricingSection />
        <TrackRecord />
        <EngineSection />
        <FaqSection />
      </main>

      <Footer />
    </div>
  );
}
