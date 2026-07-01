"use client";
// File: frontend/components/AnimatedScoreBar.tsx
// The prototype `.rep-bar` — a thin risk bar that fills on mount, colored by
// threshold (>=60 bad, >=30 warn, else good). Used on the agent report card.
import { useEffect, useRef } from "react";

interface Props {
  score: number;
}

export function AnimatedScoreBar({ score }: Props) {
  const fillRef = useRef<HTMLElement>(null);
  const color = score >= 60 ? "var(--bad)" : score >= 30 ? "var(--warn)" : "var(--good)";

  useEffect(() => {
    const el = fillRef.current;
    if (!el) return;
    el.style.width = "0%";
    const raf = requestAnimationFrame(() => {
      el.style.width = `${score}%`;
    });
    return () => cancelAnimationFrame(raf);
  }, [score]);

  return (
    <div className="rep-bar">
      <i ref={fillRef} style={{ background: color, boxShadow: `0 0 12px -2px ${color}` }} />
    </div>
  );
}
