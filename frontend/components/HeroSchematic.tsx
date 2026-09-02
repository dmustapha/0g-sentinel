// Self-drawing scan-pipeline schematic for the landing hero. Pure SVG + CSS animation (no client
// hooks), so it renders as a server component. The six admission stages — Identity, Checks, Compute,
// Storage, Lease, Gate — are drawn as bracketed node boxes joined by cyan paths that draw themselves
// in via stroke-dashoffset (see app/styles/motion.css). The Gate node reads green (ALLOWED). Under
// prefers-reduced-motion every path shows fully drawn and every node fully opaque.
//
// The visual is decorative; its meaning is carried for assistive tech by the sibling sr-only ordered
// list rendered by the caller and by the <title>/aria-label on the SVG itself. Font sizes live on the
// SVG text elements as presentation attributes (not CSS) so they stay outside the 12px CSS type floor
// while remaining legible at the diagram's native scale.

const NODES = [
  { cls: "n1", num: "01", label: "IDENTITY", sub: "ERC-8004", x: 18, y: 66, w: 92, h: 52 },
  { cls: "n2", num: "02", label: "CHECKS", sub: "OFAC·CA·SS", x: 200, y: 66, w: 110, h: 52 },
  { cls: "n3", num: "03", label: "COMPUTE", sub: "0G · risk model", x: 356, y: 168, w: 108, h: 56 },
  { cls: "n4", num: "04", label: "STORAGE", sub: "0G · proof root", x: 200, y: 242, w: 110, h: 52 },
  { cls: "n5", num: "05", label: "LEASE", sub: "lease attest", x: 18, y: 298, w: 92, h: 52 },
] as const;

const NODE_DELAYS: Record<string, string> = {
  n1: "200ms", n2: "550ms", n3: "900ms", n4: "1250ms", n5: "1600ms", n6: "1950ms",
};

const PATHS = [
  { d: "M110 92 L200 92", delay: "300ms" },
  { d: "M310 92 L410 92 L410 168", delay: "600ms" },
  { d: "M410 224 L410 268 L310 268", delay: "900ms" },
  { d: "M200 268 L110 268 L110 324", delay: "1200ms" },
  { d: "M110 380 L200 380 L310 380", delay: "1500ms" },
] as const;

export function HeroSchematic() {
  return (
    <div className="schematic">
      <p className="schematic-title" id="schematic-desc">
        Scan pipeline schematic: Identity, then Checks, then Compute, then Storage, then Lease, then Gate.
      </p>
      <svg viewBox="0 0 520 448" preserveAspectRatio="xMidYMid meet" role="img"
        aria-labelledby="schematic-desc">
        <line className="dim-tick" x1="14" y1="18" x2="14" y2="30" />
        <line className="dim-tick" x1="506" y1="18" x2="506" y2="30" />
        <line className="dim-tick" x1="14" y1="24" x2="506" y2="24" strokeDasharray="3 3" />
        <text className="dim-anno" x="230" y="20" fontSize={6.5}>SCAN PIPELINE · 6 STAGES</text>

        {PATHS.map((path, index) => (
          <path key={index} className="dpath" d={path.d} style={{ animationDelay: path.delay }} />
        ))}

        <circle className="scandot" r="3">
          <animateMotion dur="4s" repeatCount="indefinite" begin="2.4s"
            path="M110 92 L200 92 M310 92 L410 92 L410 168 M410 224 L410 268 L310 268 M200 268 L110 268 L110 324 M110 380 L310 380" />
        </circle>

        {NODES.map((node) => (
          <g key={node.cls} className={`node-g ${node.cls}`} style={{ animationDelay: NODE_DELAYS[node.cls] }}>
            <rect className="nodebox" x={node.x} y={node.y} width={node.w} height={node.h} rx="2" />
            <NodeBrackets x={node.x} y={node.y} w={node.w} h={node.h} />
            <text className="nnum" x={node.x + 6} y={node.y + 14} fontSize={7}>{node.num}</text>
            <text className="nlabel" x={node.x + 6} y={node.y + 30} fontSize={9}>{node.label}</text>
            <text className="nsub" x={node.x + 6} y={node.y + 42} fontSize={7}>{node.sub}</text>
          </g>
        ))}

        {/* 06 GATE — ALLOWED, drawn green. */}
        <g className="node-g n6" style={{ animationDelay: NODE_DELAYS.n6 }}>
          <rect className="nodebox nodebox--gate" x="310" y="354" width="110" height="52" rx="2" />
          <NodeBrackets x={310} y={354} w={110} h={52} gate />
          <text className="nnum nnum--gate" x="316" y="368" fontSize={7}>06</text>
          <text className="nlabel" x="316" y="384" fontSize={9}>GATE</text>
          <text className="nsub nsub--gate" x="316" y="398" fontSize={7}>ALLOWED ✓</text>
        </g>
      </svg>
    </div>
  );
}

// Four cyan (or green, for the Gate) registration Ls hugging a node box's corners.
function NodeBrackets({ x, y, w, h, gate = false }: Readonly<{
  x: number; y: number; w: number; h: number; gate?: boolean;
}>) {
  const cls = gate ? "nodebracket nodebracket--gate" : "nodebracket";
  const right = x + w;
  const bottom = y + h;
  return (
    <>
      <path className={cls} d={`M${x} ${y + 8} L${x} ${y} L${x + 8} ${y}`} />
      <path className={cls} d={`M${right - 8} ${y} L${right} ${y} L${right} ${y + 8}`} />
      <path className={cls} d={`M${x} ${bottom - 8} L${x} ${bottom} L${x + 8} ${bottom}`} />
      <path className={cls} d={`M${right - 8} ${bottom} L${right} ${bottom} L${right} ${bottom - 8}`} />
    </>
  );
}
