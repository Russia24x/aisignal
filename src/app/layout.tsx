import type { Metadata, Viewport } from "next";
import { Vazirmatn, JetBrains_Mono } from "next/font/google";
import { Providers } from "@/components/providers";
import "./globals.css";

const vazir = Vazirmatn({
  subsets: ["arabic", "latin"],
  variable: "--font-vazirmatn",
  display: "swap",
});

const mono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono-code",
  display: "swap",
});

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
const DESCRIPTION =
  "Daily algorithmic buy/sell signals for PENGU on Abstract Chain. 11 technical indicator families, on-chain payments, real track record.";

export const metadata: Metadata = {
  metadataBase: new URL(APP_URL),
  title: {
    default: "PenguSignals — Smart PENGU signals on Abstract",
    template: "%s · PenguSignals",
  },
  description: DESCRIPTION,
  applicationName: "PenguSignals",
  keywords: [
    "PENGU",
    "Abstract",
    "Pudgy Penguins",
    "trading signals",
    "technical analysis",
    "buy sell signals",
    "Abstract Chain",
    "crypto signals",
    "AGW wallet",
  ],
  authors: [{ name: "PenguSignals" }],
  creator: "PenguSignals",
  openGraph: {
    type: "website",
    url: APP_URL,
    siteName: "PenguSignals",
    title: "PenguSignals — Smart PENGU signals on Abstract",
    description: DESCRIPTION,
    images: [
      {
        url: "/api/og",
        width: 1200,
        height: 630,
        alt: "PenguSignals — daily algorithmic PENGU trading signals on Abstract Chain",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "PenguSignals — Smart PENGU signals on Abstract",
    description: DESCRIPTION,
    images: ["/api/og"],
  },
  icons: {
    icon: [{ url: "/icon.svg", type: "image/svg+xml" }],
    shortcut: ["/icon.svg"],
    apple: [{ url: "/icon.svg" }],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, "max-image-preview": "large" },
  },
};

export const viewport: Viewport = {
  themeColor: "#0a1418",
  width: "device-width",
  initialScale: 1,
  colorScheme: "dark light",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fa" dir="rtl" suppressHydrationWarning>
      <body className={`${vazir.variable} ${mono.variable} font-sans`}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
