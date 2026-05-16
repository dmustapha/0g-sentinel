"use client";
// File: frontend/components/AnimatedScoreBar.tsx
import { useEffect, useRef } from "react";

interface Props {
  score: number;
}

export function AnimatedScoreBar({ score }: Props) {
  const fillRef = useRef<HTMLDivElement>(null);
  const color = score >= 60 ? "#f43f5e" : score >= 30 ? "#fbbf24" : "#10b981";

  useEffect(() => {
    const el = fillRef.current;
    if (!el) return;
    el.style.width = "0%";
    const raf = requestAnimationFrame(() => {
      el.style.transition = "width 1.2s cubic-bezier(0.25, 0.46, 0.45, 0.94)";
      el.style.width = `${score}%`;
    });
    return () => cancelAnimationFrame(raf);
  }, [score]);

  return (
    <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginTop: 6 }}>
      <div className="sg-score-bar" style={{ flex: 1 }}>
        <div
          ref={fillRef}
          className="sg-score-bar-fill"
          style={{ width: 0, background: color }}
        />
      </div>
      <span className="sg-mono" style={{ color, minWidth: 36, textAlign: "right" }}>
        {score}/100
      </span>
    </div>
  );
}
