// File: frontend/app/layout.tsx
import type { Metadata } from "next";
import { Chakra_Petch, IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";
import { NavLinks } from "@/components/NavLinks";

const chakra = Chakra_Petch({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-chakra",
  display: "swap",
});

const plexSans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500"],
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
  applicationName: "0G Sentinel ProofLock",
  category: "technology",
  formatDetection: { address: false, email: false, telephone: false },
  icons: { icon: "/favicon.ico" },
  title: {
    default: "0G Sentinel ProofLock · policy-scoped agent admission",
    template: "%s · 0G Sentinel",
  },
  description: "Identity-bound, versioned admission leases backed by verified 0G Compute, root-matched 0G Storage evidence, and reason-coded AgentGateV2 decisions.",
  openGraph: {
    title: "0G Sentinel ProofLock",
    description: "Policy-scoped agent admission with versioned, append-preserved proof history on 0G.",
    siteName: "0G Sentinel",
    type: "website",
    locale: "en_US",
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
        <Link href="#main-content" className="sr-only focus:not-sr-only">Skip to main content</Link>
        <div className="texture" aria-hidden="true" />

        <header className="topbar">
          <div className="topbar-inner">
            <Link href="/" className="wordmark">
              <span className="mk" aria-hidden="true" />
              0G Sentinel
            </Link>
            <NavLinks />
            <span className="network-tag">Network configuration · Chain ID 16661</span>
          </div>
        </header>

        <main id="main-content">{children}</main>

        <footer>
          <div className="wrap foot-inner">
            <span className="fmk">0G Sentinel</span>
            <span className="fnet">ProofLock V2 · Network configuration · Chain ID 16661</span>
            <a className="flink" href="https://chainscan.0g.ai" target="_blank" rel="noopener noreferrer">
              0G Explorer ↗
            </a>
          </div>
        </footer>
      </body>
    </html>
  );
}
