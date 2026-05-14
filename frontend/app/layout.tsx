// File: frontend/app/layout.tsx
import type { Metadata } from "next";
import { Space_Grotesk, Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { GridOverlays } from "@/components/GridOverlays";

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-space-grotesk",
  display: "swap",
});

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "0G Sentinel — Agent Security Dashboard",
  description: "On-chain security attestations for AI agents. Powered by 0G Compute, 0G Storage, and 0G Chain.",
  openGraph: {
    title: "0G Sentinel",
    description: "$88.88M in ecosystem grants. Every agent operating blind.",
    siteName: "0G Sentinel",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${spaceGrotesk.variable} ${inter.variable} ${jetbrainsMono.variable}`}>
      <body>
        <GridOverlays />
        {/* Top bar */}
        <header role="banner" className="sg-topbar">
          <a href="/agents" className="sg-topbar-brand">
            0G <span>Sentinel</span>
          </a>
          <nav className="sg-topbar-nav">
            <a href="/agents" className="sg-topbar-link">Dashboard</a>
            <a href="/proof" className="sg-topbar-link">Proof</a>
          </nav>
          <div className="sg-topbar-status">
            <span className="sg-topbar-dot" />
            <span>Live · 0G Aristotle · 16661</span>
          </div>
        </header>
        <main id="main-content">
          {children}
        </main>
      </body>
    </html>
  );
}
