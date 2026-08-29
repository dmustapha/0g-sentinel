"use client";

import { useEffect, useState, type HTMLAttributes } from "react";
import { VERIFIER_CLAIM_COPY } from "../../lib/prooflock-claims";
import { safeDisplayText } from "../../lib/safe-display";

export interface DataRowProps extends Omit<HTMLAttributes<HTMLDivElement>, "children"> {
  copyable?: boolean;
  displayValue?: string;
  external?: boolean;
  href?: string;
  label: string;
  technical?: boolean;
  value?: string | number | null;
}

export function DataRow({ className = "", copyable = false, displayValue, external = false,
  href, label, technical = true, value, ...props }: DataRowProps) {
  const canonical = canonicalValue(value);
  const visible = visibleValue(canonical, displayValue, technical);
  const link = canonical && href && safeHref(href, external) ? href : null;
  const content = technical
    ? <bdi dir="ltr" className="ui-data-row__technical-value break">{visible}</bdi>
    : <bdi className="ui-data-row__text-value">{visible}</bdi>;
  return (
    <div {...props} className={`ui-data-row ${className}`.trim()}>
      <dt className="ui-data-row__label">{label}</dt>
      <dd className="ui-data-row__value">
        {link ? <a href={link} target={external ? "_blank" : undefined}
          rel={external ? "noopener noreferrer" : undefined}
          referrerPolicy={external ? "no-referrer" : undefined}>{content}</a> : content}
        {copyable && canonical ? <CopyControl canonical={canonical} label={label} /> : null}
      </dd>
    </div>
  );
}

function CopyControl({ canonical, label }: Readonly<{ canonical: string; label: string }>) {
  const [state, setState] = useState<"idle" | "success" | "error">("idle");
  useEffect(() => setState("idle"), [canonical]);
  const copy = async () => {
    try {
      if (!navigator.clipboard) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(canonical);
      setState("success");
    } catch {
      setState("error");
    }
  };
  const labelPrefix = state === "success" ? "Copied" : state === "error" ? "Retry copy" : "Copy";
  return <><button type="button" onClick={copy} data-copy-state={state}
    aria-label={`${labelPrefix} ${label}`}>{state === "error" ? "Retry" : labelPrefix}</button>
    {state === "error" ? <span className="ui-data-row__copy-error" role="alert">
      Clipboard unavailable. Try again.</span> : null}</>;
}

function canonicalValue(value: DataRowProps["value"]): string | null {
  if (value == null) return null;
  const canonical = String(value);
  return safeDisplayText(canonical).trim() ? canonical : null;
}

function visibleValue(canonical: string | null, display: string | undefined, technical: boolean): string {
  if (canonical == null) return VERIFIER_CLAIM_COPY.evidence.unavailableValue;
  if (display !== undefined) return safeDisplayText(display);
  return technical ? canonical : safeDisplayText(canonical);
}

function safeHref(href: string, external: boolean): boolean {
  if (!external) return safeSameContextHref(href);
  try {
    const url = new URL(href);
    return url.origin === "https://chainscan.0g.ai" && !url.username && !url.password
      && !url.search && !url.hash && validExplorerPath(url.pathname);
  } catch {
    return false;
  }
}

function safeSameContextHref(href: string): boolean {
  if (/\\|[\u0000-\u001f]|%5c|%2f/i.test(href)) return false;
  return /^\/(?!\/)/.test(href) || /^#[^#]/.test(href);
}

function validExplorerPath(pathname: string): boolean {
  return /^\/tx\/0x(?!0{64}$)[0-9a-f]{64}$/i.test(pathname)
    || /^\/address\/0x(?!0{40}$)[0-9a-f]{40}$/i.test(pathname);
}
