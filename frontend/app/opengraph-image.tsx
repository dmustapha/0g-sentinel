import { ImageResponse } from "next/og";

export const runtime = "edge";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "0G Sentinel ProofLock policy-scoped agent admission";

export default function Image() {
  return new ImageResponse(<div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column",
    justifyContent: "space-between", padding: "62px", background: "#111214", color: "#f2efe8",
    borderTop: "12px solid #ad72ff", fontFamily: "sans-serif" }}>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
      <b style={{ fontSize: 30 }}>0G SENTINEL · PROOFLOCK</b>
      <span style={{ fontSize: 18, color: "#a7a39b" }}>0G MAINNET · 16661</span>
    </div>
    <div style={{ display: "flex", flexDirection: "column" }}>
      <span style={{ color: "#ad72ff", fontSize: 22, letterSpacing: 3 }}>POLICY-SCOPED EVIDENCE</span>
      <strong style={{ fontSize: 76, lineHeight: 1.05, marginTop: 14 }}>Policy-scoped agent admission</strong>
      <span style={{ color: "#a7a39b", fontSize: 28, marginTop: 22 }}>
        Identity-bound evidence · versioned leases · reason-coded Gate decisions
      </span>
    </div>
    <div style={{ display: "flex", color: "#a7a39b", fontSize: 19 }}>
      Current status is read on the application. This card makes no agent verdict.
    </div>
  </div>, size);
}
