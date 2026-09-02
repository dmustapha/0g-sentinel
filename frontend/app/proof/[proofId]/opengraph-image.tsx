import { ImageResponse } from "next/og";

export const runtime = "edge";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "0G Sentinel ProofLock proof route locator";

export default function Image({ params }: { params: { proofId: string } }) {
  const proof = /^(?!0x0{64}$)0x[0-9a-f]{64}$/i.test(params.proofId)
    ? `${params.proofId.slice(0, 10)}…${params.proofId.slice(-8)}` : "Invalid proof identifier";
  return new ImageResponse(<div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column",
    justifyContent: "space-between", padding: "62px", background: "#050810", color: "#e8eef6",
    borderTop: "12px solid #06b6d4", fontFamily: "sans-serif" }}>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
      <b style={{ fontSize: 30 }}>0G SENTINEL · PROOFLOCK</b>
      <span style={{ fontSize: 18, color: "#9db0c6" }}>NETWORK · CHAIN ID 16661</span></div>
    <div style={{ display: "flex", flexDirection: "column" }}>
      <span style={{ color: "#06b6d4", fontSize: 22, letterSpacing: 3 }}>PROOF ROUTE LOCATOR</span>
      <strong style={{ fontSize: 66, lineHeight: 1.05, marginTop: 14 }}>Route parameter · {proof}</strong>
      <span style={{ color: "#9db0c6", fontSize: 28, marginTop: 22 }}>Syntactic locator only · reproduce evidence on the detail page</span></div>
    <div style={{ display: "flex", color: "#9db0c6", fontSize: 19 }}>
      Proof existence and verification are resolved on the application. No share-card verdict is asserted.
    </div>
  </div>, size);
}
