// File: frontend/app/layout.tsx
import type { Metadata } from "next";
import { Chakra_Petch, IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";
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
  icons: { icon: "/favicon.ico" },
  other: { "ory-verify": "orynth-19957cf4753042679cc129c11f28707c" },
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
        <div className="texture" aria-hidden="true" />

        <header className="topbar">
          <div className="topbar-inner">
            <a href="/" className="wordmark">
              <span className="mk" aria-hidden="true" />
              0G Sentinel
            </a>
            <NavLinks />
            <span className="status-pill">
              <span className="dot" aria-hidden="true" />
              LIVE · <span className="pill-mid">0G Aristotle · </span>16661
            </span>
          </div>
        </header>

        <main id="main-content">{children}</main>

        <footer>
          <div className="wrap foot-inner">
            <span className="fmk">0G Sentinel</span>
            <span className="fnet">Live on 0G Aristotle · Chain ID 16661</span>
            <a className="flink" href="https://chainscan.0g.ai" target="_blank" rel="noopener noreferrer">
              0G Explorer ↗
            </a>
          </div>
        </footer>
      </body>
    </html>
  );
}
