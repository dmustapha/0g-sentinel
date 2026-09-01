import { useEffect, useRef, useState } from "react";

const DEFAULT_DURATION_MS = 600;

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined"
    && typeof window.matchMedia === "function"
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

// Counts a numeric value up from 0 to `target` once, on first appear. Returns the target instantly
// under prefers-reduced-motion or when the environment has no rAF (SSR / tests), so the final number
// is always correct and no layout depends on the interpolated value.
export function useCountUp(target: number | null, durationMs = DEFAULT_DURATION_MS): number {
  const safeTarget = target ?? 0;
  const [value, setValue] = useState(safeTarget);
  const startedFor = useRef<number | null>(null);

  useEffect(() => {
    if (target === null) return;
    if (startedFor.current === target) return;
    startedFor.current = target;

    if (prefersReducedMotion() || typeof requestAnimationFrame !== "function") {
      setValue(target);
      return;
    }
    let frame = 0;
    let start: number | null = null;
    const step = (now: number) => {
      start ??= now;
      const progress = Math.min(1, (now - start) / durationMs);
      // easeOutCubic for a premium settle.
      const eased = 1 - Math.pow(1 - progress, 3);
      setValue(Math.round(eased * target));
      if (progress < 1) frame = requestAnimationFrame(step);
    };
    setValue(0);
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [target, durationMs]);

  return target === null ? safeTarget : value;
}
