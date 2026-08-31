// File: frontend/components/Logo.tsx
import type { CSSProperties } from "react";

type LogoProps = {
  /** Rendered pixel size of the square mark. Defaults to 22 to match the nav glyph. */
  size?: number;
  /** Accessible title. Set to null to mark the SVG decorative (aria-hidden). */
  title?: string | null;
  className?: string;
  style?: CSSProperties;
};

/**
 * 0G Sentinel mark.
 *
 * Concept: a corner-cut seal (echoing the dossier `clip-path` motif used across
 * the evidence cards) enclosing a keyhole. The keyhole reads two ways at once:
 * as a watchful eye (the sentinel) and as a lock (ProofLock). The frame inherits
 * `currentColor` so the wordmark stays monochrome-friendly; the keyhole carries
 * the single violet accent, so the whole mark still holds up in one flat color.
 */
export function Logo({ size = 22, title = "0G Sentinel", className, style }: LogoProps) {
  const decorative = title === null;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      style={style}
      role={decorative ? undefined : "img"}
      aria-hidden={decorative ? true : undefined}
      aria-label={decorative ? undefined : title}
    >
      {!decorative && <title>{title}</title>}

      {/* Seal frame: a corner-cut shield. Top-right corner is clipped to match
          the evidence-card dossier cut; the base narrows to a sentinel point. */}
      <path
        d="M3 3 H17 L21 7 V12.5 C21 17.4 17.1 20.2 12 22 C6.9 20.2 3 17.4 3 12.5 Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="miter"
      />

      {/* Keyhole: eye and lock. Round bore reads as the iris; the tapered slot
          reads as the lock stem. Filled with the violet accent token. */}
      <circle cx="12" cy="10.4" r="2.7" fill="var(--logo-accent, var(--action-on-dark))" />
      <path
        d="M10.7 11.9 L9.9 16.4 H14.1 L13.3 11.9 Z"
        fill="var(--logo-accent, var(--action-on-dark))"
      />
    </svg>
  );
}
