import { ImageResponse } from "next/og";

export const runtime = "edge";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "0G Sentinel ProofLock agent identity detail";

export default function Image({ params }: { params: { address: string } }) {
  const valid = /^(0|[1-9]\d*)$/.test(params.address);
  return new ImageResponse(<div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column",
    justifyContent: "space-between", padding: "62px", background: "#111214", color: "#f2efe8", borderTop: "12px solid #ad72ff", fontFamily: "sans-serif" }}>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}><b style={{ fontSize: 30 }}>0G SENTINEL · PROOFLOCK</b>
      <span style={{ fontSize: 18, color: "#a7a39b" }}>0G MAINNET · 16661</span></div>
    <div style={{ display: "flex", flexDirection: "column" }}><span style={{ color: "#ad72ff", fontSize: 22, letterSpacing: 3 }}>CANONICAL ERC-8004 IDENTITY</span>
      <strong style={{ fontSize: 110, lineHeight: 1.05, marginTop: 14 }}>{valid ? `Agent #${params.address}` : "Invalid Agent ID"}</strong>
      <span style={{ color: "#a7a39b", fontSize: 28, marginTop: 22 }}>Policy-scoped admission · exact 0G evidence · stable Gate reasons</span></div>
    <div style={{ display: "flex", color: "#a7a39b", fontSize: 19 }}>Current status is read live on the detail page. No share-card verdict is fabricated.</div>
  </div>, size);
}
