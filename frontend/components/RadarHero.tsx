"use client";
// File: frontend/components/RadarHero.tsx
// The signature — a live mission-control radar scope. Decorative/representative:
// concentric range rings, crosshairs + coordinate ticks, a continuously rotating
// cyan sweep beam (conic-gradient + glowing line), agent blips (faint cyan neutral,
// two pulsing red = FLAGGED). CSS-first; sweep disables under prefers-reduced-motion.

interface RadarHeroProps {
  compact?: boolean;
}

// Coordinate ticks (degrees) around the scope.
const TICKS = [30, 75, 120, 210, 255, 310];

// Blips: representative agent field. faint/neutral cyan, two hot (FLAGGED).
const BLIPS: { top: string; left: string; kind: "" | "faint" | "hot" }[] = [
  { top: "32%", left: "40%", kind: "faint" },
  { top: "58%", left: "63%", kind: "" },
  { top: "44%", left: "70%", kind: "faint" },
  { top: "38%", left: "58%", kind: "hot" },
  { top: "66%", left: "38%", kind: "faint" },
  { top: "70%", left: "56%", kind: "" },
  { top: "52%", left: "30%", kind: "faint" },
  { top: "64%", left: "47%", kind: "hot" },
  { top: "28%", left: "56%", kind: "faint" },
];

export function RadarHero({ compact = false }: RadarHeroProps) {
  return (
    <div
      className={`radar-stage${compact ? " compact" : ""} sg-reveal-left`}
      role="img"
      aria-label="Live radar sweeping the agent field on 0G Aristotle. Most agents read neutral cyan, two read hot red for FLAGGED."
    >
      <div className="radar">
        <div className="radar-ring r1" />
        <div className="radar-ring r2" />
        <div className="radar-ring r3" />
        <div className="radar-ring r4" />
        <div className="radar-cross-h" />
        <div className="radar-cross-v" />
        {TICKS.map((deg) => (
          <div
            key={deg}
            className="radar-tick"
            style={{ transform: `translate(0,-50%) rotate(${deg}deg)` }}
          />
        ))}
        <div className="radar-sweep" aria-hidden />
        <div className="radar-sweep-line" aria-hidden />
        {BLIPS.map((b, i) => (
          <div
            key={i}
            className={`radar-blip${b.kind ? " " + b.kind : ""}`}
            style={{ top: b.top, left: b.left }}
          />
        ))}
        <div className="radar-center" />
        <span className="radar-readout tl">
          SCAN 0G-ARISTOTLE
          <br />
          RNG 16661
        </span>
        <span className="radar-readout br">
          SWEEP 04.6s
          <br />
          BLIPS 09
        </span>
      </div>
      <span className="radar-badge">
        tracking agent field · <b>2 FLAGGED</b>
      </span>
    </div>
  );
}
