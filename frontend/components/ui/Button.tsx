"use client";

import { forwardRef, type ButtonHTMLAttributes, type MouseEvent } from "react";

export type ButtonVariant = "primary" | "secondary" | "quiet" | "destructive";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  pending?: boolean;
  pendingLabel?: string;
  variant?: ButtonVariant;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { children, className = "", disabled = false, onClick, pending = false,
    pendingLabel = "Working…", type = "button", variant = "secondary", ...props },
  ref,
) {
  const state = disabled ? "disabled" : pending ? "pending" : "idle";
  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    if (pending) { event.preventDefault(); event.stopPropagation(); return; }
    onClick?.(event);
  };

  return (
    <button {...props} ref={ref} type={type} disabled={disabled} onClick={handleClick}
      aria-busy={pending} aria-disabled={pending || undefined}
      className={`ui-button ui-button--${variant} ui-button--${state} ${className}`.trim()}
      data-state={state} data-variant={variant}>
      <span className="ui-button__content">
        <span className="ui-button__label" aria-hidden={pending}>{children}</span>
        <span className="ui-button__label ui-button__pending-label" aria-hidden={!pending}>{pendingLabel}</span>
      </span>
    </button>
  );
});
