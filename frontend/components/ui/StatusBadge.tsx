import type { HTMLAttributes } from "react";
import { OBSERVATION_PRESENTATION } from "../../lib/prooflock-observations";
import type { ObservationStatus } from "../../lib/prooflock-types";

const STATUS_CONTENT = Object.freeze({
  VERIFIED: { label: "Verified", mark: "✓" },
  BLOCKED: { label: "Blocked", mark: "×" },
  UNAVAILABLE: { label: "Unavailable", mark: "—" },
  STALE: { label: "Stale", mark: "◷" },
  MISMATCH: { label: "Mismatch", mark: "!" },
  NOT_APPLICABLE: { label: "Not applicable", mark: "○" },
} satisfies Record<ObservationStatus, Readonly<{ label: string; mark: string }>>);

export interface StatusBadgeProps extends Omit<HTMLAttributes<HTMLSpanElement>, "children"> {
  status: ObservationStatus;
  surface?: "dark" | "paper";
}

export function StatusBadge({ className = "", status, surface = "dark", ...props }: StatusBadgeProps) {
  const content = STATUS_CONTENT[status];
  return (
    <span {...props} aria-label={`Status: ${content.label}`} data-status={status}
      data-surface={surface} data-tone={OBSERVATION_PRESENTATION[status].tone}
      className={`ui-status-badge ${className}`.trim()}>
      <span className="ui-status-badge__mark" aria-hidden="true">{content.mark}</span>{content.label}
    </span>
  );
}
