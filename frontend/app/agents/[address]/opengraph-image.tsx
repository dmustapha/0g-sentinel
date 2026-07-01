// File: frontend/app/agents/[address]/opengraph-image.tsx
// D2 — shareable verdict card. Next.js file-based dynamic OG image: when an agent report
// link is shared (X, Discord, Telegram, etc.) this branded 1200x630 card auto-renders in the
// feed, reading the live on-chain attestation. Doubles as a downloadable PNG (a Download button
// on the report links straight to this route). Surfaces the C1 "verified on 0G" stamp and the
// C3 "two independent audits" claim — the viral unit for the community vote.
import { ImageResponse } from "next/og";
import { getAttestationRegistry } from "@/lib/contracts";
import { THREAT_LABELS, CODE_RISK_LABELS } from "@/lib/types";

export const runtime = "nodejs";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "0G Agent Watch: agent security verdict";

const THREAT_COLOR = ["#10b981", "#fbbf24", "#f43f5e"]; // SAFE / CAUTION / FLAGGED
const BG = "#08010e";

interface CardData {
  threatLevel: 0 | 1 | 2;
  behavioralScore: number;
  codeRisk: 0 | 1 | 2;
  reason: string;
}

function firstSentence(text: string, max = 140): string {
  if (!text) return "";
  const cut = text.split(/(?<=[.!?])\s/)[0] || text;
  const s = cut.length > max ? cut.slice(0, max - 1).trimEnd() + "…" : cut;
  return s;
}

async function readCard(address: string): Promise<CardData | null> {
  try {
    const registry = getAttestationRegistry();
    if (!(await registry.hasAttestation(address))) return null;
    const raw = await registry.getAttestation(address);
    return {
      threatLevel: Number(raw.threat_level) as 0 | 1 | 2,
      behavioralScore: Number(raw.behavioral_score),
      codeRisk: Number(raw.code_risk) as 0 | 1 | 2,
      reason: firstSentence(raw.reasoning || ""),
    };
  } catch {
    return null;
  }
}

export default async function Image({ params }: { params: { address: string } }) {
  let address = params.address;
  try {
    const { ethers } = await import("ethers");
    address = ethers.getAddress(params.address.toLowerCase());
  } catch { /* leave as-is; render still works */ }
  const short = `${address.slice(0, 8)}…${address.slice(-6)}`;
  const data = await readCard(address);

  const accent = data ? THREAT_COLOR[data.threatLevel] : "#06b6d4";
  const verdict = data ? THREAT_LABELS[data.threatLevel] ?? "UNKNOWN" : "UNSCANNED";
  const codeLabel = data ? CODE_RISK_LABELS[data.codeRisk] ?? "UNKNOWN" : "";

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          background: `linear-gradient(150deg, ${accent}26, ${BG} 46%)`,
          padding: "56px 64px",
          borderTop: `10px solid ${accent}`,
          fontFamily: "sans-serif",
          color: "#ffffff",
        }}
      >
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", fontSize: 30, fontWeight: 800, letterSpacing: 1 }}>
              0G AGENT WATCH
            </div>
            <div style={{ display: "flex", fontSize: 18, color: "#8a8f98", marginTop: 4 }}>
              live threat intelligence for the agent economy
            </div>
          </div>
          <div
            style={{
              display: "flex",
              fontSize: 18,
              fontWeight: 700,
              color: accent,
              border: `2px solid ${accent}66`,
              borderRadius: 999,
              padding: "8px 18px",
            }}
          >
            0G Aristotle · 16661
          </div>
        </div>

        {/* Verdict block */}
        <div style={{ display: "flex", flexDirection: "column", marginTop: 46 }}>
          <div style={{ display: "flex", fontSize: 24, color: "#8a8f98", letterSpacing: 2 }}>
            VERDICT
          </div>
          <div style={{ display: "flex", alignItems: "flex-end", marginTop: 6 }}>
            <div style={{ display: "flex", fontSize: 132, fontWeight: 900, color: accent, lineHeight: 1 }}>
              {verdict}
            </div>
            {data && (
              <div style={{ display: "flex", flexDirection: "column", marginLeft: 40, marginBottom: 14 }}>
                <div style={{ display: "flex", fontSize: 64, fontWeight: 800, color: "#ffffff", lineHeight: 1 }}>
                  {data.behavioralScore}
                  <span style={{ display: "flex", fontSize: 26, color: "#8a8f98", fontWeight: 400, marginLeft: 4, marginTop: 26 }}>
                    /100
                  </span>
                </div>
                <div style={{ display: "flex", fontSize: 20, color: "#8a8f98", marginTop: 4 }}>
                  behavioral risk
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Reason / CTA */}
        <div style={{ display: "flex", marginTop: 30, maxWidth: 1000 }}>
          <div style={{ display: "flex", fontSize: 30, color: "#d5d7db", lineHeight: 1.35 }}>
            {data ? `“${data.reason}”` : "Paste any 0G agent address to generate a verified on-chain security verdict."}
          </div>
        </div>

        {/* Footer stamps */}
        <div style={{ display: "flex", alignItems: "center", marginTop: "auto", gap: 14 }}>
          {data && (
            <div
              style={{
                display: "flex",
                fontSize: 20,
                fontWeight: 700,
                color: "#06b6d4",
                border: "2px solid #06b6d466",
                borderRadius: 10,
                padding: "8px 16px",
              }}
            >
              ✓ verified on 0G
            </div>
          )}
          {data && (
            <div
              style={{
                display: "flex",
                fontSize: 20,
                fontWeight: 700,
                color: "#a78bfa",
                border: "2px solid #a78bfa66",
                borderRadius: 10,
                padding: "8px 16px",
              }}
            >
              2 independent audits · code {codeLabel}
            </div>
          )}
          <div style={{ display: "flex", marginLeft: "auto", fontSize: 22, color: "#8a8f98", fontFamily: "monospace" }}>
            {short}
          </div>
        </div>
      </div>
    ),
    { ...size }
  );
}
