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
  title: "0G Sentinel ProofLock · policy-scoped agent admission",
  description: "Identity-bound, versioned admission leases backed by verified 0G Compute, root-matched 0G Storage evidence, and reason-coded AgentGateV2 decisions.",
  openGraph: {
    title: "0G Sentinel ProofLock",
    description: "Policy-scoped agent admission with versioned, append-preserved proof history on 0G.",
    siteName: "0G Sentinel",
    images: [{ url: "/dashboard.png", width: 1280, height: 800, alt: "0G Sentinel ProofLock evidence ledger" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "0G Sentinel ProofLock",
    description: "Policy-scoped agent admission with exact 0G evidence and stable Gate decisions.",
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
            <span className="network-tag">0G MAINNET · 16661</span>
          </div>
        </header>

        <main id="main-content">{children}</main>

        <footer>
          <div className="wrap foot-inner">
            <span className="fmk">0G Sentinel</span>
            <span className="fnet">ProofLock V2 · 0G Mainnet · Chain ID 16661</span>
            <a className="flink" href="https://chainscan.0g.ai" target="_blank" rel="noopener noreferrer">
              0G Explorer ↗
            </a>
          </div>
        </footer>
      </body>
    </html>
  );
}
