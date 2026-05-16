// File: frontend/app/layout.tsx
import type { Metadata } from "next";
import { Syne, DM_Mono } from "next/font/google";
import Image from "next/image";
import "./globals.css";
import { GridOverlays } from "@/components/GridOverlays";
import { NavLinks } from "@/components/NavLinks";

const syne = Syne({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-syne",
  display: "swap",
});

const dmMono = DM_Mono({
  subsets: ["latin"],
  weight: ["300", "400", "500"],
  variable: "--font-dm-mono",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"),
  icons: { icon: "/favicon.ico", apple: "/logo.png" },
  title: "0G Sentinel: Agent Security Dashboard",
  description: "On-chain security attestations for AI agents. Powered by 0G Compute, 0G Storage, and 0G Chain.",
  openGraph: {
    title: "0G Sentinel",
    description: "$88.88M in ecosystem grants. Every agent operating blind.",
    siteName: "0G Sentinel",
    images: [{ url: "/dashboard.png", width: 1280, height: 800, alt: "0G Sentinel Agent Dashboard" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "0G Sentinel: Agent Security Dashboard",
    description: "$88.88M in ecosystem grants. Every agent operating blind.",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${syne.variable} ${dmMono.variable}`}>
      <body>
        <GridOverlays />
        {/* Top bar */}
        <header role="banner" className="sg-topbar">
          <a href="/" className="sg-topbar-brand" style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <Image src="/logo.png" alt="0G Sentinel" width={28} height={28} style={{ borderRadius: "4px" }} />
            0G <span>Sentinel</span>
          </a>
          <NavLinks />
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
