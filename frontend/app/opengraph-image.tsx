import { ImageResponse } from "next/og";

export const runtime = "edge";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "0G Sentinel ProofLock policy-scoped agent admission";

export default function Image() {
  return new ImageResponse(<div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column",
    justifyContent: "space-between", padding: "62px", background: "#050810", color: "#e8eef6",
    borderTop: "12px solid #06b6d4", fontFamily: "sans-serif" }}>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
      <b style={{ fontSize: 30 }}>0G SENTINEL · PROOFLOCK</b>
      <span style={{ fontSize: 18, color: "#9db0c6" }}>NETWORK · CHAIN ID 16661</span>
    </div>
    <div style={{ display: "flex", flexDirection: "column" }}>
      <span style={{ color: "#06b6d4", fontSize: 22, letterSpacing: 3 }}>POLICY-SCOPED EVIDENCE</span>
      <strong style={{ fontSize: 76, lineHeight: 1.05, marginTop: 14 }}>Policy-scoped agent admission</strong>
      <span style={{ color: "#9db0c6", fontSize: 28, marginTop: 22 }}>
        Identity-bound evidence · versioned leases · reason-coded Gate decisions
      </span>
    </div>
    <div style={{ display: "flex", color: "#9db0c6", fontSize: 19 }}>
      Current status is read on the application. This card makes no agent verdict.
    </div>
  </div>, size);
}
