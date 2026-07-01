// File: frontend/app/layout.tsx
import type { Metadata } from "next";
import { Chakra_Petch, IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";
import Image from "next/image";
import "./globals.css";
import { GridOverlays } from "@/components/GridOverlays";
import { NavLinks } from "@/components/NavLinks";

const chakra = Chakra_Petch({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-chakra",
  display: "swap",
});

const plexSans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-plex-sans",
  display: "swap",
});

const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-plex-mono",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"),
  icons: { icon: "/favicon.ico", apple: "/logo.png" },
  title: "0G Agent Watch · live threat intelligence for the agent economy",
  description: "On-chain security attestations for AI agents. Behavioral audit, code scan, and immutable verdicts on 0G Compute, 0G Storage, and 0G Chain.",
  openGraph: {
    title: "0G Agent Watch · live threat intelligence for the agent economy",
    description: "Behavioral audit, code scan, on-chain proof. Every AI agent on 0G Aristotle, verified.",
    siteName: "0G Sentinel",
    images: [{ url: "/dashboard.png", width: 1280, height: 800, alt: "0G Agent Watch · agent security radar" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "0G Agent Watch · live threat intelligence for the agent economy",
    description: "Behavioral audit, code scan, on-chain proof. Every AI agent on 0G Aristotle, verified.",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${chakra.variable} ${plexSans.variable} ${plexMono.variable}`}>
      <body>
        <GridOverlays />
        {/* Top bar */}
        <header role="banner" className="sg-topbar">
          <a href="/" className="sg-topbar-brand" style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <Image src="/logo.png" alt="0G Sentinel" width={26} height={26} style={{ borderRadius: "5px" }} />
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
