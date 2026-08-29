import { forwardRef, useId, type HTMLAttributes, type ReactNode } from "react";

export interface EvidenceSheetProps extends Omit<HTMLAttributes<HTMLElement>, "title"> {
  eyebrow?: ReactNode;
  title: ReactNode;
}

export const EvidenceSheet = forwardRef<HTMLElement, EvidenceSheetProps>(function EvidenceSheet(
  { children, className = "", eyebrow, title, ...props }, ref,
) {
  const headingId = useId();
  return (
    <section {...props} ref={ref} aria-labelledby={headingId} data-surface="paper"
      className={`ui-evidence-sheet ${className}`.trim()}>
      <div className="ui-evidence-sheet__clip">
        {eyebrow ? <div className="ui-evidence-sheet__eyebrow" aria-hidden="true">{eyebrow}</div> : null}
        <h2 id={headingId} className="ui-evidence-sheet__title">{title}</h2>
        <div className="ui-evidence-sheet__body">{children}</div>
      </div>
    </section>
  );
});
