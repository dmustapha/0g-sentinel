"use client";

import { useId, useState, type ReactNode } from "react";

// A friendly, keyboard-operable "Technical evidence" disclosure. It keeps all technical content
// mounted in the DOM (so it stays copyable, linkable, and referenced by ID) while collapsing it
// visually through CSS until requested. Visibility is class-driven rather than the `hidden`
// attribute so the panel content remains reachable to assistive tech coordinates it already owns.
export function TechnicalDisclosure({ children, defaultOpen = false, summary, hint }: Readonly<{
  children: ReactNode;
  defaultOpen?: boolean;
  summary: string;
  hint?: string;
}>) {
  const [open, setOpen] = useState(defaultOpen);
  const panelId = `disclosure-${useId().replaceAll(":", "")}`;
  return (
    <section className="ui-disclosure" data-open={open ? "true" : "false"}>
      <button type="button" className="ui-disclosure__trigger" aria-expanded={open}
        aria-controls={panelId} onClick={() => setOpen((value) => !value)}>
        <span className="ui-disclosure__mark" aria-hidden="true">{open ? "-" : "+"}</span>
        <span className="ui-disclosure__summary">{summary}</span>
        {hint ? <span className="ui-disclosure__hint">{hint}</span> : null}
      </button>
      <div id={panelId} className="ui-disclosure__panel" role="region" aria-label={summary}>{children}</div>
    </section>
  );
}
